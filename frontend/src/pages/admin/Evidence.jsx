import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import PhotoThumb from "../../components/PhotoThumb";
import { dropLabel, dropStyle, statusLabel, statusStyle } from "../../lib/status";
import Icon, { CHECKPOINT_ICON } from "../../components/Icon";
import { formatDate, formatDuration, formatTime } from "../../lib/duration";

// The retrieval surface: prove one specific trip.
//
// Nobody types a claim here. A row exists because the system subtracted two
// checkpoint timestamps and compared the result to the target table. The
// driver's only contribution is the reason code when a gap breached; the
// admin's is the claim status. So "did someone remember to log this?" never
// arises -- if the trip happened, the row exists.
//
// Built to be filtered rather than scrolled: at a few hundred trips a month,
// scrolling is not a way to find anything.
//
// The hierarchy is Job -> Trip -> Order: a Job is everything one driver ran
// on one date (was labelled "Day" -- same driver_day row, friendlier name),
// a Trip is one warehouse run, and each Trip carries the Waypoints (its
// drops -- the thing this app used to also call "Job", before Job took over
// the day-level name) that its Orders (parcels) were scanned against.

const CHECKPOINT_LABEL = {
  arrived: "Arrived at Lotus",
  goods_ready: "Lotus goods ready",
  loaded: "Loaded to truck",
  departed: "Departed outlet",
  deliveries_done: "Deliveries done",
  returned: "Returned to Lotus",
};

