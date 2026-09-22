"""Admin analytics: the dispute dashboard and the evidence extract.

Two surfaces with two different jobs, which is why they are two endpoints rather
than one big payload:

  /overview  answers "what happened, and is it us or them?" -- a fixed set of
             figures that stays the same size however much data accumulates.
  /evidence  answers "prove this one trip" -- a filtered, paged list that grows
             without limit and is read by drilling, not scrolling.

Everything here computes from the same checkpoint rows and the same gap targets
the driver app uses (see trips.py), so ops' numbers and a driver's own numbers
can never disagree. Nothing is precomputed or cached: retuning a target has to
re-score history while the target is still being negotiated with Lotus.
"""
from datetime import date, timedelta

from asyncmy.cursors import DictCursor

from clocks import fmt, local_today
from fastapi import APIRouter, Depends, Query, Request

from auth import get_current_admin
from db import get_pool
from photos import trip_photo_map
from trips import (
    active_checkpoints,
    final_checkpoint,
    load_settings,
    trip_end,
    resolve_target,
    CHECKPOINT_ORDER,
    load_schedules,
    schedule_variance,
    slots_for,
    compute_gaps,
    compute_time_at_outlet,
    fetch_checkpoints,
    load_targets,
    owning_party,
    serialize_checkpoint,
    stamps_from,
)

router = APIRouter()

PERIODS = {"today": 1, "l7d": 7, "l1m": 30, "l3m": 90}


def _range_for(period: str, date_from: str | None, date_to: str | None) -> tuple[date, date, date, date]:
    """Returns (start, end, prev_start, prev_end). The previous window is the
    same length immediately before, so 'vs previous period' is like for like."""
    today = local_today()
    if date_from and date_to:
        start, end = date.fromisoformat(date_from), date.fromisoformat(date_to)
    else:
        days = PERIODS.get(period, 7)
        end = today
        start = today - timedelta(days=days - 1)
    span = (end - start).days + 1
    return start, end, start - timedelta(days=span), start - timedelta(days=1)


# How the trend chart should group its points, from the span being looked at.
#
# It used to be weekly always, whatever the filter said -- so "Last 7 days"
# drew one or two week-shaped dots and called it a trend. The grain has to
# follow the question: a week of work is read day by day, a quarter is read
# month by month, and a point should cover something a person can name.
def _bucket_for(start: date, end: date) -> str:
    span = (end - start).days + 1
    if span <= 45:
        return "day"
    if span <= 200:
        return "week"
    return "month"


def _bucket_start(d: date, bucket: str) -> date:
    if bucket == "day":
        return d
    if bucket == "week":
        return d - timedelta(days=d.weekday())
    return d.replace(day=1)


def _bucket_end(start: date, bucket: str) -> date:
    if bucket == "day":
        return start
    if bucket == "week":
        return start + timedelta(days=6)
    nxt = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return nxt - timedelta(days=1)


async def _load_trips(pool, start: date, end: date, warehouse_id: int | None) -> list[dict]:
    where = ["m.work_date BETWEEN %s AND %s", "m.cancelled_at IS NULL"]
    params: list = [start.isoformat(), end.isoformat()]
    if warehouse_id:
        where.append("u.warehouse_id = %s")
        params.append(warehouse_id)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT m.id, m.work_date, m.day_closed_at, m.expected_job_count, m.schedule_slot_no, "
            "m.driver_day_id, u.id AS driver_id, u.name AS driver_name, u.warehouse_id, w.name AS warehouse_name "
            "FROM manifests m JOIN users u ON u.id = m.driver_id "
            "LEFT JOIN warehouses w ON w.id = u.warehouse_id "
            f"WHERE {' AND '.join(where)} ORDER BY m.work_date DESC, m.id DESC",
            tuple(params),
        )
        return await cur.fetchall()


async def _counts(pool, ids: list[int]) -> tuple[dict, dict]:
    if not ids:
        return {}, {}
    ph = ",".join(["%s"] * len(ids))
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            f"SELECT manifest_id, COUNT(*) AS n, SUM(status = 'failed') AS failed "
            f"FROM trip_job WHERE manifest_id IN ({ph}) GROUP BY manifest_id",
            tuple(ids),
        )
        jobs = {r["manifest_id"]: r for r in await cur.fetchall()}
        await cur.execute(
            f"SELECT manifest_id, COUNT(*) AS n, SUM(status_code = 'failed') AS failed "
            f"FROM delivery_jobs WHERE manifest_id IN ({ph}) GROUP BY manifest_id",
            tuple(ids),
        )
        orders = {r["manifest_id"]: r for r in await cur.fetchall()}
    return jobs, orders


