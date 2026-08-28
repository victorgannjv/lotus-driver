"""Driver-facing endpoints: manifest upload+OCR, and the check-in flow that logs
every status change with timestamp/GPS/photo and auto-matches Delivered check-ins
back to a manifest job via OCR of the delivery-order slip."""
import json
from datetime import date, datetime, timezone

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from auth import get_current_driver
from db import get_pool
from matching import match_job
from ocr import extract_do_identifier, extract_manifest
from photos import fetch_photo, store_photo

router = APIRouter()


def _serialize_manifest(row: dict) -> dict:
    return {
        "id": row["id"],
        "work_date": str(row["work_date"]),
        "photo_id": row["photo_id"],
        "ocr_status": row["ocr_status"],
        "ocr_error": row["ocr_error"],
        "created_at": str(row["created_at"]),
    }


def _serialize_job(row: dict) -> dict:
    return {
        "id": row["id"],
        "tracking_no": row["tracking_no"],
        "recipient_name": row["recipient_name"],
        "address": row["address"],
        "status_code": row["status_code"],
        "needs_review": bool(row["needs_review"]),
        "created_at": str(row["created_at"]),
    }


def _serialize_event(row: dict) -> dict:
    return {
        "id": row["id"],
        "status_code": row["status_code"],
        "occurred_at": str(row["occurred_at"]),
        "lat": float(row["lat"]) if row["lat"] is not None else None,
        "lng": float(row["lng"]) if row["lng"] is not None else None,
        "photo_id": row["photo_id"],
        "match_type": row["match_type"],
        "needs_review": bool(row["needs_review"]),
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


async def _persist_ocr_jobs(pool, manifest_id: int, ocr_result: dict) -> list[dict]:
    jobs_data = ocr_result.get("jobs", [])
    error = ocr_result.get("error")
    ocr_status = "failed" if error or not jobs_data else "done"
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "UPDATE manifests SET ocr_status = %s, ocr_error = %s, ocr_raw_response = %s WHERE id = %s",
            (ocr_status, error, ocr_result.get("raw"), manifest_id),
        )
        created = []
        for job in jobs_data:
            await cur.execute(
                "INSERT INTO delivery_jobs (manifest_id, tracking_no, recipient_name, address, raw_ocr_json, status_code) "
                "VALUES (%s, %s, %s, %s, %s, 'pending')",
                (manifest_id, job.get("tracking_no"), job.get("recipient_name"), job.get("address"), json.dumps(job)),
            )
            created.append({"id": cur.lastrowid, **job, "status_code": "pending"})
    return created


@router.post("/manifests", status_code=201)
async def upload_manifest(
    request: Request,
    file: UploadFile = File(...),
    work_date: str | None = Form(None),
    driver=Depends(get_current_driver),
):
    pool = get_pool(request)
    raw = await file.read()
    content_type = file.content_type or "image/jpeg"
    photo_id = await store_photo(pool, raw, content_type, driver["id"])
    parsed_date = work_date or date.today().isoformat()

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO manifests (driver_id, work_date, photo_id, ocr_status) VALUES (%s, %s, %s, 'pending')",
            (driver["id"], parsed_date, photo_id),
        )
        manifest_id = cur.lastrowid

    ocr_result = await extract_manifest(raw, content_type)
    jobs = await _persist_ocr_jobs(pool, manifest_id, ocr_result)

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, work_date, photo_id, ocr_status, ocr_error, created_at FROM manifests WHERE id = %s",
            (manifest_id,),
        )
        manifest = await cur.fetchone()

    return {"manifest": _serialize_manifest(manifest), "jobs": jobs}


@router.post("/manifests/{manifest_id}/reprocess")
async def reprocess_manifest(manifest_id: int, request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, photo_id, ocr_status FROM manifests WHERE id = %s AND driver_id = %s",
            (manifest_id, driver["id"]),
        )
        manifest = await cur.fetchone()
    if manifest is None:
        raise HTTPException(status_code=404, detail="manifest not found")
    if manifest["ocr_status"] != "failed":
        raise HTTPException(
            status_code=409, detail="reprocess is only allowed after a failed OCR pass (jobs already exist otherwise)"
        )
    photo = await fetch_photo(pool, manifest["photo_id"])
    if photo is None:
        raise HTTPException(status_code=404, detail="manifest photo missing")
    raw, content_type, _ = photo
    ocr_result = await extract_manifest(raw, content_type)
    jobs = await _persist_ocr_jobs(pool, manifest_id, ocr_result)
    return {"manifest_id": manifest_id, "jobs": jobs}


