"""System diagnostics: the error log, and the health checks that sit beside it.

Two routers because they have two audiences:

  public_router  POST /api/diagnostics/client-error
                 What the driver app and the admin pages call when THEY break.
                 Open to anyone, because the person it breaks for is often not
                 logged in yet (a crash on the login screen) or no longer
                 (an expired session). Bounded instead of authenticated:
                 small bodies, a per-client rate limit, and a per-problem
                 rate limit so one crash loop cannot fill the table.

  router         /api/admin/diagnostics/*
                 What an admin reads: a summary, the issues grouped by
                 fingerprint, the raw events, the health checks, and the
                 actions (resolve / reopen / clear resolved / self-test).

Backend failures never come through here -- they are caught where they happen
(see the exception handlers in main.py) and written by the same
diagnostics.record_error.
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

import diagnostics
from auth import get_current_admin
from clocks import fmt
from db import get_pool
from diagnostics import actor_from_request, client_ip, client_limiter, record_error
from healthchecks import run_checks

public_router = APIRouter()
router = APIRouter()

MAX_BODY_BYTES = 100_000
MAX_REPORT_AGE = 7 * 86400
FINGERPRINT = re.compile(r"^[0-9a-f]{40}$")
LIST_DETAIL_MAX = 6000


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------- ingest

class ClientError(BaseModel):
    source: Literal["driver", "admin"]
    kind: Literal["js_error", "promise_rejection", "render_error", "network_error", "gateway_error", "test"]
    message: str
    stack: str | None = None
    page: str | None = None
    method: str | None = None
    api_path: str | None = None
    status: int | None = None
    build: str | None = None
    level: Literal["error", "warning"] = "error"
    # Seconds between the error and this report, for reports held back while
    # the phone had no signal.
    age_seconds: int = 0


_URL = re.compile(r"\(?https?://\S+\)?")


def _top_frame(stack: str | None) -> str | None:
    """The function name on the first stack line that has one, with the URL
    (which carries a per-build hash) removed -- so the same bug groups together
    across deploys."""
    for line in (stack or "").splitlines()[1:6]:
        cleaned = _URL.sub("", line).strip()
        if cleaned:
            return cleaned[:120]
    return None


@public_router.post("/client-error", status_code=202)
async def client_error(body: ClientError, request: Request):
    try:
        size = int(request.headers.get("content-length") or 0)
    except ValueError:
        size = 0
    if size > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="report too large")
    if not client_limiter.allow(client_ip(request)):
        raise HTTPException(status_code=429, detail="too many reports")

    # A client report is about something that happened to the person, not about
    # an API call -- those are written server-side with the real status and
    # route. What arrives here is what the server could not have seen.
    is_api = body.api_path is not None
    actor_type, actor_id, actor_label = actor_from_request(request)
    if body.source == "admin" and actor_type is None:
        actor_type = "admin"
    error_id = await record_error(
        get_pool(request),
        source=body.source,
        kind=body.kind,
        level=body.level,
        message=body.message,
        detail=body.stack,
        method=body.method if is_api else None,
        path=body.api_path if is_api else body.page,
        status_code=body.status,
        actor=(actor_type, actor_id, actor_label),
        user_agent=request.headers.get("user-agent"),
        app_build=body.build,
        frame=_top_frame(body.stack),
        when=_now() - timedelta(seconds=max(0, min(body.age_seconds, MAX_REPORT_AGE))),
    )
    return {"ok": True, "id": error_id}


# ------------------------------------------------------------------ read

def _where(source, level, q, days, extra=()):
    where = ["e.created_at >= %s"]
    params: list = [_now() - timedelta(days=days)]
    if source:
        where.append("e.source = %s")
        params.append(source)
    if level:
        where.append("e.level = %s")
        params.append(level)
    if q:
        like = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where.append("(e.message LIKE %s OR e.path LIKE %s OR e.actor_label LIKE %s OR e.kind LIKE %s "
                     "OR u.name LIKE %s)")
        params += [like] * 5
    for clause, value in extra:
        where.append(clause)
        params.append(value)
    return " AND ".join(where), params


# Joined on every read so a driver shows as a name, not a number, and a rename
# is not frozen into history.
_FROM = "FROM error_log e LEFT JOIN users u ON u.id = e.actor_id AND e.actor_type = 'driver'"


def _who(r: dict) -> str | None:
    if r.get("actor_type") == "driver" and r.get("actor_id"):
        return f"{r.get('driver_name') or 'Driver'} (driver #{r['actor_id']})"
    return r.get("actor_label")


def _event(r: dict) -> dict:
    return {
        "id": r["id"], "source": r["source"], "kind": r["kind"], "level": r["level"],
        "message": r["message"], "detail": (r.get("detail") or "")[:LIST_DETAIL_MAX] or None,
        "method": r["method"], "path": r["path"], "status_code": r["status_code"],
        "who": _who(r), "user_agent": r["user_agent"], "app_build": r["app_build"],
        "fingerprint": r["fingerprint"],
        "resolved_at": fmt(r["resolved_at"]), "resolved_by": r["resolved_by"],
        "created_at": fmt(r["created_at"]),
    }


_EVENT_COLS = ("e.id, e.source, e.kind, e.level, e.message, e.detail, e.method, e.path, e.status_code, "
               "e.actor_type, e.actor_id, e.actor_label, u.name AS driver_name, e.user_agent, e.app_build, "
               "e.fingerprint, e.resolved_at, e.resolved_by, e.created_at")


@router.get("/summary")
async def summary(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    now = _now()
    since24, since7 = now - timedelta(hours=24), now - timedelta(days=7)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT source, level, COUNT(*) AS n, SUM(created_at >= %s) AS n24 "
            "FROM error_log WHERE created_at >= %s GROUP BY source, level",
            (since24, since7),
        )
        rows = await cur.fetchall()
        await cur.execute(
            "SELECT COUNT(*) AS n FROM error_log WHERE resolved_at IS NULL AND level = 'error' AND created_at >= %s",
            (since24,),
        )
        open_24h = (await cur.fetchone())["n"]
        await cur.execute(
            "SELECT COUNT(DISTINCT fingerprint) AS n FROM error_log "
            "WHERE resolved_at IS NULL AND level = 'error' AND created_at >= %s",
            (since7,),
        )
        open_issues = (await cur.fetchone())["n"]
        await cur.execute("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM error_log")
        total = await cur.fetchone()

    by_source = {s: {"errors_24h": 0, "warnings_24h": 0, "errors_7d": 0, "warnings_7d": 0}
                 for s in ("backend", "driver", "admin")}
    for r in rows:
        key = "errors" if r["level"] == "error" else "warnings"
        by_source[r["source"]][f"{key}_24h"] += int(r["n24"] or 0)
        by_source[r["source"]][f"{key}_7d"] += int(r["n"])
    return {
        "by_source": by_source,
        "errors_24h": sum(v["errors_24h"] for v in by_source.values()),
        "warnings_24h": sum(v["warnings_24h"] for v in by_source.values()),
        "errors_7d": sum(v["errors_7d"] for v in by_source.values()),
        "warnings_7d": sum(v["warnings_7d"] for v in by_source.values()),
        # What the nav badge shows: errors from the last day nobody has dealt with.
        "open_errors_24h": open_24h,
        "open_issues": open_issues,
        "total_logged": total["n"],
        "last_logged_at": fmt(total["last"]),
        "retention_days": diagnostics.RETENTION_DAYS,
    }


@router.get("/issues")
async def issues(
    request: Request,
    source: Literal["backend", "driver", "admin"] | None = None,
    level: Literal["error", "warning"] | None = None,
    status: Literal["open", "resolved", "all"] = "open",
    q: str | None = None,
    days: int = Query(7, ge=1, le=90),
    page: int = Query(1, ge=1),
    page_size: int = Query(15, ge=1, le=100),
    admin=Depends(get_current_admin),
):
    """The log grouped by fingerprint: fifty drivers hitting one bug are one
    row here, seen fifty times."""
    pool = get_pool(request)
    where, params = _where(source, level, q, days)
    having = {
        "open": "HAVING SUM(e.resolved_at IS NULL) > 0",
        "resolved": "HAVING SUM(e.resolved_at IS NULL) = 0",
        "all": "",
    }[status]
    grouped = (
        "SELECT e.fingerprint, MAX(e.id) AS last_id, COUNT(*) AS n, MIN(e.created_at) AS first_seen, "
        "MAX(e.created_at) AS last_seen, SUM(e.resolved_at IS NULL) AS open_n, "
        "SUM(e.resolved_at IS NOT NULL) AS resolved_n, SUM(e.level = 'error') AS error_n, "
        "COUNT(DISTINCT COALESCE(CONCAT('d', e.actor_id), e.actor_label)) AS people "
        f"{_FROM} WHERE {where} GROUP BY e.fingerprint {having}"
    )
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(f"SELECT COUNT(*) AS n FROM ({grouped}) g", tuple(params))
        total = (await cur.fetchone())["n"]
        await cur.execute(
            f"{grouped} ORDER BY (SUM(e.resolved_at IS NULL) > 0) DESC, MAX(e.created_at) DESC LIMIT %s OFFSET %s",
            tuple(params + [page_size, (page - 1) * page_size]),
        )
        groups = await cur.fetchall()
        latest = {}
        if groups:
            ids = [g["last_id"] for g in groups]
            marks = ",".join(["%s"] * len(ids))
            await cur.execute(f"SELECT {_EVENT_COLS} {_FROM} WHERE e.id IN ({marks})", tuple(ids))
            latest = {r["id"]: r for r in await cur.fetchall()}

    out = []
    for g in groups:
        last = _event(latest[g["last_id"]]) if g["last_id"] in latest else {}
        open_n, resolved_n = int(g["open_n"]), int(g["resolved_n"])
        out.append({
            "fingerprint": g["fingerprint"],
            "source": last.get("source"), "kind": last.get("kind"),
            "level": "error" if int(g["error_n"]) else "warning",
            "message": last.get("message"), "method": last.get("method"), "path": last.get("path"),
            "status_code": last.get("status_code"), "last_who": last.get("who"),
            "occurrences": int(g["n"]), "people": int(g["people"]),
            "first_seen": fmt(g["first_seen"]), "last_seen": fmt(g["last_seen"]),
            # "regressed": it was resolved once and has happened again since.
            "status": "resolved" if open_n == 0 else "regressed" if resolved_n else "open",
        })
    return {"issues": out, "total": total, "page": page, "page_size": page_size,
            "pages": max(1, -(-total // page_size))}


@router.get("/events")
async def events(
    request: Request,
    source: Literal["backend", "driver", "admin"] | None = None,
    level: Literal["error", "warning"] | None = None,
    q: str | None = None,
    days: int = Query(7, ge=1, le=90),
    fingerprint: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    admin=Depends(get_current_admin),
):
    """The raw log, newest first. With a fingerprint, the occurrences of one
    issue."""
    if fingerprint is not None and not FINGERPRINT.match(fingerprint):
        raise HTTPException(status_code=422, detail="fingerprint must be 40 hex characters")
    pool = get_pool(request)
    extra = [("e.fingerprint = %s", fingerprint)] if fingerprint else []
    where, params = _where(source, level, q, days, extra)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(f"SELECT COUNT(*) AS n {_FROM} WHERE {where}", tuple(params))
        total = (await cur.fetchone())["n"]
        await cur.execute(
            f"SELECT {_EVENT_COLS} {_FROM} WHERE {where} ORDER BY e.id DESC LIMIT %s OFFSET %s",
            tuple(params + [page_size, (page - 1) * page_size]),
        )
        rows = await cur.fetchall()
    return {"events": [_event(r) for r in rows], "total": total, "page": page, "page_size": page_size,
            "pages": max(1, -(-total // page_size))}


@router.get("/health")
async def health(request: Request, admin=Depends(get_current_admin)):
    checks = await run_checks(get_pool(request))
    worst = "fail" if any(c["status"] == "fail" for c in checks) else \
            "warn" if any(c["status"] == "warn" for c in checks) else "ok"
    return {"overall": worst, "checks": checks, "checked_at": fmt(_now())}


# --------------------------------------------------------------- actions

def _fp(value: str) -> str:
    if not FINGERPRINT.match(value):
        raise HTTPException(status_code=422, detail="fingerprint must be 40 hex characters")
    return value


@router.post("/issues/{fingerprint}/resolve")
async def resolve_issue(fingerprint: str, request: Request, admin=Depends(get_current_admin)):
    """Marks every occurrence of one issue as dealt with. If it happens again
    the new occurrence is open, and the issue reads as regressed."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "UPDATE error_log SET resolved_at = %s, resolved_by = %s WHERE fingerprint = %s AND resolved_at IS NULL",
            (_now(), admin["email"], _fp(fingerprint)),
        )
        return {"resolved": cur.rowcount}


@router.post("/issues/{fingerprint}/reopen")
async def reopen_issue(fingerprint: str, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "UPDATE error_log SET resolved_at = NULL, resolved_by = NULL "
            "WHERE fingerprint = %s AND resolved_at IS NOT NULL",
            (_fp(fingerprint),),
        )
        return {"reopened": cur.rowcount}


@router.post("/clear-resolved")
async def clear_resolved(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("DELETE FROM error_log WHERE resolved_at IS NOT NULL")
        return {"deleted": cur.rowcount}


@router.post("/test-backend-error")
async def test_backend_error(admin=Depends(get_current_admin)):
    """Raises on purpose, to prove the path from a backend exception to this
    page works end to end. The caller sees a 500 -- that is the test."""
    raise RuntimeError("Diagnostics self-test: this error was raised on purpose by an admin")