async def _scored(pool, rows: list[dict]) -> list[dict]:
    """Attaches checkpoints, gaps, time-at-outlet and the owning party to each
    trip. This is the single place a trip becomes 'disputable' or not."""
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    cps_all = await fetch_checkpoints(pool, ids)
    targets = await load_targets(pool)
    schedules = await load_schedules(pool)
    jobs, orders = await _counts(pool, ids)
    photo_sets = await trip_photo_map(pool, ids)
    ended_cp = final_checkpoint(active_checkpoints(await load_settings(pool)))

    out = []
    for r in rows:
        cps = cps_all.get(r["id"], {})
        stamps = stamps_from(cps)
        gaps = compute_gaps(stamps, targets, r["warehouse_id"])
        tao = compute_time_at_outlet(stamps, targets, r["warehouse_id"])
        party = owning_party(cps, gaps)
        reason = next(
            (cps[g["to_checkpoint"]].get("reason_label")
             for g in gaps if g["over_target"] and g["to_checkpoint"] in cps
             and cps[g["to_checkpoint"]].get("reason_label")),
            None,
        )
        window = schedule_variance(
            slots_for(schedules, r["warehouse_id"]).get(r.get("schedule_slot_no")),
            stamps.get("arrived"), stamps.get("departed"),
        )
        out.append({
            **{k: r[k] for k in ("id", "driver_id", "driver_name", "warehouse_id", "warehouse_name", "driver_day_id")},
            "window": window,
            "missed_window": bool(window and window.get("departed_late_minutes")),
            # Which run of the day this was -- stamped at trip start, so a
            # cancelled or re-ordered later trip can never retro-change it.
            # Read for the window above but never passed on, which is why
            # nothing downstream could split first runs from second ones.
            "schedule_slot_no": r.get("schedule_slot_no"),
            "work_date": str(r["work_date"]),
            "day_closed_at": fmt(r["day_closed_at"]),
            "expected_job_count": r["expected_job_count"],
            "jobs": int((jobs.get(r["id"]) or {}).get("n") or 0),
            "orders": int((orders.get(r["id"]) or {}).get("n") or 0),
            "failed_orders": int((orders.get(r["id"]) or {}).get("failed") or 0),
            "checkpoints": [
                {**serialize_checkpoint(cps[c]),
                 "photo_ids": photo_sets.get((r["id"], c))
                 or ([cps[c]["photo_id"]] if cps[c]["photo_id"] else [])}
                for c in CHECKPOINT_ORDER if c in cps
            ],
            "gaps": gaps,
            "time_at_outlet": tao,
            "over_target": bool(tao and tao["over_target"]),
            "owner": party,
            "reason": reason,
            "started_at": fmt(stamps["arrived"]) if "arrived" in stamps else None,
            # When the trip ended. "Returned to Lotus" while that step is
            # switched on, and whatever now ends a run when it is not -- but a
            # trip that DID come back is over by anyone's reckoning, even if
            # the step has since been switched off, so both are considered and
            # the later one wins. History does not change when a setting does.
            "ended_at": fmt(trip_end(stamps, ended_cp)),
        })
    return out


def _checkpoint_at(trip: dict, checkpoint: str) -> str | None:
    """A checkpoint's local wall-clock stamp, "YYYY-MM-DD HH:MM:SS"."""
    cp = next((c for c in trip["checkpoints"] if c["checkpoint"] == checkpoint), None)
    return (cp or {}).get("occurred_at")


def _clock_minutes(stamp: str | None) -> int | None:
    """Minutes since midnight, from an already-local stamp. Averaging times of
    day only means anything within one day, which is what a shift is."""
    if not stamp or len(stamp) < 16:
        return None
    try:
        return int(stamp[11:13]) * 60 + int(stamp[14:16])
    except ValueError:
        return None


def _hhmm(total) -> str | None:
    if total is None:
        return None
    total = int(round(total))
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def _mean(values: list[int]) -> float | None:
    return sum(values) / len(values) if values else None


