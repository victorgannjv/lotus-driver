"""Driver performance: one row per driver, over a chosen span.

Trips, the hours they work in a day, how long a trip takes them, and where they
are based. Built from the same trips the Dashboard and Evidence screens read
(analytics_routes._scored), so a driver's hours here are the same hours that
page shows for their jobs.
"""
import csv
import io
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from auth import require_access
from db import get_pool
from routers.analytics_routes import (
    _avg_worked_per_day, _evidence_range, _group_by_day, _load_trips, _overtime_threshold, _scored,
)
from trips import load_settings

router = APIRouter()


def _avg_trip_minutes(trips: list[dict]) -> tuple[int | None, int]:
    """How long a trip takes, on average: (average minutes, trips counted).

    A trip's time is arrival at the outlet to the end of the trip -- the same
    figure the Evidence page adds up into a job's worked time. A trip that has
    not finished has no end to measure, and a figure for "so far" would drag
    the average down, so it is left out; the row says how many were counted.
    """
    done = [t["worked_minutes"] for t in trips if t.get("worked_minutes") is not None]
    return (round(sum(done) / len(done)) if done else None), len(done)


def _cost_per_hour(settings: dict) -> Decimal | None:
    """The Settings > Job management rate, in RM per hour -- or None while it is
    not set (0, empty or unreadable), in which case no cost is shown."""
    try:
        rate = Decimal(str(settings.get("cost_per_hour", "0")).strip() or "0")
    except InvalidOperation:
        return None
    return rate if rate.is_finite() and rate > 0 else None


def _total_worked_minutes(trips: list[dict]) -> float | None:
    """Every finished trip's time added together. A trip that has not finished
    has no end to measure and is left out (the row says how many), so the total
    never contains a "so far". None, not 0, when nothing has finished."""
    done = [t["worked_minutes"] for t in trips if t.get("worked_minutes") is not None]
    return round(sum(done), 2) if done else None


def _cost(minutes: float | None, rate: Decimal | None) -> float | None:
    """Hours x rate, to the sen. Worked on the exact minutes, so an hour and a
    half at RM 20 is RM 30.00 and not a rounding of a rounding. A half sen
    rounds UP (19.125 -> 19.13): Decimal's default is to round half to even,
    which is right for statistics and not what anyone checking a bill expects."""
    if minutes is None or rate is None:
        return None
    return float((Decimal(str(minutes)) / 60 * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _overtime_jobs(trips: list[dict], threshold: int | None) -> list[dict]:
    """The driver's jobs (J-ids) flagged as overtime, newest first.

    Judged by the same rule as the Evidence page, because it is the same code:
    a job is one driver's one day, its worked time is the finished trips added
    up, and it is overtime when that is over the Job management limit. With no
    limit set nothing is overtime.
    """
    return [
        {
            "job_id": d["driver_day_id"],
            "work_date": d["work_date"],
            "worked_minutes": d["worked_minutes"],
            "overtime_minutes": d["overtime_minutes"],
            "open_trips": d["open_trips"],
        }
        for d in _group_by_day(trips, threshold)  # newest first
        if d["is_overtime"]
    ]


def _driver_row(driver: dict, trips: list[dict], threshold: int | None = None, rate: Decimal | None = None) -> dict:
    avg_day, days_counted, days_left_out = _avg_worked_per_day(trips)
    avg_trip, trips_timed = _avg_trip_minutes(trips)
    ot_jobs = _overtime_jobs(trips, threshold)
    total_minutes = _total_worked_minutes(trips)
    total_cost = _cost(total_minutes, rate)

    # Overtime hours are the hours past the limit in each job (a driver's day),
    # added up -- the same per-job figures that flag the job, so the hours here
    # and the days counted beside them always agree. Without a limit nothing
    # is "regular" or "overtime", so all three figures are blank, not zero.
    ot_minutes = sum(j["overtime_minutes"] for j in ot_jobs) if threshold else None
    ot_cost = _cost(ot_minutes, rate) if threshold else None
    # Regular cost is what is LEFT of the total once overtime is taken out,
    # rather than a third multiplication. Rounding each of the three
    # separately can leave them a sen apart; this way regular + overtime
    # equals the total to the sen, always.
    regular_cost = (
        float(Decimal(str(total_cost)) - Decimal(str(ot_cost)))
        if total_cost is not None and ot_cost is not None else None
    )
    return {
        "driver_id": driver["id"],
        "driver_name": driver["name"],
        "status": driver["status"],
        "warehouse_id": driver["warehouse_id"],
        "outlet": driver["warehouse_name"],
        "trips": len(trips),
        "open_trips": sum(1 for t in trips if t.get("ended_at") is None),
        "avg_worked_minutes": avg_day,
        "days_counted": days_counted,
        "days_left_out": days_left_out,
        "avg_trip_minutes": avg_trip,
        "trips_timed": trips_timed,
        # None, not 0, while no limit is set: "0 overtime days" would claim
        # everyone was inside a limit that does not exist.
        "total_worked_minutes": total_minutes,
        "total_cost": total_cost,
        "total_ot_minutes": ot_minutes,
        "regular_cost": regular_cost,
        "ot_cost": ot_cost,
        "ot_days": len(ot_jobs) if threshold else None,
        "ot_jobs": ot_jobs,
    }


async def _performance(pool, date_from: str | None, date_to: str | None, warehouse_id: int | None) -> dict:
    """Everything the page shows, for one span and outlet. The screen and the
    CSV export both come from here, so a downloaded file can never disagree
    with the table it was downloaded from."""
    # The Evidence page's span rule: no dates is the last 30 days, and a bad or
    # backwards range is a 422 rather than a server error.
    start, end = _evidence_range(date_from, date_to)

    trips = await _scored(pool, await _load_trips(pool, start, end, warehouse_id))
    settings = await load_settings(pool)
    threshold = _overtime_threshold(settings)
    rate = _cost_per_hour(settings)

    by_driver: dict[int, list[dict]] = {}
    for t in trips:
        by_driver.setdefault(t["driver_id"], []).append(t)

    # Every driver in the system, not just the ones who drove: someone with no
    # trips in the span is a finding ("nothing from Aiman since the 3rd"), and
    # a list that silently omits them would hide it. A disabled driver is only
    # worth a row if they actually have trips in the span.
    where, params = ["u.role = 'driver'"], []
    if warehouse_id:
        where.append("u.warehouse_id = %s")
        params.append(warehouse_id)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT u.id, u.name, u.status, u.warehouse_id, w.name AS warehouse_name "
            "FROM users u LEFT JOIN warehouses w ON w.id = u.warehouse_id "
            f"WHERE {' AND '.join(where)} ORDER BY u.name",
            tuple(params),
        )
        drivers = [d for d in await cur.fetchall() if d["status"] == "active" or d["id"] in by_driver]

    rows = [_driver_row(d, by_driver.get(d["id"], []), threshold, rate) for d in drivers]

    avg_minutes, _, _ = _avg_worked_per_day(trips)
    avg_trip, _ = _avg_trip_minutes(trips)
    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "drivers": rows,
        "summary": {
            "drivers": len(rows),
            "drivers_with_trips": sum(1 for r in rows if r["trips"]),
            "trips": len(trips),
            "avg_worked_minutes": avg_minutes,
            "avg_trip_minutes": avg_trip,
            "ot_days": sum(r["ot_days"] or 0 for r in rows) if threshold else None,
            "total_worked_minutes": _total_worked_minutes(trips),
            # The sum of the rows as shown, so the column and its total agree to the sen.
            "total_cost": float(sum((Decimal(str(r["total_cost"])) for r in rows if r["total_cost"] is not None), Decimal(0))) if rate else None,
        },
        "cost_per_hour": float(rate) if rate else None,
        "overtime_threshold_minutes": threshold,
    }


