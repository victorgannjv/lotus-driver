"""Driver auth (password + JWT) and admin auth (Google SSO header, allowlisted in `users`)."""
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, Request

from access import VIEW, allows_any, denial, effective_permissions
from db import get_pool

JWT_ALGORITHM = "HS256"
RESET_TOKEN_TTL = timedelta(hours=1)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def generate_reset_token() -> tuple[str, str, datetime]:
    """Returns (raw_token_for_the_email_link, sha256_hex_for_the_db, expires_at).
    Only the hash is ever stored -- a DB leak alone can't be used to reset a password."""
    raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + RESET_TOKEN_TTL
    return raw, token_hash, expires_at


def hash_reset_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


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
    """Identifies the admin. Says WHO, not what they may do -- that is
    require_access's job, and the answer rides along as user["permissions"]."""
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
            "SELECT u.id, u.role, u.email, u.phone, u.name, u.status, "
            "r.id, r.name, r.permissions, r.is_system "
            "FROM users u LEFT JOIN access_role r ON r.id = u.access_role_id "
            "WHERE u.email = %s AND u.role = 'admin'",
            (email,),
        )
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=403, detail="this account is not on the admin allowlist")
    user = _row_to_user(row)
    if user["status"] != "active":
        raise HTTPException(status_code=403, detail="this admin account is disabled")
    role_id, role_name, role_permissions, is_system = row[6], row[7], row[8], row[9]
    user["access_role_id"] = role_id
    user["role_name"] = role_name
    # No role means no access, not full access: the safe way to be wrong. The
    # migration gives every existing admin the system role, and adding one now
    # requires choosing a role, so this is only an admin someone has since
    # unassigned.
    user["permissions"] = effective_permissions(role_id, role_permissions, is_system)
    return user


def require_access(module, level: str = VIEW):
    """A route dependency: the caller must be an active admin whose role gives
    them `level` on `module` -- or on ANY of them, when given several, which is
    for endpoints that serve more than one screen (the driver list feeds a
    filter on Evidence as well as the Drivers page)."""
    modules = (module,) if isinstance(module, str) else tuple(module)

    async def dependency(request: Request) -> dict:
        admin = await get_current_admin(request)
        if not allows_any(admin["permissions"], modules, level):
            raise HTTPException(status_code=403, detail=denial(admin["role_name"], modules, level))
        return admin

    return dependency


async def require_any_access(request: Request) -> dict:
    """For reference data every screen needs (the outlet names in a filter):
    any admin who can use at least one module."""
    admin = await get_current_admin(request)
    if not admin["permissions"]:
        raise HTTPException(status_code=403, detail=denial(admin["role_name"], (), VIEW))
    return admin


async def get_current_user_any(request: Request) -> dict:
    """Accepts either a driver JWT or an admin SSO header — for endpoints both
    surfaces call (GET /api/statuses)."""
    if request.headers.get("authorization", "").startswith("Bearer "):
        return await get_current_driver(request)
    return await get_current_admin(request)