# ---------------------------------------------------------------------------
# Arrival and departure, split by which run of the day it was.
#
# The two figures a claim actually turns on: when the truck got to the outlet
# and when it got out, for the first trip and for the second. They were in the
# data all along -- every trip is stamped with its slot at the moment it
# starts -- but every screen averaged all runs together, which hides the thing
# worth seeing. A first run and a second run are measured against DIFFERENT
# contracted windows and behave nothing alike; one mean across both answers
# neither question.
# ---------------------------------------------------------------------------
def _by_trip_of_day(trips: list[dict]) -> tuple[list[dict], int]:
    by_slot: dict = {}
    unnumbered = 0
    for t in trips:
        slot = t.get("schedule_slot_no")
        if slot is None:
            # Trips from before slots were stamped. Counted and reported
            # rather than dropped, so the rows below always add up.
            unnumbered += 1
            continue
        s = by_slot.setdefault(slot, {"slot_no": slot, "arrivals": [], "departures": [],
                                      "at_outlet": [], "trips": 0, "windowed": [], "label": None,
                                      "window_start": None, "window_end": None, "detail": []})
        s["trips"] += 1
        arrived = _clock_minutes(_checkpoint_at(t, "arrived"))
        departed = _clock_minutes(_checkpoint_at(t, "departed"))
        if arrived is not None:
            s["arrivals"].append(arrived)
        if departed is not None:
            s["departures"].append(departed)
        # The trips behind the average, so the average can be checked rather
        # than believed. A mean hides its spread completely: six arrivals
        # averaging 11:40 is equally true of six trucks at 11:40 and of five
        # at nine with one at half past one, and those are different problems.
        s["detail"].append({
            "trip_id": t["id"],
            "work_date": t["work_date"],
            "driver": t["driver_name"],
            "outlet": t["warehouse_name"],
            "arrived": _hhmm(arrived),
            "departed": _hhmm(departed),
            "at_outlet_minutes": t["time_at_outlet"]["minutes"] if t["time_at_outlet"] else None,
        })
        if t["time_at_outlet"]:
            s["at_outlet"].append(t["time_at_outlet"]["minutes"])
        w = t.get("window")
        if w:
            s["label"] = s["label"] or w.get("label")
            s["window_start"] = s["window_start"] or w.get("window_start")
            s["window_end"] = s["window_end"] or w.get("window_end")
            s["windowed"].append(w)

    rows = []
    for slot in sorted(by_slot):
        s = by_slot[slot]
        w = s["windowed"]
        rows.append({
            "slot_no": slot,
            "label": s["label"] or f"Trip {slot}",
            "window_start": s["window_start"],
            "window_end": s["window_end"],
            "trips": s["trips"],
            # The two headline figures, as a time of day rather than a
            # duration -- "arrived 09:48 on average" is the sentence someone
            # says out loud in a meeting with Lotus.
            "avg_arrival": _hhmm(_mean(s["arrivals"])),
            "avg_departure": _hhmm(_mean(s["departures"])),
            "arrivals_recorded": len(s["arrivals"]),
            "departures_recorded": len(s["departures"]),
            # The spread, alongside the middle. Printed only where it is not
            # the same figure twice.
            "arrival_earliest": _hhmm(min(s["arrivals"])) if s["arrivals"] else None,
            "arrival_latest": _hhmm(max(s["arrivals"])) if s["arrivals"] else None,
            "departure_earliest": _hhmm(min(s["departures"])) if s["departures"] else None,
            "departure_latest": _hhmm(max(s["departures"])) if s["departures"] else None,
            # Newest first and capped: this exists to be spot-checked, not
            # scrolled, and a quarter of trips would be thousands of rows.
            "detail": sorted(s["detail"], key=lambda d: (d["work_date"], d["trip_id"]),
                             reverse=True)[:100],
            "detail_truncated": max(0, len(s["detail"]) - 100),
            "avg_at_outlet_minutes": round(_mean(s["at_outlet"])) if s["at_outlet"] else None,
            # TWO denominators, not one. Whether a truck ARRIVED in time is
            # known the moment it arrives; whether it LEFT in time cannot be
            # judged until it has. Scoring both against the trips that have
            # departed threw away the arrival verdict on every run still
            # sitting at the outlet -- which is exactly the run someone is
            # looking at the dashboard to ask about.
            "arrivals_with_window": len(w),
            "arrived_on_time": sum(1 for x in w if x["arrived_on_time"]),
            "departures_with_window": sum(1 for x in w if x["departed_on_time"] is not None),
            "departed_on_time": sum(1 for x in w if x["departed_on_time"]),
            # How far off the contracted times those averages landed, signed:
            # negative is before, positive is after. Sent rather than left to
            # the screen to subtract, because grace minutes live on the
            # schedule and the arithmetic has to agree with the on-time counts
            # sitting next to it.
            "avg_arrival_variance": (
                round(_mean([x["arrival_variance_minutes"] for x in w]))
                if w else None
            ),
            "avg_departure_variance": (
                round(_mean([x["departure_variance_minutes"] for x in w
                             if x["departure_variance_minutes"] is not None]))
                if any(x["departure_variance_minutes"] is not None for x in w) else None
            ),
            "grace_minutes": w[0]["grace_minutes"] if w else 0,
        })
    return rows, unnumbered


