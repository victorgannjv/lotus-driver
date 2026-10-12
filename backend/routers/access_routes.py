"""Access control: the staff who can sign in, and the roles that decide what
each of them may see or change.

Everything that can widen anyone's access is gated on the `access` module at
Edit level -- including editing a role, since a role's grants are exactly what
its members hold. Viewing the lists needs only View, so a supervisor can see
who has what without being able to change it.

Two rules exist purely so this screen cannot lock the site:

  - There must always be at least one ACTIVE staff member whose role gives
    them Edit on Access control. Every change that could remove the last one
    (demoting them, moving them to another role, disabling them, trimming the
    role they hold) is checked against the state it would produce and refused.
  - The built-in Administrator role cannot be edited or deleted.

Every change is written to the activity log, with who made it.
"""
import json
from typing import Literal

from asyncmy.cursors import DictCursor
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from access import EDIT, VIEW, allows, clean_permissions, effective_permissions
from auth import require_access
from clocks import fmt
from db import get_pool
from routers.config_routes import audit

router = APIRouter()

NO_MANAGER = (
    "That would leave nobody able to manage access. Give another active member of staff a role with "
    "Edit on Access control first."
)


class RoleIn(BaseModel):
    name: str
    description: str | None = None
    permissions: dict[str, str] = {}


class StaffIn(BaseModel):
    name: str
    email: str
    role_id: int


class StaffUpdate(BaseModel):
    name: str | None = None
    role_id: int | None = None
    status: Literal["active", "disabled"] | None = None


# ----------------------------------------------------------------- helpers

async def _roles(pool) -> dict[int, dict]:
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT id, name, description, permissions, is_system, updated_at FROM access_role ORDER BY is_system DESC, name")
        rows = await cur.fetchall()
    return {
        r["id"]: {
            "id": r["id"], "name": r["name"], "description": r["description"],
            "is_system": bool(r["is_system"]),
            "permissions": effective_permissions(r["id"], r["permissions"], r["is_system"]),
            "updated_at": fmt(r["updated_at"]),
        }
        for r in rows
    }


async def _staff(pool) -> list[dict]:
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, name, email, status, access_role_id AS role_id, created_at "
            "FROM users WHERE role = 'admin' ORDER BY (status = 'active') DESC, created_at"
        )
        return await cur.fetchall()


def _has_manager(staff, roles, staff_patch=None, role_patch=None) -> bool:
    """Whether, with the given changes applied, some active member of staff
    holds Edit on Access control."""
    for person in staff:
        patch = (staff_patch or {}).get(person["id"], {})
        if patch.get("status", person["status"]) != "active":
            continue
        role = roles.get(patch.get("role_id", person["role_id"]))
        if role is None:
            continue
        perms = role["permissions"] if role["is_system"] else (role_patch or {}).get(role["id"], role["permissions"])
        if allows(perms, "access", EDIT):
            return True
    return False


def _guard_manager(staff, roles, staff_patch=None, role_patch=None) -> None:
    # If the site is somehow already without a manager, allow the change: the
    # only way out is to be able to make one.
    if _has_manager(staff, roles) and not _has_manager(staff, roles, staff_patch, role_patch):
        raise HTTPException(status_code=409, detail=NO_MANAGER)


def _name(value: str, what: str) -> str:
    out = (value or "").strip()
    if not out:
        raise HTTPException(status_code=422, detail=f"{what} cannot be empty")
    if len(out) > 80:
        raise HTTPException(status_code=422, detail=f"{what} is too long (80 characters at most)")
    return out


def _describe(perms: dict) -> str:
    n_edit = sum(1 for v in perms.values() if v == EDIT)
    n_view = sum(1 for v in perms.values() if v == VIEW)
    return f"{n_edit} edit, {n_view} view"


# ------------------------------------------------------------------- read

@router.get("/roles")
async def list_roles(request: Request, admin=Depends(require_access("access", VIEW))):
    pool = get_pool(request)
    roles, staff = await _roles(pool), await _staff(pool)
    members: dict[int, int] = {}
    for person in staff:
        if person["status"] == "active" and person["role_id"] in roles:
            members[person["role_id"]] = members.get(person["role_id"], 0) + 1
    return {"roles": [{**r, "members": members.get(r["id"], 0)} for r in roles.values()]}


@router.get("/staff")
async def list_staff(request: Request, admin=Depends(require_access("access", VIEW))):
    pool = get_pool(request)
    roles = await _roles(pool)
    return {
        "staff": [
            {
                "id": p["id"], "name": p["name"], "email": p["email"], "status": p["status"],
                "role_id": p["role_id"],
                "role_name": roles[p["role_id"]]["name"] if p["role_id"] in roles else None,
                "created_at": fmt(p["created_at"]),
                "is_self": p["id"] == admin["id"],
            }
            for p in await _staff(pool)
        ]
    }


# ------------------------------------------------------------------ roles

@router.post("/roles", status_code=201)
async def create_role(body: RoleIn, request: Request, admin=Depends(require_access("access", EDIT))):
    pool = get_pool(request)
    name = _name(body.name, "A role name")
    perms = clean_permissions(body.permissions)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT 1 FROM access_role WHERE name = %s", (name,))
        if await cur.fetchone():
            raise HTTPException(status_code=409, detail=f"a role called '{name}' already exists")
        await cur.execute(
            "INSERT INTO access_role (name, description, permissions, is_system) VALUES (%s, %s, %s, 0)",
            (name, (body.description or "").strip()[:255] or None, json.dumps(perms)),
        )
        new_id = cur.lastrowid
    await audit(pool, admin, "role", new_id, "create", f"Created access role '{name}' ({_describe(perms)})",
                after={"name": name, "permissions": perms})
    return {"id": new_id}


