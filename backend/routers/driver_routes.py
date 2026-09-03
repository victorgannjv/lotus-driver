"""Driver-facing endpoints: barcode-scan registration and completion. A barcode is
an exact, unambiguous identifier, so scanning replaces manifest-photo OCR entirely --
scan an order's barcode to register it at pickup, scan the same barcode again at the
delivery outcome (delivered, or failed with a reason). No more fuzzy matching, orphan
review, or photo evidence."""
from datetime import date, datetime, timezone

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, HTTPException, Request

from auth import get_current_driver
from db import get_pool
from schemas import ArrivalRequest, ScanFailRequest, ScanRequest

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


async def _get_or_create_todays_manifest(pool, driver_id: int) -> int:
    today = date.today().isoformat()
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT id FROM manifests WHERE driver_id = %s AND work_date = %s AND cancelled_at IS NULL",
            (driver_id, today),
        )
        row = await cur.fetchone()
        if row:
            return row[0]
        await cur.execute("INSERT INTO manifests (driver_id, work_date) VALUES (%s, %s)", (driver_id, today))
        return cur.lastrowid


async def _find_open_job(pool, driver_id: int, code: str) -> dict:
    """Looks up the job a delivery-outcome scan refers to. 'registered' and
    'failed' are both open to a new outcome (a driver can retry after a failed
    attempt); 'delivered'/'cancelled' are terminal."""
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        # A code may exist in more than one of the driver's past sessions in theory;
        # the most recently registered one is the one they mean.
        await cur.execute(
            "SELECT dj.id, dj.status_code FROM delivery_jobs dj "
            "JOIN manifests m ON m.id = dj.manifest_id "
            "WHERE m.driver_id = %s AND dj.tracking_no = %s "
            "ORDER BY dj.created_at DESC LIMIT 1",
            (driver_id, code),
        )
        job = await cur.fetchone()

    if job is None:
        raise HTTPException(status_code=404, detail=f"{code} hasn't been registered yet -- scan it in first")
    if job["status_code"] == "delivered":
        raise HTTPException(status_code=409, detail=f"{code} was already delivered")
    if job["status_code"] == "cancelled":
        raise HTTPException(status_code=409, detail=f"{code} was cancelled")
    return job


@router.post("/scans/register", status_code=201)
async def register_scan(body: ScanRequest, request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    code = body.code.strip()
    if not code:
        raise HTTPException(status_code=422, detail="scanned code is empty")

    manifest_id = await _get_or_create_todays_manifest(pool, driver["id"])
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
        # Already registered in this session -- a repeat scan is a no-op, not an error.
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
async def complete_scan(body: ScanRequest, request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    code = body.code.strip()
    if not code:
        raise HTTPException(status_code=422, detail="scanned code is empty")
    occurred_dt = _parse_occurred_at(body.occurred_at)
    job = await _find_open_job(pool, driver["id"], code)

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("UPDATE delivery_jobs SET status_code = 'delivered' WHERE id = %s", (job["id"],))
        await cur.execute(
            "INSERT INTO delivery_events (job_id, driver_id, status_code, occurred_at, lat, lng) "
            "VALUES (%s, %s, 'delivered', %s, %s, %s)",
            (job["id"], driver["id"], occurred_dt, body.lat, body.lng),
        )

    return {"job_id": job["id"], "tracking_no": code}


@router.post("/scans/fail", status_code=201)
async def fail_scan(body: ScanFailRequest, request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    code = body.code.strip()
    if not code:
        raise HTTPException(status_code=422, detail="scanned code is empty")
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="a failure reason is required")
    occurred_dt = _parse_occurred_at(body.occurred_at)
    job = await _find_open_job(pool, driver["id"], code)

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("UPDATE delivery_jobs SET status_code = 'failed' WHERE id = %s", (job["id"],))
        await cur.execute(
            "INSERT INTO delivery_events (job_id, driver_id, status_code, occurred_at, lat, lng, failure_reason) "
            "VALUES (%s, %s, 'failed', %s, %s, %s, %s)",
            (job["id"], driver["id"], occurred_dt, body.lat, body.lng, reason),
        )

    return {"job_id": job["id"], "tracking_no": code}


@router.get("/manifests")
async def list_manifests(request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            f"SELECT {_MANIFEST_COLUMNS} FROM manifests "
            "WHERE driver_id = %s ORDER BY work_date DESC, id DESC",
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
            raise HTTPException(status_code=404, detail="manifest not found")
        await cur.execute(
            "SELECT id, tracking_no, status_code, created_at FROM delivery_jobs WHERE manifest_id = %s ORDER BY id",
            (manifest_id,),
        )
        jobs = await cur.fetchall()
    return {"manifest": _serialize_manifest(manifest), "jobs": [_serialize_job(j) for j in jobs]}


@router.post("/manifests/{manifest_id}/cancel")
async def cancel_manifest(manifest_id: int, request: Request, driver=Depends(get_current_driver)):
    """Voids a scan session (e.g. the wrong load got scanned in) so the driver can
    start clean. Never deletes rows (dispute audit trail) and refuses once any job in
    the session has actually been delivered."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, cancelled_at FROM manifests WHERE id = %s AND driver_id = %s",
            (manifest_id, driver["id"]),
        )
        manifest = await cur.fetchone()
        if manifest is None:
            raise HTTPException(status_code=404, detail="manifest not found")
        if manifest["cancelled_at"] is not None:
            raise HTTPException(status_code=409, detail="this session is already cancelled")

        await cur.execute(
            "SELECT 1 FROM delivery_jobs WHERE manifest_id = %s AND status_code IN ('delivered', 'failed') LIMIT 1",
            (manifest_id,),
        )
        if await cur.fetchone() is not None:
            raise HTTPException(
                status_code=409,
                detail="this session already has delivery attempts and can't be cancelled — contact your admin",
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


@router.post("/warehouse-arrival")
async def log_warehouse_arrival(body: ArrivalRequest, request: Request, driver=Depends(get_current_driver)):
    """Records the moment a driver starts their day (first tap of "Scan orders"),
    on today's session. Only the first call of the day sets it -- a driver returning
    to scan more later in the shift shouldn't overwrite the original arrival time."""
    pool = get_pool(request)
    manifest_id = await _get_or_create_todays_manifest(pool, driver["id"])
    occurred_dt = _parse_occurred_at(body.occurred_at)

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "UPDATE manifests SET warehouse_arrived_at = %s, warehouse_arrived_lat = %s, warehouse_arrived_lng = %s "
            "WHERE id = %s AND warehouse_arrived_at IS NULL",
            (occurred_dt, body.lat, body.lng, manifest_id),
        )

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(f"SELECT {_MANIFEST_COLUMNS} FROM manifests WHERE id = %s", (manifest_id,))
        manifest = await cur.fetchone()
    return {"manifest": _serialize_manifest(manifest)}


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
            "SELECT id, status_code, occurred_at, lat, lng, failure_reason FROM delivery_events "
            "WHERE job_id = %s ORDER BY occurred_at",
            (job_id,),
        )
        events = await cur.fetchall()
    return {"events": [_serialize_event(e) for e in events]}
