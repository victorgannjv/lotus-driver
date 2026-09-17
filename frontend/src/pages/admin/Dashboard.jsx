import { useEffect, useState } from "react";
import { api } from "../../api";
import TrendChart from "../../components/TrendChart";
import Comparisons from "../../components/Comparisons";
import TripOfDay from "../../components/TripOfDay";
import SectionNote, { NoteItem } from "../../components/SectionNote";
import Icon from "../../components/Icon";
import { dayParts, formatDate, formatDuration } from "../../lib/duration";

// The monitoring surface. Every figure answers one question: how much time did
// Lotus cost us, and can we prove it? Nothing here grows as data accumulates --
// the detail lives on the Evidence screen, so this stays readable at a glance.
//
// Colour has exactly two meanings on this page and they never mix: WHO OWNS the
// lost time (amber Lotus / blue Ninja Van / green external) and WHETHER it beat
// its target (green within / red over). Each block repeats the part of that key
// it uses, so nothing sends you back to the top.

// The periods people actually ask for.
//
// "Last 30 days" and "Last 90 days" were rolling windows, which read fine as a
// tab and badly as an answer: a rolling 30 days straddles two months, so no
// figure under it matches anything in a monthly report, and the trend chart
// had no natural grain to group by. A named month does -- "September" is a
// thing both sides of a dispute can look up.
//
// Ninety days is gone entirely. Anything longer than a month is a question
// with its own dates, so it gets a date range instead of a tab pretending to
// know which ninety days were meant.
const QUICK_PERIODS = [
  { key: "today", label: "Today" },
  { key: "l7d", label: "Last 7 days" },
];

const BUCKET_WORD = { day: "day", week: "week", month: "month" };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];

