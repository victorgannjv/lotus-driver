"""The error log: one place everything that went wrong gets written, and the
helpers that decide what is worth writing.

Logging must never become a second thing that breaks. Everything here that
touches the database is wrapped so a failure to LOG an error is printed to the
container log and swallowed -- the request that was already failing is not made
worse by the log being unable to say so.

There is no scheduler on this platform, so the table is kept bounded by the
writer: every Nth insert also deletes what is past its age or its row cap.
"""
import hashlib
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Request

# When this process started -- the uptime the health page reports.
STARTED_AT = datetime.now(timezone.utc).replace(tzinfo=None)

# Which refusals count as "the app got in someone's way". 401 is excluded on
# purpose: an expired token is the most common response the API gives and says
# nothing about a bug. 404 is excluded because most are scanners probing paths.
# What is left are the ones a driver or admin actually sees as a failure:
# invalid input, forbidden, "stamp the earlier step first", photo too big,
# validation, throttled.
WARNING_STATUSES = {400, 403, 409, 413, 422, 429}

# The endpoint the clients report to. A failure to report must not itself be
# reported -- that is a loop with a log table on the end of it.
SKIP_PATH_PREFIXES = ("/api/diagnostics",)

RETENTION_DAYS = 30
MAX_ROWS = 20_000
PRUNE_EVERY = 100

MESSAGE_MAX = 1000
DETAIL_MAX = 16_000
_inserted = 0


class RateLimiter:
    """Fixed-window counter, in memory. Per process, which is the right grain
    here: the goal is to stop one runaway client or one error storm filling the
    table, not to meter anyone precisely."""

    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict = {}

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        start, n = self._hits.get(key, (now, 0))
        if now - start >= self.window:
            start, n = now, 0
        if n >= self.limit:
            self._hits[key] = (start, n)
            return False
        self._hits[key] = (start, n + 1)
        if len(self._hits) > 5000:
            self._hits = {k: v for k, v in self._hits.items() if now - v[0] < self.window}
        return True


# Two limiters because they guard different things. The per-fingerprint one is
# the storm guard: a render crash on a screen drivers sit on can fire hundreds
# of times a minute, and the hundredth copy tells nobody anything the first did
# not. The per-client one is the abuse guard on the one endpoint that has to be
# open to people who are not logged in. Generous on purpose: behind a shared
# ingress many phones can look like one address, and the moment this matters
# most -- a bad deploy breaking every driver's screen at once -- is the moment
# a tight limit would throw the evidence away.
fingerprint_limiter = RateLimiter(limit=10, window_seconds=60)
client_limiter = RateLimiter(limit=120, window_seconds=60)


def clip(value, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


_DIGITS = re.compile(r"\d+")
_HEX = re.compile(r"\b[0-9a-f]{8,}\b", re.I)
_SPACE = re.compile(r"\s+")


def normalize(text: str | None) -> str:
    """What two occurrences of one problem have in common. A tracking number, a
    trip id or a timestamp in the message is what makes otherwise identical
    errors look different, so they are blanked before comparing."""
    out = _HEX.sub("<id>", text or "")
    out = _DIGITS.sub("#", out)
    return _SPACE.sub(" ", out).strip()[:300]


def fingerprint(source: str, kind: str, message: str, *, status_code=None, method=None,
                path=None, frame=None) -> str:
    key = "|".join([
        source, kind, str(status_code or ""), method or "",
        _DIGITS.sub("#", path or ""), normalize(message), frame or "",
    ])
    # SHA-256 cut to 40 hex characters. Only a grouping key -- nothing here is
    # secret -- but SHA-1 is flagged by every scanner on sight, and the width
    # the table was built for is the same.
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:40]


