"""Admin-facing endpoints (Google SSO gated). Driver/job listings and each job's
chronological scan-event log (timestamp, status, GPS). No more orphan-event review --
barcode scans are exact matches, so there's nothing left ambiguous to resolve."""
import csv
import io
from datetime import date as date_cls

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from auth import get_current_admin
from db import get_pool
from schemas import AddAdminRequest, WarehouseRequest

router = APIRouter()


def _build_job_filters(
    status: str | None,
    driver_id: int | None,
    manifest_id: int | None,
    warehouse_id: int | None,
    date_from: str | None,
    date_to: str | None,
) -> tuple[list[str], list]:
    where: list[str] = []
    params: list = []
    if status:
        where.append("dj.status_code = %s")
        params.append(status)
    if driver_id:
        where.append("m.driver_id = %s")
        params.append(driver_id)
    if manifest_id:
        where.append("dj.manifest_id = %s")
        params.append(manifest_id)
    if warehouse_id:
        # A job has no warehouse of its own -- it's the driver's fixed outlet
        # assignment, so this filters on the driver behind the job.
        where.append("u.warehouse_id = %s")
        params.append(warehouse_id)
    if date_from:
        where.append("m.work_date >= %s")
        params.append(date_from)
    if date_to:
        where.append("m.work_date <= %s")
        params.append(date_to)
    return where, params


def _serialize_driver(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "status": row["status"],
        "warehouse_id": row["warehouse_id"],
        "warehouse_name": row["warehouse_name"],
        "created_at": str(row["created_at"]),
    }


def _serialize_warehouse(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "address": row["address"],
        "is_active": bool(row["is_active"]),
        "created_at": str(row["created_at"]),
    }


def _serialize_admin_job(row: dict) -> dict:
    return {
        "id": row["id"],
        "tracking_no": row["tracking_no"],
        "status_code": row["status_code"],
        "created_at": str(row["created_at"]),
        "manifest_id": row["manifest_id"],
        "work_date": str(row["work_date"]),
        "warehouse_arrived_at": str(row["warehouse_arrived_at"]) if row["warehouse_arrived_at"] else None,
        "driver_id": row["driver_id"],
        "driver_name": row["driver_name"],
        "warehouse_id": row["warehouse_id"],
        "warehouse_name": row["warehouse_name"],
    }


def _serialize_admin_event(row: dict) -> dict:
    return {
        "id": row["id"],
        "job_id": row["job_id"],
        "driver_id": row["driver_id"],
        "status_code": row["status_code"],
        "occurred_at": str(row["occurred_at"]),
        "lat": float(row["lat"]) if row["lat"] is not None else None,
        "lng": float(row["lng"]) if row["lng"] is not None else None,
        "failure_reason": row["failure_reason"],
        "photo_id": row["photo_id"],
    }


@router.get("/drivers")
async def list_drivers(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT u.id, u.name, u.email, u.phone, u.status, u.warehouse_id, w.name AS warehouse_name, u.created_at "
            "FROM users u LEFT JOIN warehouses w ON w.id = u.warehouse_id "
            "WHERE u.role = 'driver' ORDER BY u.created_at DESC"
        )
        rows = await cur.fetchall()
    return {"drivers": [_serialize_driver(r) for r in rows]}


