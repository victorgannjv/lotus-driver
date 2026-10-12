"""Access control: the catalogue of what can be permitted, and the rules for
reading a role's grants.

A MODULE is a part of the admin site someone might be allowed to use. A LEVEL
is how much of it: none (no entry at all), view, or edit -- and edit includes
view, so a role never has to say both. Some modules have nothing to edit (the
dashboard is figures; the activity log is a record), so the catalogue says
which levels each one offers and the editor only draws those.

The catalogue lives here, in code, on purpose. A module is a feature, and
whether someone may use it has to ship in the same release as the feature --
otherwise there is a window where a new screen exists and nobody can tell who
is meant to see it. Roles in the database only reference these keys.

The built-in Administrator role is not a stored list of grants but "everything
in this catalogue", computed on read. Add a module here and every
Administrator has it immediately, and no one can be locked out of a module
because a role's JSON predates it.
"""
import json

from fastapi import HTTPException

VIEW = "view"
EDIT = "edit"
_RANK = {VIEW: 1, EDIT: 2}


def _m(key, label, group, levels, about):
    return {"key": key, "label": label, "group": group, "levels": list(levels), "about": about}


CATALOG = [
    _m("dashboard", "Dashboard", "Work", [VIEW],
       "The figures: time at the outlet, delays, manpower and trends."),
    _m("evidence", "Evidence", "Work", [VIEW],
       "Every trip with its checkpoints, photos and reasons. Includes exporting the log to CSV."),
    _m("orders", "Orders", "Work", [VIEW],
       "Parcels and their scan history, with proof photos."),
    _m("diagnostics", "Diagnostics", "Monitoring", [VIEW, EDIT],
       "The error log and system health checks. Edit lets them resolve issues and clear the log."),
    _m("drivers", "Drivers", "Settings", [VIEW, EDIT],
       "The driver list. Edit lets them add, change, invite and delete drivers (deleting removes their trips)."),
    # An on/off switch rather than a scale: there is no "view" of setting a
    # password. Its own module (not part of Drivers edit) because it is the one
    # permission that lets someone SIGN IN AS another person -- everything a
    # driver's account can do, and every proof photo it can add -- so who holds
    # it is a decision of its own. It does not open the Drivers page; that
    # still takes View on Drivers.
    _m("driver_passwords", "Driver passwords", "Settings", [EDIT],
       "Set a new password for a driver who has forgotten theirs. Whoever can do this can then sign in "
       "as that driver, so give it sparingly. They also need View on Drivers to reach the page."),
    _m("outlets", "Outlets", "Settings", [VIEW, EDIT],
       "The warehouses drivers work from."),
    _m("windows", "Delivery windows", "Settings", [VIEW, EDIT],
       "The contracted time window each run is judged against."),
    _m("targets", "Time limits", "Settings", [VIEW, EDIT],
       "How long each step may take before it counts as a delay."),
    _m("reasons", "Delay reasons", "Settings", [VIEW, EDIT],
       "The reasons a driver can give for a delay, and who each one is charged to."),
    _m("driver_app", "Driver app", "Settings", [VIEW, EDIT],
       "What the driver app asks for: steps, photos, quick picks."),
    _m("activity", "Activity log", "Settings", [VIEW],
       "The record of every settings change and who made it."),
    _m("sample", "Sample data", "Settings", [VIEW, EDIT],
       "Loading and removing the demonstration data."),
    _m("access", "Access control", "Administration", [VIEW, EDIT],
       "Who can sign in and what each role may do. Edit lets them grant themselves or anyone else anything."),
]

BY_KEY = {m["key"]: m for m in CATALOG}
MODULE_KEYS = [m["key"] for m in CATALOG]

# The system role: the highest level each module offers.
FULL_ACCESS = {m["key"]: m["levels"][-1] for m in CATALOG}


def parse_permissions(text) -> dict:
    """A role's stored JSON as {module: level}. Tolerant by design: unknown
    modules and impossible levels are dropped rather than raised, because this
    runs on every request and a bad row must never turn into a 500 for
    everyone holding the role."""
    try:
        raw = json.loads(text) if isinstance(text, (str, bytes)) else (text or {})
    except (TypeError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, level in raw.items():
        mod = BY_KEY.get(key)
        if mod and level in mod["levels"]:
            out[key] = level
    return out


def clean_permissions(raw: dict) -> dict:
    """The strict version, for WRITES: an unknown module or a level the module
    does not offer is a 422 the editor can show, not something to drop quietly
    and save a role the admin did not think they made."""
    if not isinstance(raw, dict):
        raise HTTPException(status_code=422, detail="permissions must be an object of module -> level")
    out = {}
    for key, level in raw.items():
        mod = BY_KEY.get(key)
        if mod is None:
            raise HTTPException(status_code=422, detail=f"unknown module '{key}'")
        if level in (None, "", "none"):
            continue
        if level not in mod["levels"]:
            offered = " or ".join(mod["levels"])
            raise HTTPException(status_code=422, detail=f"{mod['label']} can only be given as {offered}")
        out[key] = level
    return out


def effective_permissions(role_id, stored, is_system) -> dict:
    """What a role actually grants. No role grants nothing -- the safe way to
    be wrong; the system role grants the whole catalogue whatever it stored."""
    if not role_id:
        return {}
    return dict(FULL_ACCESS) if is_system else parse_permissions(stored)


def allows(permissions: dict, module: str, level: str = VIEW) -> bool:
    have = permissions.get(module)
    return have is not None and _RANK[have] >= _RANK[level]


def allows_any(permissions: dict, modules, level: str = VIEW) -> bool:
    return any(allows(permissions, m, level) for m in modules)


def denial(role_name: str | None, modules, level: str) -> str:
    """Says what was refused and why, in terms of the role, so the person who
    hits it knows whom to ask rather than that something is broken."""
    labels = [BY_KEY[m]["label"] for m in modules if m in BY_KEY]
    what = labels[0] if len(labels) == 1 else "this area"
    verb = "change" if level == EDIT else "view"
    who = f"Your access role ({role_name})" if role_name else "Your account has no access role, so it"
    return f"{who} doesn't allow you to {verb} {what}. Ask an administrator if you need it."


def ensure(admin: dict, modules, level: str = VIEW) -> None:
    """The imperative form of require_access, for the places a single endpoint
    serves more than one module and only the request body says which."""
    mods = (modules,) if isinstance(modules, str) else tuple(modules)
    if not allows_any(admin.get("permissions") or {}, mods, level):
        raise HTTPException(status_code=403, detail=denial(admin.get("role_name"), mods, level))
