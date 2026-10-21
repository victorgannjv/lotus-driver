"""Driver performance: one row per driver, over a chosen span.

Trips, the hours they work in a day, how long a trip takes them, and where they
are based. Built from the same trips the Dashboard and Evidence screens read
(analytics_routes._scored), so a driver's hours here are the same hours that
page shows for their jobs.
"""
from datetime import date, timedelta

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, Request

from auth import require_access
from clocks import local_today
from db import get_pool
from routers.analytics_routes import (
    _avg_worked_per_day, _group_by_day, _load_trips, _overtime_threshold, _scored,
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


def _driver_row(driver: dict, trips: list[dict], threshold: int | None = None) -> dict:
    avg_day, days_counted, days_left_out = _avg_worked_per_day(trips)
    avg_trip, trips_timed = _avg_trip_minutes(trips)
    ot_jobs = _overtime_jobs(trips, threshold)
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
        "ot_days": len(ot_jobs) if threshold else None,
        "ot_jobs": ot_jobs,
    }


@router.get("/performance")
async def performance(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    warehouse_id: int | None = None,
    admin=Depends(require_access("driver_performance")),
):
    pool = get_pool(request)
    end = date.fromisoformat(date_to) if date_to else local_today()
    start = date.fromisoformat(date_from) if date_from else end - timedelta(days=29)

    trips = await _scored(pool, await _load_trips(pool, start, end, warehouse_id))
    threshold = _overtime_threshold(await load_settings(pool))

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

    rows = [_driver_row(d, by_driver.get(d["id"], []), threshold) for d in drivers]

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
        },
        "overtime_threshold_minutes": threshold,
    }
