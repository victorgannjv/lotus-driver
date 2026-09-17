"""Configuration: the lists someone maintains, rather than the work itself.

Reason codes, gap targets, driver-app settings and the shift roster. These are
deliberately separated from the working screens -- ops live in the dashboard
daily, but a reason code changes once a quarter, and editing one re-scores every
historical figure that used it. That is not something to leave one mis-click
away from the board you read every morning.

Every list here is soft-edited: a reason code is deactivated rather than deleted
(historical checkpoints still reference it), and a target change is a new value
on the same row so history re-scores consistently.
"""
import json
import sys
from datetime import datetime, timedelta, timezone

from asyncmy.cursors import DictCursor

import demo
from clocks import fmt, fmt_time, parse_hhmm
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth import generate_reset_token, get_current_admin
from db import get_pool
from mailer import send_password_reset_email

router = APIRouter()


async def audit(pool, actor, entity: str, entity_id, action: str, summary: str,
                before: dict | None = None, after: dict | None = None) -> None:
    """Records a settings change.

    These are not preferences: a window, an allowance or the party a reason code
    blames all decide how PAST trips score, because variance is computed on
    read. So "why does last month read differently now?" will be asked, and a
    claim has to survive Lotus asking whether the bar moved after the fact.
    """
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO config_audit (entity, entity_id, action, summary, before_json, after_json, "
            "actor_id, actor_email) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (entity, str(entity_id) if entity_id is not None else None, action, summary[:500],
             json.dumps(before, default=str) if before else None,
             json.dumps(after, default=str) if after else None,
             (actor or {}).get("id"), (actor or {}).get("email")),
        )


