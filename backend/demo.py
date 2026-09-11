"""Sample trips for showing the app to people who have never seen it.

Three rules this is built around.

REAL PATHS. The rows go into manifests, trip_checkpoint, trip_job and
delivery_jobs exactly as a driver's phone would write them. Nothing here
fabricates a dashboard figure -- gaps, fault attribution and window variance
are all computed on read by the same code that scores real trips. A demo that
short-circuits that proves the mock works, not the product.

COMPLETELY REMOVABLE. Every row hangs off a user with is_demo = 1, so the reset
is a delete by ownership rather than a guess about which rows were pretend.

DETERMINISTIC. One fixed seed, so the numbers are identical every time it is
loaded. You can rehearse a walkthrough on Monday and give it on Thursday
against the same figures, and two people demoing to different stakeholders tell
the same story.

The shape of the data is deliberate rather than random: it has to show the
thing the app exists to show. Roughly a third of trips breach, most of the lost
time is Lotus's, and one outlet is visibly worse than the rest -- because a
dashboard where every bar is the same height demonstrates nothing.
"""
import random
from datetime import datetime, timedelta

from asyncmy.cursors import DictCursor

from clocks import from_local, local_today

SEED = 20260911

DEMO_EMAIL_DOMAIN = "sample.invalid"   # RFC 2606: can never collide with a real address

DEMO_DRIVERS = [
    "Aminah Binti Yusof",
    "Ravi Kumar",
    "Tan Wei Ming",
    "Nurul Izzah Binti Hassan",
    "Lim Chee Keong",
    "Mohd Faizal Bin Rahman",
]

DAYS = 28            # four weeks: enough for the 7-day / 30-day presets to differ
TRIPS_PER_DAY = 3    # matches the three contracted slots

# Wall-clock start for each slot, aligned to the seeded windows in V14
# (09:30-12:00, 13:00-15:00, 15:00-17:00).
SLOT_START = {1: (9, 30), 2: (13, 0), 3: (15, 0)}

# Reason codes weighted the way a real month reads: the outlet not having the
# goods staged is the single biggest cause, and our own late starts are a real
# but smaller share. Weights, not uniform choice -- a flat distribution would
# make the "top reasons" panel meaningless.
LOTUS_REASONS = [
    ("LOT_NOT_STAGED", 34), ("LOT_NO_BAY", 22), ("LOT_STAFF", 14),
    ("LOT_DOC", 11), ("LOT_SHORT_GOODS", 8), ("LOT_SYSTEM", 6),
    ("LOT_GATE", 5),
]
NJV_REASONS = [
    ("NJV_LATE", 30), ("NJV_VEHICLE", 20), ("NJV_LOADPLAN", 18),
    ("NJV_CAPACITY", 14), ("NJV_SHORTHANDED", 10), ("NJV_APP", 8),
]
EXT_REASONS = [("EXT_TRAFFIC", 55), ("EXT_ROAD", 25), ("EXT_WEATHER", 20)]


def _pick(rng: random.Random, weighted: list[tuple[str, int]]) -> str:
    return rng.choices([c for c, _ in weighted], weights=[w for _, w in weighted])[0]


async def status(pool) -> dict:
    """What is currently loaded. Drives both the Settings panel and the banner,
    so neither can claim demo data is present when it is not."""
    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT COUNT(*) AS n FROM users WHERE is_demo = 1")
        drivers = (await cur.fetchone())["n"]
        await cur.execute(
            "SELECT COUNT(*) AS n FROM manifests m JOIN users u ON u.id = m.driver_id "
            "WHERE u.is_demo = 1"
        )
        trips = (await cur.fetchone())["n"]
    return {"loaded": drivers > 0, "drivers": drivers, "trips": trips}


