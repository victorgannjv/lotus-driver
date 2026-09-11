"""Driver-facing trip checkpoint, job and day-close endpoints.

These sit alongside the existing scan flow rather than replacing it: an order is
still registered and completed by scanning its barcode on the screens that
already exist. What is new is the frame around that work -- a trip is stamped at
each checkpoint with a photo, its gaps are measured against targets, and a gap
that ran over is explained with a coded reason carrying a fault owner.

Kept in its own router so the diff against the original driver_routes.py stays
small and reviewable.
"""
from datetime import date, datetime, timezone

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from auth import get_current_driver
from db import get_pool
from photos import store_photo
from trips import (
    CHECKPOINT_GAP,
    load_schedules,
    schedule_variance,
    slots_for,
    CHECKPOINT_ORDER,
    compute_gaps,
    compute_time_at_outlet,
    fetch_checkpoints,
    load_settings,
    load_targets,
    serialize_checkpoint,
    setting_bool,
    setting_list,
    stamps_from,
)

router = APIRouter()

# Order the driver walks. deliveries_done is fired by the server when the last
# job resolves, so it is never POSTed by the app.
DRIVER_STAMPABLE = ["arrived", "goods_ready", "loaded", "departed", "returned"]


def _parse_occurred_at(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="occurred_at must be ISO 8601")
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


async def _owned_trip(pool, driver_id: int, manifest_id: int) -> dict:
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT m.id, m.driver_id, m.work_date, m.cancelled_at, m.day_closed_at, m.expected_job_count, "
            "m.schedule_slot_no, u.warehouse_id "
            "FROM manifests m JOIN users u ON u.id = m.driver_id "
            "WHERE m.id = %s AND m.driver_id = %s",
            (manifest_id, driver_id),
        )
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="trip not found")
    if row["cancelled_at"] is not None:
        raise HTTPException(status_code=409, detail="this trip was cancelled")
    return row


async def _trip_state(pool, trip: dict) -> dict:
    """The whole trip as the app draws it: stamped checkpoints, computed gaps,
    jobs, and which step comes next."""
    mid = trip["id"]
    cps = (await fetch_checkpoints(pool, [mid])).get(mid, {})
    targets = await load_targets(pool)
    stamps = stamps_from(cps)
    gaps = compute_gaps(stamps, targets, trip["warehouse_id"])

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, seq, status, started_at, completed_at, photo_id FROM trip_job "
            "WHERE manifest_id = %s ORDER BY seq",
            (mid,),
        )
        jobs = await cur.fetchall()
        await cur.execute(
            "SELECT tj.seq, COUNT(dj.id) AS orders FROM trip_job tj "
            "LEFT JOIN delivery_jobs dj ON dj.trip_job_id = tj.id "
            "WHERE tj.manifest_id = %s GROUP BY tj.seq",
            (mid,),
        )
        counts = {r["seq"]: r["orders"] for r in await cur.fetchall()}

    done_jobs = sum(1 for j in jobs if j["status"] != "pending")
    next_cp = None
    for cp in DRIVER_STAMPABLE:
        if cp in cps:
            continue
        # returned only becomes available once every job is resolved
        if cp == "returned" and jobs and done_jobs < len(jobs):
            break
        next_cp = cp
        break

    slots = slots_for(await load_schedules(pool), trip["warehouse_id"])
    window = schedule_variance(
        slots.get(trip.get("schedule_slot_no")), stamps.get("arrived"), stamps.get("departed")
    )

    return {
        "trip": {
            "id": mid,
            "work_date": str(trip["work_date"]),
            "expected_job_count": trip["expected_job_count"],
            "day_closed_at": str(trip["day_closed_at"]) if trip["day_closed_at"] else None,
            "schedule_slot_no": trip.get("schedule_slot_no"),
        },
        "window": window,
        "checkpoints": [serialize_checkpoint(cps[c]) for c in CHECKPOINT_ORDER if c in cps],
        "gaps": gaps,
        "time_at_outlet": compute_time_at_outlet(stamps, targets, trip["warehouse_id"]),
        "jobs": [
            {
                "id": j["id"], "seq": j["seq"], "status": j["status"],
                "started_at": str(j["started_at"]) if j["started_at"] else None,
                "completed_at": str(j["completed_at"]) if j["completed_at"] else None,
                "photo_id": j["photo_id"], "orders": counts.get(j["seq"], 0),
            }
            for j in jobs
        ],
        "jobs_done": done_jobs,
        "next_checkpoint": next_cp,
    }