@router.get("/activity")
async def list_activity(
    request: Request,
    entity: str | None = None,
    limit: int = Query(25, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin=Depends(get_current_admin),
):
    """One page of the log, newest first, plus the total so the caller can show
    'x-y of n' rather than an endless scroll. The log only ever grows, so a page
    that is never paged is a page that eventually stops being read."""
    pool = get_pool(request)
    where, params = [], []
    if entity:
        where.append("entity = %s")
        params.append(entity)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(f"SELECT COUNT(*) AS n FROM config_audit {clause}", tuple(params))
        total = (await cur.fetchone())["n"]
        await cur.execute(
            "SELECT id, entity, entity_id, action, summary, actor_email, created_at "
            f"FROM config_audit {clause} ORDER BY id DESC LIMIT %s OFFSET %s",
            tuple(params + [limit, offset]),
        )
        rows = await cur.fetchall()
    return {
        "activity": [{**r, "created_at": fmt(r["created_at"])} for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


class ReasonCodeIn(BaseModel):
    code: str
    label: str
    fault_party: str
    applies_to_gap: str = "any"
    sort_order: int = 0
    is_active: bool = True


class ReasonCodeUpdate(BaseModel):
    label: str | None = None
    fault_party: str | None = None
    applies_to_gap: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class ActiveIn(BaseModel):
    is_active: bool


class TargetIn(BaseModel):
    gap_code: str
    warehouse_id: int | None = None
    target_minutes: int


class SettingIn(BaseModel):
    value: str


class RosterIn(BaseModel):
    work_date: str
    warehouse_id: int
    driver_id: int
    shift: str = "full"


VALID_PARTIES = {"lotus", "njv", "external"}
VALID_GAPS = {
    "waiting_for_lotus", "loading", "departure_lag",
    "delivery_round", "return_leg", "time_at_outlet",
}


# ---------------------------------------------------------------- reason codes
@router.get("/reason-codes")
async def list_reason_codes(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT code, label, fault_party, applies_to_gap, sort_order, is_active "
            "FROM reason_code ORDER BY sort_order, label"
        )
        rows = await cur.fetchall()
    return {"reason_codes": [{**r, "is_active": bool(r["is_active"])} for r in rows]}


@router.post("/reason-codes", status_code=201)
async def create_reason_code(body: ReasonCodeIn, request: Request, admin=Depends(get_current_admin)):
    if body.fault_party not in VALID_PARTIES:
        raise HTTPException(status_code=422, detail="fault_party must be lotus, njv or external")
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT 1 FROM reason_code WHERE code = %s", (body.code,))
        if await cur.fetchone():
            raise HTTPException(status_code=409, detail="that code already exists")
        await cur.execute(
            "INSERT INTO reason_code (code, label, fault_party, applies_to_gap, sort_order, is_active) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (body.code.strip(), body.label.strip(), body.fault_party,
             body.applies_to_gap.strip() or "any", body.sort_order, 1 if body.is_active else 0),
        )
    await audit(pool, admin, "reason_code", body.code, "create",
                f"Added delay reason '{body.label}' blamed on {body.fault_party}", after=body.model_dump())
    return {"code": body.code}


@router.put("/reason-codes/{code}")
async def update_reason_code(code: str, body: ReasonCodeUpdate, request: Request, admin=Depends(get_current_admin)):
    if body.fault_party is not None and body.fault_party not in VALID_PARTIES:
        raise HTTPException(status_code=422, detail="fault_party must be lotus, njv or external")
    fields, params = [], []
    for name in ("label", "fault_party", "applies_to_gap", "sort_order"):
        val = getattr(body, name)
        if val is not None:
            fields.append(f"{name} = %s")
            params.append(val)
    if body.is_active is not None:
        fields.append("is_active = %s")
        params.append(1 if body.is_active else 0)
    if not fields:
        raise HTTPException(status_code=422, detail="nothing to update")
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(f"UPDATE reason_code SET {', '.join(fields)} WHERE code = %s", tuple(params + [code]))
    changed = {k: v for k, v in body.model_dump().items() if v is not None}
    await audit(pool, admin, "reason_code", code, "update",
                f"Edited delay reason '{code}'", after=changed)
    return {"code": code}


@router.delete("/reason-codes/{code}")
async def deactivate_reason_code(code: str, request: Request, admin=Depends(get_current_admin)):
    """Soft-delete only. Historical checkpoints still point at this code, and a
    dispute filed last month must keep reading the same way next month."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("UPDATE reason_code SET is_active = 0 WHERE code = %s", (code,))
    await audit(pool, admin, "reason_code", code, "update", f"Stopped offering delay reason '{code}'")
    return {"code": code, "is_active": False}


# --------------------------------------------------------------------- targets
@router.get("/targets")
async def list_targets(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT gt.id, gt.gap_code, gt.warehouse_id, w.name AS warehouse_name, gt.target_minutes, gt.is_active "
            "FROM gap_target gt LEFT JOIN warehouses w ON w.id = gt.warehouse_id "
            "ORDER BY gt.gap_code, gt.warehouse_id IS NOT NULL, w.name"
        )
        rows = await cur.fetchall()
    return {"targets": [{**r, "is_active": bool(r["is_active"])} for r in rows]}


@router.post("/targets", status_code=201)
async def upsert_target(body: TargetIn, request: Request, admin=Depends(get_current_admin)):
    """A row with no outlet is the global default; naming an outlet overrides it
    for that outlet only. Changing either re-scores history on the next read,
    which is intended -- the target is still being negotiated."""
    if body.gap_code not in VALID_GAPS:
        raise HTTPException(status_code=422, detail=f"unknown gap: {body.gap_code}")
    if body.target_minutes < 1 or body.target_minutes > 1440:
        raise HTTPException(status_code=422, detail="target must be between 1 and 1440 minutes")
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        if body.warehouse_id is None:
            await cur.execute(
                "SELECT id FROM gap_target WHERE gap_code = %s AND warehouse_id IS NULL", (body.gap_code,)
            )
        else:
            await cur.execute(
                "SELECT id FROM gap_target WHERE gap_code = %s AND warehouse_id = %s",
                (body.gap_code, body.warehouse_id),
            )
        existing = await cur.fetchone()
    async with pool.acquire() as conn, conn.cursor() as cur:
        if existing:
            await cur.execute(
                "UPDATE gap_target SET target_minutes = %s WHERE id = %s", (body.target_minutes, existing["id"])
            )
        else:
            await cur.execute(
                "INSERT INTO gap_target (gap_code, warehouse_id, target_minutes) VALUES (%s, %s, %s)",
                (body.gap_code, body.warehouse_id, body.target_minutes),
            )
    await audit(pool, admin, "target", body.gap_code, "update" if existing else "create",
                f"Set '{body.gap_code}' allowance to {body.target_minutes} minutes"
                + (f" for outlet {body.warehouse_id}" if body.warehouse_id else " for every outlet"),
                after=body.model_dump())
    return {"gap_code": body.gap_code, "warehouse_id": body.warehouse_id, "target_minutes": body.target_minutes}


@router.put("/targets/{target_id}/active")
async def set_target_active(target_id: int, body: ActiveIn, request: Request,
                            admin=Depends(get_current_admin)):
    """Switch one allowance on or off without losing the number. An allowance
    that has not been agreed with Lotus should not be flagging trips, but the
    value is worth keeping for the day it is."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT gap_code FROM gap_target WHERE id = %s", (target_id,))
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="allowance not found")
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("UPDATE gap_target SET is_active = %s WHERE id = %s",
                          (1 if body.is_active else 0, target_id))
    await audit(pool, admin, "target", row["gap_code"], "update",
                f"{'Switched on' if body.is_active else 'Switched off'} the "
                f"'{row['gap_code']}' allowance")
    return {"id": target_id, "is_active": body.is_active}


