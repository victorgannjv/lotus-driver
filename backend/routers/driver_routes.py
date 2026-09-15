"""Driver-facing endpoints. A driver explicitly starts a job by tapping "Arrived at
warehouse" (POST /manifests/start) -- every order scanned afterwards groups under
that job until they start a new one. A barcode is an exact, unambiguous identifier,
so scanning replaces manifest-photo OCR entirely: scan an order's barcode to
register it into the current job, scan the same barcode again at the delivery
outcome (delivered, or failed with a reason), with a required proof photo either
way. If an order was never scanned in (a driver forgot it at the warehouse), the
outcome scan still goes through -- it's auto-registered into today's most recent
open job with no "registered" event, rather than blocking the driver. When the last
open order in a job resolves, the response flags job_complete so the app can tell
the driver."""
from datetime import datetime, timezone

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from auth import get_current_driver
from db import get_pool
from photos import evidence_caption, link_trip_photos, store_photo
from clocks import fmt, local_today, stamp as clock_stamp
from schemas import DriverWarehouseRequest, ScanRequest

router = APIRouter()

_MANIFEST_COLUMNS = (
    "id, work_date, cancelled_at, warehouse_arrived_at, warehouse_arrived_lat, warehouse_arrived_lng, "
    "warehouse_arrived_photo_id, created_at"
)


def _serialize_manifest(row: dict) -> dict:
    return {
        "id": row["id"],
        "work_date": str(row["work_date"]),
        "cancelled_at": fmt(row["cancelled_at"]),
        "warehouse_arrived_at": fmt(row["warehouse_arrived_at"]),
        "warehouse_arrived_lat": float(row["warehouse_arrived_lat"]) if row["warehouse_arrived_lat"] is not None else None,
        "warehouse_arrived_lng": float(row["warehouse_arrived_lng"]) if row["warehouse_arrived_lng"] is not None else None,
        "warehouse_arrived_photo_id": row["warehouse_arrived_photo_id"],
        "created_at": fmt(row["created_at"]),
    }


def _serialize_job(row: dict) -> dict:
    return {
        "id": row["id"],
        "tracking_no": row["tracking_no"],
        "status_code": row["status_code"],
        "created_at": fmt(row["created_at"]),
    }


def _serialize_event(row: dict) -> dict:
    return {
        "id": row["id"],
        "status_code": row["status_code"],
        "occurred_at": fmt(row["occurred_at"]),
        "lat": float(row["lat"]) if row["lat"] is not None else None,
        "lng": float(row["lng"]) if row["lng"] is not None else None,
        "failure_reason": row["failure_reason"],
        "photo_id": row["photo_id"],
    }


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


async def _require_open_manifest(pool, driver_id: int, manifest_id: int) -> None:
    """A job (manifest) must exist, belong to this driver, and not be cancelled
    before any order can be scanned into it -- it's only ever created explicitly,
    via POST /manifests/start ("Arrived at warehouse")."""
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT cancelled_at FROM manifests WHERE id = %s AND driver_id = %s", (manifest_id, driver_id)
        )
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="job not found -- tap \"Arrived at warehouse\" to start one")
    if row[0] is not None:
        raise HTTPException(status_code=409, detail="this job was cancelled")


async def _driver_outlet(pool, driver_id: int) -> str | None:
    """Name and address of the outlet this driver works from, for the photo
    caption. The address we hold under contract, not a reverse geocode."""
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT w.name, w.address FROM users u JOIN warehouses w ON w.id = u.warehouse_id "
            "WHERE u.id = %s",
            (driver_id,),
        )
        row = await cur.fetchone()
    if not row:
        return None
    return " - ".join(x for x in (row["name"], row["address"]) if x) or None