@router.get("/driver/app-settings")
async def driver_app_settings(request: Request, driver=Depends(get_current_driver)):
    """What the app should ask for, configured by an admin rather than hard-coded
    -- job-count quick picks, which checkpoints demand a photo, and so on."""
    pool = get_pool(request)
    s = await load_settings(pool)
    return {
        "job_count_quick_picks": [int(v) for v in setting_list(s, "job_count_quick_picks") if v.isdigit()],
        "job_count_manual_max": int(s.get("job_count_manual_max", "40")),
        "allow_add_job_mid_trip": setting_bool(s, "allow_add_job_mid_trip", True),
        "photo_required_checkpoints": setting_list(s, "photo_required_checkpoints"),
        "photo_burn_timestamp": setting_bool(s, "photo_burn_timestamp", True),
        "photo_timestamp_source": s.get("photo_timestamp_source", "server"),
        "photo_capture_gps": setting_bool(s, "photo_capture_gps", True),
        "reason_prompt_on_breach": setting_bool(s, "reason_prompt_on_breach", True),
        "default_language": s.get("default_language", "en"),
    }


@router.get("/reason-codes")
async def list_reason_codes(request: Request, gap: str | None = None, driver=Depends(get_current_driver)):
    """Active reason codes, optionally narrowed to the gap being explained."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT code, label, fault_party, applies_to_gap FROM reason_code "
            "WHERE is_active = 1 ORDER BY sort_order, label"
        )
        rows = await cur.fetchall()
    out = []
    for r in rows:
        scopes = [p.strip() for p in r["applies_to_gap"].split(",")]
        if gap and "any" not in scopes and gap not in scopes:
            continue
        out.append({"code": r["code"], "label": r["label"], "fault_party": r["fault_party"]})
    return {"reason_codes": out}


@router.get("/trips/{manifest_id}")
async def get_trip(manifest_id: int, request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    trip = await _owned_trip(pool, driver["id"], manifest_id)
    return await _trip_state(pool, trip)


@router.post("/trips/{manifest_id}/checkpoints", status_code=201)
async def stamp_checkpoint(
    manifest_id: int,
    request: Request,
    checkpoint: str = Form(...),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    occurred_at: str | None = Form(None),
    reason_code: str | None = Form(None),
    reason_note: str | None = Form(None),
    photo: UploadFile | None = File(None),
    driver=Depends(get_current_driver),
):
    """Stamps one checkpoint. Refuses without a photo where the settings demand
    one, and refuses to run ahead of the sequence -- a driver cannot record
    departure before the truck was loaded."""
    if checkpoint not in DRIVER_STAMPABLE:
        raise HTTPException(status_code=422, detail=f"'{checkpoint}' is not a checkpoint the app stamps")

    pool = get_pool(request)
    trip = await _owned_trip(pool, driver["id"], manifest_id)
    settings = await load_settings(pool)

    existing = (await fetch_checkpoints(pool, [manifest_id])).get(manifest_id, {})
    if checkpoint in existing:
        raise HTTPException(status_code=409, detail="that checkpoint is already stamped for this trip")

    # every earlier stampable checkpoint must already be in place
    for earlier in DRIVER_STAMPABLE[: DRIVER_STAMPABLE.index(checkpoint)]:
        if earlier not in existing:
            raise HTTPException(status_code=409, detail=f"stamp '{earlier}' first")

    photo_id = None
    if photo is not None:
        photo_id = await store_photo(pool, await photo.read(), photo.content_type or "image/jpeg", driver["id"])
    elif checkpoint in setting_list(settings, "photo_required_checkpoints"):
        raise HTTPException(status_code=422, detail="a photo is required for this checkpoint")

    # The server clock is the default stamp source: a handset with the wrong time
    # would hand Lotus an easy challenge on every photo in the claim.
    occurred_dt = (
        _parse_occurred_at(occurred_at)
        if settings.get("photo_timestamp_source") == "handset"
        else datetime.now(timezone.utc).replace(tzinfo=None)
    )

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO trip_checkpoint (manifest_id, checkpoint, occurred_at, lat, lng, photo_id, "
            "reason_code, reason_note, created_by) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (manifest_id, checkpoint, occurred_dt, lat, lng, photo_id,
             reason_code or None, (reason_note or "").strip() or None, driver["id"]),
        )

    state = await _trip_state(pool, trip)

    # Tell the app whether this stamp needs explaining, so it can raise the
    # reason sheet straight away rather than on the next screen.
    gap_code = CHECKPOINT_GAP.get(checkpoint)
    needs_reason = False
    if gap_code and setting_bool(settings, "reason_prompt_on_breach", True) and not reason_code:
        for g in state["gaps"]:
            if g["gap_code"] == gap_code and g["over_target"]:
                needs_reason = True
                break
    state["reason_required_for"] = gap_code if needs_reason else None
    return state


@router.post("/trips/{manifest_id}/checkpoints/{checkpoint}/reason")
async def set_checkpoint_reason(
    manifest_id: int,
    checkpoint: str,
    request: Request,
    reason_code: str = Form(...),
    reason_note: str | None = Form(None),
    driver=Depends(get_current_driver),
):
    """Attaches the reason after the fact -- the app stamps first so the clock is
    honest, then asks why."""
    pool = get_pool(request)
    trip = await _owned_trip(pool, driver["id"], manifest_id)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT 1 FROM reason_code WHERE code = %s AND is_active = 1", (reason_code,))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=422, detail="unknown reason code")
        await cur.execute(
            "UPDATE trip_checkpoint SET reason_code = %s, reason_note = %s "
            "WHERE manifest_id = %s AND checkpoint = %s",
            (reason_code, (reason_note or "").strip() or None, manifest_id, checkpoint),
        )
    return await _trip_state(pool, trip)


@router.post("/trips/{manifest_id}/jobs", status_code=201)
async def set_job_count(
    manifest_id: int,
    request: Request,
    job_count: int = Form(...),
    driver=Depends(get_current_driver),
):
    """How many drops this trip carries. The driver enters it once at loading
    time; until Lotus exposes an API that is the only honest source."""
    pool = get_pool(request)
    trip = await _owned_trip(pool, driver["id"], manifest_id)
    settings = await load_settings(pool)
    max_jobs = int(settings.get("job_count_manual_max", "40"))
    if job_count < 1 or job_count > max_jobs:
        raise HTTPException(status_code=422, detail=f"job count must be between 1 and {max_jobs}")

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT COUNT(*) FROM trip_job WHERE manifest_id = %s", (manifest_id,))
        (already,) = await cur.fetchone()
    if already:
        raise HTTPException(status_code=409, detail="this trip already has its jobs")

    async with pool.acquire() as conn, conn.cursor() as cur:
        for seq in range(1, job_count + 1):
            await cur.execute("INSERT INTO trip_job (manifest_id, seq) VALUES (%s, %s)", (manifest_id, seq))
        # Kept beside the actual count so "told 6, ran 8" stays reportable.
        await cur.execute("UPDATE manifests SET expected_job_count = %s WHERE id = %s", (job_count, manifest_id))

    trip["expected_job_count"] = job_count
    return await _trip_state(pool, trip)


@router.put("/trips/{manifest_id}/jobs")
async def amend_job_count(
    manifest_id: int,
    request: Request,
    job_count: int = Form(...),
    driver=Depends(get_current_driver),
):
    """Corrects a miscounted load. Growing the count appends drops; shrinking it
    removes only trailing drops that are still pending -- a job already closed
    is evidence and is never deleted to make a number tidy. The originally
    entered count stays on the trip, so "told 6, ran 8" remains reportable."""
    pool = get_pool(request)
    trip = await _owned_trip(pool, driver["id"], manifest_id)
    settings = await load_settings(pool)
    max_jobs = int(settings.get("job_count_manual_max", "40"))
    if job_count < 1 or job_count > max_jobs:
        raise HTTPException(status_code=422, detail=f"job count must be between 1 and {max_jobs}")

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, seq, status FROM trip_job WHERE manifest_id = %s ORDER BY seq", (manifest_id,)
        )
        jobs = await cur.fetchall()

    current = len(jobs)
    if job_count == current:
        return await _trip_state(pool, trip)

    if job_count > current:
        async with pool.acquire() as conn, conn.cursor() as cur:
            for seq in range(current + 1, job_count + 1):
                await cur.execute("INSERT INTO trip_job (manifest_id, seq) VALUES (%s, %s)", (manifest_id, seq))
    else:
        removable = [j for j in jobs[job_count:] if j["status"] == "pending"]
        if len(removable) != current - job_count:
            raise HTTPException(
                status_code=409,
                detail="some of those jobs are already done -- they can't be removed",
            )
        async with pool.acquire() as conn, conn.cursor() as cur:
            for j in removable:
                await cur.execute("UPDATE delivery_jobs SET trip_job_id = NULL WHERE trip_job_id = %s", (j["id"],))
                await cur.execute("DELETE FROM trip_job WHERE id = %s", (j["id"],))

    trip["expected_job_count"] = job_count
    return await _trip_state(pool, trip)


@router.post("/trips/{manifest_id}/jobs/add", status_code=201)
async def add_job(manifest_id: int, request: Request, driver=Depends(get_current_driver)):
    """Appends one drop when the load changes after loading."""
    pool = get_pool(request)
    trip = await _owned_trip(pool, driver["id"], manifest_id)
    settings = await load_settings(pool)
    if not setting_bool(settings, "allow_add_job_mid_trip", True):
        raise HTTPException(status_code=409, detail="adding a job mid-trip is switched off")
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT COALESCE(MAX(seq), 0) FROM trip_job WHERE manifest_id = %s", (manifest_id,))
        (last,) = await cur.fetchone()
        await cur.execute("INSERT INTO trip_job (manifest_id, seq) VALUES (%s, %s)", (manifest_id, last + 1))
    return await _trip_state(pool, trip)


@router.post("/trip-jobs/{trip_job_id}/complete", status_code=201)
async def complete_job(
    trip_job_id: int,
    request: Request,
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    failed: bool = Form(False),
    photo: UploadFile | None = File(None),
    driver=Depends(get_current_driver),
):
    """Closes one drop. When the last open job resolves, the server stamps
    deliveries_done itself -- the app already knows, so the driver isn't asked to
    confirm it."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT tj.id, tj.manifest_id, tj.status FROM trip_job tj "
            "JOIN manifests m ON m.id = tj.manifest_id "
            "WHERE tj.id = %s AND m.driver_id = %s",
            (trip_job_id, driver["id"]),
        )
        job = await cur.fetchone()
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] != "pending":
        raise HTTPException(status_code=409, detail="that job is already closed")

    trip = await _owned_trip(pool, driver["id"], job["manifest_id"])
    photo_id = None
    if photo is not None:
        photo_id = await store_photo(pool, await photo.read(), photo.content_type or "image/jpeg", driver["id"])
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "UPDATE trip_job SET status = %s, completed_at = %s, lat = %s, lng = %s, photo_id = %s WHERE id = %s",
            ("failed" if failed else "done", now, lat, lng, photo_id, trip_job_id),
        )
        await cur.execute(
            "SELECT COUNT(*) FROM trip_job WHERE manifest_id = %s AND status = 'pending'", (job["manifest_id"],)
        )
        (still_open,) = await cur.fetchone()

    if still_open == 0:
        existing = (await fetch_checkpoints(pool, [job["manifest_id"]])).get(job["manifest_id"], {})
        if "deliveries_done" not in existing:
            async with pool.acquire() as conn, conn.cursor() as cur:
                await cur.execute(
                    "INSERT INTO trip_checkpoint (manifest_id, checkpoint, occurred_at, created_by) "
                    "VALUES (%s, 'deliveries_done', %s, %s)",
                    (job["manifest_id"], now, driver["id"]),
                )
    return await _trip_state(pool, trip)