def _owned_minutes(trips: list[dict]) -> dict:
    """Minutes over target, split by who owns them. This split is the dashboard:
    Lotus-owned time is what we claim, Ninja Van-owned time is what we concede
    before filing -- conceding it is what keeps the claim credible."""
    totals = {"lotus": 0, "njv": 0, "external": 0}
    for t in trips:
        for g in t["gaps"]:
            if not g["over_target"]:
                continue
            cp = next((c for c in t["checkpoints"] if c["checkpoint"] == g["to_checkpoint"]), None)
            party = (cp or {}).get("fault_party") or g["default_fault_party"]
            if party in totals:
                totals[party] += g["over_by_minutes"]
    return totals


def _avg_at_outlet(trips: list[dict]) -> int | None:
    vals = [t["time_at_outlet"]["minutes"] for t in trips if t["time_at_outlet"]]
    return round(sum(vals) / len(vals)) if vals else None


# ---------------------------------------------------------------------------
# Day on day, week on week, month on month.
#
# The dashboard answered "what happened in the selected period" and stopped
# there, so every figure on it was a number without a direction. Commercial
# cannot act on "3m average at outlet" -- they can act on "3m, up from 1m last
# week, on twice the trips".
#
# Each window is NAMED THE WAY PEOPLE SAY IT -- W38, September -- and runs to
# today against the same slice of the period before: this week so far against
# the same days last week, this month so far against the same days last month.
#
# That "same slice" is the whole trick. Four days of this week against seven of
# last week would report a collapse every Wednesday, and 17 days of September
# against the whole of August would do it once a month. Comparing like spans is
# what makes the arrow mean something.
#
# These windows are FIXED, deliberately independent of the period filter above.
# A comparison whose meaning changes when someone clicks a tab is a comparison
# nobody can quote in a meeting.
# ---------------------------------------------------------------------------

# Fixed, not locale-derived: the frontend hardcodes the same three-letter names
# for exactly the reason a shared dashboard should read the same to everyone.
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _slot_clock(trips: list[dict], slot: int, checkpoint: str) -> int | None:
    """Average time of day, in minutes since midnight, that a given run of the
    day hit a given checkpoint. None when that run did not happen, or did not
    reach that step, in this slice."""
    vals = [
        _clock_minutes(_checkpoint_at(t, checkpoint))
        for t in trips if t.get("schedule_slot_no") == slot
    ]
    vals = [v for v in vals if v is not None]
    return round(_mean(vals)) if vals else None


def _comparison_metrics(trips: list[dict]) -> dict:
    """The measures a commercial reader acts on, for one slice of days."""
    windowed = [t for t in trips if t["window"] and t["window"]["departed_on_time"] is not None]
    drivers = {t["driver_id"] for t in trips}
    return {
        # Arrival and departure per run of the day, carried through the same
        # windows as every other measure. The table further down averages
        # across the whole selected period, which answers "what does a
        # typical first trip look like" and cannot answer "is it getting
        # worse" -- that needs today against yesterday, this week against
        # last, this month against last, which is what this block is.
        "trip1_arrival": _slot_clock(trips, 1, "arrived"),
        "trip1_departure": _slot_clock(trips, 1, "departed"),
        "trip2_arrival": _slot_clock(trips, 2, "arrived"),
        "trip2_departure": _slot_clock(trips, 2, "departed"),
        "trips": len(trips),
        "orders": sum(t["orders"] for t in trips),
        "drivers": len(drivers),
        "trips_per_driver": round(len(trips) / len(drivers), 1) if drivers else None,
        "avg_at_outlet_minutes": _avg_at_outlet(trips),
        "missed_window": sum(1 for t in windowed if not t["window"]["departed_on_time"]),
        "lotus_late_minutes": sum(t["window"]["lotus_late_minutes"] for t in windowed),
    }


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _last_day_of(month_start: date) -> int:
    nxt = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return (nxt - timedelta(days=1)).day


