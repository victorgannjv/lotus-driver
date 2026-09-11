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

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth import get_current_admin
from db import get_pool

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
    limit: int = Query(100, ge=1, le=500),
    admin=Depends(get_current_admin),
):
    pool = get_pool(request)
    where, params = [], []
    if entity:
        where.append("entity = %s")
        params.append(entity)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, entity, entity_id, action, summary, actor_email, created_at "
            f"FROM config_audit {clause} ORDER BY id DESC LIMIT %s",
            tuple(params + [limit]),
        )
        rows = await cur.fetchall()
    return {"activity": [{**r, "created_at": str(r["created_at"])} for r in rows]}


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
            "SELECT gt.id, gt.gap_code, gt.warehouse_id, w.name AS warehouse_name, gt.target_minutes "
            "FROM gap_target gt LEFT JOIN warehouses w ON w.id = gt.warehouse_id "
            "ORDER BY gt.gap_code, gt.warehouse_id IS NOT NULL, w.name"
        )
        rows = await cur.fetchall()
    return {"targets": rows}


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
    return {"settings": [{**r, "updated_at": str(r["updated_at"])} for r in rows]}


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
async def disable_driver(driver_id: int, request: Request, admin=Depends(get_current_admin)):
    """Disabled, never deleted -- their trips are dispute evidence and the rows
    point back at this user."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("UPDATE users SET status = 'disabled' WHERE id = %s AND role = 'driver'", (driver_id,))
    await audit(pool, admin, "driver", driver_id, "update", f"Turned off sign-in for driver {driver_id}")
    return {"id": driver_id, "status": "disabled"}


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
             "window_start": str(r["window_start"]), "window_end": str(r["window_end"])}
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
    if body.window_end <= body.window_start:
        raise HTTPException(status_code=422, detail="the window has to end after it starts")
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
                (body.label, body.window_start, body.window_end, body.grace_minutes,
                 1 if body.is_active else 0, existing["id"]),
            )
        else:
            await cur.execute(
                "INSERT INTO trip_schedule (warehouse_id, slot_no, label, window_start, window_end, "
                "grace_minutes, is_active) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (body.warehouse_id, body.slot_no, body.label, body.window_start, body.window_end,
                 body.grace_minutes, 1 if body.is_active else 0),
            )
    await audit(pool, admin, "schedule", f"slot{body.slot_no}", "update" if existing else "create",
                f"Set '{body.label}' window to {body.window_start}-{body.window_end}"
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
