"""Trip checkpoint domain logic, shared by the driver and admin surfaces.

A trip (a `manifests` row) is stamped at up to five points: arrived,
goods_ready, loaded, departed, returned -- plus deliveries_done, which the app
fires by itself once every job in the trip is resolved rather than making a
driver confirm what the system can already see.

WHICH of those the app asks for is a setting, not a constant (see
active_checkpoints): the shape of a run is still being worked out with the
outlets, and a driver asked for a stamp that means nothing learns to fire them
all at the gate. Only `arrived` and `deliveries_done` are fixed.

The time BETWEEN two checkpoints is a "gap", and a gap that runs past its target
is what Ninja Van disputes with. Gaps are always COMPUTED, never stored: a stored
gap becomes a second source of truth the moment someone corrects a timestamp, and
targets are still being negotiated with Lotus, so changing one has to re-score
history rather than only future trips.

One roll-up, two audiences: the driver's week and ops' week come from the same
query with the same targets (see summarise_trips), so they can never disagree.
"""
from datetime import datetime

from asyncmy.cursors import DictCursor

from clocks import fmt, to_local
from localities import describe

# gap_code -> (from checkpoint, to checkpoint, default fault party or None)
# None means "ask the driver" -- loading time can be Lotus's manpower or ours.
GAP_DEFS: list[tuple[str, str, str, str | None]] = [
    ("waiting_for_lotus", "arrived", "goods_ready", "lotus"),
    ("loading", "goods_ready", "loaded", None),
    ("departure_lag", "loaded", "departed", "njv"),
    ("delivery_round", "departed", "deliveries_done", "njv"),
    ("return_leg", "deliveries_done", "returned", "njv"),
]

# The headline dispute number: how long Lotus kept the truck on site.
HEADLINE_GAP = ("time_at_outlet", "arrived", "departed")

GAP_LABELS = {
    "waiting_for_lotus": "Waiting for Lotus",
    "loading": "Loading",
    "departure_lag": "Departure lag",
    "delivery_round": "Delivery round",
    "return_leg": "Return leg",
    "time_at_outlet": "Time at outlet",
}

CHECKPOINT_ORDER = ["arrived", "goods_ready", "loaded", "departed", "deliveries_done", "returned"]

# The ones the driver taps, in order. deliveries_done is absent on purpose --
# the server fires it when the last drop closes.
DRIVER_CHECKPOINTS = ["arrived", "goods_ready", "loaded", "departed", "returned"]

# Steps that cannot be switched off.
#
# `arrived` IS the trip: POST /manifests/start creates the manifest and stamps
# it in the same breath, so a run without it does not exist. `deliveries_done`
# is fired by the server and is what the drop list hangs off -- nobody is being
# asked for it, so there is nothing for an admin to switch off.
LOCKED_CHECKPOINTS = ("arrived", "deliveries_done")

# Anything after the deliveries themselves can only be stamped once every drop
# is resolved. Derived rather than hard-coded to "returned", because which step
# ends a run is now configurable.
AFTER_DELIVERIES = set(CHECKPOINT_ORDER[CHECKPOINT_ORDER.index("deliveries_done") + 1:])

CHECKPOINT_LABELS = {
    "arrived": "Arrived at Lotus",
    "goods_ready": "Lotus goods ready",
    "loaded": "Loaded to truck",
    "departed": "Departed outlet",
    "deliveries_done": "Deliveries done",
    "returned": "Returned to Lotus",
}

# The gap whose breach a given checkpoint has to explain, so the app knows which
# reason prompt to raise when the driver stamps it.
CHECKPOINT_GAP = {to_cp: code for code, _from, to_cp, _party in GAP_DEFS}


async def load_targets(pool) -> dict:
    """Active gap targets, keyed (gap_code, warehouse_id). warehouse_id None is
    the global default; an outlet row overrides it for that outlet only.

    Empty when the feature is switched off, which is the default -- the
    per-step allowances are working numbers, not terms Lotus has agreed, and
    flagging a trip against a bar nobody signed is an argument we lose. An
    empty map makes resolve_target return None, and every consumer already
    treats a missing target as "nothing to flag": no red, no reason prompt, no
    fault attribution. One switch, no branches."""
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT value FROM app_setting WHERE setting_key = 'gap_targets_enabled'")
        row = await cur.fetchone()
        enabled = str((row or {}).get("value", "false")).strip().lower()
        if enabled not in ("1", "true", "yes", "on"):
            return {}
        await cur.execute(
            "SELECT gap_code, warehouse_id, target_minutes FROM gap_target WHERE is_active = 1"
        )
        rows = await cur.fetchall()
    return {(r["gap_code"], r["warehouse_id"]): r["target_minutes"] for r in rows}


