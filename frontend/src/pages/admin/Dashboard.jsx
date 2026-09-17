import { useEffect, useState } from "react";
import { api } from "../../api";
import TrendChart from "../../components/TrendChart";
import Comparisons from "../../components/Comparisons";
import Icon from "../../components/Icon";
import { dayParts, formatDuration } from "../../lib/duration";

// The monitoring surface. Every figure answers one question: how much time did
// Lotus cost us, and can we prove it? Nothing here grows as data accumulates --
// the detail lives on the Evidence screen, so this stays readable at a glance.
//
// Colour has exactly two meanings on this page and they never mix: WHO OWNS the
// lost time (amber Lotus / blue Ninja Van / green external) and WHETHER it beat
// its target (green within / red over). Each block repeats the part of that key
// it uses, so nothing sends you back to the top.

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "l7d", label: "Last 7 days" },
  { key: "l1m", label: "Last 30 days" },
  { key: "l3m", label: "Last 90 days" },
];

const PARTY = {
  lotus: { label: "Lotus", bar: "bg-amber-500", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  njv: { label: "Ninja Van", bar: "bg-blue-600", chip: "bg-blue-100 text-blue-800", dot: "bg-blue-600" },
  external: { label: "External", bar: "bg-emerald-600", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-600" },
};

function Tile({ label, value, sub, delta, deltaBad, accent }) {
  return (
    <div className={`rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${accent ? "border-l-4 border-brand-red" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1.5 text-3xl font-semibold tabular-nums text-brand-black">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      {delta && (
        <p className={`mt-1.5 text-xs ${deltaBad ? "text-brand-red" : "text-emerald-700"}`}>{delta}</p>
      )}
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${i.dot}`} />
          <span>
            <b className="font-semibold text-slate-700">{i.label}</b>
            {i.note ? ` — ${i.note}` : ""}
          </span>
        </span>
      ))}
    </div>
  );
}

