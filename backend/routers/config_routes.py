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
from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_admin
from db import get_pool

router = APIRouter()


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
    return {"code": code}


@router.delete("/reason-codes/{code}")
async def deactivate_reason_code(code: str, request: Request, admin=Depends(get_current_admin)):
    """Soft-delete only. Historical checkpoints still point at this code, and a
    dispute filed last month must keep reading the same way next month."""
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("UPDATE reason_code SET is_active = 0 WHERE code = %s", (code,))
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
    if row["warehouse_id"] is None:
        raise HTTPException(status_code=409, detail="the global default can be changed but not removed")
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("DELETE FROM gap_target WHERE id = %s", (target_id,))
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
    return {"work_date": body.work_date, "driver_id": body.driver_id}


@router.delete("/roster/{roster_id}")
async def delete_roster(roster_id: int, request: Request, admin=Depends(get_current_admin)):
    pool = get_pool(request)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("DELETE FROM shift_roster WHERE id = %s", (roster_id,))
    return {"deleted": roster_id}
