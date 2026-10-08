"""Lotus Driver Tracking System backend.

Listens on port 8000, serves GET /health, and its API under /api. Reads
DATABASE_URL / REDIS_URL / JWT_SECRET from the environment (platform-injected);
custom config (JWT_EXPIRY_DAYS, SMTP_*) is declared in backend/.env.example. All DDL
lives in Flyway migrations under resources/db/migration/ -- never in code.
"""
import os
import traceback

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from db import lifespan
from diagnostics import DETAIL_MAX, SKIP_PATH_PREFIXES, WARNING_STATUSES, actor_from_request, record_error, route_path
from routers import (
    admin_routes,
    analytics_routes,
    auth_routes,
    checkpoint_routes,
    common_routes,
    config_routes,
    diagnostics_routes,
    driver_routes,
)

app = FastAPI(title="Lotus Driver Tracking System", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# --- Error capture -----------------------------------------------------------
#
# Every failure that reaches a caller is written to error_log (see
# diagnostics.py) on its way out, so the admin Diagnostics page can show what
# happened to whom without anyone having to reproduce it. These handlers only
# ADD that write -- the response each caller gets is exactly what FastAPI would
# have sent anyway, apart from an unhandled 500 now carrying a reference id a
# driver can read out.

def _pool(request: Request):
    # getattr: before the lifespan has run (or in a test client that skips it)
    # there is no pool attribute at all, and the error handler must not be the
    # thing that raises.
    return getattr(request.app.state, "pool", None)


def _loggable(request: Request) -> bool:
    return not request.url.path.startswith(SKIP_PATH_PREFIXES)


@app.exception_handler(StarletteHTTPException)
async def on_http_exception(request: Request, exc: StarletteHTTPException):
    if _loggable(request) and (exc.status_code >= 500 or exc.status_code in WARNING_STATUSES):
        await record_error(
            _pool(request),
            source="backend", kind="http_error",
            level="error" if exc.status_code >= 500 else "warning",
            message=f"{exc.status_code} {exc.detail}",
            method=request.method, path=route_path(request), status_code=exc.status_code,
            actor=actor_from_request(request), user_agent=request.headers.get("user-agent"),
        )
    return await http_exception_handler(request, exc)


@app.exception_handler(RequestValidationError)
async def on_validation_error(request: Request, exc: RequestValidationError):
    if _loggable(request):
        # Field names and what was wrong with them -- never the values, which
        # on a login or signup request would be a password.
        problems = "; ".join(
            f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('msg', '')}" for e in exc.errors()[:5]
        )
        await record_error(
            _pool(request),
            source="backend", kind="http_error", level="warning",
            message=f"422 invalid request -- {problems}",
            method=request.method, path=route_path(request), status_code=422,
            actor=actor_from_request(request), user_agent=request.headers.get("user-agent"),
        )
    return await request_validation_exception_handler(request, exc)


def _app_frame(exc: BaseException) -> str | None:
    """The innermost frame that is OUR code -- the library frame at the very
    bottom of a database error is the same for every bug in the app."""
    frames = traceback.extract_tb(exc.__traceback__)
    for f in reversed(frames):
        if "site-packages" not in f.filename:
            return f"{os.path.basename(f.filename)}:{f.name}"
    return f"{os.path.basename(frames[-1].filename)}:{frames[-1].name}" if frames else None


@app.exception_handler(Exception)
async def on_unhandled(request: Request, exc: Exception):
    ref = None
    if _loggable(request):
        trace = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        ref = await record_error(
            _pool(request),
            source="backend", kind="exception", level="error",
            message=f"{type(exc).__name__}: {exc}",
            detail=trace[-DETAIL_MAX:],
            method=request.method, path=route_path(request), status_code=500,
            actor=actor_from_request(request), user_agent=request.headers.get("user-agent"),
            frame=_app_frame(exc),
        )
    detail = "Something went wrong on our side."
    if ref:
        detail += f" Reference E-{ref}."
    return JSONResponse(status_code=500, content={"detail": detail})


app.include_router(auth_routes.router, prefix="/api/auth", tags=["auth"])
app.include_router(driver_routes.router, prefix="/api", tags=["driver"])
app.include_router(checkpoint_routes.router, prefix="/api", tags=["checkpoints"])
app.include_router(admin_routes.router, prefix="/api/admin", tags=["admin"])
app.include_router(analytics_routes.router, prefix="/api/admin", tags=["analytics"])
app.include_router(config_routes.router, prefix="/api/admin/config", tags=["config"])
app.include_router(diagnostics_routes.router, prefix="/api/admin/diagnostics", tags=["diagnostics"])
app.include_router(diagnostics_routes.public_router, prefix="/api/diagnostics", tags=["diagnostics"])
app.include_router(common_routes.router, prefix="/api", tags=["common"])
