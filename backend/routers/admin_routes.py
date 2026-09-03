"""Admin-facing endpoints (Google SSO gated). Driver/job listings and each job's
chronological scan-event log (timestamp, status, GPS). No more orphan-event review --
barcode scans are exact matches, so there's nothing left ambiguous to resolve."""
from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth import get_current_admin
from db import get_pool
from schemas import AddAdminRequest

router = APIRouter()


def _serialize_driver(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "status": row["status"],
        "created_at": str(row["created_at"]),
    }


def _serialize_admin_job(row: dict) -> dict:
    return {
        "id": row["id"],
        "tracking_no": row["tracking_no"],
        "status_code": row["status_code"],
        "created_at": str(row["created_at"]),
        "work_date": str(row["work_date"]),
        "driver_id": row["driver_id"],
        "driver_name": row["driver_name"],
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
    }


@router.get("/drivers")
async def list_drivers(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, name, email, phone, status, created_at FROM users "
            "WHERE role = 'driver' ORDER BY created_at DESC"
        )
        rows = await cur.fetchall()
    return {"drivers": [_serialize_driver(r) for r in rows]}


@router.get("/jobs")
async def list_jobs(
    request: Request,
    status: str | None = Query(None),
    driver_id: int | None = Query(None),
    manifest_id: int | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    admin=Depends(get_current_admin),
):
    pool = get_pool(request)
    where = []
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
    if date_from:
        where.append("m.work_date >= %s")
        params.append(date_from)
    if date_to:
        where.append("m.work_date <= %s")
        params.append(date_to)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    offset = (page - 1) * page_size

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            f"SELECT dj.id, dj.tracking_no, dj.status_code, dj.created_at, "
            f"       m.work_date, m.driver_id, u.name AS driver_name "
            f"FROM delivery_jobs dj "
            f"JOIN manifests m ON m.id = dj.manifest_id "
            f"JOIN users u ON u.id = m.driver_id "
            f"{where_sql} "
            f"ORDER BY m.work_date DESC, dj.id DESC "
            f"LIMIT %s OFFSET %s",
            (*params, page_size, offset),
        )
        rows = await cur.fetchall()
    return {"jobs": [_serialize_admin_job(r) for r in rows], "page": page, "page_size": page_size}


@router.get("/jobs/{job_id}")
async def get_job(job_id: int, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT dj.id, dj.tracking_no, dj.status_code, dj.created_at, "
            "       m.id AS manifest_id, m.work_date, "
            "       u.id AS driver_id, u.name AS driver_name, u.email AS driver_email "
            "FROM delivery_jobs dj "
            "JOIN manifests m ON m.id = dj.manifest_id "
            "JOIN users u ON u.id = m.driver_id "
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
            "driver_id": row["driver_id"],
            "driver_name": row["driver_name"],
            "driver_email": row["driver_email"],
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
            "SELECT id, job_id, driver_id, status_code, occurred_at, lat, lng "
            "FROM delivery_events WHERE job_id = %s ORDER BY occurred_at",
            (job_id,),
        )
        rows = await cur.fetchall()
    return {"events": [_serialize_admin_event(r) for r in rows]}


@router.post("/users", status_code=201)
async def add_admin(body: AddAdminRequest, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM users WHERE email = %s", (body.email,))
        if await cur.fetchone() is not None:
            raise HTTPException(status_code=409, detail="a user with this email already exists")
        await cur.execute(
            "INSERT INTO users (role, email, name, status) VALUES ('admin', %s, %s, 'active')",
            (body.email, body.name),
        )
        new_id = cur.lastrowid
    return {"id": new_id, "email": body.email, "name": body.name}