async def _comparisons(pool, warehouse_id: int | None) -> list[dict]:
    """One wide read, sliced six ways -- rather than six round trips for what
    is the same couple of months of trips."""
    today = local_today()
    # Far enough back to cover the 1st of last month on any date.
    rows = await _scored(
        pool, await _load_trips(pool, today - timedelta(days=75), today, warehouse_id)
    )

    by_day: dict = {}
    for t in rows:
        by_day.setdefault(t["work_date"], []).append(t)

    def between(a: date, b: date) -> list[dict]:
        out: list[dict] = []
        d = a
        while d <= b:
            out.extend(by_day.get(d.isoformat(), []))
            d += timedelta(days=1)
        return out

    out: list[dict] = []

    # Day on day walks to the last two days that actually ran. A fleet that
    # does not work Sundays would otherwise report Monday against nothing
    # every week, which is a calendar fact dressed up as a collapse. Both
    # dates are labelled, so a skipped day is visible rather than hidden.
    days_run = sorted(by_day.keys(), reverse=True)
    if len(days_run) >= 2:
        cur_day, prev_day = days_run[0], days_run[1]
        out.append({
            "key": "dod",
            "label": "Day on day",
            "current_prefix": None,
            "previous_prefix": None,
            "current_label": cur_day,
            "previous_label": prev_day,
            # Today is still being worked. Comparing half a day to a whole one
            # and not saying so is how a dashboard lies by omission.
            "partial": cur_day == today.isoformat(),
            "current": _comparison_metrics(by_day[cur_day]),
            "previous": _comparison_metrics(by_day[prev_day]),
        })

    # Week on week, named by ISO week. This week from Monday to today, against
    # the same weekdays of the week before -- Monday to the same weekday.
    week_start = today - timedelta(days=today.weekday())
    prev_week_start = week_start - timedelta(days=7)
    prev_week_end = prev_week_start + timedelta(days=today.weekday())
    out.append({
        "key": "wow",
        "label": "Week on week",
        "current_prefix": f"W{week_start.isocalendar()[1]}",
        "previous_prefix": f"W{prev_week_start.isocalendar()[1]}",
        "current_label": f"{week_start.isoformat()}..{today.isoformat()}",
        "previous_label": f"{prev_week_start.isoformat()}..{prev_week_end.isoformat()}",
        "partial": today.weekday() != 6,
        "current": _comparison_metrics(between(week_start, today)),
        "previous": _comparison_metrics(between(prev_week_start, prev_week_end)),
    })

    # Month on month, named by the month. This month to date, against the same
    # run of dates last month -- 1st to the 17th against the 1st to the 17th.
    # A short previous month clamps to its last day (31 March has no 31
    # February), and because the label prints the real span, the shorter side
    # is visible rather than silently assumed.
    month_start = _month_start(today)
    prev_month_start = _month_start(month_start - timedelta(days=1))
    prev_month_end = prev_month_start.replace(
        day=min(today.day, _last_day_of(prev_month_start))
    )
    out.append({
        "key": "mom",
        "label": "Month on month",
        "current_prefix": MONTH_NAMES[month_start.month - 1],
        "previous_prefix": MONTH_NAMES[prev_month_start.month - 1],
        "current_label": f"{month_start.isoformat()}..{today.isoformat()}",
        "previous_label": f"{prev_month_start.isoformat()}..{prev_month_end.isoformat()}",
        "partial": today.day != _last_day_of(month_start),
        "current": _comparison_metrics(between(month_start, today)),
        "previous": _comparison_metrics(between(prev_month_start, prev_month_end)),
    })

    return out


