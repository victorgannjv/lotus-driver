import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useAccess } from "../../auth/AdminAccess";
import { formatDate, formatDuration, formatShortDate } from "../../lib/duration";
import { driverCode } from "../../lib/ids";
import { formatRM } from "../../lib/money";

// One row per driver: how much they drove, how long they work in a day, how
// long a trip takes, and where they are based.
//
// The figures that depend on something being recorded say how much they rest
// on, in small type under the number. "6h 12m" on one day's work and "6h 12m"
// on twenty are not the same claim.

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeFor(mode, custom) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (mode === "custom") return { from: custom.from, to: custom.to };
  if (mode === "today") return { from: isoDate(today), to: isoDate(today) };
  if (mode === "yesterday") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { from: isoDate(y), to: isoDate(y) };
  }
  if (mode === "month") return { from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(today) };
  const days = mode === "l7d" ? 7 : 30;
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { from: isoDate(start), to: isoDate(today) };
}

const MODES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["l7d", "Last 7 days"],
  ["l30d", "Last 30 days"],
  ["month", "This month"],
  ["custom", "Custom"],
];

const COLUMNS = [
  { key: "driver_id", label: "Driver ID", text: true },
  { key: "driver_name", label: "Driver", text: true },
  { key: "trips", label: "Trips" },
  { key: "total_worked_minutes", label: "Total hours worked" },
  { key: "total_ot_minutes", label: "Total OT hours worked" },
  { key: "regular_cost", label: "Regular hours cost" },
  { key: "ot_cost", label: "OT cost" },
  { key: "total_cost", label: "Total cost" },
  { key: "avg_worked_minutes", label: "Avg hours per day" },
  { key: "avg_trip_minutes", label: "Avg time per trip" },
  { key: "ot_days", label: "Number of OT days" },
  { key: "outlet", label: "Outlet", text: true },
];

const inputClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm";

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-black">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

const NO_LIMIT = "No overtime limit is set. An admin sets it under Settings, Job management.";

// Why a cost cell is empty, so the dash is never a mystery: the three costs
// need a rate; the regular/overtime split also needs the overtime limit.
function costWhy(d, data) {
  if (!data.cost_per_hour) return "No cost per hour is set. An admin sets it under Settings, Job management.";
  if (!data.overtime_threshold_minutes) return NO_LIMIT;
  return "No finished trips yet.";
}

const Blank = () => <span className="text-slate-300">—</span>;

