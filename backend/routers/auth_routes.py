"""Driver signup / login. Drivers have no company Google account, so this is a
plain email+password flow issuing a JWT signed with the platform's JWT_SECRET."""
from fastapi import APIRouter, HTTPException, Request

from auth import create_token, hash_password, verify_password
from db import get_pool
from schemas import LoginRequest, SignupRequest

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
