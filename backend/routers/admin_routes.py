"""Admin-facing endpoints (Google SSO gated). Driver/job listings, the
chronological per-job event log, and the orphan-event review queue for
Delivered check-ins the OCR matcher couldn't confidently link."""
from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth import get_current_admin
from db import get_pool
from schemas import AddAdminRequest, ResolveEventRequest

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
        "recipient_name": row["recipient_name"],
        "address": row["address"],
        "status_code": row["status_code"],
        "needs_review": bool(row["needs_review"]),
        "created_at": str(row["created_at"]),
        "work_date": str(row["work_date"]),
        "driver_id": row["driver_id"],
        "driver_name": row["driver_name"],
    }


def _serialize_admin_event(row: dict) -> dict:
    return {
        "id": row["id"],
        "driver_selected_job_id": row["driver_selected_job_id"],
        "job_id": row["job_id"],
        "driver_id": row["driver_id"],
        "status_code": row["status_code"],
        "occurred_at": str(row["occurred_at"]),
        "lat": float(row["lat"]) if row["lat"] is not None else None,
        "lng": float(row["lng"]) if row["lng"] is not None else None,
        "photo_id": row["photo_id"],
        "ocr_candidate_text": row["ocr_candidate_text"],
        "match_type": row["match_type"],
        "needs_review": bool(row["needs_review"]),
        "resolved_by": row["resolved_by"],
        "resolved_at": str(row["resolved_at"]) if row["resolved_at"] else None,
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
    needs_review: bool | None = Query(None),
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
    if needs_review is not None:
        where.append("dj.needs_review = %s")
        params.append(1 if needs_review else 0)
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
            f"SELECT dj.id, dj.tracking_no, dj.recipient_name, dj.address, dj.status_code, "
            f"       dj.needs_review, dj.created_at, m.work_date, m.driver_id, u.name AS driver_name "
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
            "SELECT dj.id, dj.tracking_no, dj.recipient_name, dj.address, dj.status_code, "
            "       dj.needs_review, dj.created_at, dj.raw_ocr_json, "
            "       m.id AS manifest_id, m.work_date, m.photo_id AS manifest_photo_id, "
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
            "recipient_name": row["recipient_name"],
            "address": row["address"],
            "status_code": row["status_code"],
            "needs_review": bool(row["needs_review"]),
            "created_at": str(row["created_at"]),
            "raw_ocr_json": row["raw_ocr_json"],
            "manifest_id": row["manifest_id"],
            "work_date": str(row["work_date"]),
            "manifest_photo_id": row["manifest_photo_id"],
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
            "SELECT id, driver_selected_job_id, job_id, driver_id, status_code, occurred_at, lat, lng, "
            "       photo_id, ocr_candidate_text, match_type, needs_review, resolved_by, resolved_at "
            "FROM delivery_events WHERE driver_selected_job_id = %s OR job_id = %s ORDER BY occurred_at",
            (job_id, job_id),
        )
        rows = await cur.fetchall()
    return {"events": [_serialize_admin_event(r) for r in rows]}


@router.get("/events/orphans")
async def list_orphan_events(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT de.id, de.driver_selected_job_id, de.driver_id, de.status_code, de.occurred_at, "
            "       de.photo_id, de.ocr_candidate_text, "
            "       tapped.tracking_no AS tapped_tracking_no, tapped.manifest_id, "
            "       u.name AS driver_name, m.work_date "
            "FROM delivery_events de "
            "JOIN delivery_jobs tapped ON tapped.id = de.driver_selected_job_id "
            "JOIN manifests m ON m.id = tapped.manifest_id "
            "JOIN users u ON u.id = de.driver_id "
            "WHERE de.needs_review = 1 "
            "ORDER BY de.occurred_at DESC"
        )
        rows = await cur.fetchall()
    return {
        "events": [
            {
                "id": r["id"],
                "driver_selected_job_id": r["driver_selected_job_id"],
                "manifest_id": r["manifest_id"],
                "driver_id": r["driver_id"],
                "driver_name": r["driver_name"],
                "status_code": r["status_code"],
                "occurred_at": str(r["occurred_at"]),
                "photo_id": r["photo_id"],
                "ocr_candidate_text": r["ocr_candidate_text"],
                "tapped_tracking_no": r["tapped_tracking_no"],
                "work_date": str(r["work_date"]),
            }
            for r in rows
        ]
    }


@router.post("/events/{event_id}/resolve")
async def resolve_event(event_id: int, body: ResolveEventRequest, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT de.id, de.needs_review, de.status_code, tapped.manifest_id AS tapped_manifest_id "
            "FROM delivery_events de "
            "JOIN delivery_jobs tapped ON tapped.id = de.driver_selected_job_id "
            "WHERE de.id = %s",
            (event_id,),
        )
        event = await cur.fetchone()
        if event is None:
            raise HTTPException(status_code=404, detail="event not found")
        if not event["needs_review"]:
            raise HTTPException(status_code=409, detail="event is not pending review")

        await cur.execute("SELECT id, manifest_id FROM delivery_jobs WHERE id = %s", (body.job_id,))
        target_job = await cur.fetchone()
        if target_job is None:
            raise HTTPException(status_code=404, detail="target job not found")
        if target_job["manifest_id"] != event["tapped_manifest_id"]:
            raise HTTPException(status_code=400, detail="target job must be on the same manifest as the check-in")

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "UPDATE delivery_events SET job_id = %s, needs_review = 0, resolved_by = %s, resolved_at = NOW() "
            "WHERE id = %s",
            (body.job_id, admin["id"], event_id),
        )
        await cur.execute("UPDATE delivery_jobs SET status_code = %s WHERE id = %s", (event["status_code"], body.job_id))
    return {"ok": True}


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
