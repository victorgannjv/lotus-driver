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

// One column template, used by the header strip AND every row. Before this the
// header was a wrapping flex of variable-width children, so "Jobs" started
// wherever the driver's name happened to end -- "JC" and "Victor Test 3" pushed
// the same column to two different places and nothing lined up down the page.
//
// Stacks below lg rather than md: nine columns need about 900px before they
// stop being a table and start being a squeeze.
const TRIP_COLS =
  "lg:grid lg:grid-cols-[6.5rem_minmax(9rem,1.4fr)_6.5rem_5rem_5rem_6rem_4rem_4.5rem_6.5rem] lg:items-center lg:gap-x-4";

const TRIP_HEADS = ["Trip", "Driver", "Date", "Arrived", "Returned", "At outlet", "Jobs", "Orders", "Owner"];

// Below lg the label rides with the value, because a stacked row has no header
// strip to sit under.
function Cell({ label, children, tone }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2 lg:block">
      <span className="w-[5.5rem] shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 lg:hidden">
        {label}
      </span>
      <span className={`min-w-0 truncate text-sm ${tone || "text-brand-black"}`}>{children}</span>
    </span>
  );
}

// A drop row is a door, not a dead end.
//
// The trail behind one parcel -- every status event with its own time, GPS,
// photo and the failure reason the driver typed -- lives on the order page.
// From here an admin could see THAT job 2 failed but then had to go to Orders
// and search the tracking number to find out WHY, which is the question the
// row itself raises.
//
// The order page is per parcel, so the parcel is what links. A drop carrying a
// single parcel is unambiguous, so its whole header row goes there as well; a
// drop with several keeps an inert header and lets each parcel link for
// itself, rather than guessing which one was meant.
function JobRow({ trip, job: j }) {
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
          <span className={`font-semibold ${only ? "group-hover:text-brand-red" : ""}`}>Job {j.seq}</span>
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
                      caption={`T-${trip.id} · Job ${j.seq} · ${formatTime(j.completed_at)}`} />
        )}
      </div>

      {/* Which parcels, and how each one ended. A drop can be closed with one
          parcel delivered and another failed, and the drop's own status cannot
          show that. Each one opens its own evidence trail.

          The row is the link, not the text. A tracking number here is often
          typed by the driver rather than scanned, so underlining it in red
          dressed a scrap of free text up as an identifier -- and a column of
          those reads as noise. The row lights on hover and carries the same
          chevron as the job above it, which is how everything else on this
          page says "this opens". */}
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

// The layer above Trip: everything one driver ran on one date. A driver makes
// two or three trips a day, and "how was Ali's Tuesday" is the question a
// dispute or a roster check actually asks -- not "how was trip 3000006" on
// its own. Not collapsible like a trip card: at that scale there is nothing
// to hide, only a header worth reading before the cards it introduces.
function DayHeader({ day }) {
  return (
    <div className="mb-1.5 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 first:mt-0">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-black text-[10px] font-bold text-white">
        {(day.driver_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("")}
      </span>
      {/* Same "T-<id>" convention as the trip cards below it -- a day is now a
          row with its own id (driver_day), not just a label grouping trips,
          so it gets the same kind of identifier the things inside it get. */}
      <span className="text-xs font-semibold text-slate-400">D-{day.driver_day_id}</span>
      <span className="text-sm font-semibold text-brand-black">{day.driver_name}</span>
      <span className="text-xs text-slate-400">{formatDate(day.work_date)}</span>
      <span className="text-xs text-slate-400">
        {day.trip_count} {day.trip_count === 1 ? "trip" : "trips"} · {day.jobs_total} jobs · {day.orders_total} orders
      </span>
      {day.over_target_count > 0 && (
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-brand-red">
          {day.over_target_count} over target
        </span>
      )}
    </div>
  );
}

function TripCard({ trip, open, onToggle }) {
  const [detail, setDetail] = useState(null);
  const tao = trip.time_at_outlet;

  useEffect(() => {
    if (open && !detail) {
      api.get(`/admin/trips/${trip.id}/detail`).then((d) => setDetail(d.trip)).catch(() => setDetail(null));
    }
  }, [open, detail, trip.id]);

  const gapFor = (cp) => (trip.gaps || []).find((g) => g.to_checkpoint === cp);

  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 border-l-4 bg-white ${
      trip.over_target ? "border-l-brand-red" : "border-l-emerald-600"
    }`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full space-y-1.5 px-4 py-3.5 text-left hover:bg-slate-50 lg:space-y-0 ${TRIP_COLS}`}
      >
        <span className="flex items-center gap-2">
          <Icon name="chevron" className={`h-3.5 w-3.5 shrink-0 text-slate-400 ${open ? "rotate-90" : ""}`} />
          <span className="text-sm font-semibold text-brand-black">T-{trip.id}</span>
        </span>

        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
            {(trip.driver_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold text-brand-black">{trip.driver_name}</span>
            <span className="truncate text-[11px] text-slate-400">{trip.warehouse_name}</span>
          </span>
        </span>

        <Cell label="Date">{formatDate(trip.work_date)}</Cell>
        <Cell label="Arrived">{formatTime(trip.started_at) || "—"}</Cell>
        {/* An open trip says so. The old row rendered "05:01–…", which reads
            like a value that got cut off rather than one that does not exist
            yet. */}
        <Cell label="Returned" tone={trip.ended_at ? undefined : "text-slate-400"}>
          {formatTime(trip.ended_at) || "open"}
        </Cell>
        <Cell label="At outlet"
              tone={tao?.over_target ? "font-semibold text-brand-red" : "text-emerald-700"}>
          {tao ? formatDuration(tao.minutes) : "—"}
        </Cell>
        <Cell label="Jobs">{trip.jobs}</Cell>
        <Cell label="Orders">{trip.orders}</Cell>

        <span className="flex items-baseline gap-2 lg:block lg:text-right">
          <span className="w-[5.5rem] shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 lg:hidden">
            Owner
          </span>
          <OwnerChip owner={trip.owner} lateSteps={(trip.gaps || []).some((g) => g.over_target)} />
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
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
              <p className="mb-2 mt-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">Jobs</p>
              <ul className="space-y-1.5">
                {detail.job_detail.map((j) => (
                  <JobRow key={j.id} trip={trip} job={j} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
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
          </ul>
        </details>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={filters.q}
            onChange={set("q")}
            placeholder="Trip ID, day ID or driver…"
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
            Showing {data.days.length} of {data.total} driver-days · {data.trip_total} trips
            {" "}· {data.over_target_total} over target
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <>
          {/* Said once, at the top, instead of on all 25 cards. The labels were
              the loudest thing on a row that exists to show values. */}
          <div className={`hidden px-4 pb-2 ${TRIP_COLS}`} aria-hidden="true">
            {TRIP_HEADS.map((h, i) => (
              <span key={h}
                    className={`text-[10px] font-bold uppercase tracking-widest text-slate-400 ${
                      i === TRIP_HEADS.length - 1 ? "text-right" : ""
                    }`}>
                {h}
              </span>
            ))}
          </div>

          <div>
            {data.days.map((day) => (
              <div key={day.driver_day_id}>
                <DayHeader day={day} />
                <div className="space-y-2">
                  {day.trips.map((trip) => (
                    <TripCard
                      key={trip.id}
                      trip={trip}
                      open={openId === trip.id}
                      onToggle={() => patch({ trip: openId === trip.id ? "" : trip.id }, { keepPage: true })}
                    />
                  ))}
                </div>
              </div>
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
