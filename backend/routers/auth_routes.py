"""Driver signup / login. Drivers have no company Google account, so this is a
plain email+password flow issuing a JWT signed with the platform's JWT_SECRET.
Also the forgot-password flow: email a one-time reset link (SMTP via mailer.py)."""
import sys
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from auth import create_token, generate_reset_token, hash_password, hash_reset_token, verify_password
from db import get_pool
from mailer import send_password_reset_email
from schemas import ForgotPasswordRequest, LoginRequest, ResetPasswordRequest, SignupRequest

router = APIRouter()


@router.post("/signup", status_code=201)
async def signup(body: SignupRequest, request: Request):
    pool = get_pool(request)
    if pool is None:
        raise HTTPException(status_code=503, detail="database not configured")
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT id FROM users WHERE email = %s", (body.email,))
        if await cur.fetchone() is not None:
            raise HTTPException(status_code=409, detail="an account with this email already exists")
        password_hash = hash_password(body.password)
        await cur.execute(
            "INSERT INTO users (role, email, phone, password_hash, name, status) "
            "VALUES ('driver', %s, %s, %s, %s, 'active')",
            (body.email, body.phone, password_hash, body.name),
        )
        user_id = cur.lastrowid
    token = create_token(user_id)
    return {"token": token, "user": {"id": user_id, "email": body.email, "name": body.name}}


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    pool = get_pool(request)
    if pool is None:
        raise HTTPException(status_code=503, detail="database not configured")
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT id, password_hash, name, status FROM users WHERE email = %s AND role = 'driver'",
            (body.email,),
        )
        row = await cur.fetchone()
    if row is None or row[1] is None or not verify_password(body.password, row[1]):
        raise HTTPException(status_code=401, detail="invalid email or password")
    if row[3] != "active":
        raise HTTPException(status_code=403, detail="this account is disabled")
    token = create_token(row[0])
    return {"token": token, "user": {"id": row[0], "email": body.email, "name": row[2]}}


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest, request: Request):
    pool = get_pool(request)
    if pool is None:
        raise HTTPException(status_code=503, detail="database not configured")

    generic_response = {"message": "if that email exists, we've sent a password reset link"}

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT id FROM users WHERE email = %s AND role = 'driver' AND status = 'active'",
            (body.email,),
        )
        row = await cur.fetchone()
        if row is None:
            # Same response either way -- don't let this endpoint reveal which emails have accounts.
            return generic_response
        user_id = row[0]

        raw_token, token_hash, expires_at = generate_reset_token()
        await cur.execute(
            "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (%s, %s, %s)",
            (user_id, token_hash, expires_at),
        )

    reset_link = f"{str(request.base_url).rstrip('/')}/driver/reset-password?token={raw_token}"
    try:
        send_password_reset_email(body.email, reset_link)
    except Exception as exc:  # SMTP/network failures shouldn't leak account existence to the caller
        print(f"[forgot-password] failed to send reset email to {body.email}: {exc}", file=sys.stderr)

    return generic_response


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, request: Request):
    pool = get_pool(request)
    if pool is None:
        raise HTTPException(status_code=503, detail="database not configured")

    token_hash = hash_reset_token(body.token)
    invalid = HTTPException(status_code=400, detail="this reset link is invalid or has expired")

    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = %s",
            (token_hash,),
        )
        row = await cur.fetchone()
        if row is None or row[3] is not None:
            raise invalid
        token_id, user_id, expires_at, _ = row
        if expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
            raise invalid

        await cur.execute(
            "SELECT id, email, name, status FROM users WHERE id = %s AND role = 'driver'", (user_id,)
        )
        user = await cur.fetchone()
        if user is None or user[3] != "active":
            raise invalid

        password_hash = hash_password(body.new_password)
        await cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id))
        await cur.execute("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = %s", (token_id,))
        # One reset link should retire every other outstanding link for this account too.
        await cur.execute(
            "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = %s AND used_at IS NULL",
            (user_id,),
        )

    token = create_token(user_id)
    return {"token": token, "user": {"id": user_id, "email": user[1], "name": user[2]}}
