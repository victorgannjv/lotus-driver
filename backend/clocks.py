"""One place that knows the difference between when something happened and what
a human should read.

Every datetime in the database is naive UTC -- written as
`datetime.now(timezone.utc).replace(tzinfo=None)`, which is UTC by construction
and does not depend on the container's timezone. Everything a person reads is
Malaysia time: a contracted window of 09:30-12:00 means 09:30 in Puchong, and a
timestamp burned onto a proof photo has to say what the clock on the wall said.

Storage stays UTC. This module is the only conversion.
"""
from datetime import date, datetime, timedelta, timezone

# Single-country operation. If Ninja Van ever runs this outside Malaysia the
# offset belongs on the outlet, not here -- but inventing that column now would
# be a second source of truth for a question nobody is asking yet.
LOCAL_TZ = timezone(timedelta(hours=8))
LOCAL_TZ_LABEL = "GMT+08:00"


def to_local(dt: datetime | None) -> datetime | None:
    """Naive-UTC (as stored) -> naive local. Anything already carrying a tzinfo
    is converted honestly rather than assumed."""
    if dt is None:
        return None
    aware = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    return aware.astimezone(LOCAL_TZ).replace(tzinfo=None)


def local_now() -> datetime:
    return datetime.now(LOCAL_TZ).replace(tzinfo=None)


def local_today() -> date:
    """The day it is where the drivers are. `date.today()` on a UTC server rolls
    over at 08:00 Malaysia time, which would file a morning trip under
    yesterday."""
    return local_now().date()


def fmt(dt: datetime | None) -> str | None:
    """The wire format for a timestamp: local wall clock, seconds included."""
    local = to_local(dt)
    return None if local is None else local.strftime("%Y-%m-%d %H:%M:%S")


def stamp(dt: datetime | None) -> str:
    """The same instant, labelled -- for anything that leaves the app and has to
    stand on its own, like the caption burned into a proof photo."""
    local = to_local(dt)
    return "" if local is None else f"{local.strftime('%Y-%m-%d %H:%M:%S')} {LOCAL_TZ_LABEL}"
