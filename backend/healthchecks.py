"""System health checks: questions with a yes/no answer that, when the answer is
no, explain a bug report before anyone files it.

Three groups, because they fail for different reasons and are fixed by
different people:

  System         the process, the database, the secrets -- ours to fix, now
  Configuration  something an admin has to set before the app can behave
  Data           rows the app should never have produced; each one is a bug in
                 how the app was used, or in the app

Every check runs on its own and reports its own failure. A check that cannot
run says so as a warning rather than taking the page down -- a diagnostics
screen that blanks when something is broken is worth nothing at exactly the
moment it is opened.

Demo (sample-data) drivers are left out of the data checks. Their trips are
deliberately varied and are not a sign that anything is wrong.
"""
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from asyncmy.cursors import DictCursor

from clocks import fmt, local_today
from diagnostics import STARTED_AT
from trips import CHECKPOINT_ORDER, active_checkpoints, fetch_checkpoints, final_checkpoint, load_settings

MIGRATIONS_DIR = Path(__file__).parent / "resources" / "db" / "migration"
PHOTO_WARN_BYTES = 2 * 1024**3
SAMPLE_LIMIT = 5


def _check(key, group, label, status, detail, items=None):
    return {"key": key, "group": group, "label": label, "status": status,
            "detail": detail, "items": items or []}


