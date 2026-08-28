"""Driver auth (password + JWT) and admin auth (Google SSO header, allowlisted in `users`)."""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, Request

from db import get_pool

JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user_id: int) -> str:
    expiry_days = int(os.getenv("JWT_EXPIRY_DAYS", "14"))
    payload = {
        "sub": str(user_id),
        "role": "driver",
        "exp": datetime.now(timezone.utc) + timedelta(days=expiry_days),
    }
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


def _row_to_user(row) -> dict:
    return {"id": row[0], "role": row[1], "email": row[2], "phone": row[3], "name": row[4], "status": row[5]}


async def _load_user_by_id(pool, user_id: int) -> dict | None:
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT id, role, email, phone, name, status FROM users WHERE id = %s", (user_id,)
        )
        row = await cur.fetchone()
    return _row_to_user(row) if row else None


async def get_current_driver(request: Request) -> dict:
    pool = get_pool(request)
    if pool is None:
        raise HTTPException(status_code=503, detail="database not configured")
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = auth_header[len("Bearer "):]
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="invalid or expired token")
    user = await _load_user_by_id(pool, int(payload["sub"]))
    if user is None or user["role"] != "driver" or user["status"] != "active":
        raise HTTPException(status_code=401, detail="invalid token")
    return user


async def get_current_admin(request: Request) -> dict:
    pool = get_pool(request)
    if pool is None:
        raise HTTPException(status_code=503, detail="database not configured")
    # Trustworthy only while the platform's Google SSO proxy is enabled for this app
    # (it strips any client-sent copy of this header before injecting its own). An
    # absent header means SSO is off or this is local dev -- refuse rather than treat
    # that as "anonymous but allowed", since nothing else here proves who's asking.
    email = request.headers.get("x-forwarded-email")
    if not email:
        raise HTTPException(
            status_code=403,
            detail="admin access requires Google SSO to be enabled for this app (Substrait portal Access tab)",
        )
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT id, role, email, phone, name, status FROM users WHERE email = %s AND role = 'admin'",
            (email,),
        )
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=403, detail="this account is not on the admin allowlist")
    user = _row_to_user(row)
    if user["status"] != "active":
        raise HTTPException(status_code=403, detail="this admin account is disabled")
    return user


async def get_current_user_any(request: Request) -> dict:
    """Accepts either a driver JWT or an admin SSO header — for endpoints both
    surfaces call (GET /api/statuses, GET /api/photos/{id})."""
    if request.headers.get("authorization", "").startswith("Bearer "):
        return await get_current_driver(request)
    return await get_current_admin(request)