async def _close_drop(pool, trip_job_id: int | None, driver_id: int, when, lat, lng,
                      photo_id: int | None, failed: bool) -> None:
    """A scan against a drop closes that drop.

    Without this a parcel could be scanned, photographed and recorded and the
    trip would still show "Finish job 1 of 2" -- tapping it restarted the photo
    flow, and the drop could never actually be closed from the scanner. The
    scan already carries everything completing a drop requires: a time, a
    place and a proof photo.

    Only a drop still pending is touched, so scanning a second parcel for the
    same stop adds an order without disturbing the completion already recorded.
    Once the last drop closes, deliveries_done is stamped exactly as the photo
    flow does it -- one rule for when a round is finished, not two.
    """
    if trip_job_id is None:
        return
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT tj.id, tj.manifest_id, tj.status FROM trip_job tj "
            "JOIN manifests m ON m.id = tj.manifest_id "
            "WHERE tj.id = %s AND m.driver_id = %s",
            (trip_job_id, driver_id),
        )
        drop = await cur.fetchone()
    if drop is None or drop["status"] != "pending":
        return

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "UPDATE trip_job SET status = %s, completed_at = %s, lat = %s, lng = %s, "
            "photo_id = COALESCE(photo_id, %s) WHERE id = %s",
            ("failed" if failed else "done", when, lat, lng, photo_id, trip_job_id),
        )
        await cur.execute(
            "SELECT COUNT(*) FROM trip_job WHERE manifest_id = %s AND status = 'pending'",
            (drop["manifest_id"],),
        )
        (still_open,) = await cur.fetchone()
        if still_open == 0:
            await cur.execute(
                "SELECT 1 FROM trip_checkpoint WHERE manifest_id = %s AND checkpoint = 'deliveries_done'",
                (drop["manifest_id"],),
            )
            if not await cur.fetchone():
                await cur.execute(
                    "INSERT INTO trip_checkpoint (manifest_id, checkpoint, occurred_at, created_by) "
                    "VALUES (%s, 'deliveries_done', %s, %s)",
                    (drop["manifest_id"], when, driver_id),
                )


async def _find_or_create_job_for_outcome(pool, driver_id: int, code: str) -> dict:
    """Looks up the job(-order) a delivery-outcome scan refers to. 'registered' and
    'failed' are both open to a new outcome (a driver can retry after a failed
    attempt); 'delivered'/'cancelled' are terminal.

    If the driver never scanned this code in at the warehouse (forgot it, or it
    wasn't in that day's load), that shouldn't block them from completing it -- it's
    auto-registered into today's most recently started open job instead. There's
    just no "registered" event/timestamp for it, since it never actually went
    through that step; the outcome event is its first and only one."""
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        # A code may exist in more than one of the driver's past jobs in theory;
        # the most recently registered one is the one they mean.
        await cur.execute(
            "SELECT dj.id, dj.manifest_id, dj.status_code FROM delivery_jobs dj "
            "JOIN manifests m ON m.id = dj.manifest_id "
            "WHERE m.driver_id = %s AND dj.tracking_no = %s "
            "ORDER BY dj.created_at DESC LIMIT 1",
            (driver_id, code),
        )
        job = await cur.fetchone()

    if job is not None:
        if job["status_code"] == "delivered":
            raise HTTPException(status_code=409, detail=f"{code} was already delivered")
        if job["status_code"] == "cancelled":
            raise HTTPException(status_code=409, detail=f"{code} was cancelled")
        return job

    today = local_today().isoformat()
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id FROM manifests WHERE driver_id = %s AND work_date = %s AND cancelled_at IS NULL "
            "ORDER BY id DESC LIMIT 1",
            (driver_id, today),
        )
        manifest = await cur.fetchone()
    if manifest is None:
        raise HTTPException(
            status_code=404,
            detail=f'{code} was never scanned in, and no job is open today -- tap "Arrived at warehouse" first',
        )

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO delivery_jobs (manifest_id, tracking_no, status_code) VALUES (%s, %s, 'registered')",
            (manifest["id"], code),
        )
        job_id = cur.lastrowid
    return {"id": job_id, "manifest_id": manifest["id"], "status_code": "registered"}