def resolve_target(targets: dict, gap_code: str, warehouse_id: int | None) -> int | None:
    """Outlet-specific target wins; otherwise the global default; otherwise None
    (an unconfigured gap is never 'over target' -- silence beats a made-up bar)."""
    if warehouse_id is not None and (gap_code, warehouse_id) in targets:
        return targets[(gap_code, warehouse_id)]
    return targets.get((gap_code, None))


def _minutes(a: datetime, b: datetime) -> int:
    return int(round((b - a).total_seconds() / 60))


def compute_gaps(stamps: dict, targets: dict, warehouse_id: int | None) -> list[dict]:
    """Gaps for one trip. `stamps` maps checkpoint -> datetime; a gap whose two
    ends are not both stamped is simply absent rather than guessed at."""
    out: list[dict] = []
    for code, from_cp, to_cp, party in GAP_DEFS:
        start, end = stamps.get(from_cp), stamps.get(to_cp)
        if start is None or end is None:
            continue
        mins = _minutes(start, end)
        target = resolve_target(targets, code, warehouse_id)
        out.append({
            "gap_code": code,
            "label": GAP_LABELS[code],
            "from_checkpoint": from_cp,
            "to_checkpoint": to_cp,
            "minutes": mins,
            "target_minutes": target,
            "over_target": target is not None and mins > target,
            "over_by_minutes": max(0, mins - target) if target is not None else None,
            "default_fault_party": party,
        })
    return out


def open_gap(stamps: dict, targets: dict, warehouse_id: int | None, next_cp: str | None) -> dict | None:
    """The step the driver is inside right now, and how long it is allowed.

    compute_gaps only reports gaps with both ends stamped, which is the right
    rule for scoring and the wrong one for the screen: while a trip is running
    the only interval anyone cares about is the one still open. This returns
    it, with the clock it started from, so the app can count down against the
    allowance instead of reporting a number that stopped moving.
    """
    if next_cp is None:
        return None
    for code, from_cp, to_cp, party in GAP_DEFS:
        if to_cp != next_cp:
            continue
        start = stamps.get(from_cp)
        if start is not None:
            return {
                "gap_code": code,
                "label": GAP_LABELS[code],
                "from_checkpoint": from_cp,
                "to_checkpoint": to_cp,
                "started_at": fmt(start),
                "target_minutes": resolve_target(targets, code, warehouse_id),
                "default_fault_party": party,
            }

        # This gap begins at a step that is switched off, so nothing stamped
        # it. Count from the last stamp there actually is -- the driver is
        # still standing in a loading bay and the clock since the last thing
        # that happened is the useful number.
        #
        # WITHOUT the allowance. The interval being measured is no longer the
        # one the allowance was set for, and counting a wider interval down
        # against a narrower bar would flag a breach that was never defined.
        prev = _previous_stamp(stamps, to_cp)
        if prev is None:
            return None
        prev_cp, prev_at = prev
        return {
            "gap_code": code,
            "label": GAP_LABELS[code],
            "from_checkpoint": prev_cp,
            "to_checkpoint": to_cp,
            "started_at": fmt(prev_at),
            "target_minutes": None,
            "default_fault_party": party,
        }
    return None


def _previous_stamp(stamps: dict, before_cp: str):
    """The latest checkpoint stamped ahead of `before_cp`, as (code, time)."""
    for cp in reversed(CHECKPOINT_ORDER[: CHECKPOINT_ORDER.index(before_cp)]):
        if stamps.get(cp) is not None:
            return cp, stamps[cp]
    return None


def compute_time_at_outlet(stamps: dict, targets: dict, warehouse_id: int | None) -> dict | None:
    code, from_cp, to_cp = HEADLINE_GAP
    start, end = stamps.get(from_cp), stamps.get(to_cp)
    if start is None or end is None:
        return None
    mins = _minutes(start, end)
    target = resolve_target(targets, code, warehouse_id)
    return {
        "gap_code": code,
        "label": GAP_LABELS[code],
        "minutes": mins,
        "target_minutes": target,
        "over_target": target is not None and mins > target,
        "over_by_minutes": max(0, mins - target) if target is not None else None,
    }


