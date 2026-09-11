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
            "u.warehouse_id "
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

    return {
        "trip": {
            "id": mid,
            "work_date": str(trip["work_date"]),
            "expected_job_count": trip["expected_job_count"],
            "day_closed_at": str(trip["day_closed_at"]) if trip["day_closed_at"] else None,
        },
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