@router.delete("/targets/{target_id}")
async def delete_target(target_id: int, request: Request, admin=Depends(get_current_admin)):
    """Only an outlet override can be removed -- deleting a global default would
    leave a gap with no bar at all, which silently stops flagging breaches."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT warehouse_id FROM gap_target WHERE id = %s", (target_id,))
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="target not found")
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("DELETE FROM gap_target WHERE id = %s", (target_id,))
    await audit(pool, admin, "target", target_id, "delete",
                "Removed a time allowance" + ("" if row["warehouse_id"] else " (the every-outlet default)"))
    return {"deleted": target_id}


# -------------------------------------------------------------------- settings
@router.get("/settings")
async def list_settings(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT setting_key, value, notes, updated_at FROM app_setting ORDER BY setting_key")
        rows = await cur.fetchall()
    return {"settings": [{**r, "updated_at": fmt(r["updated_at"])} for r in rows]}


@router.put("/settings/{key}")
async def update_setting(key: str, body: SettingIn, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT 1 FROM app_setting WHERE setting_key = %s", (key,))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="unknown setting")
        await cur.execute("UPDATE app_setting SET value = %s WHERE setting_key = %s", (body.value.strip(), key))
    await audit(pool, admin, "setting", key, "update",
                f"Changed driver-app setting '{key}' to '{body.value.strip()}'",
                after={"value": body.value.strip()})
    return {"setting_key": key, "value": body.value.strip()}


# ---------------------------------------------------------------------- roster
@router.get("/roster")
async def list_roster(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    admin=Depends(get_current_admin),
):
    pool = get_pool(request)
    where, params = [], []
    if date_from:
        where.append("r.work_date >= %s")
        params.append(date_from)
    if date_to:
        where.append("r.work_date <= %s")
        params.append(date_to)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT r.id, r.work_date, r.shift, r.warehouse_id, w.name AS warehouse_name, "
            "r.driver_id, u.name AS driver_name, u.email AS driver_email "
            "FROM shift_roster r JOIN warehouses w ON w.id = r.warehouse_id "
            f"JOIN users u ON u.id = r.driver_id {clause} ORDER BY r.work_date DESC, w.name, u.name",
            tuple(params),
        )
        rows = await cur.fetchall()
    return {"roster": [{**r, "work_date": str(r["work_date"])} for r in rows]}


@router.post("/roster", status_code=201)
async def add_roster(body: RosterIn, request: Request, admin=Depends(get_current_admin)):
    """Who is PLANNED to work. On-duty is already derivable from trips; without
    this, "we ran two drivers short" is an assertion rather than a number."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "SELECT 1 FROM shift_roster WHERE work_date = %s AND driver_id = %s", (body.work_date, body.driver_id)
        )
        if await cur.fetchone():
            raise HTTPException(status_code=409, detail="that driver is already rostered for that day")
        await cur.execute(
            "INSERT INTO shift_roster (work_date, warehouse_id, driver_id, shift) VALUES (%s, %s, %s, %s)",
            (body.work_date, body.warehouse_id, body.driver_id, body.shift),
        )
    await audit(pool, admin, "roster", f"{body.work_date}/{body.driver_id}", "create",
                f"Rostered driver {body.driver_id} on {body.work_date}", after=body.model_dump())
    return {"work_date": body.work_date, "driver_id": body.driver_id}