const OWNER = {
  lotus: { label: "Lotus", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  njv: { label: "Ninja Van", chip: "bg-blue-100 text-blue-800", dot: "bg-blue-600" },
  external: { label: "External", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-600" },
};

// A flat 30 minutes, independent of whatever time-at-outlet target is (or
// isn't) configured in Settings -- that target covers the whole outlet stay
// and can be switched off entirely, but "how long before Lotus even started
// pulling the load" is its own question and this page answers it on its own
// bar.
const LONG_WAIT_MINUTES = 30;

function waitMinutes(trip) {
  const gap = (trip.gaps || []).find((g) => g.gap_code === "waiting_for_lotus");
  return gap ? gap.minutes : null;
}

function isLongWait(trip) {
  const mins = waitMinutes(trip);
  return mins != null && mins > LONG_WAIT_MINUTES;
}

// Blank used to mean two very different things, both shown as "No owner": the
// trip was fine, or the trip ran late and nobody said why. The second is money
// we cannot claim because the reason was never logged, so it gets its own chip
// and its own colour -- it is a work queue, not an empty cell.
// A colour chip inline in a sentence, so the key reads as prose rather than
// as a second table of its own.
function Swatch({ tone }) {
  return <span className={`mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle ${tone}`} />;
}

function OwnerChip({ owner, lateSteps }) {
  const o = OWNER[owner];
  if (o) return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${o.chip}`}>{o.label}</span>;
  if (lateSteps) {
    return (
      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800"
            title="A step ran late but no reason was recorded, so we cannot say whose time it was.">
        No reason given
      </span>
    );
  }
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">On time</span>;
}

// Two timestamps in, minutes between them out. Values arrive as
// "2026-09-11 08:05:12", already in Malaysia wall-clock time (see
// formatTime) -- the 'T' swap is only so Date can parse it, the offset it
// assumes cancels out when the two are subtracted.
function minutesBetween(fromValue, toValue) {
  if (!fromValue || !toValue) return null;
  const a = new Date(String(fromValue).replace(" ", "T"));
  const b = new Date(String(toValue).replace(" ", "T"));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return (b - a) / 60000;
}

// A waypoint row is a door, not a dead end.
//
// The trail behind one parcel -- every status event with its own time, GPS,
// photo and the failure reason the driver typed -- lives on the order page.
// From here an admin could see THAT waypoint 2 failed but then had to go to
// Orders and search the tracking number to find out WHY, which is the
// question the row itself raises.
//
// The order page is per parcel, so the parcel is what links. A waypoint
// carrying a single parcel is unambiguous, so its whole header row goes there
// as well; a waypoint with several keeps an inert header and lets each parcel
// link for itself, rather than guessing which one was meant.
function WaypointRow({ trip, waypoint: j }) {
  const only = j.orders.length === 1 ? j.orders[0] : null;
  const Head = only ? Link : "div";
  const headProps = only
    ? { to: `/admin/jobs/${only.id}`, state: { from: "evidence" }, title: `Open ${only.tracking_no}` }
    : {};

  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        {/* The photo stays outside the link: tapping a proof photo should open
            the photo, not navigate away from it. */}
        <Head
          {...headProps}
          className={`flex min-w-0 flex-1 flex-wrap items-center gap-3 ${
            only ? "group -mx-1 rounded px-1 py-0.5 hover:bg-slate-50" : ""
          }`}
        >
          <span className={`h-4 w-1 rounded ${
            j.status === "failed" ? "bg-brand-red" : j.status === "done" ? "bg-emerald-600" : "bg-slate-300"
          }`} />
          <span className={`font-semibold ${only ? "group-hover:text-brand-red" : ""}`}>Waypoint {j.seq}</span>
          {/* A coloured bar told you something happened without saying what.
              The outcome is the thing an admin came to this row for. */}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${dropStyle(j.status)}`}>
            {dropLabel(j.status)}
          </span>
          <span className="text-slate-500">{formatTime(j.completed_at) || "not closed yet"}</span>
          <span className="text-slate-500">
            {j.orders.length} {j.orders.length === 1 ? "parcel" : "parcels"}
          </span>
          {only && (
            <Icon name="chevron" className="h-3 w-3 shrink-0 text-slate-300 group-hover:text-brand-red" />
          )}
        </Head>
        {j.photo_id && (
          <PhotoThumb photoId={j.photo_id} size="h-10 w-10"
                      caption={`T-${trip.id} · Waypoint ${j.seq} · ${formatTime(j.completed_at)}`} />
        )}
      </div>

      {/* Which parcels, and how each one ended. A waypoint can be closed with
          one parcel delivered and another failed, and the waypoint's own
          status cannot show that. Each one opens its own evidence trail.

          The row is the link, not the text. A tracking number here is often
          typed by the driver rather than scanned, so underlining it in red
          dressed a scrap of free text up as an identifier -- and a column of
          those reads as noise. The row lights on hover and carries the same
          chevron as the waypoint above it, which is how everything else on
          this page says "this opens". */}
      {j.orders.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-1.5">
          {j.orders.map((o) => (
            <li key={o.id}>
              <Link
                to={`/admin/jobs/${o.id}`}
                state={{ from: "evidence" }}
                title={`Open ${o.tracking_no}`}
                className="group/parcel -mx-1 flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-slate-50"
              >
                <span className="truncate text-slate-600 group-hover/parcel:text-brand-black">{o.tracking_no}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusStyle(o.status_code)}`}>
                    {statusLabel(o.status_code)}
                  </span>
                  <Icon name="chevron" className="h-3 w-3 text-slate-300 group-hover/parcel:text-slate-500" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// A trip, folded down to what fits on a chip: which one, when it ran, how big
// it was. Everything a trip card used to spell out in its own full-width row
// -- the id, the window, the load -- but small enough that a job with three
// trips still reads as one shape, not three repeats of the same driver and date.
// `connectedAbove`/`connectedBelow` say whether the trip touching this one on
// that side started the instant this one ended (see JobRow) -- the driver
// never left Lotus between them, so the seam is dropped and the two chips
// read as one continuous block instead of two trips with a border between.
function TripChip({ trip, open, onToggle, connectedAbove, connectedBelow, spaced }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`flex w-full items-center gap-3 border-l-4 border-r border-slate-200 bg-white px-3 py-2 text-left text-xs hover:bg-slate-50 ${
        spaced ? "mt-1" : ""
      } ${connectedAbove ? "border-t border-t-slate-100 rounded-t-none" : "border-t rounded-t-lg"} ${
        connectedBelow ? "rounded-b-none" : "border-b rounded-b-lg"
      } ${
        trip.over_target ? "border-l-brand-red" : "border-l-emerald-600"
      } ${open ? "ring-1 ring-inset ring-brand-red" : ""}`}
    >
      <Icon name="chevron" className={`h-3 w-3 shrink-0 text-slate-400 ${open ? "rotate-90" : ""}`} />
      <span className="font-semibold text-brand-black">T-{trip.id}</span>
      <span className="text-slate-500">
        {formatTime(trip.started_at) || "—"}–{formatTime(trip.ended_at) || "open"}
      </span>
      {/* Its own flag, separate from the red edge: that one tracks the
          configurable time-at-outlet target (which can be off entirely),
          this one is a fixed 30-minute bar on the wait alone. */}
      {isLongWait(trip) && (
        <span
          className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
          title="Waited more than 30 minutes for Lotus goods ready"
        >
          <Icon name="alert" className="h-3 w-3" />
          {formatDuration(waitMinutes(trip))} wait
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-right text-[10px] text-slate-400">
        {trip.warehouse_name} · {trip.jobs} wp · {trip.orders} ord
      </span>
    </button>
  );
}

// The gap itself -- dead time the driver spent neither at the outlet nor on
// the road. Only drawn between trips that actually have a gap: a trip that
// started the instant the last one returned (every trip past the first,
// now that one drop-off rolls straight into the next pickup) gets no badge
// at all -- see JobRow, where the chips are merged into one block instead.
// A missing timestamp (a trip still open, or cancelled without one) shows as
// a dash rather than a wrong number.
function GapBadge({ minutes }) {
  if (minutes == null) {
    return <span className="mt-1 flex items-center gap-2 py-0.5 pl-3 text-slate-300">┊</span>;
  }
  const long = minutes >= 60;
  return (
    <span
      className={`mt-1 flex items-center gap-2 py-0.5 pl-3 text-[11px] ${long ? "font-semibold text-brand-red" : "text-slate-400"}`}
      title="Time between this trip ending and the next one starting"
    >
      <span aria-hidden="true">↓</span>
      {formatDuration(minutes)} gap
    </span>
  );
}

// The full evidence trail for whichever trip chip is open, shown once below
// the whole strip rather than under the chip itself -- a chip is too narrow
// to grow without reflowing every chip after it.
function TripDetail({ trip }) {
  const [detail, setDetail] = useState(null);
  const tao = trip.time_at_outlet;

  useEffect(() => {
    setDetail(null);
    api.get(`/admin/trips/${trip.id}/detail`).then((d) => setDetail(d.trip)).catch(() => setDetail(null));
  }, [trip.id]);

  const gapFor = (cp) => (trip.gaps || []).find((g) => g.to_checkpoint === cp);

  return (
    <div className="-mx-4 mt-1 border-y border-slate-200 bg-slate-50 px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="font-semibold text-brand-black">T-{trip.id} · {trip.warehouse_name}</span>
        <span>Arrived {formatTime(trip.started_at) || "—"}</span>
        <span className={trip.ended_at ? undefined : "text-slate-400"}>
          Returned {formatTime(trip.ended_at) || "open"}
        </span>
        <span className={tao?.over_target ? "font-semibold text-brand-red" : "text-emerald-700"}>
          At outlet {tao ? formatDuration(tao.minutes) : "—"}
        </span>
        <OwnerChip owner={trip.owner} lateSteps={(trip.gaps || []).some((g) => g.over_target)} />
      </div>
      {trip.reason && (
        <p className="mb-3 text-sm text-slate-600">
          <span className="font-semibold text-brand-black">Reason given:</span> {trip.reason}
        </p>
      )}
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        End to end · arrival to return
      </p>
      <ol className="space-y-1.5">
        {trip.checkpoints.map((c) => {
          const gap = gapFor(c.checkpoint);
          const over = gap && gap.over_target;
          return (
            <li
              key={c.checkpoint}
              className={`grid grid-cols-[26px_minmax(110px,1fr)_90px_minmax(0,1.4fr)_56px] items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs ${
                over ? "border-l-[3px] border-l-brand-red" : "border-l-[3px] border-l-emerald-600"
              }`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-md ${over ? "bg-rose-50 text-brand-red" : "bg-emerald-50 text-emerald-700"}`}>
                <Icon name={CHECKPOINT_ICON[c.checkpoint]} className="h-3.5 w-3.5" />
              </span>
              <span className="font-semibold text-brand-black">{CHECKPOINT_LABEL[c.checkpoint]}</span>
              <span className="min-w-0">
                <span className="block">{formatTime(c.occurred_at)}</span>
                {c.place && <span className="block truncate text-[10px] text-slate-400">{c.place}</span>}
              </span>
              <span className={`${over ? "font-semibold text-brand-red" : "text-slate-500"}`}>
                {gap ? `${gap.label} ${formatDuration(gap.minutes)} / ${formatDuration(gap.target_minutes)}` : ""}
                {c.reason_label ? ` · ${c.reason_label}` : ""}
              </span>
              <span className="flex justify-end">
                {(c.photo_ids?.length ? c.photo_ids : c.photo_id ? [c.photo_id] : []).length > 0 ? (
                  <span className="flex flex-wrap justify-end gap-1">
                    {(c.photo_ids?.length ? c.photo_ids : [c.photo_id]).map((pid) => (
                      <PhotoThumb key={pid} photoId={pid} size="h-10 w-10"
                                  caption={`T-${trip.id} · ${CHECKPOINT_LABEL[c.checkpoint]} · ${formatTime(c.occurred_at)}`} />
                    ))}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-300">no photo</span>
                )}
              </span>
            </li>
          );
        })}
        {trip.checkpoints.length === 0 && (
          <li className="text-xs text-slate-400">No checkpoints recorded for this trip.</li>
        )}
      </ol>

      {detail && detail.job_detail.length > 0 && (
        <>
          <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Waypoints</p>
          <ul className="space-y-1.5">
            {detail.job_detail.map((j) => (
              <WaypointRow key={j.id} trip={trip} waypoint={j} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// One row per job -- not one per trip. A job that ran three trips used to
// print its driver, date and owner three times over as three separate cards;
// here it prints once, and the trips ride inside as a strip of chips with the
// gap between each pair called out, which is the shape "how was Ali's
// Tuesday" actually has: a few active stretches with dead time in between.
function JobRow({ job, openTripId, onToggleTrip, onFilterJob }) {
  const trips = [...job.trips].sort((a, b) => {
    const ta = a.started_at || "";
    const tb = b.started_at || "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id - b.id;
  });
  const longWaitCount = trips.filter(isLongWait).length;
  // Every order riding on a long-wait trip counts as problematic -- the wait
  // is stamped before a single drop exists yet (arrived -> goods ready), so
  // it delayed the whole load, not just some of it. "Problematic" is left
  // open for other criteria later; today this is the only one.
  const problematicOrders = trips.reduce((sum, t) => sum + (isLongWait(t) ? t.orders : 0), 0);

  // The detail for whichever chip is open sits right under THAT chip, not
  // pinned to the bottom of the strip -- opening the first of three trips
  // used to drop its evidence trail below the other two, which read as the
  // detail belonging to the last trip, or as a second card underneath.
  //
  // A gap of exactly zero minutes means the next trip's "arrived" is the
  // same instant this one's "returned" was stamped -- which, now that every
  // driver's second trip onward starts itself the moment the last one
  // returns, is not a coincidence but the normal case. Those pairs are drawn
  // with no gap badge and no seam between them at all, so the strip reads as
  // one continuous run with real rest breaks called out, rather than a row
  // of independent trips.
  const strip = trips.flatMap((trip, i) => {
    const prevGap = i > 0 ? minutesBetween(trips[i - 1].ended_at, trip.started_at) : null;
    const nextGap = i < trips.length - 1 ? minutesBetween(trip.ended_at, trips[i + 1].started_at) : null;
    const connectedAbove = i > 0 && prevGap === 0;
    const connectedBelow = i < trips.length - 1 && nextGap === 0;

    const nodes = [];
    if (i > 0 && !connectedAbove) {
      nodes.push(<GapBadge key={`gap-${trip.id}`} minutes={prevGap} />);
    }
    nodes.push(
      <TripChip
        key={trip.id}
        trip={trip}
        open={trip.id === openTripId}
        onToggle={() => onToggleTrip(trip.id)}
        connectedAbove={connectedAbove}
        connectedBelow={connectedBelow}
        spaced={i > 0 && !connectedAbove}
      />,
    );
    if (trip.id === openTripId) {
      nodes.push(<TripDetail key={`detail-${trip.id}`} trip={trip} />);
    }
    return nodes;
  });

  return (
    <div className={`mb-2.5 overflow-hidden rounded-xl border border-slate-200 border-l-4 bg-white ${
      job.over_target_count > 0 ? "border-l-brand-red" : "border-l-emerald-600"
    }`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
        <button
          type="button"
          onClick={onFilterJob}
          title="Copy this job's id into the search box"
          className="text-sm font-medium text-slate-500 underline decoration-slate-300 hover:text-brand-red hover:decoration-brand-red"
        >
          J-{job.driver_day_id}
        </button>
        <span className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
            {(job.driver_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-brand-black">{job.driver_name}</span>
            <span className="text-[11px] text-slate-400">{formatDate(job.work_date)}</span>
          </span>
        </span>
        <span className="text-xs text-slate-500">
          {job.trip_count} {job.trip_count === 1 ? "trip" : "trips"} · {job.jobs_total} waypoints · {job.orders_total} orders
        </span>
        {job.over_target_count > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-brand-red">
            {job.over_target_count} over target
          </span>
        )}
        {/* The count Lotus disputes are actually argued over -- a trip is an
            operational unit, an order is the billable one. Shown first, with
            the trip-count chip beside it as the "which runs" detail. */}
        {problematicOrders > 0 && (
          <span
            className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
            title="Orders riding on a trip that waited more than 30 minutes for Lotus goods ready"
          >
            <Icon name="alert" className="h-3 w-3" />
            {problematicOrders} problematic {problematicOrders === 1 ? "order" : "orders"}
          </span>
        )}
        {longWaitCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {longWaitCount} {longWaitCount === 1 ? "long wait" : "long waits"}
          </span>
        )}
      </div>

      <div className="flex flex-col border-t border-slate-100 bg-slate-50/70 px-4 py-3">
        {strip}
      </div>
    </div>
  );
}

// Which trips, which page and which one is open all live in the URL rather
// than in component state.
//
// Opening a parcel's evidence trail leaves this page and comes back to a fresh
// mount, so state held in useState is gone: the admin returned to page 1 of an
// unfiltered list with the trip they were reading collapsed. The URL survives
// that, and survives a refresh and a paste into chat as well -- which for a
// dispute tool is the point. Filter changes replace the history entry instead
// of adding one, so Back means "back out of the parcel", not "undo a keystroke".
const FIELDS = {
  q: "q",
  warehouseId: "warehouse_id",
  driverId: "driver_id",
  owner: "owner",
  overOnly: "over_target_only",
};

export default function Evidence() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [drivers, setDrivers] = useState([]);

  const filters = {
    q: params.get(FIELDS.q) || "",
    warehouseId: params.get(FIELDS.warehouseId) || "",
    driverId: params.get(FIELDS.driverId) || "",
    owner: params.get(FIELDS.owner) || "",
    overOnly: params.get(FIELDS.overOnly) === "true",
  };
  const page = Math.max(1, Number(params.get("page")) || 1);
  const openId = Number(params.get("trip")) || null;

  useEffect(() => {
    api.get("/admin/warehouses").then((d) => setWarehouses(d.warehouses)).catch(() => {});
    api.get("/admin/drivers").then((d) => setDrivers(d.drivers)).catch(() => {});
  }, []);

  const patch = useCallback(
    (changes, { keepPage = false } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value === "" || value == null || value === false) next.delete(key);
            else next.set(key, String(value));
          }
          if (!keepPage) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Depends on the query string, not on the filters object -- which is rebuilt
  // every render and would re-fetch forever as a dependency.
  const qs = (() => {
    const out = new URLSearchParams({ page: String(page), page_size: "25" });
    if (filters.q) out.set("q", filters.q);
    if (filters.warehouseId) out.set("warehouse_id", filters.warehouseId);
    if (filters.driverId) out.set("driver_id", filters.driverId);
    if (filters.owner) out.set("owner", filters.owner);
    if (filters.overOnly) out.set("over_target_only", "true");
    return out.toString();
  })();

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .get(`/admin/evidence?${qs}`)
      .then(setData)
      .catch((err) => setError(err.detail || "could not load the evidence list"));
  }, [qs]);

  function set(field) {
    return (e) => {
      const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      patch({ [FIELDS[field]]: value });
    };
  }

  return (
    <div>
      <div className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-base font-semibold text-brand-black">Evidence</h2>
        {/* Say what the page is FOR, not how it works.
            "Every trip, and where the time went. A step that ran over its
            allowed time is flagged, and Owner says whose time it was" described
            three mechanics and never once said why anyone would open this
            screen -- and the first of them was not even true with the limits
            switched off. The legend at the foot already explains the colours;
            this line only has to answer "what is this page". */}
        <p className="mt-0.5 text-xs text-slate-500">
          Look up any trip and see the proof behind it: every checkpoint with its time, place and
          photo, and the reason given for a delay. This is what you use to argue a late-delivery
          charge from Lotus.
        </p>
        {/* The colour key, at the top and folded away.
            It sat at the FOOT of the page as seven entries on one flat list,
            wrapping over three lines -- and it was really two different
            colour systems jammed together: the edge down the side of a row,
            and the Owner column. Grouped by where you actually see each one,
            it is two lines, and it is above the rows it explains rather than
            below them. */}
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer font-medium text-slate-500 hover:text-brand-black">
            What the colours mean
          </summary>
          <ul className="mt-1.5 space-y-1.5 border-l-2 border-slate-200 pl-3">
            <li>
              <b className="font-semibold text-slate-600">The edge down each row:</b>{" "}
              <Swatch tone="bg-brand-red" /> Over its time limit
              <span className="px-1.5 text-slate-300">·</span>
              <Swatch tone="bg-emerald-600" /> Every step inside it
            </li>
            <li>
              <b className="font-semibold text-slate-600">The Owner column:</b>{" "}
              <Swatch tone="bg-amber-500" /> Lotus, we can claim it back
              <span className="px-1.5 text-slate-300">·</span>
              <Swatch tone="bg-blue-600" /> Ninja Van, we cover it
              <span className="px-1.5 text-slate-300">·</span>
              <Swatch tone="bg-emerald-500" /> Outside causes, nobody to bill
              <span className="px-1.5 text-slate-300">·</span>
              <Swatch tone="bg-orange-500" /> No reason given, so nobody to bill
              <span className="px-1.5 text-slate-300">·</span>
              <Swatch tone="bg-slate-300" /> On time, nothing to explain
            </li>
            <li>
              <b className="font-semibold text-slate-600">Amber wait flag:</b>{" "}
              <Swatch tone="bg-amber-100" /> Waited over 30 minutes for Lotus goods ready -- its own fixed
              bar, separate from the time-at-outlet limit above (which can be off entirely). Shown per
              trip in minutes, and per job as how many orders rode on a flagged trip
            </li>
          </ul>
        </details>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={filters.q}
            onChange={set("q")}
            placeholder="Job ID, Trip ID or driver…"
            className="min-w-0 flex-1 basis-48 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select value={filters.warehouseId} onChange={set("warehouseId")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All outlets</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select value={filters.driverId} onChange={set("driverId")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All drivers</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={filters.owner} onChange={set("owner")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Any owner</option>
            <option value="lotus">Lotus</option>
            <option value="njv">Ninja Van</option>
            <option value="external">External</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600">
            <input type="checkbox" checked={filters.overOnly} onChange={set("overOnly")} />
            Over target only
          </label>
        </div>
        {data && (
          <p className="mt-3 text-xs text-slate-500">
            Showing {data.days.length} of {data.total} jobs · {data.trip_total} trips
            {" "}· {data.over_target_total} over target
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <>
          <div>
            {data.days.map((job) => (
              <JobRow
                key={job.driver_day_id}
                job={job}
                openTripId={openId}
                onToggleTrip={(tripId) => patch({ trip: openId === tripId ? "" : tripId }, { keepPage: true })}
                onFilterJob={() => patch({ q: String(job.driver_day_id) })}
              />
            ))}
            {data.days.length === 0 && (
              <p className="rounded-xl bg-white px-4 py-6 text-sm text-slate-500 ring-1 ring-slate-200">
                No trips match these filters. Clear one and try again.
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <button type="button" disabled={page <= 1}
                      onClick={() => patch({ page: page - 1, trip: "" }, { keepPage: true })}
                      className="font-semibold text-brand-red disabled:text-slate-300">← Previous</button>
              <span className="text-xs text-slate-500">Page {data.page} of {data.pages}</span>
              <button type="button" disabled={page >= data.pages}
                      onClick={() => patch({ page: page + 1, trip: "" }, { keepPage: true })}
                      className="font-semibold text-brand-red disabled:text-slate-300">Next →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