// "2026-09" -> "September 2026". The months themselves come from the server,
// which knows which ones hold trips; counting twelve back from today offered
// November 2025 on an app that did not exist then, and every one of those
// options answered with an empty dashboard.
function monthLabel(value) {
  const [y, m] = value.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A month runs to its last day, or to today when it is the month we are in --
// asking the server for dates that have not happened yet invites a comparison
// against an empty future.
function monthRange(value) {
  const [y, m] = value.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { from: isoDate(start), to: isoDate(last > today ? today : last) };
}

// One place that turns the chosen period into query parameters, so the tiles,
// the tables and the chart can never be looking at different spans.
function periodQuery(range) {
  const qs = new URLSearchParams();
  if (range.mode === "month") {
    const { from, to } = monthRange(range.month);
    qs.set("date_from", from);
    qs.set("date_to", to);
  } else if (range.mode === "custom" && range.from && range.to) {
    qs.set("date_from", range.from);
    qs.set("date_to", range.to);
  } else {
    qs.set("period", range.mode === "today" ? "today" : "l7d");
  }
  return qs;
}

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
  const [range, setRange] = useState({ mode: "l7d" });
  // What the app actually holds, so the pickers can only offer that.
  const [span, setSpan] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/admin/warehouses").then((d) => setWarehouses(d.warehouses)).catch(() => {});
    api.get("/admin/data-range").then(setSpan).catch(() => {});
  }, []);

  // Depends on the query string, not the range object -- that is rebuilt every
  // render and would refetch forever as a dependency.
  const overviewQs = (() => {
    const qs = periodQuery(range);
    if (warehouseId) qs.set("warehouse_id", warehouseId);
    return qs.toString();
  })();

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .get(`/admin/overview?${overviewQs}`)
      .then(setData)
      .catch((err) => setError(err.detail || "could not load the dashboard"));
  }, [overviewQs]);

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
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1">
          {QUICK_PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setRange({ mode: p.key })}
              aria-pressed={range.mode === p.key}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                range.mode === p.key ? "bg-white text-brand-black shadow-sm" : "text-slate-500"
              }`}
            >
              {p.label}
            </button>
          ))}
          {/* A month is chosen, not toggled, so it is a select that switches
              the mode as a side effect of picking one -- rather than a tab you
              press and then a second control you have to find. */}
          <select
            value={range.mode === "month" ? range.month : ""}
            onChange={(e) => setRange({ mode: "month", month: e.target.value })}
            aria-label="A whole month"
            disabled={!span?.months?.length}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
              range.mode === "month" ? "bg-white text-brand-black shadow-sm" : "bg-transparent text-slate-500"
            }`}
          >
            <option value="" disabled>Month…</option>
            {(span?.months || []).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setRange((r) => (r.mode === "custom" ? r : { mode: "custom", from: "", to: "" }))}
            aria-pressed={range.mode === "custom"}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
              range.mode === "custom" ? "bg-white text-brand-black shadow-sm" : "text-slate-500"
            }`}
          >
            Date range
          </button>
        </div>

        {/* Shown only once that mode is chosen. Both dates are needed before
            anything is fetched -- a half-entered range would otherwise reload
            the whole dashboard against a span nobody asked for. */}
        {/* Bounded by the days that actually hold trips, so the browser's own
            calendar greys out everything before the first run and after the
            last one. Picking a date with nothing behind it and getting an
            empty dashboard back reads as a broken dashboard. */}
        {range.mode === "custom" && (
          <span className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <input type="date" value={range.from || ""}
                   min={span?.first_date || undefined}
                   max={range.to || span?.last_date || undefined}
                   onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                   aria-label="From"
                   className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            to
            <input type="date" value={range.to || ""}
                   min={range.from || span?.first_date || undefined}
                   max={span?.last_date || undefined}
                   onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                   aria-label="To"
                   className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            {(!range.from || !range.to) && (
              <span className="text-xs text-slate-400">
                Pick both dates — showing the last 7 days until you do.
                {span?.first_date && ` Trips run from ${formatDate(span.first_date)} to ${formatDate(span.last_date)}.`}
              </span>
            )}
          </span>
        )}
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
          {/* Where the numbers come from, and how lateness is judged. Both
              have to be answered somewhere, and the four tile subtitles
              cannot carry it between them.
              It was one paragraph of five clauses doing four jobs: the
              source, the arithmetic, which basis is in force, and the
              attribution rule. Nobody reads that standing up. Two short
              lines now say the part you need every time; the mechanics sit
              behind a disclosure for the once you need them. */}
          <SectionNote
            label="How these are worked out"
            more={<>
              <NoteItem term="The steps.">
                Arrived · goods ready · loaded · departed · returned. The app subtracts one stamp from
                the next to get how long each took.
              </NoteItem>
              <NoteItem term="Arriving late is ours.">
                A run that reaches the outlet after its window has opened is counted against Ninja Van.
              </NoteItem>
              <NoteItem term="Still there at closing is the outlet's.">
                Time after the window closes is counted against Lotus — but our own late arrival is
                deducted first, so a claim never bills them for a start we were late to.
              </NoteItem>
              {target ? (
                <NoteItem term="Steps over their limit.">
                  A step that runs longer than its time limit is a delay too, and the reason the driver
                  gives decides whether those minutes sit with Lotus, with us, or with neither.
                </NoteItem>
              ) : (
                <NoteItem term="Why the limits are off.">
                  The per-step figures are internal working assumptions, not terms agreed with Lotus.
                  Until they are, no step is judged on its own length.
                </NoteItem>
              )}
            </>}
          >
            Every figure comes from checkpoints drivers stamp on their phones — nothing is typed in by
            hand. {target
              ? "Lateness is judged against the delivery window for the run and the time limit on each step."
              : "Lateness is judged against the contracted delivery window for each run."}
          </SectionNote>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Two sources, one row. The per-step limits are off, so
                anything measured against them is not zero -- it is unmeasured,
                and a confident "0m" beside "Delay caused by Lotus" reads as
                "nothing to claim", which is the opposite of true.
                The contracted delivery windows ARE in force and carry the same
                attribution, so while the limits are off these tiles report the
                windows and say so. Nothing on the row is a placeholder. */}
            <Tile
              accent
              label="Delay caused by Lotus"
              value={formatDuration(target ? t.owned_minutes.lotus : win.late_minutes_lotus ?? 0)}
              sub={target
                ? "Minutes a step ran over its time limit, where the driver's reason points at the outlet"
                : "Minutes a run left the outlet after its delivery window closed, beyond any late arrival of ours"}
              delta={
                target && t.owned_minutes_previous.lotus
                  ? `was ${formatDuration(t.owned_minutes_previous.lotus)} last period`
                  : null
              }
              deltaBad={t.owned_minutes.lotus > t.owned_minutes_previous.lotus}
            />
            <Tile
              label={target ? "Trips over the limit" : "Trips that missed their window"}
              value={target
                ? `${t.over_target} / ${t.trips}`
                : `${win.missed ?? 0} / ${win.trips_with_window ?? 0}`}
              sub={target
                ? (t.breach_rate !== null
                    ? `${t.breach_rate}% of trips were at the outlet longer than the limit`
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

          <TripOfDay rows={data.trip_of_day} unnumbered={data.trips_unnumbered}
                     from={data.period?.from} to={data.period?.to} />

          <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-base font-semibold text-brand-black">Manpower</h2>
            <SectionNote
              more={<>
                <NoteItem term="Why it is here.">
                  It answers the staffing question before the outlet one — a slow day with two drivers
                  out is ours, not Lotus's, and this is where you can tell.
                </NoteItem>
                <NoteItem term="On duty.">
                  Counted from trips actually run, not from a roster. A driver who was scheduled and did
                  not drive does not appear.
                </NoteItem>
              </>}
            >
              A row per day: who drove, how much they carried, and how long they spent at the outlet.
            </SectionNote>
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
              ...(target ? [{ label: "Red figure", note: `over the ${target}m limit`, dot: "bg-brand-red" }] : []),
            ]} />
            {/* The cut at the end of the table: the same measures, against the
                last day, the last week and the last four weeks. */}
            <Comparisons comparisons={data.comparisons} />
          </section>

          <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {/* The grain follows the period: a week of work reads day by day,
                a quarter reads month by month. It used to be weekly whatever
                was selected, which is why a seven-day view drew two dots. */}
            <h2 className="text-base font-semibold text-brand-black">
              Time at outlet, by {BUCKET_WORD[data.trend_bucket] || "week"}
            </h2>
            <SectionNote
              more={<>
                <NoteItem term="Each point.">
                  Covers the whole {BUCKET_WORD[data.trend_bucket] || "week"} it is labelled with, in its real
                  place on the timeline — a gap means the fleet did not run, not that it scored zero.
                </NoteItem>
                <NoteItem term="The grain follows the period.">
                  Day by day for a week or a month, week by week beyond that, month by month for a long
                  range. Change the period above and this regroups.
                </NoteItem>
                <NoteItem term="Three outlets at most.">
                  A fourth line cannot be told from the others by colour, so the busiest three are drawn
                  and the rest are named under the chart.
                </NoteItem>
              </>}
            >
              Average time from arriving at an outlet to leaving it, one line per outlet.
            </SectionNote>
            {/* The period bounds, so the axis is the span you selected rather
                than just the days that came back with trips. */}
            <TrendChart trend={data.trend} target={data.at_outlet_target} bucket={data.trend_bucket}
                        from={data.period?.from} to={data.period?.to} />
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
            {/* The minutes mean one of two things and the note says which.
                With the limits off there is no bar to be over, so the figure
                is the length of the step the driver explained. */}
            <SectionNote
              more={<>
                <NoteItem term="What the minutes are.">
                  {data.reasons_over_allowance
                    ? "The time a step ran past its limit — the overage, not the whole step."
                    : "The whole length of the step the reason explains. With per-step time limits off there is no bar to be over, so there is no overage to measure."}
                </NoteItem>
                <NoteItem term="Where they come from.">
                  A driver picks a coded reason against a step. Nothing here is typed free-hand, which is
                  what makes these totals addable in the first place.
                </NoteItem>
                <NoteItem term="The colours.">
                  Who the reason points at — amber Lotus, blue Ninja Van, green external. That tagging
                  lives on the reason code, in Settings › Delay reasons.
                </NoteItem>
              </>}
            >
              Where the time went, by the reason the driver gave, ranked by total.
            </SectionNote>
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
                  {/* "gaps that ran over" described the old, broken rule --
                      with the limits off nothing ever ran over, so this line
                      was telling people to wait for something that could not
                      happen. Any coded reason lands here now. */}
                  No reasons recorded in this period — they appear here as soon as drivers start
                  giving them on their trips.
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