@router.post("/days/{work_date}/close")
async def close_day(work_date: str, request: Request, driver=Depends(get_current_driver)):
    """Ends the driver's day -- basket and invoice returned. A day that is never
    closed can't be counted as complete on either surface, which is why this is
    an explicit act rather than an inference from the last scan."""
    try:
        date.fromisoformat(work_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="work_date must be YYYY-MM-DD")
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT COUNT(*) FROM manifests WHERE driver_id = %s AND work_date = %s AND cancelled_at IS NULL",
            (driver["id"], work_date),
        )
        (n,) = await cur.fetchone()
        if n == 0:
            raise HTTPException(status_code=404, detail="no trips on that day")
        await cur.execute(
            "UPDATE manifests SET day_closed_at = NOW() "
            "WHERE driver_id = %s AND work_date = %s AND cancelled_at IS NULL AND day_closed_at IS NULL",
            (driver["id"], work_date),
        )
    return {"work_date": work_date, "closed": True, "trips": n}


async def _autoclose_finished_days(pool, driver_id: int) -> None:
    """A past day whose every trip came back to the outlet is finished, whatever
    the driver remembered to tap. Closing it on read keeps the history honest
    rather than leaving a trail of days stuck open behind them."""
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT m.work_date, COUNT(*) AS trips, "
            "SUM(tc.id IS NOT NULL) AS returned, MAX(tc.occurred_at) AS last_return "
            "FROM manifests m "
            "LEFT JOIN trip_checkpoint tc ON tc.manifest_id = m.id AND tc.checkpoint = 'returned' "
            "WHERE m.driver_id = %s AND m.cancelled_at IS NULL AND m.day_closed_at IS NULL "
            "AND m.work_date < CURDATE() GROUP BY m.work_date",
            (driver_id,),
        )
        rows = await cur.fetchall()
    done = [r for r in rows if r["trips"] and r["returned"] == r["trips"]]
    if not done:
        return
    async with pool.acquire() as conn, conn.cursor() as cur:
        for r in done:
            await cur.execute(
                "UPDATE manifests SET day_closed_at = %s "
                "WHERE driver_id = %s AND work_date = %s AND cancelled_at IS NULL AND day_closed_at IS NULL",
                (r["last_return"], driver_id, r["work_date"]),
            )