@router.get("/manifests")
async def list_manifests(request: Request, driver=Depends(get_current_driver)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, work_date, photo_id, ocr_status, ocr_error, created_at FROM manifests "
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
            "SELECT id, work_date, photo_id, ocr_status, ocr_error, created_at FROM manifests "
            "WHERE id = %s AND driver_id = %s",
            (manifest_id, driver["id"]),
        )
        manifest = await cur.fetchone()
        if manifest is None:
            raise HTTPException(status_code=404, detail="manifest not found")
        await cur.execute(
            "SELECT id, tracking_no, recipient_name, address, status_code, needs_review, created_at "
            "FROM delivery_jobs WHERE manifest_id = %s ORDER BY id",
            (manifest_id,),
        )
        jobs = await cur.fetchall()
    return {"manifest": _serialize_manifest(manifest), "jobs": [_serialize_job(j) for j in jobs]}


@router.post("/jobs/{job_id}/checkins", status_code=201)
async def checkin(
    job_id: int,
    request: Request,
    status_code: str = Form(...),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    occurred_at: str | None = Form(None),
    photo: UploadFile | None = File(None),
    driver=Depends(get_current_driver),
):
    pool = get_pool(request)

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT dj.id, dj.manifest_id FROM delivery_jobs dj JOIN manifests m ON m.id = dj.manifest_id "
            "WHERE dj.id = %s AND m.driver_id = %s",
            (job_id, driver["id"]),
        )
        job = await cur.fetchone()
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")

        await cur.execute(
            "SELECT code, requires_photo, is_terminal_success, is_active FROM statuses WHERE code = %s",
            (status_code,),
        )
        status_row = await cur.fetchone()
    if status_row is None or not status_row["is_active"]:
        raise HTTPException(status_code=422, detail="unknown or inactive status")

    photo_bytes = None
    photo_id = None
    photo_content_type = None
    if photo is not None:
        photo_bytes = await photo.read()
        photo_content_type = photo.content_type or "image/jpeg"
        photo_id = await store_photo(pool, photo_bytes, photo_content_type, driver["id"])
    elif status_row["requires_photo"]:
        raise HTTPException(status_code=422, detail=f"status '{status_code}' requires a photo")

    occurred_dt = _parse_occurred_at(occurred_at)

    if status_row["is_terminal_success"]:
        if photo_bytes is None:
            raise HTTPException(status_code=422, detail="a photo is required to auto-match a delivered job")

        ocr_result = await extract_do_identifier(photo_bytes, photo_content_type)
        candidate = ocr_result.get("tracking_no")

        async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
            await cur.execute(
                "SELECT id, tracking_no FROM delivery_jobs WHERE manifest_id = %s AND status_code != 'delivered'",
                (job["manifest_id"],),
            )
            open_jobs = await cur.fetchall()

        matched_job, match_type = match_job(candidate, open_jobs)
        resolved_job_id = matched_job["id"] if matched_job else None
        needs_review = 0 if matched_job else 1

        async with pool.acquire() as conn, conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO delivery_events "
                "(driver_selected_job_id, job_id, driver_id, status_code, occurred_at, lat, lng, "
                " photo_id, ocr_candidate_text, match_type, needs_review) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    job_id, resolved_job_id, driver["id"], status_code, occurred_dt, lat, lng,
                    photo_id, candidate, match_type, needs_review,
                ),
            )
            event_id = cur.lastrowid
            if matched_job is not None:
                await cur.execute(
                    "UPDATE delivery_jobs SET status_code = %s WHERE id = %s", (status_code, matched_job["id"])
                )

        return {
            "event_id": event_id,
            "matched_job_id": resolved_job_id,
            "match_type": match_type,
            "needs_review": bool(needs_review),
        }

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO delivery_events "
            "(driver_selected_job_id, job_id, driver_id, status_code, occurred_at, lat, lng, photo_id, match_type) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'n_a')",
            (job_id, job_id, driver["id"], status_code, occurred_dt, lat, lng, photo_id),
        )
        event_id = cur.lastrowid
        await cur.execute("UPDATE delivery_jobs SET status_code = %s WHERE id = %s", (status_code, job_id))

    return {"event_id": event_id, "matched_job_id": job_id, "match_type": "n_a", "needs_review": False}


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
            "SELECT id, status_code, occurred_at, lat, lng, photo_id, match_type, needs_review "
            "FROM delivery_events WHERE driver_selected_job_id = %s OR job_id = %s ORDER BY occurred_at",
            (job_id, job_id),
        )
        events = await cur.fetchall()
    return {"events": [_serialize_event(e) for e in events]}
