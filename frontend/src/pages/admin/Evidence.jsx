import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import PhotoThumb from "../../components/PhotoThumb";
import Icon, { CHECKPOINT_ICON } from "../../components/Icon";
import { formatDuration, formatTime } from "../../lib/duration";

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

function OwnerChip({ owner }) {
  const o = OWNER[owner];
  if (!o) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">No owner</span>;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${o.chip}`}>{o.label}</span>;
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

        <Cell label="Date">{trip.work_date}</Cell>
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
          <OwnerChip owner={trip.owner} />
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
                  <span>{formatTime(c.occurred_at)}</span>
                  <span className={`${over ? "font-semibold text-brand-red" : "text-slate-500"}`}>
                    {gap ? `${gap.label} ${formatDuration(gap.minutes)} / ${formatDuration(gap.target_minutes)}` : ""}
                    {c.reason_label ? ` · ${c.reason_label}` : ""}
                  </span>
                  <span className="flex justify-end">
                    {c.photo_id ? (
                      <PhotoThumb photoId={c.photo_id} size="h-10 w-10"
                                  caption={`T-${trip.id} · ${CHECKPOINT_LABEL[c.checkpoint]} · ${formatTime(c.occurred_at)}`} />
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
                  <li key={j.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                    <span className={`h-4 w-1 rounded ${j.status === "failed" ? "bg-amber-500" : j.status === "done" ? "bg-emerald-600" : "bg-slate-300"}`} />
                    <span className="font-semibold">Job {j.seq}</span>
                    <span className="text-slate-500">{formatTime(j.completed_at) || "pending"}</span>
                    <span className="text-slate-500">{j.orders.length} orders</span>
                    <span className="flex-1" />
                    {j.photo_id && (
                      <PhotoThumb photoId={j.photo_id} size="h-10 w-10"
                                  caption={`T-${trip.id} · Job ${j.seq} · ${formatTime(j.completed_at)}`} />
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Evidence() {
  const [filters, setFilters] = useState({ q: "", warehouseId: "", driverId: "", owner: "", overOnly: false });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    api.get("/admin/warehouses").then((d) => setWarehouses(d.warehouses)).catch(() => {});
    api.get("/admin/drivers").then((d) => setDrivers(d.drivers)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), page_size: "25" });
    if (filters.q) qs.set("q", filters.q);
    if (filters.warehouseId) qs.set("warehouse_id", filters.warehouseId);
    if (filters.driverId) qs.set("driver_id", filters.driverId);
    if (filters.owner) qs.set("owner", filters.owner);
    if (filters.overOnly) qs.set("over_target_only", "true");
    setData(null);
    api
      .get(`/admin/evidence?${qs}`)
      .then(setData)
      .catch((err) => setError(err.detail || "could not load the evidence list"));
  }, [filters, page]);

  useEffect(load, [load]);

  function set(field) {
    return (e) => {
      const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      setFilters((f) => ({ ...f, [field]: value }));
      setPage(1);
    };
  }

  return (
    <div>
      <div className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-base font-semibold text-brand-black">Evidence</h2>
        <p className="mt-0.5 max-w-3xl text-xs text-slate-500">
          One row per trip, generated by the system — nobody types a claim. A trip appears over target because two
          checkpoint timestamps were subtracted and compared to the target table; the driver only supplies the reason.
          Filter first, then open what you need.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={filters.q}
            onChange={set("q")}
            placeholder="Trip ID or driver…"
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
            Showing {data.trips.length} of {data.total} trips · {data.over_target_total} over target
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

          <div className="space-y-2">
            {data.trips.map((trip) => (
              <TripCard
                key={trip.id}
                trip={trip}
                open={openId === trip.id}
                onToggle={() => setOpenId(openId === trip.id ? null : trip.id)}
              />
            ))}
            {data.trips.length === 0 && (
              <p className="rounded-xl bg-white px-4 py-6 text-sm text-slate-500 ring-1 ring-slate-200">
                No trips match these filters. Clear one and try again.
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-red" /><b className="text-slate-700">Over target</b> — a claim is possible</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /><b className="text-slate-700">Within target</b> — no claim</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /><b className="text-slate-700">Lotus-owned</b></span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" /><b className="text-slate-700">Ninja Van-owned</b></span>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                      className="font-semibold text-brand-red disabled:text-slate-300">← Previous</button>
              <span className="text-xs text-slate-500">Page {data.page} of {data.pages}</span>
              <button type="button" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}
                      className="font-semibold text-brand-red disabled:text-slate-300">Next →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
