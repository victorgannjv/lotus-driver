"""Lotus Driver Tracking System backend.

Listens on port 8000, serves GET /health, and its API under /api. Reads
DATABASE_URL / REDIS_URL / JWT_SECRET from the environment (platform-injected);
custom config (JWT_EXPIRY_DAYS, SMTP_*) is declared in backend/.env.example. All DDL
lives in Flyway migrations under resources/db/migration/ -- never in code.
"""
from fastapi import FastAPI

from db import lifespan
from routers import admin_routes, auth_routes, common_routes, driver_routes

app = FastAPI(title="Lotus Driver Tracking System", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(auth_routes.router, prefix="/api/auth", tags=["auth"])
app.include_router(driver_routes.router, prefix="/api", tags=["driver"])
app.include_router(admin_routes.router, prefix="/api/admin", tags=["admin"])
app.include_router(common_routes.router, prefix="/api", tags=["common"])