@router.delete("/roster/{roster_id}")
async def delete_roster(roster_id: int, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("DELETE FROM shift_roster WHERE id = %s", (roster_id,))
    await audit(pool, admin, "roster", roster_id, "delete", "Removed a roster line")
    return {"deleted": roster_id}


# ------------------------------------------------------------------- drivers
class DriverUpdate(BaseModel):
    warehouse_id: int | None = None
    status: str | None = None
    name: str | None = None
    phone: str | None = None


class DriverIn(BaseModel):
    name: str
    email: str
    phone: str | None = None
    warehouse_id: int | None = None


# An invite lives longer than a password reset.
#
# RESET_TOKEN_TTL is an hour, which is right for "I forgot my password" -- the
# person is at the screen waiting for the mail. An invite is handed over by an
# admin, often on WhatsApp at the end of a shift, and an hour means it has
# expired before the driver reads it. A week is long enough to be useful and
# short enough that an unused invite does not sit live forever.
INVITE_TTL = timedelta(days=7)


async def _issue_invite(pool, request: Request, user_id: int, email: str) -> str:
    """A one-time link that lets the driver set their own password.

    The admin never types or sees a password. The account is created WITHOUT
    one (password_hash NULL, which login already refuses), so until the driver
    follows this link there is no credential to leak, share or reuse -- and
    nobody but the driver ever knows it.

    The link is returned as well as emailed. SMTP may not be configured, the
    address may be one the driver cannot read at work, and this fleet passes
    things to each other on WhatsApp -- an invite an admin cannot hand over is
    an invite that does not arrive.
    """
    raw_token, token_hash, _ = generate_reset_token()
    expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + INVITE_TTL
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (%s, %s, %s)",
            (user_id, token_hash, expires_at),
        )
    link = f"{str(request.base_url).rstrip('/')}/driver/reset-password?token={raw_token}"
    try:
        send_password_reset_email(email, link)
    except Exception as exc:  # noqa: BLE001 -- the link is returned and still usable
        print(f"[invite] could not email {email}: {exc}", file=sys.stderr)
    return link


@router.post("/drivers", status_code=201)
async def create_driver(body: DriverIn, request: Request, admin=Depends(get_current_admin)):
    """Create a driver account from the admin side.

    Drivers could only ever sign themselves up, which is fine until someone
    joins mid-week and there is no way to get them onto the app. This creates
    the account and hands back a set-your-password link.
    """
    name = (body.name or "").strip()
    email = (body.email or "").strip().lower()
    if not name:
        raise HTTPException(status_code=422, detail="a name is required")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=422, detail="that does not look like an email address")

    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        # Scoped to role='driver', matching signup: an email on the admin
        # allowlist is a separate identity and must not block a driver account.
        await cur.execute("SELECT id FROM users WHERE email = %s AND role = 'driver'", (email,))
        if await cur.fetchone() is not None:
            raise HTTPException(status_code=409, detail="a driver with this email already exists")
        if body.warehouse_id is not None:
            await cur.execute(
                "SELECT id FROM warehouses WHERE id = %s AND is_active = 1", (body.warehouse_id,)
            )
            if await cur.fetchone() is None:
                raise HTTPException(status_code=422, detail="that outlet doesn't exist or is no longer active")
        await cur.execute(
            "INSERT INTO users (role, email, phone, password_hash, name, status, warehouse_id) "
            "VALUES ('driver', %s, %s, NULL, %s, 'active', %s)",
            (email, (body.phone or "").strip() or None, name, body.warehouse_id),
        )
        driver_id = cur.lastrowid

    link = await _issue_invite(pool, request, driver_id, email)
    await audit(pool, admin, "driver", driver_id, "create", f"Added driver {name} ({email})",
                after={"name": name, "email": email, "warehouse_id": body.warehouse_id})
    return {"id": driver_id, "invite_link": link}