def _uptime(delta: timedelta) -> str:
    secs = int(delta.total_seconds())
    d, rem = divmod(secs, 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    return f"{d}d {h}h" if d else f"{h}h {m}m" if h else f"{m}m"


def _trip_items(ids) -> list[dict]:
    return [{"label": f"T-{i}", "href": f"/admin/evidence?q={i}"} for i in list(ids)[:SAMPLE_LIMIT]]


async def _scalar(pool, sql, params=()):
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(sql, params)
        row = await cur.fetchone()
    return row[0] if row else None


async def _ids(pool, sql, params=()):
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(sql, params)
        return [r[0] for r in await cur.fetchall()]


# ---------------------------------------------------------------- System

async def check_database(pool):
    started = time.perf_counter()
    try:
        await _scalar(pool, "SELECT 1")
    except Exception as exc:  # noqa: BLE001
        return _check("database", "System", "Database", "fail", f"Query failed: {exc}")
    ms = round((time.perf_counter() - started) * 1000)
    if ms > 500:
        return _check("database", "System", "Database", "warn", f"Reachable, but a trivial query took {ms} ms")
    return _check("database", "System", "Database", "ok", f"Reachable, round trip {ms} ms")


def check_runtime():
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return _check("runtime", "System", "Backend process", "ok",
                  f"Up {_uptime(now - STARTED_AT)} (since {fmt(STARTED_AT)})")


def _shipped_version() -> int | None:
    versions = []
    if MIGRATIONS_DIR.is_dir():
        for p in MIGRATIONS_DIR.glob("V*__*.sql"):
            m = re.match(r"V(\d+)__", p.name)
            if m:
                versions.append(int(m.group(1)))
    return max(versions) if versions else None


async def check_migrations(pool):
    shipped = _shipped_version()
    try:
        applied = await _scalar(
            pool, "SELECT MAX(CAST(version AS UNSIGNED)) FROM flyway_schema_history WHERE success = 1"
        )
    except Exception:  # noqa: BLE001 -- the table is the platform's; it may be named otherwise
        return _check("migrations", "System", "Database migrations", "warn",
                      "Could not read the migration history, so schema drift cannot be checked")
    if shipped is None or applied is None:
        return _check("migrations", "System", "Database migrations", "warn",
                      "Could not compare the shipped migrations with the applied ones")
    if applied < shipped:
        return _check("migrations", "System", "Database migrations", "fail",
                      f"Code ships V{shipped} but the database is on V{applied} -- a migration did not run")
    return _check("migrations", "System", "Database migrations", "ok", f"Database is on V{applied}, matching this build")


def check_secrets():
    missing = [k for k in ("JWT_SECRET", "DATABASE_URL") if not os.getenv(k)]
    if missing:
        return _check("secrets", "System", "Required environment", "fail", f"Missing: {', '.join(missing)}")
    return _check("secrets", "System", "Required environment", "ok", "JWT_SECRET and DATABASE_URL are set")


def check_email():
    if not os.getenv("SMTP_HOST"):
        return _check("email", "System", "Password-reset email", "warn",
                      "SMTP_HOST is empty, so \"forgot password\" emails cannot be sent. Drivers who forget "
                      "their password will see an error. Set SMTP_* in the app's environment settings.")
    return _check("email", "System", "Password-reset email", "ok", f"Relay configured ({os.getenv('SMTP_HOST')})")


async def check_photo_storage(pool):
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT COUNT(*), COALESCE(SUM(byte_size), 0) FROM photos")
        n, size = await cur.fetchone()
    size = int(size or 0)
    human = f"{size / 1024**2:,.0f} MB" if size < 1024**3 else f"{size / 1024**3:.2f} GB"
    status = "warn" if size > PHOTO_WARN_BYTES else "ok"
    note = " -- photos live in the database; growth here is database growth" if status == "warn" else ""
    return _check("photos", "System", "Photo storage", status, f"{n:,} photos, {human}{note}")


# ---------------------------------------------------------- Configuration

async def _config_count(pool, key, label, sql, empty_detail, ok_noun):
    n = await _scalar(pool, sql)
    if not n:
        return _check(key, "Configuration", label, "warn", empty_detail)
    return _check(key, "Configuration", label, "ok", f"{n} {ok_noun}")


async def check_drivers_without_outlet(pool):
    ids = await _ids(
        pool,
        "SELECT id FROM users WHERE role = 'driver' AND status = 'active' AND is_demo = 0 "
        "AND warehouse_id IS NULL ORDER BY id",
    )
    if not ids:
        return _check("driver_outlet", "Configuration", "Drivers have an outlet", "ok", "Every active driver has one")
    return _check("driver_outlet", "Configuration", "Drivers have an outlet", "warn",
                  f"{len(ids)} active driver(s) have no outlet, so their trips cannot be scored against an "
                  "outlet's windows or reported per outlet. Assign one under Settings > Drivers.",
                  [{"label": f"Driver #{i}", "href": "/admin/config/drivers"} for i in ids[:SAMPLE_LIMIT]])


# ------------------------------------------------------------------- Data

async def check_stale_open_trips(pool, ended_cp):
    ids = await _ids(
        pool,
        "SELECT m.id FROM manifests m JOIN users u ON u.id = m.driver_id AND u.is_demo = 0 "
        "WHERE m.cancelled_at IS NULL AND m.work_date < %s AND NOT EXISTS ("
        "  SELECT 1 FROM trip_checkpoint tc WHERE tc.manifest_id = m.id AND tc.checkpoint = %s"
        ") ORDER BY m.id DESC",
        (local_today(), ended_cp),
    )
    label = "Trips left open"
    if not ids:
        return _check("stale_open", "Data", label, "ok", "No trip from a previous day is still open")
    return _check("stale_open", "Data", label, "warn",
                  f"{len(ids)} trip(s) from earlier days never recorded the final step ({ended_cp}). Their time at "
                  "the outlet may be fine, but the run is not closed and will read as unfinished everywhere.",
                  _trip_items(ids))


async def check_missing_arrived(pool):
    ids = await _ids(
        pool,
        "SELECT m.id FROM manifests m JOIN users u ON u.id = m.driver_id AND u.is_demo = 0 "
        "WHERE m.cancelled_at IS NULL AND NOT EXISTS ("
        "  SELECT 1 FROM trip_checkpoint tc WHERE tc.manifest_id = m.id AND tc.checkpoint = 'arrived'"
        ") ORDER BY m.id DESC",
    )
    label = "Trips missing their arrival"
    if not ids:
        return _check("missing_arrived", "Data", label, "ok", "Every trip has an arrival stamp")
    return _check("missing_arrived", "Data", label, "fail",
                  f"{len(ids)} trip(s) have no 'arrived' checkpoint. Arrival IS the trip, so nothing about these "
                  "can be timed -- they should not exist.", _trip_items(ids))


async def check_out_of_order(pool):
    since = local_today() - timedelta(days=14)
    ids = await _ids(
        pool,
        "SELECT m.id FROM manifests m JOIN users u ON u.id = m.driver_id AND u.is_demo = 0 "
        "WHERE m.cancelled_at IS NULL AND m.work_date >= %s ORDER BY m.id DESC",
        (since,),
    )
    label = "Checkpoints in order"
    if not ids:
        return _check("out_of_order", "Data", label, "ok", "No trips in the last 14 days to check")
    cps = await fetch_checkpoints(pool, ids)
    bad = []
    for mid in ids:
        stamps = [cps.get(mid, {})[c]["occurred_at"] for c in CHECKPOINT_ORDER if c in cps.get(mid, {})]
        if any(b < a for a, b in zip(stamps, stamps[1:])):
            bad.append(mid)
    if not bad:
        return _check("out_of_order", "Data", label, "ok", f"{len(ids)} trips in the last 14 days, all in sequence")
    return _check("out_of_order", "Data", label, "warn",
                  f"{len(bad)} trip(s) in the last 14 days have a later step stamped BEFORE an earlier one. "
                  "Usually a handset clock when 'photo timestamp source' is set to the handset.", _trip_items(bad))


async def check_pending_waypoints(pool, ended_cp):
    ids = await _ids(
        pool,
        "SELECT DISTINCT m.id FROM manifests m JOIN users u ON u.id = m.driver_id AND u.is_demo = 0 "
        "JOIN trip_job tj ON tj.manifest_id = m.id AND tj.status = 'pending' "
        "WHERE m.cancelled_at IS NULL AND EXISTS ("
        "  SELECT 1 FROM trip_checkpoint tc WHERE tc.manifest_id = m.id AND tc.checkpoint = %s"
        ") ORDER BY m.id DESC",
        (ended_cp,),
    )
    label = "Finished trips with open waypoints"
    if not ids:
        return _check("pending_waypoints", "Data", label, "ok", "No finished trip still has an unresolved waypoint")
    return _check("pending_waypoints", "Data", label, "warn",
                  f"{len(ids)} trip(s) recorded the final step while a waypoint was still pending. Those parcels "
                  "have no delivered/failed outcome.", _trip_items(ids))


async def check_overlapping_open_trips(pool, ended_cp):
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT m.driver_id, COUNT(*) FROM manifests m JOIN users u ON u.id = m.driver_id AND u.is_demo = 0 "
            "WHERE m.cancelled_at IS NULL AND m.work_date = %s AND NOT EXISTS ("
            "  SELECT 1 FROM trip_checkpoint tc WHERE tc.manifest_id = m.id AND tc.checkpoint = %s"
            ") GROUP BY m.driver_id HAVING COUNT(*) > 1",
            (local_today(), ended_cp),
        )
        rows = await cur.fetchall()
    label = "One open trip at a time"
    if not rows:
        return _check("overlap", "Data", label, "ok", "No driver has two unfinished trips today")
    return _check("overlap", "Data", label, "warn",
                  f"{len(rows)} driver(s) have more than one unfinished trip today. A trip starts the next one "
                  "itself when it returns, so a second open trip means one was abandoned or started by hand.",
                  [{"label": f"Driver #{d} ({n} open)", "href": "/admin/config/drivers"} for d, n in rows[:SAMPLE_LIMIT]])