async def fetch_checkpoints(pool, manifest_ids: list[int]) -> dict[int, dict]:
    """checkpoint rows grouped by manifest id."""
    if not manifest_ids:
        return {}
    placeholders = ",".join(["%s"] * len(manifest_ids))
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT tc.id, tc.manifest_id, tc.checkpoint, tc.occurred_at, tc.lat, tc.lng, tc.photo_id, "
            "tc.reason_code, tc.reason_note, tc.original_reason_code, tc.recoded_at, "
            "rc.label AS reason_label, rc.fault_party "
            "FROM trip_checkpoint tc LEFT JOIN reason_code rc ON rc.code = tc.reason_code "
            f"WHERE tc.manifest_id IN ({placeholders}) ORDER BY tc.occurred_at",
            tuple(manifest_ids),
        )
        rows = await cur.fetchall()
    grouped: dict[int, dict] = {mid: {} for mid in manifest_ids}
    for r in rows:
        grouped[r["manifest_id"]][r["checkpoint"]] = r
    return grouped


def serialize_checkpoint(row: dict) -> dict:
    return {
        "checkpoint": row["checkpoint"],
        "label": CHECKPOINT_LABELS.get(row["checkpoint"], row["checkpoint"]),
        "occurred_at": fmt(row["occurred_at"]),
        "lat": float(row["lat"]) if row["lat"] is not None else None,
        "lng": float(row["lng"]) if row["lng"] is not None else None,
        # Where that fix was, in words. Saves every screen doing its own
        # lookup and keeps one answer for one coordinate.
        "place": describe(row["lat"], row["lng"]),
        "photo_id": row["photo_id"],
        "reason_code": row["reason_code"],
        "reason_label": row.get("reason_label"),
        "fault_party": row.get("fault_party"),
        "reason_note": row["reason_note"],
        "original_reason_code": row.get("original_reason_code"),
        "recoded": row.get("recoded_at") is not None,
    }


def stamps_from(checkpoint_rows: dict) -> dict:
    return {cp: row["occurred_at"] for cp, row in checkpoint_rows.items()}


def owning_party(checkpoint_rows: dict, gaps: list[dict]) -> str | None:
    """Which party owns the biggest breach on this trip -- what the register shows
    in its Owner column. A trip with no breach has no owner, deliberately: that is
    the difference between 'nothing to claim' and 'nobody logged it'."""
    worst_party, worst_over = None, 0
    for gap in gaps:
        if not gap["over_target"]:
            continue
        row = checkpoint_rows.get(gap["to_checkpoint"])
        party = (row or {}).get("fault_party") or gap["default_fault_party"]
        if party and gap["over_by_minutes"] > worst_over:
            worst_party, worst_over = party, gap["over_by_minutes"]
    return worst_party


async def load_settings(pool) -> dict:
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT setting_key, value FROM app_setting")
        rows = await cur.fetchall()
    return {r["setting_key"]: r["value"] for r in rows}


def setting_bool(settings: dict, key: str, default: bool = False) -> bool:
    return str(settings.get(key, str(default))).strip().lower() in ("1", "true", "yes", "on")


def setting_list(settings: dict, key: str) -> list[str]:
    raw = settings.get(key, "")
    return [p.strip() for p in raw.split(",") if p.strip()]


def active_checkpoints(settings: dict) -> list[str]:
    """Which steps the app asks for, in trip order.

    The shape of a run is still being worked out with the outlets, so it is a
    setting rather than a constant -- an outlet that stages its goods before we
    arrive makes "Lotus goods ready" a tap with nothing behind it, and a driver
    asked for a stamp that means nothing learns to fire them all at the gate,
    which costs us the stamps that do mean something.

    An absent or empty setting means every step. An app that asks for nothing
    is not what an empty box was ever meant to say, and this has to be safe on
    a database where the row does not exist yet.
    """
    chosen = set(setting_list(settings, "active_checkpoints"))
    if not chosen:
        active = list(CHECKPOINT_ORDER)
    else:
        active = [cp for cp in CHECKPOINT_ORDER if cp in chosen or cp in LOCKED_CHECKPOINTS]

    # `deliveries_done` is fired by the server when the last drop closes. With
    # the drops layer switched off there are no drops to close, so it would
    # sit unstamped on every trip forever -- a step the timeline draws, the
    # driver cannot act on, and nothing will ever fill in. It is locked
    # against the checkpoint setting, not against this one.
    if not job_tracking_enabled(settings):
        active = [cp for cp in active if cp != "deliveries_done"]
    return active


def job_tracking_enabled(settings: dict) -> bool:
    """Whether the app asks for drops and parcels at all.

    A trip records two things at once: when the truck was at the outlet, and
    what it carried. The Lotus dispute rests almost entirely on the first.
    During adoption the second can be switched off -- the drop count sheet and
    the parcel scanning are the longest part of the flow and the easiest place
    for a driver still learning it to give up -- and switched back on later
    without a deploy. Default on, so an unmigrated database behaves as before.
    """
    return setting_bool(settings, "job_tracking_enabled", True)