@router.post("/drivers/{driver_id}/invite")
async def resend_invite(driver_id: int, request: Request, admin=Depends(get_current_admin)):
    """A fresh set-password link -- the first expired, or went to an inbox the
    driver never opens. Also how a driver who has forgotten their password gets
    back in without anyone else learning what it was."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT email, status FROM users WHERE id = %s AND role = 'driver'", (driver_id,)
        )
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="driver not found")
    if row["status"] != "active":
        raise HTTPException(status_code=409, detail="turn sign-in back on for this driver first")
    link = await _issue_invite(pool, request, driver_id, row["email"])
    await audit(pool, admin, "driver", driver_id, "update", f"Sent a new sign-in link to {row['email']}")
    return {"id": driver_id, "invite_link": link}


@router.put("/drivers/{driver_id}")
async def update_driver(driver_id: int, body: DriverUpdate, request: Request, admin=Depends(get_current_admin)):
    """Reassigning a driver's outlet matters beyond tidiness: gap targets and
    contracted windows can be set per outlet, so the outlet on the driver is
    what decides which bar their trips are scored against."""
    if body.status is not None and body.status not in ("active", "disabled"):
        raise HTTPException(status_code=422, detail="status must be active or disabled")
    fields, params = [], []
    if body.warehouse_id is not None:
        fields.append("warehouse_id = %s")
        params.append(body.warehouse_id)
    for name in ("status", "name", "phone"):
        val = getattr(body, name)
        if val is not None:
            fields.append(f"{name} = %s")
            params.append(val)
    if not fields:
        raise HTTPException(status_code=422, detail="nothing to update")
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT 1 FROM users WHERE id = %s AND role = 'driver'", (driver_id,))
        if await cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="driver not found")
        await cur.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = %s", tuple(params + [driver_id]))
    await audit(pool, admin, "driver", driver_id, "update", f"Updated driver {driver_id}",
                after={k: v for k, v in body.model_dump().items() if v is not None})
    return {"id": driver_id}


@router.delete("/drivers/{driver_id}")
async def delete_driver(driver_id: int, request: Request, admin=Depends(get_current_admin)):
    """Delete a driver account outright -- and refuse when that would destroy
    evidence.

    A driver who has run trips cannot be deleted at any price. Those trips are
    what a claim against Lotus is built from and every one of them points back
    at this row; removing it would leave the evidence unattributable, which is
    the same as not having it. Turning sign-in off is the answer there, and the
    message says so rather than just failing.

    A driver with no trips is a typo, a duplicate, or someone who never
    started. Keeping those forever makes the list harder to read for no gain.

    This endpoint used to be the deactivate button -- DELETE that disabled a
    row. The toggle now says what it means (PUT status), so DELETE can too.
    """
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT name, email FROM users WHERE id = %s AND role = 'driver'", (driver_id,))
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="driver not found")
        await cur.execute("SELECT COUNT(*) AS n FROM manifests WHERE driver_id = %s", (driver_id,))
        trips = (await cur.fetchone())["n"]

    if trips:
        plural = "s" if trips != 1 else ""
        raise HTTPException(
            status_code=409,
            detail=f"{row['name']} has {trips} trip{plural} on record, which is evidence behind "
                   "past claims. Turn their sign-in off instead.",
        )

    async with pool.acquire() as conn, conn.cursor() as cur:
        # The only rows that can point at a driver with no trips.
        await cur.execute("DELETE FROM password_reset_tokens WHERE user_id = %s", (driver_id,))
        await cur.execute("DELETE FROM shift_roster WHERE driver_id = %s", (driver_id,))
        await cur.execute("DELETE FROM users WHERE id = %s AND role = 'driver'", (driver_id,))
    await audit(pool, admin, "driver", driver_id, "delete",
                f"Deleted driver {row['name']} ({row['email']}) -- no trips on record")
    return {"id": driver_id, "deleted": True}


@router.delete("/admins/{admin_id}")
async def disable_admin(admin_id: int, request: Request, admin=Depends(get_current_admin)):
    """Removing the last active admin would lock everyone out of the dashboard,
    so the count is checked before the change rather than after."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'")
        (active,) = await cur.fetchone()
        if active <= 1:
            raise HTTPException(status_code=409, detail="that's the last active admin -- add another first")
        await cur.execute("UPDATE users SET status = 'disabled' WHERE id = %s AND role = 'admin'", (admin_id,))
    await audit(pool, admin, "admin", admin_id, "update", f"Removed dashboard access for admin {admin_id}")
    return {"id": admin_id, "status": "disabled"}


