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
from datetime import date, datetime, timezone

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from auth import get_current_driver
from db import get_pool
from photos import store_photo
from schemas import ArrivalRequest, ScanRequest

router = APIRouter()

_MANIFEST_COLUMNS = (
    "id, work_date, cancelled_at, warehouse_arrived_at, warehouse_arrived_lat, warehouse_arrived_lng, created_at"
)


def _serialize_manifest(row: dict) -> dict:
    return {
        "id": row["id"],
        "work_date": str(row["work_date"]),
        "cancelled_at": str(row["cancelled_at"]) if row["cancelled_at"] else None,
        "warehouse_arrived_at": str(row["warehouse_arrived_at"]) if row["warehouse_arrived_at"] else None,
        "warehouse_arrived_lat": float(row["warehouse_arrived_lat"]) if row["warehouse_arrived_lat"] is not None else None,
        "warehouse_arrived_lng": float(row["warehouse_arrived_lng"]) if row["warehouse_arrived_lng"] is not None else None,
        "created_at": str(row["created_at"]),
    }


def _serialize_job(row: dict) -> dict:
    return {
        "id": row["id"],
        "tracking_no": row["tracking_no"],
        "status_code": row["status_code"],
        "created_at": str(row["created_at"]),
    }


def _serialize_event(row: dict) -> dict:
    return {
        "id": row["id"],
        "status_code": row["status_code"],
        "occurred_at": str(row["occurred_at"]),
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

    today = date.today().isoformat()
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


@router.post("/manifests/start", status_code=201)
async def start_manifest(body: ArrivalRequest, request: Request, driver=Depends(get_current_driver)):
    """"Arrived at warehouse" -- always creates a new job (a driver may make more
    than one warehouse trip a day), timestamped + geotagged at creation."""
    pool = get_pool(request)
    occurred_dt = _parse_occurred_at(body.occurred_at)
    today = date.today().isoformat()

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO manifests (driver_id, work_date, warehouse_arrived_at, warehouse_arrived_lat, warehouse_arrived_lng) "
            "VALUES (%s, %s, %s, %s, %s)",
            (driver["id"], today, occurred_dt, body.lat, body.lng),
        )
        manifest_id = cur.lastrowid

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
    photo: UploadFile = File(...),
    driver=Depends(get_current_driver),
):
    pool = get_pool(request)
    code = code.strip()
    if not code:
        raise HTTPException(status_code=422, detail="scanned code is empty")
    occurred_dt = _parse_occurred_at(occurred_at)
    job = await _find_or_create_job_for_outcome(pool, driver["id"], code)

    photo_bytes = await photo.read()
    photo_id = await store_photo(pool, photo_bytes, photo.content_type or "image/jpeg", driver["id"])

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("UPDATE delivery_jobs SET status_code = 'delivered' WHERE id = %s", (job["id"],))
        await cur.execute(
            "INSERT INTO delivery_events (job_id, driver_id, status_code, occurred_at, lat, lng, photo_id) "
            "VALUES (%s, %s, 'delivered', %s, %s, %s, %s)",
            (job["id"], driver["id"], occurred_dt, lat, lng, photo_id),
        )

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
    photo: UploadFile = File(...),
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

    photo_bytes = await photo.read()
    photo_id = await store_photo(pool, photo_bytes, photo.content_type or "image/jpeg", driver["id"])

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("UPDATE delivery_jobs SET status_code = 'failed' WHERE id = %s", (job["id"],))
        await cur.execute(
            "INSERT INTO delivery_events (job_id, driver_id, status_code, occurred_at, lat, lng, failure_reason, photo_id) "
            "VALUES (%s, %s, 'failed', %s, %s, %s, %s, %s)",
            (job["id"], driver["id"], occurred_dt, lat, lng, reason, photo_id),
        )

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
