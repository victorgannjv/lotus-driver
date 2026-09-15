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


async def _load_trips(pool, start: date, end: date, warehouse_id: int | None) -> list[dict]:
    where = ["m.work_date BETWEEN %s AND %s", "m.cancelled_at IS NULL"]
    params: list = [start.isoformat(), end.isoformat()]
    if warehouse_id:
        where.append("u.warehouse_id = %s")
        params.append(warehouse_id)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT m.id, m.work_date, m.day_closed_at, m.expected_job_count, m.schedule_slot_no, "
            "u.id AS driver_id, u.name AS driver_name, u.warehouse_id, w.name AS warehouse_name "
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
            **{k: r[k] for k in ("id", "driver_id", "driver_name", "warehouse_id", "warehouse_name")},
            "window": window,
            "missed_window": bool(window and window.get("departed_late_minutes")),
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
            "ended_at": fmt(stamps["returned"]) if "returned" in stamps else None,
        })
    return out


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
    reasons: dict = {}
    for t in trips:
        for g in t["gaps"]:
            if not g["over_target"]:
                continue
            cp = next((c for c in t["checkpoints"] if c["checkpoint"] == g["to_checkpoint"]), None)
            if not cp or not cp.get("reason_label"):
                continue
            r = reasons.setdefault(cp["reason_label"],
                                   {"label": cp["reason_label"], "fault_party": cp["fault_party"],
                                    "minutes": 0, "occurrences": 0})
            r["minutes"] += g["over_by_minutes"]
            r["occurrences"] += 1
    reason_rows = sorted(reasons.values(), key=lambda r: -r["minutes"])

    # Weekly trend per outlet -- the historical benchmark.
    weeks: dict = {}
    for t in trips:
        d = date.fromisoformat(t["work_date"])
        wk = (d - timedelta(days=d.weekday())).isoformat()
        key = (wk, t["warehouse_name"] or "Unassigned")
        weeks.setdefault(key, []).append(t)
    trend = [
        {"week_start": wk, "outlet": outlet, "avg_at_outlet_minutes": _avg_at_outlet(v), "trips": len(v)}
        for (wk, outlet), v in sorted(weeks.items())
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
        "outlets": outlets,
        "reasons": reason_rows,
        "trend": trend,
        "manpower": manpower,
        "roster_configured": bool(rostered),
    }


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
    """The detail extract. Filtered and paged rather than dumped: at a few
    hundred trips a month, scrolling is not a way to find anything."""
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

    total = len(trips)
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    window = trips[(page - 1) * page_size: page * page_size]

    return {
        "trips": window,
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": max(1, (total + page_size - 1) // page_size),
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