# ------------------------------------------------------ contracted windows
class ScheduleIn(BaseModel):
    warehouse_id: int | None = None
    slot_no: int
    label: str
    window_start: str
    window_end: str
    grace_minutes: int = 0
    is_active: bool = True


@router.get("/schedule")
async def list_schedule(request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT s.id, s.warehouse_id, w.name AS warehouse_name, s.slot_no, s.label, "
            "s.window_start, s.window_end, s.grace_minutes, s.is_active "
            "FROM trip_schedule s LEFT JOIN warehouses w ON w.id = s.warehouse_id "
            "ORDER BY s.warehouse_id IS NOT NULL, w.name, s.slot_no"
        )
        rows = await cur.fetchall()
    return {
        "schedule": [
            {**r, "is_active": bool(r["is_active"]),
             "window_start": fmt_time(r["window_start"]), "window_end": fmt_time(r["window_end"])}
            for r in rows
        ]
    }


@router.post("/schedule", status_code=201)
async def upsert_schedule(body: ScheduleIn, request: Request, admin=Depends(get_current_admin)):
    """One row per slot per outlet. Outlet rows win wholesale over the global
    set, so an outlet with its own contract is described in one place rather
    than inherited piecemeal."""
    if body.slot_no < 1 or body.slot_no > 12:
        raise HTTPException(status_code=422, detail="slot must be between 1 and 12")

    # Parsed to minutes, not compared as text. The old string compare read
    # "12:00:00" <= "9:30:00" as True -- '1' sorts before '9' -- so an
    # unpadded 09:30-12:00 was rejected as ending before it started. It also
    # let an empty field through, which wrote a blank into a TIME column and
    # silently became 00:00.
    start_min = parse_hhmm(body.window_start)
    end_min = parse_hhmm(body.window_end)
    if start_min is None or end_min is None:
        raise HTTPException(status_code=422, detail="both times are needed, as HH:MM")
    if end_min <= start_min:
        raise HTTPException(status_code=422, detail="the window has to end after it starts")

    # Normalised on the way in, so the column never holds a shape the editor
    # cannot read back.
    window_start = f"{start_min // 60:02d}:{start_min % 60:02d}:00"
    window_end = f"{end_min // 60:02d}:{end_min % 60:02d}:00"
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        if body.warehouse_id is None:
            await cur.execute("SELECT id FROM trip_schedule WHERE slot_no = %s AND warehouse_id IS NULL", (body.slot_no,))
        else:
            await cur.execute(
                "SELECT id FROM trip_schedule WHERE slot_no = %s AND warehouse_id = %s",
                (body.slot_no, body.warehouse_id),
            )
        existing = await cur.fetchone()
    async with pool.acquire() as conn, conn.cursor() as cur:
        if existing:
            await cur.execute(
                "UPDATE trip_schedule SET label = %s, window_start = %s, window_end = %s, "
                "grace_minutes = %s, is_active = %s WHERE id = %s",
                (body.label, window_start, window_end, body.grace_minutes,
                 1 if body.is_active else 0, existing["id"]),
            )
        else:
            await cur.execute(
                "INSERT INTO trip_schedule (warehouse_id, slot_no, label, window_start, window_end, "
                "grace_minutes, is_active) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (body.warehouse_id, body.slot_no, body.label, window_start, window_end,
                 body.grace_minutes, 1 if body.is_active else 0),
            )
    await audit(pool, admin, "schedule", f"slot{body.slot_no}", "update" if existing else "create",
                f"Set '{body.label}' window to {window_start[:5]}-{window_end[:5]}"
                + (f" for outlet {body.warehouse_id}" if body.warehouse_id else " for every outlet"),
                after=body.model_dump())
    return {"slot_no": body.slot_no, "warehouse_id": body.warehouse_id}