@router.get("/warehouses")
async def list_warehouses(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT id, name, address, is_active, created_at FROM warehouses ORDER BY name")
        rows = await cur.fetchall()
    return {"warehouses": [_serialize_warehouse(r) for r in rows]}


@router.post("/warehouses", status_code=201)
async def create_warehouse(body: WarehouseRequest, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("INSERT INTO warehouses (name, address) VALUES (%s, %s)", (name, body.address))
        new_id = cur.lastrowid
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT id, name, address, is_active, created_at FROM warehouses WHERE id = %s", (new_id,))
        row = await cur.fetchone()
    return {"warehouse": _serialize_warehouse(row)}


@router.put("/warehouses/{warehouse_id}")
async def update_warehouse(
    warehouse_id: int, body: WarehouseRequest, request: Request, admin=Depends(get_current_admin)
):
    pool = get_pool(request)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM warehouses WHERE id = %s", (warehouse_id,))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="outlet not found")
        await cur.execute(
            "UPDATE warehouses SET name = %s, address = %s WHERE id = %s", (name, body.address, warehouse_id)
        )
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, name, address, is_active, created_at FROM warehouses WHERE id = %s", (warehouse_id,)
        )
        row = await cur.fetchone()
    return {"warehouse": _serialize_warehouse(row)}


@router.delete("/warehouses/{warehouse_id}")
async def remove_warehouse(warehouse_id: int, request: Request, admin=Depends(get_current_admin)):
    """Soft-delete: marks the outlet inactive rather than removing the row, since
    drivers may already be assigned to it -- hard-deleting would either violate that
    reference or silently orphan it. Inactive outlets just drop out of the driver-
    facing GET /api/warehouses list (and can't be picked as a new assignment)."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM warehouses WHERE id = %s", (warehouse_id,))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="outlet not found")
        await cur.execute("UPDATE warehouses SET is_active = 0 WHERE id = %s", (warehouse_id,))
    return {"ok": True}


@router.get("/jobs")
async def list_jobs(
    request: Request,
    status: str | None = Query(None),
    driver_id: int | None = Query(None),
    manifest_id: int | None = Query(None),
    warehouse_id: int | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    admin=Depends(get_current_admin),
):
    pool = get_pool(request)
    where, params = _build_job_filters(status, driver_id, manifest_id, warehouse_id, date_from, date_to)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    offset = (page - 1) * page_size

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            f"SELECT dj.id, dj.tracking_no, dj.status_code, dj.created_at, "
            f"       m.id AS manifest_id, m.work_date, m.warehouse_arrived_at, m.driver_id, u.name AS driver_name, "
            f"       u.warehouse_id, w.name AS warehouse_name "
            f"FROM delivery_jobs dj "
            f"JOIN manifests m ON m.id = dj.manifest_id "
            f"JOIN users u ON u.id = m.driver_id "
            f"LEFT JOIN warehouses w ON w.id = u.warehouse_id "
            f"{where_sql} "
            f"ORDER BY m.work_date DESC, m.id DESC, dj.id DESC "
            f"LIMIT %s OFFSET %s",
            (*params, page_size, offset),
        )
        rows = await cur.fetchall()
    return {"jobs": [_serialize_admin_job(r) for r in rows], "page": page, "page_size": page_size}


@router.get("/exports/jobs.csv")
async def export_jobs_csv(
    request: Request,
    status: str | None = Query(None),
    driver_id: int | None = Query(None),
    manifest_id: int | None = Query(None),
    warehouse_id: int | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    admin=Depends(get_current_admin),
):
    """One row per scan event (not per job) -- that's the actual dispute-trace log:
    every registered/delivered/failed timestamp, GPS fix, failure reason and proof
    photo, not just each job's current status. Same filters as GET /jobs, unpaginated."""
    pool = get_pool(request)
    where, params = _build_job_filters(status, driver_id, manifest_id, warehouse_id, date_from, date_to)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            f"SELECT dj.tracking_no, dj.status_code AS job_status, "
            f"       m.work_date, m.warehouse_arrived_at, "
            f"       u.name AS driver_name, u.email AS driver_email, w.name AS warehouse_name, "
            f"       de.status_code AS event_status, de.occurred_at AS event_occurred_at, "
            f"       de.lat, de.lng, de.failure_reason, de.photo_id "
            f"FROM delivery_jobs dj "
            f"JOIN manifests m ON m.id = dj.manifest_id "
            f"JOIN users u ON u.id = m.driver_id "
            f"LEFT JOIN warehouses w ON w.id = u.warehouse_id "
            f"LEFT JOIN delivery_events de ON de.job_id = dj.id "
            f"{where_sql} "
            f"ORDER BY m.work_date DESC, dj.id, de.occurred_at",
            params,
        )
        rows = await cur.fetchall()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "tracking_no",
            "driver_name",
            "driver_email",
            "warehouse_name",
            "work_date",
            "warehouse_arrived_at",
            "job_status",
            "event_status",
            "event_occurred_at",
            "lat",
            "lng",
            "failure_reason",
            "photo_url",
        ]
    )
    base_url = str(request.base_url).rstrip("/")
    for r in rows:
        photo_url = f"{base_url}/api/photos/{r['photo_id']}" if r["photo_id"] else ""
        writer.writerow(
            [
                r["tracking_no"],
                r["driver_name"],
                r["driver_email"],
                r["warehouse_name"] or "",
                r["work_date"],
                r["warehouse_arrived_at"] or "",
                r["job_status"],
                r["event_status"] or "",
                r["event_occurred_at"] or "",
                r["lat"] if r["lat"] is not None else "",
                r["lng"] if r["lng"] is not None else "",
                r["failure_reason"] or "",
                photo_url,
            ]
        )

    filename = f"lotus-jobs-{date_cls.today().isoformat()}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/dashboard")