@router.put("/roles/{role_id}")
async def update_role(role_id: int, body: RoleIn, request: Request,
                      admin=Depends(require_access("access", EDIT))):
    pool = get_pool(request)
    roles, staff = await _roles(pool), await _staff(pool)
    role = roles.get(role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="role not found")
    if role["is_system"]:
        raise HTTPException(status_code=409, detail="the built-in Administrator role cannot be changed")
    name = _name(body.name, "A role name")
    perms = clean_permissions(body.permissions)
    _guard_manager(staff, roles, role_patch={role_id: perms})
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT 1 FROM access_role WHERE name = %s AND id <> %s", (name, role_id))
        if await cur.fetchone():
            raise HTTPException(status_code=409, detail=f"a role called '{name}' already exists")
        await cur.execute(
            "UPDATE access_role SET name = %s, description = %s, permissions = %s WHERE id = %s",
            (name, (body.description or "").strip()[:255] or None, json.dumps(perms), role_id),
        )
    await audit(pool, admin, "role", role_id, "update", f"Changed access role '{name}' ({_describe(perms)})",
                before={"name": role["name"], "permissions": role["permissions"]},
                after={"name": name, "permissions": perms})
    return {"id": role_id}


@router.delete("/roles/{role_id}")
async def delete_role(role_id: int, request: Request, admin=Depends(require_access("access", EDIT))):
    pool = get_pool(request)
    roles, staff = await _roles(pool), await _staff(pool)
    role = roles.get(role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="role not found")
    if role["is_system"]:
        raise HTTPException(status_code=409, detail="the built-in Administrator role cannot be deleted")
    holders = [p for p in staff if p["role_id"] == role_id]
    if holders:
        raise HTTPException(
            status_code=409,
            detail=f"{len(holders)} member{'s' if len(holders) != 1 else ''} of staff still have this role "
                   "-- move them to another role first",
        )
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("DELETE FROM access_role WHERE id = %s", (role_id,))
    await audit(pool, admin, "role", role_id, "delete", f"Deleted access role '{role['name']}'",
                before={"name": role["name"], "permissions": role["permissions"]})
    return {"id": role_id, "deleted": True}


# ------------------------------------------------------------------ staff

@router.post("/staff", status_code=201)
async def add_staff(body: StaffIn, request: Request, admin=Depends(require_access("access", EDIT))):
    pool = get_pool(request)
    roles = await _roles(pool)
    role = roles.get(body.role_id)
    if role is None:
        raise HTTPException(status_code=422, detail="choose an access role for this person")
    name, email = _name(body.name, "A name"), (body.email or "").strip()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="enter a work email address")
    async with pool.acquire() as conn, conn.cursor() as cur:
        # Scoped to role='admin': an email that already has a driver account is a
        # separate identity here and shouldn't block adding it to the admin
        # allowlist -- users.email is only unique per role, not across the table.
        await cur.execute("SELECT id, status FROM users WHERE email = %s AND role = 'admin'", (email,))
        existing = await cur.fetchone()
        if existing is not None:
            detail = ("that person's access was removed earlier -- re-enable them from the list instead"
                      if existing[1] != "active" else "an admin with this email already exists")
            raise HTTPException(status_code=409, detail=detail)
        await cur.execute(
            "INSERT INTO users (role, email, name, status, access_role_id) VALUES ('admin', %s, %s, 'active', %s)",
            (email, name, role["id"]),
        )
        new_id = cur.lastrowid
    await audit(pool, admin, "admin", new_id, "create", f"Gave {name} ({email}) dashboard access as {role['name']}",
                after={"email": email, "role": role["name"]})
    return {"id": new_id}


@router.put("/staff/{staff_id}")
async def update_staff(staff_id: int, body: StaffUpdate, request: Request,
                       admin=Depends(require_access("access", EDIT))):
    pool = get_pool(request)
    roles, staff = await _roles(pool), await _staff(pool)
    person = next((p for p in staff if p["id"] == staff_id), None)
    if person is None:
        raise HTTPException(status_code=404, detail="staff member not found")

    patch: dict = {}
    if body.role_id is not None:
        if body.role_id not in roles:
            raise HTTPException(status_code=422, detail="unknown access role")
        patch["role_id"] = body.role_id
    if body.status is not None:
        patch["status"] = body.status
    if body.name is not None:
        patch["name"] = _name(body.name, "A name")
    if not patch:
        return {"id": staff_id}

    _guard_manager(staff, roles, staff_patch={staff_id: patch})

    sets, params = [], []
    for column, key in (("name", "name"), ("status", "status"), ("access_role_id", "role_id")):
        if key in patch:
            sets.append(f"{column} = %s")
            params.append(patch[key])
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = %s AND role = 'admin'",
                          tuple(params + [staff_id]))

    changes = []
    if "role_id" in patch:
        before = roles.get(person["role_id"], {}).get("name", "no role")
        changes.append(f"role {before} -> {roles[patch['role_id']]['name']}")
    if "status" in patch and patch["status"] != person["status"]:
        changes.append("access removed" if patch["status"] == "disabled" else "access restored")
    if "name" in patch and patch["name"] != person["name"]:
        changes.append(f"renamed to {patch['name']}")
    await audit(pool, admin, "admin", staff_id, "update",
                f"Changed {person['name']} ({person['email']}): {', '.join(changes) or 'no change'}",
                before={"role_id": person["role_id"], "status": person["status"]}, after=patch)
    return {"id": staff_id}
