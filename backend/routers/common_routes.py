"""Endpoints shared by both the driver and admin surfaces."""
from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, Request

from auth import get_current_user_any
from db import get_pool

router = APIRouter()


@router.get("/me")
async def me(request: Request):
    # Public: this is exactly how the admin frontend discovers whether it's
    # allowed to render anything. Absent header (SSO off / local dev) -> anonymous.
    pool = get_pool(request)
    email = request.headers.get("x-forwarded-email")
    is_admin = False
    if pool is not None and email:
        async with pool.acquire() as conn, conn.cursor() as cur:
            await cur.execute(
                "SELECT 1 FROM users WHERE email = %s AND role = 'admin' AND status = 'active'", (email,)
            )
            is_admin = await cur.fetchone() is not None
    return {"email": email, "is_admin": is_admin}


@router.get("/statuses")
async def list_statuses(request: Request, user=Depends(get_current_user_any)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT code, label, is_terminal_success FROM statuses WHERE is_active = 1 ORDER BY sort_order")
        rows = await cur.fetchall()
    return {
        "statuses": [
            {"code": r["code"], "label": r["label"], "is_terminal_success": bool(r["is_terminal_success"])}
            for r in rows
        ]
    }