async def _is_job_complete(pool, manifest_id: int) -> bool:
    """True once every order scanned into this job has a resolved outcome (none
    left in 'registered')."""
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT 1 FROM delivery_jobs WHERE manifest_id = %s AND status_code = 'registered' LIMIT 1",
            (manifest_id,),
        )
        return await cur.fetchone() is None


async def _is_job_sealed(pool, manifest_id: int) -> bool:
    """True once the job has at least one order and every one of them is resolved
    -- an empty, freshly-started job is not sealed (there's nothing to seal yet),
    but a job that has already gone all-delivered/failed is closed to new orders:
    the driver starts a new job (a new "Arrived at warehouse") instead of adding to
    this one."""
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT COUNT(*) FROM delivery_jobs WHERE manifest_id = %s", (manifest_id,))
        (total,) = await cur.fetchone()
    if total == 0:
        return False
    return await _is_job_complete(pool, manifest_id)


@router.put("/driver/warehouse")
async def update_driver_warehouse(body: DriverWarehouseRequest, request: Request, driver=Depends(get_current_driver)):
    """Sets which outlet this driver is assigned to -- a fixed assignment (not
    per-job), changeable any time from the driver's profile screen."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM warehouses WHERE id = %s AND is_active = 1", (body.warehouse_id,))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=422, detail="that outlet doesn't exist or is no longer active")
        await cur.execute("UPDATE users SET warehouse_id = %s WHERE id = %s", (body.warehouse_id, driver["id"]))

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT u.id, u.email, u.name, u.warehouse_id, w.name AS warehouse_name "
            "FROM users u LEFT JOIN warehouses w ON w.id = u.warehouse_id WHERE u.id = %s",
            (driver["id"],),
        )
        row = await cur.fetchone()
    return {
        "user": {
            "id": row["id"],
            "email": row["email"],
            "name": row["name"],
            "warehouse_id": row["warehouse_id"],
            "warehouse_name": row["warehouse_name"],
        }
    }


@router.post("/manifests/start", status_code=201)
async def start_manifest(
    request: Request,
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    occurred_at: str | None = Form(None),
    photo: UploadFile | None = File(None),
    photos: list[UploadFile] | None = File(None),
    driver=Depends(get_current_driver),
):
    """"Arrived at warehouse" -- always creates a new job (a driver may make more
    than one warehouse trip a day), timestamped + geotagged at creation, and
    requires at least one photo proving they're actually there.

    Takes a set, like every other step. This was the one checkpoint still
    capped at a single photo, which forced the app to offer one -- and it is
    the arrival, the stamp a whole late-delivery argument turns on. One frame
    cannot always show the gate, the truck and the clock.

    `photo` is still accepted so an older app build keeps working.
    """
    pool = get_pool(request)
    occurred_dt = _parse_occurred_at(occurred_at)
    today = local_today().isoformat()

    incoming = [f for f in ([photo] if photo is not None else []) + list(photos or []) if f is not None]
    if not incoming:
        raise HTTPException(status_code=422, detail="a photo is required to start a trip")

    outlet = await _driver_outlet(pool, driver["id"])
    caption = evidence_caption(ref="Arrived at outlet", what="", who=driver.get("name"),
                               lat=lat, lng=lng, place=outlet, when=clock_stamp(occurred_dt))
    photo_ids = [
        await store_photo(pool, await f.read(), f.content_type or "image/jpeg", driver["id"], caption)
        for f in incoming
    ]
    # The first one stays on the row, so every screen that reads a single photo
    # keeps working; trip_photo carries the whole set.
    photo_id = photo_ids[0]

    # Which contracted window this run is against -- the day's first trip is
    # slot 1, the second slot 2. Stamped at the start so cancelling or
    # re-ordering a later trip can never retro-change an earlier commitment.
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT COUNT(*) FROM manifests WHERE driver_id = %s AND work_date = %s AND cancelled_at IS NULL",
            (driver["id"], today),
        )
        (prior,) = await cur.fetchone()
    slot_no = prior + 1

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO manifests (driver_id, work_date, warehouse_arrived_at, warehouse_arrived_lat, "
            "warehouse_arrived_lng, warehouse_arrived_photo_id, schedule_slot_no) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (driver["id"], today, occurred_dt, lat, lng, photo_id, slot_no),
        )
        manifest_id = cur.lastrowid

    # Also record it as the trip's first checkpoint. The manifests columns above
    # are still written and still read by everything that already used them --
    # this is the same moment expressed in the checkpoint spine, so the new
    # timeline and the old fields never disagree.
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO trip_checkpoint (manifest_id, checkpoint, occurred_at, lat, lng, photo_id, created_by) "
            "VALUES (%s, 'arrived', %s, %s, %s, %s, %s)",
            (manifest_id, occurred_dt, lat, lng, photo_id, driver["id"]),
        )

    await link_trip_photos(pool, photo_ids, manifest_id=manifest_id, checkpoint="arrived")

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(f"SELECT {_MANIFEST_COLUMNS} FROM manifests WHERE id = %s", (manifest_id,))
        manifest = await cur.fetchone()
    return {"manifest": _serialize_manifest(manifest)}


@router.post("/scans/register", status_code=201)
async def register_scan(body: ScanRequest, request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    code = body.code.strip()
    if not code:
        raise HTTPException(status_code=422, detail="scanned code is empty")
    if body.manifest_id is None:
        raise HTTPException(status_code=422, detail="manifest_id is required")

    await _require_open_manifest(pool, driver["id"], body.manifest_id)
    manifest_id = body.manifest_id
    occurred_dt = _parse_occurred_at(body.occurred_at)

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, status_code FROM delivery_jobs WHERE manifest_id = %s AND tracking_no = %s",
            (manifest_id, code),
        )
        existing = await cur.fetchone()

    if existing is not None:
        if existing["status_code"] == "delivered":
            raise HTTPException(status_code=409, detail=f"{code} was already delivered")
        if existing["status_code"] == "cancelled":
            raise HTTPException(status_code=409, detail=f"{code} was cancelled")
        # Already registered in this job -- a repeat scan is a no-op, not an error.
        return {"job_id": existing["id"], "manifest_id": manifest_id, "tracking_no": code, "already_registered": True}

    if await _is_job_sealed(pool, manifest_id):
        raise HTTPException(
            status_code=409,
            detail='this job is already complete -- tap "Arrived at warehouse" to start a new one',
        )

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO delivery_jobs (manifest_id, tracking_no, status_code) VALUES (%s, %s, 'registered')",
            (manifest_id, code),
        )
        job_id = cur.lastrowid
        await cur.execute(
            "INSERT INTO delivery_events (job_id, driver_id, status_code, occurred_at, lat, lng) "
            "VALUES (%s, %s, 'registered', %s, %s, %s)",
            (job_id, driver["id"], occurred_dt, body.lat, body.lng),
        )

    return {"job_id": job_id, "manifest_id": manifest_id, "tracking_no": code, "already_registered": False}


@router.post("/scans/complete", status_code=201)
async def complete_scan(
    request: Request,
    code: str = Form(...),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    occurred_at: str | None = Form(None),
    trip_job_id: int | None = Form(None),
    photo: UploadFile | None = File(None),
    photos: list[UploadFile] | None = File(None),
    driver=Depends(get_current_driver),
):
    pool = get_pool(request)
    code = code.strip()
    if not code:
        raise HTTPException(status_code=422, detail="scanned code is empty")
    occurred_dt = _parse_occurred_at(occurred_at)
    job = await _find_or_create_job_for_outcome(pool, driver["id"], code)

    # A proof of delivery is often more than one frame: the parcel at the door,
    # the unit number, the person who took it. Capped at one, a driver had to
    # choose which of those to keep.
    incoming = [f for f in ([photo] if photo is not None else []) + list(photos or []) if f is not None]
    if not incoming:
        raise HTTPException(status_code=422, detail="a proof photo is required")
    caption = evidence_caption(ref=code, what="Delivered", who=driver.get("name"),
                               lat=lat, lng=lng, when=clock_stamp(occurred_dt))
    photo_ids = [
        await store_photo(pool, await f.read(), f.content_type or "image/jpeg", driver["id"], caption)
        for f in incoming
    ]
    photo_id = photo_ids[0]

    async with pool.acquire() as conn, conn.cursor() as cur:
        # Which drop this order was scanned at. The column has existed since
        # V13 and nothing ever wrote to it, so every order was an orphan and
        # the admin's per-job order list was permanently empty. Only set when
        # the driver scanned from a specific job, never guessed.
        if trip_job_id is not None:
            await cur.execute(
                "UPDATE delivery_jobs SET status_code = 'delivered', trip_job_id = %s WHERE id = %s",
                (trip_job_id, job["id"]),
            )
        else:
            await cur.execute("UPDATE delivery_jobs SET status_code = 'delivered' WHERE id = %s", (job["id"],))
        await cur.execute(
            "INSERT INTO delivery_events (job_id, driver_id, status_code, occurred_at, lat, lng, photo_id) "
            "VALUES (%s, %s, 'delivered', %s, %s, %s, %s)",
            (job["id"], driver["id"], occurred_dt, lat, lng, photo_id),
        )

    await _close_drop(pool, trip_job_id, driver["id"], occurred_dt, lat, lng, photo_id,
                      failed=False)

    job_complete = await _is_job_complete(pool, job["manifest_id"])
    return {"job_id": job["id"], "tracking_no": code, "manifest_id": job["manifest_id"], "job_complete": job_complete}


@router.post("/scans/fail", status_code=201)
async def fail_scan(
    request: Request,
    code: str = Form(...),
    reason: str = Form(...),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    occurred_at: str | None = Form(None),
    trip_job_id: int | None = Form(None),
    photo: UploadFile | None = File(None),
    photos: list[UploadFile] | None = File(None),
    driver=Depends(get_current_driver),
):
    pool = get_pool(request)
    code = code.strip()
    if not code:
        raise HTTPException(status_code=422, detail="scanned code is empty")
    reason = reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="a failure reason is required")
    occurred_dt = _parse_occurred_at(occurred_at)
    job = await _find_or_create_job_for_outcome(pool, driver["id"], code)

    incoming = [f for f in ([photo] if photo is not None else []) + list(photos or []) if f is not None]
    if not incoming:
        raise HTTPException(status_code=422, detail="a proof photo is required")
    caption = evidence_caption(ref=code, what=f"Not delivered - {reason}", who=driver.get("name"),
                               lat=lat, lng=lng, when=clock_stamp(occurred_dt))
    photo_ids = [
        await store_photo(pool, await f.read(), f.content_type or "image/jpeg", driver["id"], caption)
        for f in incoming
    ]
    photo_id = photo_ids[0]

    async with pool.acquire() as conn, conn.cursor() as cur:
        # Which drop this order was scanned at. The column has existed since
        # V13 and nothing ever wrote to it, so every order was an orphan and
        # the admin's per-job order list was permanently empty. Only set when
        # the driver scanned from a specific job, never guessed.
        if trip_job_id is not None:
            await cur.execute(
                "UPDATE delivery_jobs SET status_code = 'failed', trip_job_id = %s WHERE id = %s",
                (trip_job_id, job["id"]),
            )
        else:
            await cur.execute("UPDATE delivery_jobs SET status_code = 'failed' WHERE id = %s", (job["id"],))
        await cur.execute(
            "INSERT INTO delivery_events (job_id, driver_id, status_code, occurred_at, lat, lng, failure_reason, photo_id) "
            "VALUES (%s, %s, 'failed', %s, %s, %s, %s, %s)",
            (job["id"], driver["id"], occurred_dt, lat, lng, reason, photo_id),
        )

    await _close_drop(pool, trip_job_id, driver["id"], occurred_dt, lat, lng, photo_id, failed=True)

    job_complete = await _is_job_complete(pool, job["manifest_id"])
    return {"job_id": job["id"], "tracking_no": code, "manifest_id": job["manifest_id"], "job_complete": job_complete}


@router.get("/manifests")
async def list_manifests(request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            f"SELECT {_MANIFEST_COLUMNS} FROM manifests "
            "WHERE driver_id = %s ORDER BY id DESC",
            (driver["id"],),
        )
        rows = await cur.fetchall()
    return {"manifests": [_serialize_manifest(r) for r in rows]}


@router.get("/manifests/{manifest_id}")
async def get_manifest(manifest_id: int, request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            f"SELECT {_MANIFEST_COLUMNS} FROM manifests WHERE id = %s AND driver_id = %s",
            (manifest_id, driver["id"]),
        )
        manifest = await cur.fetchone()
        if manifest is None:
            raise HTTPException(status_code=404, detail="job not found")
        await cur.execute(
            "SELECT id, tracking_no, status_code, created_at FROM delivery_jobs WHERE manifest_id = %s ORDER BY id",
            (manifest_id,),
        )
        jobs = await cur.fetchall()
    return {"manifest": _serialize_manifest(manifest), "jobs": [_serialize_job(j) for j in jobs]}


@router.post("/manifests/{manifest_id}/cancel")
async def cancel_manifest(manifest_id: int, request: Request, driver=Depends(get_current_driver)):
    """Voids a job (e.g. the wrong load got scanned in) so the driver can start
    clean. Never deletes rows (dispute audit trail) and refuses once any order in
    the job has actually been attempted."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, cancelled_at FROM manifests WHERE id = %s AND driver_id = %s",
            (manifest_id, driver["id"]),
        )
        manifest = await cur.fetchone()
        if manifest is None:
            raise HTTPException(status_code=404, detail="job not found")
        if manifest["cancelled_at"] is not None:
            raise HTTPException(status_code=409, detail="this job is already cancelled")

        await cur.execute(
            "SELECT 1 FROM delivery_jobs WHERE manifest_id = %s AND status_code IN ('delivered', 'failed') LIMIT 1",
            (manifest_id,),
        )
        if await cur.fetchone() is not None:
            raise HTTPException(
                status_code=409,
                detail="this job already has delivery attempts and can't be cancelled — contact your admin",
            )

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("UPDATE manifests SET cancelled_at = NOW() WHERE id = %s", (manifest_id,))
        await cur.execute(
            "UPDATE delivery_jobs SET status_code = 'cancelled' WHERE manifest_id = %s AND status_code = 'registered'",
            (manifest_id,),
        )

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(f"SELECT {_MANIFEST_COLUMNS} FROM manifests WHERE id = %s", (manifest_id,))
        updated = await cur.fetchone()
    return {"manifest": _serialize_manifest(updated)}


@router.get("/jobs/{job_id}/events")
async def list_job_events(job_id: int, request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT dj.id FROM delivery_jobs dj JOIN manifests m ON m.id = dj.manifest_id "
            "WHERE dj.id = %s AND m.driver_id = %s",
            (job_id, driver["id"]),
        )
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="job not found")
        await cur.execute(
            "SELECT id, status_code, occurred_at, lat, lng, failure_reason, photo_id FROM delivery_events "
            "WHERE job_id = %s ORDER BY occurred_at",
            (job_id,),
        )
        events = await cur.fetchall()
    return {"events": [_serialize_event(e) for e in events]}