@router.get("/overview")
async def overview(
    request: Request,
    period: str = Query("l7d"),
    date_from: str | None = None,
    date_to: str | None = None,
    warehouse_id: int | None = None,
    admin=Depends(get_current_admin),
):
    pool = get_pool(request)
    start, end, pstart, pend = _range_for(period, date_from, date_to)

    trips = await _scored(pool, await _load_trips(pool, start, end, warehouse_id))
    prev = await _scored(pool, await _load_trips(pool, pstart, pend, warehouse_id))

    owned, prev_owned = _owned_minutes(trips), _owned_minutes(prev)

    # Against the contract, not just dwell. This is the figure Lotus bills on,
    # and the split says who actually caused each miss: our late arrival is
    # counted first, so a claim never bills them for our own late start.
    windowed = [t for t in trips if t["window"] and t["window"]["departed_on_time"] is not None]
    missed = [t for t in windowed if not t["window"]["departed_on_time"]]
    window_stats = {
        "trips_with_window": len(windowed),
        "missed": len(missed),
        "on_time_rate": round((len(windowed) - len(missed)) / len(windowed) * 100, 1) if windowed else None,
        "late_minutes_njv": sum(t["window"]["njv_late_minutes"] for t in windowed),
        "late_minutes_lotus": sum(t["window"]["lotus_late_minutes"] for t in windowed),
        "late_arrivals": sum(1 for t in windowed if not t["window"]["arrived_on_time"]),
    }
    avg, prev_avg = _avg_at_outlet(trips), _avg_at_outlet(prev)
    breached = sum(1 for t in trips if t["over_target"])

    trip_of_day, unnumbered = _by_trip_of_day(trips)

    # Per-outlet breakdown -- the zoom that shows Puchong and Shah Alam are not
    # the same problem, and shouldn't be averaged into one number.
    by_outlet: dict = {}
    for t in trips:
        key = t["warehouse_name"] or "Unassigned"
        o = by_outlet.setdefault(key, {"outlet": key, "trips": [], "warehouse_id": t["warehouse_id"]})
        o["trips"].append(t)
    outlets = []
    for o in by_outlet.values():
        ot = o["trips"]
        outlets.append({
            "outlet": o["outlet"],
            "warehouse_id": o["warehouse_id"],
            "trips": len(ot),
            "over_target": sum(1 for t in ot if t["over_target"]),
            "avg_at_outlet_minutes": _avg_at_outlet(ot),
            "owned_minutes": _owned_minutes(ot),
            "avg_jobs_per_trip": round(sum(t["jobs"] for t in ot) / len(ot), 1) if ot else 0,
        })
    outlets.sort(key=lambda x: -(x["avg_at_outlet_minutes"] or 0))

    # Reason ranking. Only exists because reasons are coded rather than typed.
    #
    # THIS PANEL REPORTED NOTHING FOR EVERY REASON EVER CODED. It skipped any
    # gap that was not `over_target`, and over_target is false for every gap
    # in the app while per-step allowances are switched off -- which they have
    # been since V20, because the allowances are not agreed with Lotus. So
    # drivers coded reasons diligently and the dashboard answered "nothing
    # coded yet". The reasons were never lost; they are on the checkpoints and
    # visible in Evidence. They were being filtered out on the way to this
    # rollup by a condition that could not be true.
    #
    # A coded reason counts now, allowance or no allowance. What its MINUTES
    # mean depends on whether there is a bar to measure against: the overage
    # where one exists, and otherwise the length of the step the reason
    # explains. Those are different figures, so the payload says which it is
    # rather than letting one number quietly change meaning.
    reasons: dict = {}
    measured_against_allowance = False
    for t in trips:
        for g in t["gaps"]:
            cp = next((c for c in t["checkpoints"] if c["checkpoint"] == g["to_checkpoint"]), None)
            if not cp or not cp.get("reason_label"):
                continue
            r = reasons.setdefault(cp["reason_label"],
                                   {"label": cp["reason_label"], "fault_party": cp["fault_party"],
                                    "minutes": 0, "occurrences": 0})
            if g["target_minutes"] is None:
                r["minutes"] += g["minutes"]
            else:
                measured_against_allowance = True
                r["minutes"] += g["over_by_minutes"] or 0
            r["occurrences"] += 1
    reason_rows = sorted(reasons.values(), key=lambda r: (-r["minutes"], -r["occurrences"]))

    # Trend per outlet, grouped at whatever grain the selected span deserves.
    bucket = _bucket_for(start, end)
    buckets: dict = {}
    for t in trips:
        d = date.fromisoformat(t["work_date"])
        b = _bucket_start(d, bucket).isoformat()
        key = (b, t["warehouse_name"] or "Unassigned")
        buckets.setdefault(key, []).append(t)
    trend = [
        {
            "bucket_start": b,
            # The end as well, because "7 Sep" under a weekly point is a date
            # that is true of one day out of the seven it stands for. A point
            # has to say what it covers.
            "bucket_end": _bucket_end(date.fromisoformat(b), bucket).isoformat(),
            "outlet": outlet,
            "avg_at_outlet_minutes": _avg_at_outlet(v),
            "trips": len(v),
        }
        for (b, outlet), v in sorted(buckets.items())
        if _avg_at_outlet(v) is not None
    ]

    # Manpower. On duty is derivable from trips; rostered is not, which is the
    # whole reason shift_roster exists. Without it "we ran short" is an
    # assertion, and an uncontested assertion is worth nothing in a dispute.
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        rw = ["work_date BETWEEN %s AND %s"]
        rp: list = [start.isoformat(), end.isoformat()]
        if warehouse_id:
            rw.append("warehouse_id = %s")
            rp.append(warehouse_id)
        await cur.execute(
            f"SELECT work_date, COUNT(*) AS rostered FROM shift_roster WHERE {' AND '.join(rw)} GROUP BY work_date",
            tuple(rp),
        )
        rostered = {str(r["work_date"]): r["rostered"] for r in await cur.fetchall()}

    per_day: dict = {}
    for t in trips:
        d = per_day.setdefault(t["work_date"], {"work_date": t["work_date"], "drivers": set(), "trips": 0,
                                                "orders": 0, "over_target": 0, "at_outlet": []})
        d["drivers"].add(t["driver_id"])
        d["trips"] += 1
        d["orders"] += t["orders"]
        if t["over_target"]:
            d["over_target"] += 1
        if t["time_at_outlet"]:
            d["at_outlet"].append(t["time_at_outlet"]["minutes"])
    manpower = []
    for d in sorted(per_day.values(), key=lambda x: x["work_date"], reverse=True):
        on = len(d["drivers"])
        manpower.append({
            "work_date": d["work_date"],
            "on_duty": on,
            "rostered": rostered.get(d["work_date"]),
            "short_handed": rostered.get(d["work_date"]) is not None and on < rostered[d["work_date"]],
            "trips": d["trips"],
            "trips_per_driver": round(d["trips"] / on, 1) if on else 0,
            "orders": d["orders"],
            "avg_at_outlet_minutes": round(sum(d["at_outlet"]) / len(d["at_outlet"])) if d["at_outlet"] else None,
            "over_target": d["over_target"],
        })

    return {
        # The bar the dashboard paints against, or null when time allowances
        # are switched off. It was hardcoded as 55 in four places on the
        # client, so the figures went red against a number nobody had agreed
        # and kept doing it after the allowances were turned off.
        "at_outlet_target": resolve_target(await load_targets(pool), "time_at_outlet", None),
        "period": {"from": start.isoformat(), "to": end.isoformat(),
                   "previous_from": pstart.isoformat(), "previous_to": pend.isoformat()},
        "totals": {
            "trips": len(trips),
            "over_target": breached,
            "breach_rate": round(breached / len(trips) * 100, 1) if trips else None,
            "avg_at_outlet_minutes": avg,
            "avg_at_outlet_previous": prev_avg,
            "avg_delta_minutes": (avg - prev_avg) if (avg is not None and prev_avg is not None) else None,
            "owned_minutes": owned,
            "owned_minutes_previous": prev_owned,
            "jobs": sum(t["jobs"] for t in trips),
            "orders": sum(t["orders"] for t in trips),
        },
        "window": window_stats,
        "trip_of_day": trip_of_day,
        "trips_unnumbered": unnumbered,
        "outlets": outlets,
        "reasons": reason_rows,
        # Whether the minutes beside each reason are time OVER an allowance or
        # the whole length of the step. Same column, two different meanings --
        # the screen has to be able to say which.
        "reasons_over_allowance": measured_against_allowance,
        "trend": trend,
        "trend_bucket": bucket,
        "manpower": manpower,
        # Fixed windows, independent of the period filter -- see _comparisons.
        "comparisons": await _comparisons(pool, warehouse_id),
        "roster_configured": bool(rostered),
    }


