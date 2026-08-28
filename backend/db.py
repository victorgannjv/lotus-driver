"""Database pool lifecycle for OceanBase (MySQL-wire). asyncmy + %s placeholders only."""
import os
from contextlib import asynccontextmanager
from urllib.parse import unquote, urlparse

import asyncmy
from fastapi import FastAPI, Request


def _dsn() -> dict:
    # DATABASE_URL looks like: mysql://user%40tenant:password@host:2881/dbname
    u = urlparse(os.environ["DATABASE_URL"])
    return {
        "host": u.hostname,
        "port": u.port or 2881,
        "user": unquote(u.username or ""),
        "password": unquote(u.password or ""),
        "db": (u.path or "/").lstrip("/"),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("DATABASE_URL"):
        app.state.pool = await asyncmy.create_pool(**_dsn(), autocommit=True)
    else:
        app.state.pool = None
    yield
    if app.state.pool is not None:
        app.state.pool.close()
        await app.state.pool.wait_closed()


def get_pool(request: Request):
    return request.app.state.pool