@router.get("/my-days")
async def my_days(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 30,
    driver=Depends(get_current_driver),
):
    """The driver's own history, grouped day -> trip -> checkpoints.

    Deliberately the same computation the admin surface runs, just scoped to one
    driver: if a driver's week and ops' week ever disagreed, neither number would
    be worth taking into a dispute.
    """
    pool = get_pool(request)
    await _autoclose_finished_days(pool, driver["id"])
    where = ["m.driver_id = %s"]
    params: list = [driver["id"]]
    if date_from:
        where.append("m.work_date >= %s")
        params.append(date_from)
    if date_to:
        where.append("m.work_date <= %s")
        params.append(date_to)

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT m.id, m.work_date, m.cancelled_at, m.day_closed_at, m.expected_job_count, "
            "m.schedule_slot_no, u.warehouse_id "
            "FROM manifests m JOIN users u ON u.id = m.driver_id "
            f"WHERE {' AND '.join(where)} ORDER BY m.work_date DESC, m.id DESC LIMIT %s",
            tuple(params + [max(1, min(limit, 200))]),
        )
        trips = await cur.fetchall()

    if not trips:
        return {"days": [], "rollup": {"trips": 0, "jobs": 0, "orders": 0, "over_target": 0}}

    ids = [t["id"] for t in trips]
    placeholders = ",".join(["%s"] * len(ids))
    cps_by_trip = await fetch_checkpoints(pool, ids)
    targets = await load_targets(pool)
    schedules = await load_schedules(pool)

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            f"SELECT manifest_id, COUNT(*) AS n, SUM(status <> 'pending') AS done, SUM(status = 'failed') AS failed "
            f"FROM trip_job WHERE manifest_id IN ({placeholders}) GROUP BY manifest_id",
            tuple(ids),
        )
        job_rows = {r["manifest_id"]: r for r in await cur.fetchall()}
        await cur.execute(
            f"SELECT manifest_id, COUNT(*) AS n, SUM(status_code = 'failed') AS failed "
            f"FROM delivery_jobs WHERE manifest_id IN ({placeholders}) GROUP BY manifest_id",
            tuple(ids),
        )
        order_rows = {r["manifest_id"]: r for r in await cur.fetchall()}

    days: dict[str, dict] = {}
    roll = {"trips": 0, "jobs": 0, "orders": 0, "over_target": 0}

    for t in trips:
        cps = cps_by_trip.get(t["id"], {})
        stamps = stamps_from(cps)
        gaps = compute_gaps(stamps, targets, t["warehouse_id"])
        tao = compute_time_at_outlet(stamps, targets, t["warehouse_id"])
        jr = job_rows.get(t["id"], {})
        orr = order_rows.get(t["id"], {})

        window = schedule_variance(
            slots_for(schedules, t["warehouse_id"]).get(t["schedule_slot_no"]),
            stamps.get("arrived"), stamps.get("departed"),
        )
        trip_out = {
            "id": t["id"],
            "window": window,
            "cancelled": t["cancelled_at"] is not None,
            "jobs": int(jr.get("n") or 0),
            "jobs_done": int(jr.get("done") or 0),
            "orders": int(orr.get("n") or 0),
            "failed_orders": int(orr.get("failed") or 0),
            "started_at": str(stamps["arrived"]) if "arrived" in stamps else None,
            "ended_at": str(stamps["returned"]) if "returned" in stamps else None,
            "time_at_outlet": tao,
            "checkpoints": [serialize_checkpoint(cps[c]) for c in CHECKPOINT_ORDER if c in cps],
            "gaps": gaps,
        }

        key = str(t["work_date"])
        day = days.setdefault(key, {
            "work_date": key, "day_closed_at": None,
            "trips": [], "totals": {"trips": 0, "jobs": 0, "orders": 0, "failed_orders": 0, "over_target": 0},
        })
        if t["day_closed_at"]:
            day["day_closed_at"] = str(t["day_closed_at"])
        day["trips"].append(trip_out)
        if t["cancelled_at"] is None:
            day["totals"]["trips"] += 1
            day["totals"]["jobs"] += trip_out["jobs"]
            day["totals"]["orders"] += trip_out["orders"]
            day["totals"]["failed_orders"] += trip_out["failed_orders"]
            roll["trips"] += 1
            roll["jobs"] += trip_out["jobs"]
            roll["orders"] += trip_out["orders"]
            if tao and tao["over_target"]:
                day["totals"]["over_target"] += 1
                roll["over_target"] += 1

    ordered = sorted(days.values(), key=lambda d: d["work_date"], reverse=True)
    for d in ordered:
        d["trips"].sort(key=lambda x: (x["started_at"] or ""))
    return {"days": ordered, "rollup": roll}


@router.get("/my-open-trip")
async def my_open_trip(request: Request, driver=Depends(get_current_driver)):
    """Today's trip that still has steps left, so the app can open straight on
    the work in hand rather than making the driver find it."""
    pool = get_pool(request)
    today = date.today().isoformat()
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT m.id, m.driver_id, m.work_date, m.cancelled_at, m.day_closed_at, m.expected_job_count, "
            "m.schedule_slot_no, u.warehouse_id FROM manifests m JOIN users u ON u.id = m.driver_id "
            "WHERE m.driver_id = %s AND m.work_date = %s AND m.cancelled_at IS NULL "
            "ORDER BY m.id DESC LIMIT 1",
            (driver["id"], today),
        )
        trip = await cur.fetchone()
    if trip is None:
        return {"trip": None}
    state = await _trip_state(pool, trip)
    return state