def _group_by_day(trips: list[dict]) -> list[dict]:
    """Trips folded under the driver_day each one belongs to, newest day
    first -- everything one driver ran on one date, which is the question a
    dispute or a roster check actually asks, not "how was trip 3000006" on
    its own. A day exists here only if it still has a trip surviving the
    filters above; an empty day is not evidence of anything."""
    by_day: dict[int, dict] = {}
    for t in trips:
        day = by_day.setdefault(t["driver_day_id"], {
            "driver_day_id": t["driver_day_id"],
            "driver_id": t["driver_id"],
            "driver_name": t["driver_name"],
            "warehouse_id": t["warehouse_id"],
            "warehouse_name": t["warehouse_name"],
            "work_date": t["work_date"],
            "trips": [],
        })
        day["trips"].append(t)

    rows = []
    for day in by_day.values():
        ts = day["trips"]
        rows.append({
            **day,
            "trip_count": len(ts),
            "jobs_total": sum(t["jobs"] for t in ts),
            "orders_total": sum(t["orders"] for t in ts),
            "over_target_count": sum(1 for t in ts if t["over_target"]),
        })
    rows.sort(key=lambda d: (d["work_date"], d["driver_name"] or ""), reverse=True)
    return rows


@router.get("/evidence")
async def evidence(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    warehouse_id: int | None = None,
    driver_id: int | None = None,
    owner: str | None = None,
    over_target_only: bool = False,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
    admin=Depends(get_current_admin),
):
    """The detail extract, grouped by day. Paginated by day rather than by
    trip, so a day's trips can never be split across a page boundary -- a
    day's own totals (jobs, orders, over-target count) would otherwise be
    wrong on whichever page happened to hold the rest of it."""
    pool = get_pool(request)
    end = date.fromisoformat(date_to) if date_to else local_today()
    start = date.fromisoformat(date_from) if date_from else end - timedelta(days=29)

    trips = await _scored(pool, await _load_trips(pool, start, end, warehouse_id))

    if driver_id:
        trips = [t for t in trips if t["driver_id"] == driver_id]
    if owner:
        trips = [t for t in trips if t["owner"] == owner]
    if over_target_only:
        trips = [t for t in trips if t["over_target"]]
    if q:
        needle = q.strip().lower()
        trips = [t for t in trips
                 if needle in str(t["id"]) or needle in (t["driver_name"] or "").lower()]

    days = _group_by_day(trips)

    total = len(days)
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    window = days[(page - 1) * page_size: page * page_size]

    return {
        "days": window,
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": max(1, (total + page_size - 1) // page_size),
        "trip_total": len(trips),
        "over_target_total": sum(1 for t in trips if t["over_target"]),
    }