async def purge(pool) -> dict:
    """Deletes every demo row, children first so the foreign keys stay happy.

    Scoped by is_demo at every step. A real driver's trip cannot be reached by
    any of these statements even if the ids interleave.
    """
    before = await status(pool)
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "DELETE de FROM delivery_events de JOIN users u ON u.id = de.driver_id WHERE u.is_demo = 1")
        await cur.execute(
            "DELETE dj FROM delivery_jobs dj JOIN manifests m ON m.id = dj.manifest_id "
            "JOIN users u ON u.id = m.driver_id WHERE u.is_demo = 1")
        await cur.execute(
            "DELETE tc FROM trip_checkpoint tc JOIN manifests m ON m.id = tc.manifest_id "
            "JOIN users u ON u.id = m.driver_id WHERE u.is_demo = 1")
        await cur.execute(
            "DELETE tj FROM trip_job tj JOIN manifests m ON m.id = tj.manifest_id "
            "JOIN users u ON u.id = m.driver_id WHERE u.is_demo = 1")
        await cur.execute(
            "DELETE r FROM shift_roster r JOIN users u ON u.id = r.driver_id WHERE u.is_demo = 1")
        await cur.execute(
            "DELETE m FROM manifests m JOIN users u ON u.id = m.driver_id WHERE u.is_demo = 1")
        await cur.execute("DELETE FROM users WHERE is_demo = 1")
    return {"removed_trips": before["trips"], "removed_drivers": before["drivers"]}