async def get_dashboard(
    request: Request,
    warehouse_id: int | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    admin=Depends(get_current_admin),
):
    """High-level performance summary: job counts by status, success/failure rate
    (delivered vs. failed among resolved jobs -- in-progress and cancelled jobs are
    excluded from that ratio since they have no outcome yet), average lead time
    (registered scan -> delivered/failed scan), and average warehouse processing
    time ("Arrived at warehouse" -> each order's registered scan). Auto-registered
    orders have no 'registered' event, so they're naturally excluded from both
    time-based averages rather than skewing them with a missing start time."""
    pool = get_pool(request)
    where, params = _build_job_filters(None, None, None, warehouse_id, date_from, date_to)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            f"SELECT dj.status_code, COUNT(*) AS cnt "
            f"FROM delivery_jobs dj "
            f"JOIN manifests m ON m.id = dj.manifest_id "
            f"JOIN users u ON u.id = m.driver_id "
            f"{where_sql} "
            f"GROUP BY dj.status_code",
            params,
        )
        status_rows = await cur.fetchall()

        await cur.execute(
            f"SELECT AVG(TIMESTAMPDIFF(SECOND, reg.occurred_at, term.occurred_at)) AS avg_lead_seconds, "
            f"       COUNT(*) AS sample_size "
            f"FROM delivery_jobs dj "
            f"JOIN manifests m ON m.id = dj.manifest_id "
            f"JOIN users u ON u.id = m.driver_id "
            f"JOIN delivery_events reg ON reg.job_id = dj.id AND reg.status_code = 'registered' "
            f"JOIN delivery_events term ON term.job_id = dj.id AND term.status_code IN ('delivered', 'failed') "
            f"{where_sql}",
            params,
        )
        lead_row = await cur.fetchone()

        processing_where_sql = "WHERE " + " AND ".join(where + ["m.warehouse_arrived_at IS NOT NULL"])
        await cur.execute(
            f"SELECT AVG(TIMESTAMPDIFF(SECOND, m.warehouse_arrived_at, reg.occurred_at)) AS avg_processing_seconds, "
            f"       COUNT(*) AS sample_size "
            f"FROM delivery_jobs dj "
            f"JOIN manifests m ON m.id = dj.manifest_id "
            f"JOIN users u ON u.id = m.driver_id "
            f"JOIN delivery_events reg ON reg.job_id = dj.id AND reg.status_code = 'registered' "
            f"{processing_where_sql}",
            params,
        )
        processing_row = await cur.fetchone()

    counts = {"registered": 0, "delivered": 0, "failed": 0, "cancelled": 0}
    for r in status_rows:
        counts[r["status_code"]] = r["cnt"]

    resolved = counts["delivered"] + counts["failed"]
    success_rate = (counts["delivered"] / resolved * 100) if resolved else None
    failure_rate = (counts["failed"] / resolved * 100) if resolved else None
    avg_lead_seconds = float(lead_row["avg_lead_seconds"]) if lead_row["avg_lead_seconds"] is not None else None
    avg_processing_seconds = (
        float(processing_row["avg_processing_seconds"]) if processing_row["avg_processing_seconds"] is not None else None
    )

    return {
        "total_jobs": sum(counts.values()),
        "registered": counts["registered"],
        "delivered": counts["delivered"],
        "failed": counts["failed"],
        "cancelled": counts["cancelled"],
        "resolved_jobs": resolved,
        "success_rate": success_rate,
        "failure_rate": failure_rate,
        "avg_lead_time_seconds": avg_lead_seconds,
        "lead_time_sample_size": lead_row["sample_size"],
        "avg_warehouse_processing_seconds": avg_processing_seconds,
        "warehouse_processing_sample_size": processing_row["sample_size"],
    }