@router.delete("/schedule/{schedule_id}")
async def delete_schedule(schedule_id: int, request: Request, admin=Depends(get_current_admin)):
    """Only an outlet override can be removed. Deleting a global slot would
    leave trips in that slot with no commitment to score against, which reads
    as "on time" and silently empties the claim."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT warehouse_id FROM trip_schedule WHERE id = %s", (schedule_id,))
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="that window doesn't exist")
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("DELETE FROM trip_schedule WHERE id = %s", (schedule_id,))
    await audit(pool, admin, "schedule", schedule_id, "delete",
                "Removed a delivery window" + ("" if row["warehouse_id"] else " (the every-outlet one)"))
    return {"deleted": schedule_id}


class RosterBulkIn(BaseModel):
    entries: list[RosterIn] = []
    remove_ids: list[int] = []


@router.post("/roster/bulk")
async def bulk_roster(body: RosterBulkIn, request: Request, admin=Depends(get_current_admin)):
    """Whole-week edits in one call.

    A roster is built a week at a time, not a person-day at a time: eight
    drivers over seven days is fifty-six decisions, and making each one a
    round-trip turns planning into data entry.
    """
    pool = get_pool(request)
    added = 0
    async with pool.acquire() as conn, conn.cursor() as cur:
        for rid in body.remove_ids:
            await cur.execute("DELETE FROM shift_roster WHERE id = %s", (rid,))
        for e in body.entries:
            await cur.execute(
                "SELECT 1 FROM shift_roster WHERE work_date = %s AND driver_id = %s", (e.work_date, e.driver_id)
            )
            if await cur.fetchone():
                continue
            await cur.execute(
                "INSERT INTO shift_roster (work_date, warehouse_id, driver_id, shift) VALUES (%s, %s, %s, %s)",
                (e.work_date, e.warehouse_id, e.driver_id, e.shift),
            )
            added += 1
    if added or body.remove_ids:
        await audit(pool, admin, "roster", None, "update",
                    f"Updated the roster: {added} added, {len(body.remove_ids)} removed")
    return {"added": added, "removed": len(body.remove_ids)}


@router.post("/roster/copy-week")
async def copy_week(
    request: Request,
    from_monday: str,
    to_monday: str,
    admin=Depends(get_current_admin),
):
    """Most weeks look like the last one, so copying beats re-entering."""
    from datetime import date as _date, timedelta as _td
    src = _date.fromisoformat(from_monday)
    dst = _date.fromisoformat(to_monday)
    shift_days = (dst - src).days

    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT work_date, warehouse_id, driver_id, shift FROM shift_roster "
            "WHERE work_date BETWEEN %s AND %s",
            (src.isoformat(), (src + _td(days=6)).isoformat()),
        )
        rows = await cur.fetchall()

    added = 0
    async with pool.acquire() as conn, conn.cursor() as cur:
        for r in rows:
            target = r["work_date"] + _td(days=shift_days)
            await cur.execute(
                "SELECT 1 FROM shift_roster WHERE work_date = %s AND driver_id = %s", (target, r["driver_id"])
            )
            if await cur.fetchone():
                continue
            await cur.execute(
                "INSERT INTO shift_roster (work_date, warehouse_id, driver_id, shift) VALUES (%s, %s, %s, %s)",
                (target, r["warehouse_id"], r["driver_id"], r["shift"]),
            )
            added += 1
    await audit(pool, admin, "roster", None, "create",
                f"Copied the roster from week of {from_monday} to week of {to_monday} ({added} shifts)")
    return {"added": added}


# ------------------------------------------------------------------ sample data

@router.get("/demo")
async def demo_status(request: Request, admin=Depends(get_current_admin)):
    return await demo.status(get_pool(request))


@router.post("/demo/seed")
async def demo_seed(request: Request, admin=Depends(get_current_admin)):
    """Loads a deterministic sample month for showing the app to stakeholders.

    Writes through the real tables so the walkthrough exercises the real
    scoring, and audits itself -- if figures are ever questioned, the log says
    when sample data was present and who loaded it.
    """
    pool = get_pool(request)
    try:
        result = await demo.seed(pool)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if result.get("already_loaded"):
        raise HTTPException(status_code=409, detail="sample data is already loaded - remove it first")
    await audit(pool, admin, "demo", "sample", "create",
                f"Loaded sample data: {result['trips']} trips across {result['drivers']} sample drivers",
                after=result)
    return result


@router.post("/demo/reset")
async def demo_reset(request: Request, admin=Depends(get_current_admin)):
    """Removes every sample row. Scoped by is_demo, so real trips cannot be
    reached by it."""
    pool = get_pool(request)
    result = await demo.purge(pool)
    await audit(pool, admin, "demo", "sample", "delete",
                f"Removed sample data: {result['removed_trips']} trips, "
                f"{result['removed_drivers']} sample drivers",
                before=result)
    return result