# ------------------------------------------------------------------ runner

async def _safe(key, group, label, coro):
    try:
        return await coro
    except Exception as exc:  # noqa: BLE001
        return _check(key, group, label, "warn", f"This check could not run: {exc}")


async def run_checks(pool) -> list[dict]:
    db = await check_database(pool)
    results = [db, check_runtime(), check_secrets(), check_email()]
    if db["status"] == "fail":
        # Everything below needs the database; running it would only print the
        # same failure fifteen times.
        return results

    ended_cp = final_checkpoint(active_checkpoints(await load_settings(pool)))
    results += [
        await _safe("migrations", "System", "Database migrations", check_migrations(pool)),
        await _safe("photos", "System", "Photo storage", check_photo_storage(pool)),
        await _safe("admins", "Configuration", "Admin access", _config_count(
            pool, "admins", "Admin access",
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'",
            "No active admin -- nobody can sign in to this page.", "active admin(s)")),
        await _safe("outlets", "Configuration", "Outlets", _config_count(
            pool, "outlets", "Outlets", "SELECT COUNT(*) FROM warehouses WHERE is_active = 1",
            "No active outlet -- drivers cannot pick one at signup.", "active outlet(s)")),
        await _safe("reasons", "Configuration", "Delay reasons", _config_count(
            pool, "reasons", "Delay reasons", "SELECT COUNT(*) FROM reason_code WHERE is_active = 1",
            "No active delay reason -- drivers cannot explain a late step.", "active reason(s)")),
        await _safe("windows", "Configuration", "Delivery windows", _config_count(
            pool, "windows", "Delivery windows", "SELECT COUNT(*) FROM trip_schedule WHERE is_active = 1",
            "No delivery window set -- trips cannot be judged on time or late.", "active window(s)")),
        await _safe("driver_outlet", "Configuration", "Drivers have an outlet", check_drivers_without_outlet(pool)),
        await _safe("stale_open", "Data", "Trips left open", check_stale_open_trips(pool, ended_cp)),
        await _safe("missing_arrived", "Data", "Trips missing their arrival", check_missing_arrived(pool)),
        await _safe("out_of_order", "Data", "Checkpoints in order", check_out_of_order(pool)),
        await _safe("pending_waypoints", "Data", "Finished trips with open waypoints",
                    check_pending_waypoints(pool, ended_cp)),
        await _safe("overlap", "Data", "One open trip at a time", check_overlapping_open_trips(pool, ended_cp)),
    ]
    return results