@router.get("/jobs/{job_id}")
async def get_job(job_id: int, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT dj.id, dj.tracking_no, dj.status_code, dj.created_at, "
            "       m.id AS manifest_id, m.work_date, m.warehouse_arrived_at, "
            "       u.id AS driver_id, u.name AS driver_name, u.email AS driver_email, "
            "       u.warehouse_id, w.name AS warehouse_name "
            "FROM delivery_jobs dj "
            "JOIN manifests m ON m.id = dj.manifest_id "
            "JOIN users u ON u.id = m.driver_id "
            "LEFT JOIN warehouses w ON w.id = u.warehouse_id "
            "WHERE dj.id = %s",
            (job_id,),
        )
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="job not found")
    return {
        "job": {
            "id": row["id"],
            "tracking_no": row["tracking_no"],
            "status_code": row["status_code"],
            "created_at": str(row["created_at"]),
            "manifest_id": row["manifest_id"],
            "work_date": str(row["work_date"]),
            "warehouse_arrived_at": str(row["warehouse_arrived_at"]) if row["warehouse_arrived_at"] else None,
            "driver_id": row["driver_id"],
            "driver_name": row["driver_name"],
            "driver_email": row["driver_email"],
            "warehouse_id": row["warehouse_id"],
            "warehouse_name": row["warehouse_name"],
        }
    }


@router.get("/jobs/{job_id}/events")
async def get_job_events(job_id: int, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT id FROM delivery_jobs WHERE id = %s", (job_id,))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="job not found")
        await cur.execute(
            "SELECT id, job_id, driver_id, status_code, occurred_at, lat, lng, failure_reason, photo_id "
            "FROM delivery_events WHERE job_id = %s ORDER BY occurred_at",
            (job_id,),
        )
        rows = await cur.fetchall()
    return {"events": [_serialize_admin_event(r) for r in rows]}


@router.get("/users")
async def list_admins(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, name, email, status, created_at FROM users WHERE role = 'admin' ORDER BY created_at"
        )
        rows = await cur.fetchall()
    return {
        "admins": [
            {"id": r["id"], "name": r["name"], "email": r["email"], "status": r["status"], "created_at": str(r["created_at"])}
            for r in rows
        ]
    }


@router.post("/users", status_code=201)
async def add_admin(body: AddAdminRequest, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        # Scoped to role='admin': an email that already has a driver account is a
        # separate identity here and shouldn't block adding it to the admin
        # allowlist -- users.email is only unique per role, not across the table.
        await cur.execute("SELECT id FROM users WHERE email = %s AND role = 'admin'", (body.email,))
        if await cur.fetchone() is not None:
            raise HTTPException(status_code=409, detail="an admin with this email already exists")
        await cur.execute(
            "INSERT INTO users (role, email, name, status) VALUES ('admin', %s, %s, 'active')",
            (body.email, body.name),
        )
        new_id = cur.lastrowid
    return {"id": new_id, "email": body.email, "name": body.name}
