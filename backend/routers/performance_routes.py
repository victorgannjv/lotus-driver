"""Driver performance: one row per driver, over a chosen span.

Trips, the hours they work in a day, how fast they drive, and where they are
based. Built from the same trips the Dashboard and Evidence screens read
(analytics_routes._scored), so a driver's hours here are the same hours that
page shows for their jobs.

Speed is the one figure that is NOT read straight off a stamp, so its limits
are spelled out where it is computed (see _trip_speed) and reported back with
the figure: how many of a driver's trips it could actually be measured on.
"""
import math
from datetime import date, datetime, timedelta

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, Request

from auth import require_access
from clocks import fmt, local_today
from db import get_pool
from routers.analytics_routes import _avg_worked_per_day, _load_trips, _scored

router = APIRouter()

EARTH_RADIUS_KM = 6371.0088

# A trip shorter than this has too little movement to put a speed on: a few
# minutes of GPS drift at the gate reads as a crawl.
MIN_SPEED_MINUTES = 10
# Above this the fixes, not the driver, are wrong (a stale or jumped GPS fix).
# Such a trip is left out of the average rather than dragging it up.
MAX_PLAUSIBLE_KMH = 120

STAMP_FORMAT = "%Y-%m-%d %H:%M:%S"


def _haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    (lat1, lng1), (lat2, lng2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


def _point(row: dict | None) -> tuple[float, float] | None:
    if not row or row.get("lat") is None or row.get("lng") is None:
        return None
    return float(row["lat"]), float(row["lng"])


def _trip_speed(trip: dict, drops: list[dict]) -> dict | None:
    """Average speed for one trip, in km/h -- or None when it cannot be
    measured honestly.

    The drive is the time away from the outlet: "Departed" to the end of the
    trip. Distance is the straight line between each GPS fix along the way,
    outlet -> each drop in the order it was closed -> back. Straight lines
    cut corners, so this UNDERSTATES road distance and therefore speed; it is
    good for comparing drivers on the same routes, not as a speedometer.

    It needs a fix at both ends. With only the drops it would measure part of
    the route over the whole time and read slow, so a trip missing the
    outlet or the return fix is not measured at all. The outlet fix is taken
    from "Departed", or "Arrived" when the driver left without one -- it is the
    same place.
    """
    cps = {c["checkpoint"]: c for c in trip["checkpoints"]}
    departed, ended_at = cps.get("departed"), trip.get("ended_at")
    if departed is None or ended_at is None:
        return None
    end_cp = cps.get("returned") or next(
        (c for c in cps.values() if c["occurred_at"] == ended_at), None)
    start = _point(departed) or _point(cps.get("arrived"))
    end = _point(end_cp)
    if start is None or end is None:
        return None

    try:
        t0 = datetime.strptime(departed["occurred_at"], STAMP_FORMAT)
        t1 = datetime.strptime(ended_at, STAMP_FORMAT)
    except (TypeError, ValueError):
        return None
    minutes = (t1 - t0).total_seconds() / 60
    if minutes < MIN_SPEED_MINUTES:
        return None

    route = [start]
    for d in drops:
        if departed["occurred_at"] <= d["at"] <= ended_at:
            route.append(d["point"])
    route.append(end)

    km = sum(_haversine_km(a, b) for a, b in zip(route, route[1:]))
    kmh = km / (minutes / 60)
    if kmh > MAX_PLAUSIBLE_KMH:
        return None
    return {"km": km, "minutes": minutes, "kmh": kmh}


async def _drop_fixes(pool, manifest_ids: list[int]) -> dict[int, list[dict]]:
    """Where each trip's drops were closed, in the order they were closed."""
    if not manifest_ids:
        return {}
    ph = ",".join(["%s"] * len(manifest_ids))
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            f"SELECT manifest_id, completed_at, lat, lng FROM trip_job "
            f"WHERE manifest_id IN ({ph}) AND completed_at IS NOT NULL "
            f"AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY completed_at",
            tuple(manifest_ids),
        )
        rows = await cur.fetchall()
    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r["manifest_id"], []).append(
            {"at": fmt(r["completed_at"]), "point": (float(r["lat"]), float(r["lng"]))})
    return out


def _driver_row(driver: dict, trips: list[dict], speeds: list[dict]) -> dict:
    avg_minutes, days_counted, days_left_out = _avg_worked_per_day(trips)
    return {
        "driver_id": driver["id"],
        "driver_name": driver["name"],
        "status": driver["status"],
        "warehouse_id": driver["warehouse_id"],
        "outlet": driver["warehouse_name"],
        "trips": len(trips),
        "open_trips": sum(1 for t in trips if t.get("ended_at") is None),
        "avg_worked_minutes": avg_minutes,
        "days_counted": days_counted,
        "days_left_out": days_left_out,
        "avg_speed_kmh": round(sum(s["kmh"] for s in speeds) / len(speeds), 1) if speeds else None,
        "avg_distance_km": round(sum(s["km"] for s in speeds) / len(speeds), 1) if speeds else None,
        "speed_trips": len(speeds),
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
    drops = await _drop_fixes(pool, [t["id"] for t in trips])

    by_driver: dict[int, list[dict]] = {}
    speeds_by_driver: dict[int, list[dict]] = {}
    for t in trips:
        by_driver.setdefault(t["driver_id"], []).append(t)
        speed = _trip_speed(t, drops.get(t["id"], []))
        if speed:
            speeds_by_driver.setdefault(t["driver_id"], []).append(speed)

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

    rows = [_driver_row(d, by_driver.get(d["id"], []), speeds_by_driver.get(d["id"], [])) for d in drivers]

    all_speeds = [s for v in speeds_by_driver.values() for s in v]
    avg_minutes, _, _ = _avg_worked_per_day(trips)
    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "drivers": rows,
        "summary": {
            "drivers": len(rows),
            "drivers_with_trips": sum(1 for r in rows if r["trips"]),
            "trips": len(trips),
            "avg_worked_minutes": avg_minutes,
            "avg_speed_kmh": round(sum(s["kmh"] for s in all_speeds) / len(all_speeds), 1) if all_speeds else None,
        },
        "speed_note": (
            "Speed is the distance between GPS fixes (outlet, each drop, back to the outlet) over the time "
            "from Departed to Returned. Straight lines cut corners, so it understates road speed; use it to "
            "compare drivers, not as a speedometer. A trip without a GPS fix at the outlet or on return is not counted."
        ),
    }