def trip_end(stamps: dict, ended_cp: str):
    """The moment a trip finished, or None while it is still running.

    "Returned to Lotus" while that step is switched on, and whatever now ends a
    run when it is not -- but a trip that DID come back is over by anyone's
    reckoning even if the step has since been switched off, so both are
    considered and the later one wins. A setting change must not rewrite when
    past trips ended.
    """
    times = [stamps[c] for c in {ended_cp, "returned"} if c in stamps]
    return max(times) if times else None


def stampable_checkpoints(active: list[str]) -> list[str]:
    """The active steps the driver actually taps, in order."""
    return [cp for cp in DRIVER_CHECKPOINTS if cp in active]


def final_checkpoint(active: list[str]) -> str:
    """The stamp that means "this trip is over".

    "Returned to Lotus" while it is switched on, and whatever now ends the run
    when it is not. Several rules hang off this -- a trip stops accepting late
    photos, a day closes itself -- and all of them meant "the last thing the
    driver does", not "returned" specifically.
    """
    stampable = stampable_checkpoints(active)
    return stampable[-1] if stampable else "arrived"


# ---------------------------------------------------------------------------
# Contracted windows.
#
# The gap targets above measure dwell -- how long a step took. That is
# diagnostic. What Lotus actually charges on is the contracted window each run
# has to land in (first trip 09:30-12:00, and so on), so lateness is an
# absolute-time judgement, not a duration one.
#
# Keeping both is the point: the window says WHETHER the commitment was missed,
# the gaps say WHY, and putting them together attributes the miss.
# ---------------------------------------------------------------------------

async def load_schedules(pool) -> list[dict]:
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute(
            "SELECT id, warehouse_id, slot_no, label, window_start, window_end, grace_minutes "
            "FROM trip_schedule WHERE is_active = 1 ORDER BY slot_no"
        )
        return await cur.fetchall()


def slots_for(schedules: list[dict], warehouse_id: int | None) -> dict[int, dict]:
    """Outlet-specific windows win wholesale where they exist; otherwise the
    global set. Mixing the two per-slot would make a schedule impossible to
    reason about from the contract it came from."""
    specific = {s["slot_no"]: s for s in schedules if s["warehouse_id"] == warehouse_id}
    if specific:
        return specific
    return {s["slot_no"]: s for s in schedules if s["warehouse_id"] is None}


def _as_minutes(value) -> int:
    """TIME comes back as timedelta on this driver; DATETIME as datetime."""
    if hasattr(value, "total_seconds"):
        return int(value.total_seconds() // 60)
    return value.hour * 60 + value.minute


def schedule_variance(slot: dict | None, arrived, departed) -> dict | None:
    """How a trip sat against its contracted window, and who owns any overrun.

    The attribution is the whole reason this exists: arriving late is ours and
    is counted first, so a claim never asks Lotus to pay for our own late start.
    Anything beyond that -- the truck was there in time and still left after the
    window closed -- is the outlet holding us.
    """
    if slot is None or arrived is None:
        return None

    # A contracted window of 09:30-12:00 means half past nine in Puchong, but
    # checkpoints are stored as naive UTC. Comparing the two directly scored
    # every trip eight hours out -- a run that left at 17:30 local read as
    # 09:30 and passed a window it had missed by hours.
    arrived = to_local(arrived)
    departed = to_local(departed)

    start = _as_minutes(slot["window_start"])
    end = _as_minutes(slot["window_end"])
    grace = slot["grace_minutes"] or 0

    arrived_min = arrived.hour * 60 + arrived.minute
    arrival_variance = arrived_min - start          # negative = early
    arrival_late = max(0, arrival_variance - grace)

    out = {
        "slot_no": slot["slot_no"],
        "label": slot["label"],
        "window_start": f"{start // 60:02d}:{start % 60:02d}",
        "window_end": f"{end // 60:02d}:{end % 60:02d}",
        "grace_minutes": grace,
        "arrival_variance_minutes": arrival_variance,
        "arrived_late_minutes": arrival_late,
        "arrived_on_time": arrival_late == 0,
        "departure_variance_minutes": None,
        "departed_late_minutes": 0,
        "departed_on_time": None,
        "njv_late_minutes": arrival_late,
        "lotus_late_minutes": 0,
        "still_open": departed is None,
    }

    if departed is None:
        return out

    departed_min = departed.hour * 60 + departed.minute
    departure_variance = departed_min - end
    departed_late = max(0, departure_variance - grace)
    out["departure_variance_minutes"] = departure_variance
    out["departed_late_minutes"] = departed_late
    out["departed_on_time"] = departed_late == 0
    # Our late arrival is deducted first; the remainder is the outlet's.
    out["lotus_late_minutes"] = max(0, departed_late - arrival_late)
    return out