export default function DriverPerformance() {
  const [mode, setMode] = useState("l30d");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [warehouseId, setWarehouseId] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "trips", dir: "desc" });
  const [warehouses, setWarehouses] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Which drivers' overtime lists are open. Kept by driver id, so a list stays
  // open through a re-sort or a search and closes only when asked to.
  const [openOt, setOpenOt] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const { can } = useAccess();
  const toggleOt = (id) =>
    setOpenOt((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    api.get("/admin/warehouses").then((d) => setWarehouses(d.warehouses)).catch(() => {});
  }, []);

  const { from, to } = rangeFor(mode, custom);
  const ready = Boolean(from && to && from <= to);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    setLoading(true);
    const qs = new URLSearchParams({ date_from: from, date_to: to });
    if (warehouseId) qs.set("warehouse_id", warehouseId);
    api
      .get(`/admin/performance?${qs}`)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e.detail || e.message || "could not load driver performance"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [from, to, warehouseId, ready]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    // A name fragment, or a driver's id as printed ("D-12" or just "12").
    const list = data.drivers.filter(
      (d) => !needle || d.driver_name.toLowerCase().includes(needle)
        || driverCode(d.driver_id).toLowerCase() === needle || String(d.driver_id) === needle,
    );
    const { key, dir } = sort;
    const sign = dir === "asc" ? 1 : -1;
    // A driver with no figure sorts last either way round, so "slowest first"
    // is not a list of people who simply have no data.
    return [...list].sort((a, b) => {
      const x = a[key], y = b[key];
      if (x == null && y == null) return a.driver_name.localeCompare(b.driver_name);
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "string" ? x.localeCompare(y) : x - y;
      return c === 0 ? a.driver_name.localeCompare(b.driver_name) : c * sign;
    });
  }, [data, q, sort]);

  // The file is the table you are looking at: the same period, outlet and
  // search, asked of the server so the figures come from the same code that
  // drew them rather than being rebuilt here.
  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const qs = new URLSearchParams({ date_from: from, date_to: to });
      if (warehouseId) qs.set("warehouse_id", warehouseId);
      if (q.trim()) qs.set("q", q.trim());
      const res = await fetch(`/api/admin/performance/export?${qs}`);
      if (!res.ok) {
        let detail;
        try {
          detail = (await res.json())?.detail;
        } catch {
          detail = null;
        }
        throw new Error(detail || `export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match ? match[1] : "driver_performance.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message || "could not export driver performance");
    } finally {
      setExporting(false);
    }
  }

  const toggleSort = (key, text) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: text ? "asc" : "desc" }));

  const s = data?.summary;

  return (
    <div>
      <div className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-brand-black">Driver performance</h2>
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || !ready}
            title={ready ? "Download the table below as a CSV file" : "Pick both dates first"}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-black hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
        {exportError && <p className="mt-1 text-xs text-red-600">{exportError}</p>}
        <p className="mt-0.5 text-xs text-slate-500">
          How each driver is doing over the period: trips done, the hours they work in a day, and how
          long a trip takes them.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Period">
            {MODES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                aria-pressed={mode === key}
                className={`px-3 py-2 text-sm font-medium ${
                  mode === key ? "bg-brand-red text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "custom" && (
            <>
              <input type="date" aria-label="From" value={custom.from} max={custom.to || undefined}
                     onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={inputClass} />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" aria-label="To" value={custom.to} min={custom.from || undefined}
                     onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={inputClass} />
            </>
          )}
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={inputClass} aria-label="Outlet">
            <option value="">All outlets</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a driver or Driver ID…"
            className={`${inputClass} min-w-0 flex-1 basis-40`}
          />
        </div>
        {ready && (
          <p className="mt-2 text-xs text-slate-400">
            {from === to ? formatShortDate(from) : `${formatShortDate(from)} to ${formatShortDate(to)}`}
          </p>
        )}
        {mode === "custom" && !ready && (
          <p className="mt-2 text-xs text-slate-500">Pick both dates to see the figures.</p>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Tile label="Drivers" value={s.drivers} sub={`${s.drivers_with_trips} drove in this period`} />
          <Tile label="Trips" value={s.trips} />
          <Tile label="Total hours worked" value={formatDuration(s.total_worked_minutes)} sub="all drivers, finished trips" />
          <Tile label="Total cost" value={s.total_cost == null ? "—" : formatRM(s.total_cost)}
                sub={data.cost_per_hour ? `at ${formatRM(data.cost_per_hour)} an hour` : "no cost per hour set"} />
          <Tile label="Avg hours per day" value={formatDuration(s.avg_worked_minutes)} sub="across all drivers" />
          <Tile label="Avg time per trip" value={formatDuration(s.avg_trip_minutes)} sub="across all drivers" />
        </div>
      )}

      <div className={`overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200 ${loading ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    className={`px-4 py-2.5 font-semibold ${c.text ? "" : "text-right"}`}>
                  <button type="button" onClick={() => toggleSort(c.key, c.text)}
                          className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-brand-black ${c.text ? "" : "flex-row-reverse"}`}>
                    {c.label}
                    <span aria-hidden className="text-[10px] text-slate-400">
                      {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((d) => (
              <Fragment key={d.driver_id}>
              <tr className="hover:bg-slate-50">
                <td className="px-4 py-3 text-xs font-semibold tabular-nums text-slate-500">{driverCode(d.driver_id)}</td>
                <td className="px-4 py-3 font-medium text-brand-black">
                  {d.driver_name}
                  {d.status !== "active" && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Disabled</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.trips ? d.trips : <Blank />}
                  {d.open_trips > 0 && (
                    <span className="block text-[11px] text-amber-700">{d.open_trips} still open</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.total_worked_minutes == null ? <Blank /> : formatDuration(d.total_worked_minutes)}
                  {d.total_worked_minutes != null && (
                    <span className="block text-[11px] text-slate-400" title="The same time in decimal hours, which is what the cost is worked from.">
                      {(d.total_worked_minutes / 60).toFixed(2)} h
                    </span>
                  )}
                  {d.open_trips > 0 && (
                    <span className="block text-[11px] text-amber-700"
                          title="A trip that has not finished has no end to measure, so its time is not in the total.">
                      {d.open_trips} open not counted
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.total_ot_minutes == null ? (
                    <span className="text-slate-300" title={NO_LIMIT}>—</span>
                  ) : d.total_ot_minutes === 0 ? (
                    <span className="text-slate-400">0m</span>
                  ) : (
                    <span className="font-medium text-orange-800">
                      {formatDuration(d.total_ot_minutes)}
                      <span className="block text-[11px] font-normal text-slate-400">{(d.total_ot_minutes / 60).toFixed(2)} h</span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.regular_cost == null ? <span className="text-slate-300" title={costWhy(d, data)}>—</span> : formatRM(d.regular_cost)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.ot_cost == null ? (
                    <span className="text-slate-300" title={costWhy(d, data)}>—</span>
                  ) : d.ot_cost === 0 ? (
                    <span className="text-slate-400">{formatRM(0)}</span>
                  ) : (
                    <span className="font-medium text-orange-800">{formatRM(d.ot_cost)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.total_cost == null ? (
                    <span className="text-slate-300" title={data.cost_per_hour ? "No finished trips yet." : "No cost per hour is set. An admin sets it under Settings, Job management."}>—</span>
                  ) : (
                    <span className="font-medium text-brand-black">{formatRM(d.total_cost)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.avg_worked_minutes == null ? <Blank /> : formatDuration(d.avg_worked_minutes)}
                  {d.days_counted > 0 && (
                    <span className="block text-[11px] text-slate-400">over {d.days_counted} day{d.days_counted === 1 ? "" : "s"}</span>
                  )}
                  {d.days_left_out > 0 && (
                    <span className="block text-[11px] text-amber-700"
                          title="A day with a trip that has not finished has no end to measure, so it is not averaged in.">
                      {d.days_left_out} day{d.days_left_out === 1 ? "" : "s"} not finished
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.avg_trip_minutes == null ? <Blank /> : formatDuration(d.avg_trip_minutes)}
                  {d.trips > 0 && (
                    <span className="block text-[11px] text-slate-400"
                          title="A trip that has not finished has no end to measure, so it is not averaged in.">
                      {d.trips_timed} of {d.trips} trip{d.trips === 1 ? "" : "s"} finished
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {d.ot_days == null ? (
                    <span className="text-slate-300" title="No overtime limit is set. An admin sets it under Settings, Job management.">—</span>
                  ) : d.ot_days === 0 ? (
                    <span className="text-slate-500">0</span>
                  ) : (
                    // The number is the control. It opens the list of jobs it
                    // counts, so the figure can be checked rather than trusted.
                    <button
                      type="button"
                      onClick={() => toggleOt(d.driver_id)}
                      aria-expanded={openOt.has(d.driver_id)}
                      aria-controls={`ot-${d.driver_id}`}
                      title={openOt.has(d.driver_id) ? "Hide the jobs" : "Show the jobs flagged as overtime"}
                      className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-2.5 py-0.5 font-semibold text-orange-800 hover:bg-orange-200"
                    >
                      {d.ot_days}
                      <span aria-hidden className={`text-[9px] transition-transform ${openOt.has(d.driver_id) ? "rotate-180" : ""}`}>▼</span>
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-700">{d.outlet || <span className="text-slate-400">No outlet</span>}</td>
              </tr>
              {d.ot_days > 0 && openOt.has(d.driver_id) && (
                <tr id={`ot-${d.driver_id}`} className="bg-orange-50/60">
                  <td colSpan={COLUMNS.length} className="px-4 py-3">
                    <p className="mb-2 text-xs font-semibold text-orange-900">
                      {d.driver_name}: {d.ot_days} {d.ot_days === 1 ? "job" : "jobs"} over {formatDuration(data.overtime_threshold_minutes)}
                    </p>
                    <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {d.ot_jobs.map((j) => (
                        <li key={j.job_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-orange-200">
                          <span className="font-semibold text-brand-black">J-{j.job_id}</span>
                          <span className="text-slate-500">{formatDate(j.work_date)}</span>
                          <span className="tabular-nums text-slate-700">{formatDuration(j.worked_minutes)} worked</span>
                          <span className="font-semibold tabular-nums text-orange-800">+{formatDuration(j.overtime_minutes)}</span>
                          {j.open_trips > 0 && (
                            <span className="text-amber-700" title="A trip is still open, so this can still grow.">· trip open</span>
                          )}
                          {can("evidence") && (
                            <Link
                              to={`/admin/evidence?driver_id=${d.driver_id}&date_from=${j.work_date}&date_to=${j.work_date}`}
                              className="ml-auto font-medium text-brand-red hover:underline"
                            >
                              View evidence
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {data && rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-sm text-slate-500">
                  {q ? "No driver matches that name." : "No drivers to show for this outlet."}
                </td>
              </tr>
            )}
            {!data && loading && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-sm text-slate-500">Loading…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <p className="mt-3 max-w-3xl text-xs text-slate-500">
          <b className="font-semibold text-slate-600">How time per trip is worked out.</b>{" "}
          From arriving at the outlet to the end of the trip (Returned), averaged over the driver's finished trips.
          A trip still open has no end yet and is left out. Hours per day is the total of a driver's finished trips
          in a day, averaged over days where every trip has finished.
        </p>
      )}
      {data && (
        <p className="mt-2 max-w-3xl text-xs text-slate-500">
          <b className="font-semibold text-slate-600">Total hours and cost.</b>{" "}
          Total hours worked is every finished trip in the period added together, from arriving at the outlet to
          returning. A trip still open is left out. Total cost is those hours times the cost per hour
          {data.cost_per_hour ? ` (${formatRM(data.cost_per_hour)})` : ", which is not set yet. An admin sets it under Settings, Job management"}.
          {data.overtime_threshold_minutes
            ? ` Total OT hours is the time past ${formatDuration(data.overtime_threshold_minutes)} in each day, added up. Regular hours cost is the cost of the hours up to that limit and OT cost is the cost of the hours past it, at the same hourly rate, so Regular hours cost + OT cost = Total cost.`
            : " Regular hours cost and OT cost need an overtime limit, which is not set yet. An admin sets it under Settings, Job management."}
        </p>
      )}
      {data && (
        <p className="mt-2 max-w-3xl text-xs text-slate-500">
          <b className="font-semibold text-slate-600">Number of OT days.</b>{" "}
          {data.overtime_threshold_minutes
            ? `Jobs (a driver's day) in this period that worked more than ${formatDuration(data.overtime_threshold_minutes)}, the limit set under Settings, Job management. Click a number to see which jobs.`
            : "No overtime limit is set, so no job is counted. An admin sets it under Settings, Job management."}
        </p>
      )}
    </div>
  );
}
