import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { formatDuration, formatShortDate } from "../../lib/duration";
import { driverCode } from "../../lib/ids";

// One row per driver: how much they drove, how long they work in a day, how
// fast they go, and where they are based.
//
// The figures that depend on something being recorded say how much they rest
// on, in small type under the number. "6h 12m" on one day's work and "6h 12m"
// on twenty are not the same claim, and a speed measured on two trips out of
// nine should not read like one measured on all nine.

const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeFor(mode, custom) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (mode === "custom") return { from: custom.from, to: custom.to };
  if (mode === "month") return { from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(today) };
  const days = mode === "l7d" ? 7 : 30;
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { from: isoDate(start), to: isoDate(today) };
}

const MODES = [
  ["l7d", "Last 7 days"],
  ["l30d", "Last 30 days"],
  ["month", "This month"],
  ["custom", "Custom"],
];

const COLUMNS = [
  { key: "driver_id", label: "Driver ID", text: true },
  { key: "driver_name", label: "Driver", text: true },
  { key: "trips", label: "Trips" },
  { key: "avg_worked_minutes", label: "Avg hours per day" },
  { key: "avg_speed_kmh", label: "Avg speed per trip" },
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

  const toggleSort = (key, text) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: text ? "asc" : "desc" }));

  const s = data?.summary;

  return (
    <div>
      <div className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-base font-semibold text-brand-black">Driver performance</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          How each driver is doing over the period: trips done, the hours they work in a day, and how
          fast they drive between the outlet and their drops.
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
            {formatShortDate(from)} to {formatShortDate(to)}
          </p>
        )}
        {mode === "custom" && !ready && (
          <p className="mt-2 text-xs text-slate-500">Pick both dates to see the figures.</p>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Drivers" value={s.drivers} sub={`${s.drivers_with_trips} drove in this period`} />
          <Tile label="Trips" value={s.trips} />
          <Tile label="Avg hours per day" value={formatDuration(s.avg_worked_minutes)} sub="across all drivers" />
          <Tile label="Avg speed per trip" value={s.avg_speed_kmh == null ? "—" : `${s.avg_speed_kmh} km/h`} sub="across all drivers" />
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
              <tr key={d.driver_id} className="hover:bg-slate-50">
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
                  {d.avg_speed_kmh == null ? <Blank /> : `${d.avg_speed_kmh} km/h`}
                  {d.trips > 0 && (
                    <span className="block text-[11px] text-slate-400"
                          title="Trips with a GPS fix at the outlet and on return, which a speed needs.">
                      {d.speed_trips} of {d.trips} trip{d.trips === 1 ? "" : "s"} measured
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-700">{d.outlet || <span className="text-slate-400">No outlet</span>}</td>
              </tr>
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
          <b className="font-semibold text-slate-600">How speed is worked out.</b>{" "}
          Distance between GPS fixes (the outlet, each drop in the order it was closed, then back to the outlet),
          divided by the time from Departed to Returned, so time stopped at a drop counts. Straight lines cut
          corners, so it reads lower than the real road speed. Use it to compare drivers on similar runs, not as a
          speedometer. A trip with no GPS fix at the outlet or on return is left out, and each row says how
          many trips it rests on.
        </p>
      )}
    </div>
  );
}