function OwnedBar({ owned }) {
  // Defaulted. A panel with a missing figure should render short, not take
  // the dashboard down with it -- which is exactly what a bare read did.
  const o = owned || {};
  const total = (o.lotus || 0) + (o.njv || 0) + (o.external || 0);
  if (!total) return <p className="mt-3 text-xs text-slate-400">No time over target in this period.</p>;
  return (
    <div className="mt-3">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100">
        {["lotus", "njv", "external"].map((p) =>
          o[p] ? <span key={p} className={PARTY[p].bar} style={{ width: `${(o[p] / total) * 100}%` }} /> : null
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 text-[11px] text-slate-500">
        {["lotus", "njv", "external"].map((p) =>
          o[p] ? <span key={p}>{PARTY[p].label} {formatDuration(o[p])}</span> : null
        )}
      </div>
    </div>
  );
}

// One line per outlet per week against the target. Drawn rather than charted by
// a library: two series and a reference line do not justify 400KB.
// target is null when time allowances are switched off, and the reference
// line is simply not drawn -- a chart should not imply a bar that is not
// being applied.
export default function Dashboard() {
  const [period, setPeriod] = useState("l7d");
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/admin/warehouses").then((d) => setWarehouses(d.warehouses)).catch(() => {});
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    const qs = new URLSearchParams({ period });
    if (warehouseId) qs.set("warehouse_id", warehouseId);
    api
      .get(`/admin/overview?${qs}`)
      .then(setData)
      .catch((err) => setError(err.detail || "could not load the dashboard"));
  }, [period, warehouseId]);

  const t = data?.totals;
  const maxReason = data?.reasons?.[0]?.minutes || 1;
  // The allowance actually in force, or null when the feature is off. Nothing
  // is painted as over target against a bar that is not being applied.
  const target = data?.at_outlet_target ?? null;
  // `window` is a sibling of `totals` in the payload, not a member of it.
  // Reading it as t.window made every tile dereference undefined and took the
  // whole dashboard down. Defaulted so a missing block can never do that
  // again -- a dashboard is not worth a blank page.
  const win = data?.window ?? {};
  const over = (v) => target != null && v != null && v > target;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-200/70 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              aria-pressed={period === p.key}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                period === p.key ? "bg-white text-brand-black shadow-sm" : "text-slate-500"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All outlets</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {data && (
        <div className="space-y-5">
          {/* Asked directly: where do these numbers come from. Answered once,
              at the top, rather than left to be inferred from four subtitles. */}
          <p className="text-xs leading-relaxed text-slate-500">
            Every figure below is calculated from the checkpoints drivers stamp on their phones — arrived,
            goods ready, loaded, departed, returned. The app subtracts one timestamp from the next to get
            the time each step took. Nothing here is typed in by hand.
            {target
              ? " A step that runs longer than its allowance is counted as a delay, and the reason the driver picks decides whether those minutes are attributed to Lotus, to us, or to neither."
              : " Per-step time allowances are switched off, so lateness is measured against the contracted delivery windows: arriving after a window opens is counted as ours, and still being there after it closes is counted as the outlet's."}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Two sources, one row. The per-step allowances are off, so
                anything measured against them is not zero -- it is unmeasured,
                and a confident "0m" beside "Delay caused by Lotus" reads as
                "nothing to claim", which is the opposite of true.
                The contracted delivery windows ARE in force and carry the same
                attribution, so while allowances are off these tiles report the
                windows and say so. Nothing on the row is a placeholder. */}
            <Tile
              accent
              label="Delay caused by Lotus"
              value={formatDuration(target ? t.owned_minutes.lotus : win.late_minutes_lotus ?? 0)}
              sub={target
                ? "Minutes a step ran over its allowance, where the driver's reason points at the outlet"
                : "Minutes a run left the outlet after its delivery window closed, beyond any late arrival of ours"}
              delta={
                target && t.owned_minutes_previous.lotus
                  ? `was ${formatDuration(t.owned_minutes_previous.lotus)} last period`
                  : null
              }
              deltaBad={t.owned_minutes.lotus > t.owned_minutes_previous.lotus}
            />
            <Tile
              label={target ? "Trips over allowance" : "Trips that missed their window"}
              value={target
                ? `${t.over_target} / ${t.trips}`
                : `${win.missed ?? 0} / ${win.trips_with_window ?? 0}`}
              sub={target
                ? (t.breach_rate !== null
                    ? `${t.breach_rate}% of trips spent longer at the outlet than allowed`
                    : "No trips in this period")
                : (win.on_time_rate != null
                    ? `${win.on_time_rate}% left inside their contracted window`
                    : "No trips with a delivery window in this period")}
            />
            <Tile
              label="Avg time at outlet"
              value={formatDuration(t.avg_at_outlet_minutes)}
              sub="Average from arriving at the outlet to leaving it"
              delta={
                t.avg_delta_minutes !== null
                  ? `${t.avg_delta_minutes > 0 ? "▲" : "▼"} ${formatDuration(Math.abs(t.avg_delta_minutes))} vs previous period`
                  : null
              }
              deltaBad={t.avg_delta_minutes > 0}
            />
            <Tile
              label="Delay caused by us"
              value={formatDuration(target ? t.owned_minutes.njv : win.late_minutes_njv ?? 0)}
              sub={target
                ? "Same measure, where the driver's reason points at Ninja Van"
                : "Minutes a run arrived after its delivery window opened — counted first, before any Lotus delay"}
            />
          </div>

          <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-base font-semibold text-brand-black">Manpower</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Daily coverage and throughput. Establishes whether our own staffing explains a slow day before
              outlet performance is questioned. Drivers on duty is derived from trips actually run.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-4">Day</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">On duty</th>
                    <th className="py-2 pr-4">Trips</th>
                    <th className="py-2 pr-4">Trips / driver</th>
                    <th className="py-2 pr-4">Orders</th>
                    <th className="py-2 pr-4">Avg at outlet</th>
                    <th className="py-2">Over target</th>
                  </tr>
                </thead>
                <tbody>
                  {data.manpower.map((d) => {
                    const day = dayParts(d.work_date);
                    return (
                      <tr key={d.work_date} className="border-t border-slate-100">
                        {/* Weekday and date in their own columns, so both line
                            up down the page instead of the weekday starting
                            wherever "Today · " happened to end. */}
                        <td className="py-2 pr-4 font-medium text-slate-500">{day.weekday}</td>
                        <td className="py-2 pr-4 whitespace-nowrap font-medium">
                          {day.date}
                          {day.relative && (
                            <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              {day.relative}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{d.on_duty}</td>
                        <td className="py-2 pr-4 tabular-nums">{d.trips}</td>
                        <td className="py-2 pr-4 tabular-nums">{d.trips_per_driver}</td>
                        <td className="py-2 pr-4 tabular-nums">{d.orders}</td>
                        <td className={`py-2 pr-4 tabular-nums ${over(d.avg_at_outlet_minutes) ? "font-semibold text-brand-red" : ""}`}>
                          {formatDuration(d.avg_at_outlet_minutes)}
                        </td>
                        <td className="py-2 tabular-nums">{d.over_target}</td>
                      </tr>
                    );
                  })}
                  {data.manpower.length === 0 && (
                    <tr><td colSpan="8" className="py-3 text-sm text-slate-400">No trips in this period.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Legend items={[
              ...(target ? [{ label: "Red figure", note: `over the ${target}m allowance`, dot: "bg-brand-red" }] : []),
            ]} />
            {/* The cut at the end of the table: the same measures, against the
                last day, the last week and the last four weeks. */}
            <Comparisons comparisons={data.comparisons} />
          </section>

          <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-base font-semibold text-brand-black">Time at outlet, by week</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Weekly average arrival-to-departure per outlet. Each point is the week beginning that date.
            </p>
            <TrendChart trend={data.trend} target={data.at_outlet_target} />
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {data.outlets.map((o) => (
              <div key={o.outlet} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-base font-semibold text-brand-black">{o.outlet}</h3>
                  <span className="text-xs text-slate-400">{o.trips} trips</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-slate-500">Avg time at outlet</dt>
                  <dd className={`text-right ${over(o.avg_at_outlet_minutes) ? "font-semibold text-brand-red" : "text-emerald-700"}`}>
                    {formatDuration(o.avg_at_outlet_minutes)}
                  </dd>
                  <dt className="text-slate-500">Trips over target</dt>
                  <dd className="text-right">{o.over_target} of {o.trips}</dd>
                  <dt className="text-slate-500">Avg jobs per trip</dt>
                  <dd className="text-right">{o.avg_jobs_per_trip}</dd>
                </dl>
                <OwnedBar owned={o.owned_minutes} />
                <Legend items={[
                  { label: "Lotus", note: "recoverable", dot: PARTY.lotus.dot },
                  { label: "Ninja Van", note: "absorbed by us", dot: PARTY.njv.dot },
                  { label: "External", note: "not attributable", dot: PARTY.external.dot },
                ]} />
              </div>
            ))}
            {data.outlets.length === 0 && (
              <p className="text-sm text-slate-400">No trips in this period.</p>
            )}
          </section>

          <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-base font-semibold text-brand-black">Delay by reason code</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Delay minutes by recorded reason, ranked by total time lost.
            </p>
            <div className="mt-4 space-y-2.5">
              {data.reasons.map((r) => (
                <div key={r.label} className="grid grid-cols-[minmax(120px,1.2fr)_minmax(0,3fr)_70px] items-center gap-3 text-sm">
                  <span className="truncate">{r.label}</span>
                  <span className="h-4 rounded bg-slate-100">
                    <span
                      className={`block h-full rounded ${PARTY[r.fault_party]?.bar || "bg-slate-400"}`}
                      style={{ width: `${Math.max(3, (r.minutes / maxReason) * 100)}%` }}
                      title={`${r.minutes} minutes across ${r.occurrences} occurrences`}
                    />
                  </span>
                  <span className="text-right text-xs text-slate-500">{formatDuration(r.minutes)}</span>
                </div>
              ))}
              {data.reasons.length === 0 && (
                <p className="text-sm text-slate-400">
                  Nothing coded yet — reasons appear here once drivers start explaining gaps that ran over.
                </p>
              )}
            </div>
            <Legend items={[
              { label: "Lotus", note: "recoverable", dot: PARTY.lotus.dot },
              { label: "Ninja Van", note: "absorbed by us", dot: PARTY.njv.dot },
              { label: "External", note: "not attributable", dot: PARTY.external.dot },
            ]} />
          </section>
        </div>
      )}
    </div>
  );
}
