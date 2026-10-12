"""Endpoints shared by both the driver and admin surfaces."""
from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from access import CATALOG, allows_any, denial, effective_permissions
from auth import get_current_admin, get_current_user_any
from db import get_pool
from photos import fetch_photo

router = APIRouter()


@router.get("/me")
async def me(request: Request):
    # Public: this is exactly how the admin frontend discovers whether it's
    # allowed to render anything. Absent header (SSO off / local dev) -> anonymous.
    #
    # `permissions` is what the admin screens use to decide what to show. It is a
    # convenience, not the control: every admin endpoint checks the same role
    # again on the server.
    pool = get_pool(request)
    email = request.headers.get("x-forwarded-email")
    is_admin, role_name, permissions = False, None, {}
    if pool is not None and email:
        async with pool.acquire() as conn, conn.cursor() as cur:
            await cur.execute(
                "SELECT r.id, r.name, r.permissions, r.is_system FROM users u "
                "LEFT JOIN access_role r ON r.id = u.access_role_id "
                "WHERE u.email = %s AND u.role = 'admin' AND u.status = 'active'",
                (email,),
            )
            row = await cur.fetchone()
        if row is not None:
            is_admin = True
            role_name = row[1]
            permissions = effective_permissions(row[0], row[2], row[3])
    return {
        "email": email, "is_admin": is_admin, "role": role_name, "permissions": permissions,
        # What a permission can be about, with the levels each offers -- sent
        # with the person's own grants so the screens never keep a second copy
        # of the list that could drift from the server's.
        "modules": CATALOG if is_admin else [],
    }


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


@router.get("/warehouses")
async def list_active_warehouses(request: Request):
    # Public, deliberately: needed on the signup form before any token exists, and
    # outlet names/addresses aren't sensitive. Only active outlets -- a removed one
    # can't be newly picked, though drivers already assigned to it are unaffected.
    pool = get_pool(request)
    if pool is None:
        return {"warehouses": []}
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT id, name, address FROM warehouses WHERE is_active = 1 ORDER BY name")
        rows = await cur.fetchall()
    return {"warehouses": [{"id": r["id"], "name": r["name"], "address": r["address"]} for r in rows]}


@router.get("/photos/{photo_id}")
async def get_photo(photo_id: int, request: Request, user=Depends(get_current_user_any)):
    pool = get_pool(request)
    if user["role"] == "admin" and not allows_any(user.get("permissions") or {}, ("evidence", "orders")):
        # Proof photos are shown on Evidence and Orders; a role with neither has
        # no screen that needs one, and a photo id is a guessable integer.
        # Decided before the photo is looked up, so refusing does not also tell
        # them which ids exist.
        raise HTTPException(status_code=403, detail=denial(user.get("role_name"), ("evidence", "orders"), "view"))
    result = await fetch_photo(pool, photo_id)
    if result is None:
        raise HTTPException(status_code=404, detail="photo not found")
    data, content_type, uploaded_by = result
    if user["role"] != "admin" and uploaded_by != user["id"]:
        # A browser used for both surfaces sends the driver's Bearer token on
        # the admin screens too, and the presence of that header is what decides
        # the identity -- so one stale or foreign driver token turned every
        # proof photo in the evidence view into a refusal. Give the SSO proxy a
        # chance to identify an admin before saying no. This grants nothing new:
        # it is the same check that would have run had no token been sent.
        try:
            admin = await get_current_admin(request)
        except HTTPException:
            raise HTTPException(status_code=403, detail="not your photo")
        if not allows_any(admin["permissions"], ("evidence", "orders")):
            raise HTTPException(status_code=403, detail=denial(admin["role_name"], ("evidence", "orders"), "view"))
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "private, max-age=86400"})