@router.get("/performance")
async def performance(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    warehouse_id: int | None = None,
    admin=Depends(require_access("driver_performance")),
):
    return await _performance(get_pool(request), date_from, date_to, warehouse_id)


def _matches(row: dict, q: str | None) -> bool:
    """The page's search box: part of a name, or the driver's id as printed
    ("D-12") or bare ("12")."""
    needle = (q or "").strip().lower()
    if not needle:
        return True
    return (needle in row["driver_name"].lower()
            or needle == f"d-{row['driver_id']}"
            or needle == str(row["driver_id"]))


FORMULA_STARTS = ("=", "+", "-", "@", chr(9), chr(13))


def _csv_text(value) -> str:
    """A text cell that a spreadsheet will not run as a formula. A name or
    outlet starting with = + - or @ is read by Excel as an instruction, and
    both come from people typing into forms."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in FORMULA_STARTS else text


def _hours(minutes) -> str:
    return "" if minutes is None else f"{minutes / 60:.2f}"


PERFORMANCE_CSV_HEADER = [
    "driver_id", "driver", "outlet", "status",
    "trips", "open_trips",
    "total_hours_worked", "total_ot_hours_worked",
    "regular_hours_cost_rm", "ot_cost_rm", "total_cost_rm",
    "avg_hours_per_day", "days_counted", "days_not_finished",
    "avg_time_per_trip_minutes", "trips_finished",
    "ot_days", "ot_job_ids",
]


@router.get("/performance/export")
async def performance_export(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    warehouse_id: int | None = None,
    q: str | None = None,
    admin=Depends(require_access("driver_performance")),
):
    """The table as one CSV: the same rows the page shows for the same period,
    outlet and search. Hours are in decimal hours and cost in RM, as numbers a
    spreadsheet can add up. Blank means there is no figure, not zero."""
    result = await _performance(get_pool(request), date_from, date_to, warehouse_id)
    rows = [r for r in result["drivers"] if _matches(r, q)]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(PERFORMANCE_CSV_HEADER)
    for r in rows:
        writer.writerow([
            f"D-{r['driver_id']}", _csv_text(r["driver_name"]), _csv_text(r["outlet"]), r["status"],
            r["trips"], r["open_trips"],
            _hours(r["total_worked_minutes"]), _hours(r["total_ot_minutes"]),
            "" if r["regular_cost"] is None else f"{r['regular_cost']:.2f}",
            "" if r["ot_cost"] is None else f"{r['ot_cost']:.2f}",
            "" if r["total_cost"] is None else f"{r['total_cost']:.2f}",
            _hours(r["avg_worked_minutes"]), r["days_counted"], r["days_left_out"],
            "" if r["avg_trip_minutes"] is None else r["avg_trip_minutes"], r["trips_timed"],
            "" if r["ot_days"] is None else r["ot_days"],
            "; ".join(f"J-{j['job_id']}" for j in r["ot_jobs"]),
        ])

    filename = f"driver_performance_{result['date_from']}_to_{result['date_to']}.csv"
    # utf-8-sig, as the Evidence export: Excel otherwise guesses the system
    # codepage and mangles any name outside ASCII.
    return Response(
        content=buf.getvalue().encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