def route_path(request: Request) -> str:
    """The route as written (/api/trips/{manifest_id}/checkpoints) rather than
    as requested (/api/trips/3000417/checkpoints), so every trip's copy of one
    failing endpoint groups together. Falls back to the literal path when the
    request never matched a route.

    Built from the literal path and the matched path parameters rather than
    read off the matched route object: depending on the FastAPI version that
    object holds only the router-relative path ('/summary'), losing the prefix
    that says which API it belongs to."""
    path = request.url.path
    params = request.scope.get("path_params") or {}
    if not params:
        return path
    segments = path.split("/")
    for name, value in params.items():
        segments = [f"{{{name}}}" if seg == str(value) else seg for seg in segments]
    return "/".join(segments)


def client_ip(request: Request) -> str:
    # The LAST hop is the one our own ingress added; anything before it is
    # whatever the client chose to claim.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def actor_from_request(request: Request) -> tuple[str | None, int | None, str | None]:
    """Who this was, if the request says -- (type, id, label). Best effort and
    deliberately cheap: no database lookup, because this runs inside error
    handling and the database may be the thing that is down."""
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer ") and os.getenv("JWT_SECRET"):
        try:
            payload = jwt.decode(auth[7:], os.environ["JWT_SECRET"], algorithms=["HS256"])
            if payload.get("role") == "driver":
                return "driver", int(payload["sub"]), None
        except (jwt.PyJWTError, ValueError, KeyError):
            pass
    email = request.headers.get("x-forwarded-email")
    if email:
        return None, None, email
    return None, None, None


async def record_error(
    pool,
    *,
    source: str,
    kind: str,
    message: str,
    detail: str | None = None,
    level: str = "error",
    method: str | None = None,
    path: str | None = None,
    status_code: int | None = None,
    actor: tuple = (None, None, None),
    user_agent: str | None = None,
    app_build: str | None = None,
    frame: str | None = None,
    when: datetime | None = None,
) -> int | None:
    """Writes one row and returns its id (the reference a driver can quote), or
    None if it was dropped or could not be written. Never raises."""
    global _inserted
    if pool is None:
        return None
    try:
        message = clip(message, MESSAGE_MAX) or "(no message)"
        fp = fingerprint(source, kind, message, status_code=status_code, method=method,
                         path=path, frame=frame)
        if not fingerprint_limiter.allow(fp):
            return None
        actor_type, actor_id, actor_label = actor
        # `when` is for reports that sat in a phone's queue until it had signal:
        # stamping them with the time they ARRIVED would file yesterday's crash
        # under today.
        now = when or datetime.now(timezone.utc).replace(tzinfo=None)
        async with pool.acquire() as conn, conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO error_log (source, kind, level, message, detail, method, path, status_code, "
                "actor_type, actor_id, actor_label, user_agent, app_build, fingerprint, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (source, kind, level, message, clip(detail, DETAIL_MAX), clip(method, 10),
                 clip(path, 500), status_code, actor_type, actor_id, clip(actor_label, 255),
                 clip(user_agent, 500), clip(app_build, 40), fp, now),
            )
            new_id = cur.lastrowid
        _inserted += 1
        if _inserted % PRUNE_EVERY == 0:
            await prune(pool)
        return new_id
    except Exception as exc:  # noqa: BLE001 -- logging must not take the caller down
        print(f"[diagnostics] could not record error: {exc!r}", file=sys.stderr)
        return None


async def prune(pool) -> None:
    """Drops rows past their age, then past the row cap. Oldest go first."""
    try:
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=RETENTION_DAYS)
        async with pool.acquire() as conn, conn.cursor() as cur:
            await cur.execute("DELETE FROM error_log WHERE created_at < %s", (cutoff,))
            await cur.execute("SELECT MAX(id) FROM error_log")
            (top,) = await cur.fetchone()
            if top and top > MAX_ROWS:
                await cur.execute("DELETE FROM error_log WHERE id <= %s", (top - MAX_ROWS,))
    except Exception as exc:  # noqa: BLE001
        print(f"[diagnostics] prune failed: {exc!r}", file=sys.stderr)