async def seed(pool) -> dict:
    """Builds the sample month. Refuses to run twice -- loading two overlapping
    sets would double every figure on the dashboard and make the walkthrough
    say something untrue."""
    existing = await status(pool)
    if existing["loaded"]:
        return {"already_loaded": True, **existing}

    rng = random.Random(SEED)

    async with pool.acquire() as conn, conn.cursor(DictCursor) as cur:
        await cur.execute("SELECT id, name FROM warehouses WHERE is_active = 1 ORDER BY id")
        outlets = await cur.fetchall()
    if not outlets:
        raise ValueError("add at least one outlet before loading sample data")

    # The worst performer, so the outlet breakdown has something to point at.
    # Picked by position rather than at random so it is the same outlet every
    # time the sample is reloaded.
    problem_outlet = outlets[len(outlets) // 2]["id"]

    driver_ids: list[tuple[int, int]] = []            # (driver_id, warehouse_id)
    async with pool.acquire() as conn, conn.cursor() as cur:
        for i, name in enumerate(DEMO_DRIVERS):
            outlet = outlets[i % len(outlets)]
            await cur.execute(
                "INSERT INTO users (role, email, name, status, warehouse_id, is_demo) "
                "VALUES ('driver', %s, %s, 'active', %s, 1)",
                (f"sample.driver{i + 1}@{DEMO_EMAIL_DOMAIN}", f"{name} (sample)", outlet["id"]),
            )
            driver_ids.append((cur.lastrowid, outlet["id"]))

    today = local_today()
    trips = 0

    # One connection and batched inserts for the whole month. Row-at-a-time
    # through the pool is ~12,000 round trips, which is slow enough that the
    # request times out at the ingress before the seed finishes -- and a
    # half-written sample month is worse than none.
    async with pool.acquire() as conn, conn.cursor() as cur:
        for day_offset in range(DAYS, 0, -1):
            day = today - timedelta(days=day_offset - 1)
            if day.weekday() == 6:                    # Sundays off
                continue

            for driver_id, warehouse_id in driver_ids:
                # Not everyone works every day -- a roster with no absences
                # looks invented, and the manpower panel needs the variation.
                if rng.random() < 0.12:
                    continue
                for slot in range(1, TRIPS_PER_DAY + 1):
                    if slot == 3 and rng.random() < 0.35:   # the last run often does not happen
                        continue
                    await _one_trip(cur, rng, driver_id, warehouse_id, day, slot,
                                    troubled=warehouse_id == problem_outlet)
                    trips += 1

    return {"already_loaded": False, "drivers": len(driver_ids), "trips": trips}


async def _one_trip(cur, rng, driver_id, warehouse_id, day, slot, troubled: bool) -> None:
    """One trip, stamped end to end, written in UTC like the app writes it."""
    hour, minute = SLOT_START[slot]

    # How this trip goes. About a third breach, and the troubled outlet
    # breaches closer to half the time -- that gap is the point of the outlet
    # panel.
    breach_chance = 0.48 if troubled else 0.28
    breaches = rng.random() < breach_chance

    # Arrival relative to the window opening: usually a few minutes either
    # side, occasionally a genuinely late start that is ours to own.
    njv_late_start = breaches and rng.random() < 0.25
    arrival_offset = rng.randint(25, 55) if njv_late_start else rng.randint(-12, 8)

    arrived = from_local(datetime(day.year, day.month, day.day, hour, minute)
                         + timedelta(minutes=arrival_offset))

    # waiting_for_lotus is the headline gap: how long the outlet kept the truck
    # before the goods were ready.
    wait = rng.randint(52, 115) if breaches and not njv_late_start else rng.randint(6, 22)
    load = rng.randint(34, 62) if breaches and rng.random() < 0.3 else rng.randint(9, 26)
    depart_lag = rng.randint(12, 28) if njv_late_start else rng.randint(2, 9)
    round_mins = rng.randint(150, 310)
    return_mins = rng.randint(22, 68)

    goods_ready = arrived + timedelta(minutes=wait)
    loaded = goods_ready + timedelta(minutes=load)
    departed = loaded + timedelta(minutes=depart_lag)
    done = departed + timedelta(minutes=round_mins)
    returned = done + timedelta(minutes=return_mins)

    job_count = rng.randint(4, 11)
    orders_per_job = rng.randint(2, 6)

    await cur.execute(
        "INSERT INTO manifests (driver_id, work_date, warehouse_arrived_at, schedule_slot_no, "
        "expected_job_count, day_closed_at) VALUES (%s, %s, %s, %s, %s, %s)",
        (driver_id, day.isoformat(), arrived, slot, job_count,
         returned + timedelta(minutes=rng.randint(5, 30))),
    )
    manifest_id = cur.lastrowid

    def coord():
        return (round(3.05 + rng.random() * 0.16, 7), round(101.55 + rng.random() * 0.19, 7))

    # A reason is attached only where the gap actually ran over, because that is
    # the only place the app would have asked the driver for one.
    stamps = [
        ("arrived", arrived, None),
        ("goods_ready", goods_ready, _pick(rng, LOTUS_REASONS) if wait > 45 else None),
        ("loaded", loaded, _pick(rng, LOTUS_REASONS) if load > 30 else None),
        ("departed", departed, _pick(rng, NJV_REASONS) if depart_lag > 10 else None),
        ("deliveries_done", done, _pick(rng, EXT_REASONS) if round_mins > 280 else None),
        ("returned", returned, _pick(rng, EXT_REASONS) if return_mins > 55 else None),
    ]
    await cur.executemany(
        "INSERT INTO trip_checkpoint (manifest_id, checkpoint, occurred_at, lat, lng, "
        "reason_code, created_by) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        [(manifest_id, cp, when, *coord(), reason, driver_id) for cp, when, reason in stamps],
    )

    jobs, orders = [], []
    for seq in range(1, job_count + 1):
        started = departed + timedelta(minutes=round(round_mins * (seq - 1) / job_count))
        finished = departed + timedelta(minutes=round(round_mins * seq / job_count))
        failed = rng.random() < 0.06
        jobs.append((manifest_id, seq, "failed" if failed else "done", started, finished))
        for n in range(orders_per_job):
            orders.append((manifest_id, f"SAMPLE{manifest_id:06d}{seq:02d}{n:02d}",
                           "failed" if failed else "delivered"))

    await cur.executemany(
        "INSERT INTO trip_job (manifest_id, seq, status, started_at, completed_at) "
        "VALUES (%s, %s, %s, %s, %s)", jobs,
    )
    await cur.executemany(
        "INSERT INTO delivery_jobs (manifest_id, tracking_no, status_code) VALUES (%s, %s, %s)",
        orders,
    )