@router.get("/trips/{manifest_id}/detail")
async def trip_detail(manifest_id: int, request: Request, admin=Depends(get_current_admin)):
    """One trip, end to end: checkpoints, gaps, jobs and the orders under each
    job -- the whole evidence trail behind a single claim."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT m.id, m.work_date, m.day_closed_at, m.expected_job_count, m.cancelled_at, "
            "u.id AS driver_id, u.name AS driver_name, u.warehouse_id, w.name AS warehouse_name "
            "FROM manifests m JOIN users u ON u.id = m.driver_id "
            "LEFT JOIN warehouses w ON w.id = u.warehouse_id WHERE m.id = %s",
            (manifest_id,),
        )
        row = await cur.fetchone()
    if row is None:
        return {"trip": None}

    scored = (await _scored(pool, [row]))[0]

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, seq, status, started_at, completed_at, photo_id FROM trip_job "
            "WHERE manifest_id = %s ORDER BY seq",
            (manifest_id,),
        )
        jobs = await cur.fetchall()
        await cur.execute(
            "SELECT id, tracking_no, status_code, trip_job_id FROM delivery_jobs WHERE manifest_id = %s ORDER BY id",
            (manifest_id,),
        )
        orders = await cur.fetchall()

    by_job: dict = {}
    for o in orders:
        by_job.setdefault(o["trip_job_id"], []).append(
            {"id": o["id"], "tracking_no": o["tracking_no"], "status_code": o["status_code"]}
        )

    scored["job_detail"] = [
        {
            "id": j["id"], "seq": j["seq"], "status": j["status"],
            "completed_at": fmt(j["completed_at"]),
            "photo_id": j["photo_id"],
            "orders": by_job.get(j["id"], []),
        }
        for j in jobs
    ]
    scored["unassigned_orders"] = by_job.get(None, [])
    return {"trip": scored}
