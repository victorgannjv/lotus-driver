import { useState } from "react";
import { formatDate, formatDuration, formatShortDate } from "../lib/duration";

// Weekly average time at outlet, one line per outlet.
//
// The old version of this chart was unreadable for three reasons, and the
// colours were the least of them:
//
//   1. The y-axis was pinned to a 90-minute floor whatever the data did, so a
//      fleet averaging two minutes at the outlet drew both lines flat along the
//      baseline with nine tenths of the plot empty. The axis now follows the
//      data (and the allowance line, when there is one).
//   2. Both series printed their name at the same y, so the two outlets sat on
//      top of each other and neither could be read. End labels are now pushed
//      apart before they are drawn.
//   3. There was no legend at all -- identity came from colour alone, plus
//      those colliding labels.
//
// It also had no hover layer, so the only values you could read were the two
// the axis happened to land on.

// Outlet identity. Assigned in this fixed order and never cycled, so an outlet
// keeps its colour when another one is filtered out.
//
// Violet / orange / aqua, validated as a set: every pair clears the
// colourblind separation floor and the normal-vision floor. Blue, amber,
// emerald and red are deliberately absent -- on this page those four already
// mean Ninja Van, Lotus, external and over-target, and an outlet is not a
// fault party. Aqua sits just under 3:1 against white, which is why the chart
// ships visible labels and a table rather than relying on the colour.
const SERIES = ["#4a3aa7", "#eb6834", "#1baf7a"];

// Three is the cap. A fourth hue cannot be told apart from one of these three
// by a reader with full colour vision, let alone without it -- so past three
// the chart plots the busiest outlets and sends the rest to the table, rather
// than inventing a colour nobody can read.
const MAX_SERIES = 3;

// What one point stands for, said in the fewest words that are still true.
//
// The axis used to print the week's START date -- "7 Sep" under a point
// covering the 7th to the 13th. That is a date which is true of one day out
// of seven, and a reader in a seven-day view quite reasonably read it as a
// single day. A point names its whole span now, at whatever grain the
// dashboard is grouping by.
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];

function bucketLabel(point, bucket, { long = false } = {}) {
  if (!point) return "";
  if (bucket === "month") {
    const m = Number(point.bucket_start.slice(5, 7)) - 1;
    const name = MONTHS_LONG[m] || "";
    return long ? name : name.slice(0, 3);
  }
  if (bucket === "week") {
    const a = formatShortDate(point.bucket_start);
    const b = formatShortDate(point.bucket_end);
    // "8–14 Sep" inside one month, "29 Sep – 5 Oct" across two.
    return a.split(" ")[1] === b.split(" ")[1] ? `${a.split(" ")[0]}–${b}` : `${a} – ${b}`;
  }
  return long ? formatDate(point.bucket_start) : formatShortDate(point.bucket_start);
}

const BUCKET_NOUN = { day: "day", week: "week", month: "month" };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

// Every slot in the selected period, in order, whether or not it holds trips.
//
// Falls back to the buckets the server sent when the period bounds are not
// available -- which keeps the chart working rather than blanking it, though
// the spacing is then only as good as the data is dense.
function axisFor(from, to, bucket, trend) {
  if (!from || !to) {
    const seen = new Map();
    [...trend]
      .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start))
      .forEach((t) => seen.set(t.bucket_start, { bucket_start: t.bucket_start, bucket_end: t.bucket_end }));
    return [...seen.values()];
  }

  const end = parse(to);
  const out = [];
  let cur = parse(from);
  if (bucket === "week") cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - ((cur.getDay() + 6) % 7));
  if (bucket === "month") cur = new Date(cur.getFullYear(), cur.getMonth(), 1);

  // A hard stop as well as the date test: a bug in the step would otherwise
  // hang the tab rather than draw a wrong chart.
  while (cur <= end && out.length < 400) {
    let last;
    if (bucket === "day") last = cur;
    else if (bucket === "week") last = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 6);
    else last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    out.push({ bucket_start: iso(cur), bucket_end: iso(last) });
    if (bucket === "day") cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    else if (bucket === "week") cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7);
    else cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return out;
}

const INK = { axis: "#94a3b8", grid: "#e2e8f0", label: "#1e293b", tick: "#64748b" };

// Steps a person reading minutes would choose. 7m and 23m are arithmetically
// fine and read as noise on an axis.
const STEPS = [1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440];

// An axis that fits the data instead of a number picked at build time.
function scaleFor(peak) {
  // A little headroom, so the highest point is not welded to the top frame.
  const wanted = peak * 1.15;
  if (!(wanted > 0)) return { max: 10, ticks: [0, 5, 10] };
  const step = STEPS.find((s) => wanted / s <= 4) || STEPS[STEPS.length - 1];
  const max = Math.max(step, Math.ceil(wanted / step) * step);
  const ticks = [];
  for (let v = 0; v <= max + 0.001; v += step) ticks.push(v);
  return { max, ticks };
}

// Two labels at the same height are one unreadable label. Walk them in order
// and push each one far enough below the last to be legible, then slide the
// whole stack back up if it has run off the bottom.
function spread(labels, minGap, top, bottom) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i].y - sorted[i - 1].y;
    if (gap < minGap) sorted[i].y = sorted[i - 1].y + minGap;
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].y - bottom : 0;
  if (overflow > 0) sorted.forEach((l) => { l.y = Math.max(top, l.y - overflow); });
  return sorted;
}

export default function TrendChart({ trend, target, bucket = "week", from, to }) {
  const [hover, setHover] = useState(null); // axis slot under the pointer

  // THE AXIS IS THE PERIOD, NOT THE ROWS THAT CAME BACK.
  //
  // Built from the data, a September with trips on the 11th, 14th, 15th and
  // 17th drew four points at even spacing -- so a three-day gap looked
  // exactly like a one-day gap, and picking "September" gave a chart of four
  // anonymous columns rather than a month. Spacing that does not mean
  // anything is worse than no spacing at all on a chart about time.
  //
  // So the axis runs across the whole selected period at the chosen grain,
  // every slot in its real place. Days the fleet did not run are empty slots
  // -- visible as gaps, which is information, not absences to be closed up.
  const spans = axisFor(from, to, bucket, trend);
  const weeks = spans.map((s) => s.bucket_start);

  // Busiest outlets first, so the three that get drawn are the three that
  // carry the most trips rather than whichever came back first.
  const weight = {};
  trend.forEach((t) => {
    weight[t.outlet] = (weight[t.outlet] || 0) + (t.trips || 1);
  });
  const ranked = [...new Set(trend.map((t) => t.outlet))].sort((a, b) => weight[b] - weight[a]);
  const outlets = ranked.slice(0, MAX_SERIES);
  const folded = ranked.slice(MAX_SERIES);

  const valueAt = (outlet, week) => {
    const row = trend.find((t) => t.outlet === outlet && t.bucket_start === week);
    return row ? row.avg_at_outlet_minutes : null;
  };

  // Counted on the slots that hold trips, not on the axis. The axis now spans
  // the whole period, so September always has thirty slots -- but one day of
  // trips inside it is still not a trend.
  const withData = new Set(trend.map((t) => t.bucket_start));
  if (weeks.filter((w) => withData.has(w)).length < 2) {
    const noun = BUCKET_NOUN[bucket] || "week";
    return (
      <p className="mt-3 text-xs text-slate-400">
        Trips on only one {noun} in this period. A trend needs at least two, so widen the period
        above or come back when there are more.
      </p>
    );
  }

  const W = 680, H = 230, L = 52, R = 104, T = 16, B = 34;
  const pw = W - L - R, ph = H - T - B;
  const peak = Math.max(0, ...trend.map((t) => t.avg_at_outlet_minutes || 0), target || 0);
  const { max, ticks } = scaleFor(peak);
  // About eight labels is what fits; past that they overlap and stop being
  // readable, which is worse than being absent.
  const labelStep = Math.max(1, Math.ceil(weeks.length / 8));
  const x = (i) => L + (pw * i) / Math.max(1, weeks.length - 1);
  const y = (v) => T + ph - (ph * v) / max;

  // End-of-line labels, collision-resolved before anything is drawn.
  const endLabels = spread(
    outlets
      .map((o, oi) => {
        const last = [...weeks].reverse().find((w) => valueAt(o, w) != null);
        return last == null
          ? null
          : { outlet: o, colour: SERIES[oi], y: y(valueAt(o, last)) + 4 };
      })
      .filter(Boolean),
    15, T + 6, T + ph,
  );

  return (
    <div className="mt-4">
      {/* A legend, always, for two or more series. The end labels supplement
          it; they are not a substitute, because they only work where the
          lines happen to end apart. */}
      {outlets.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {outlets.map((o, oi) => (
            <span key={o} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="h-0.5 w-4 rounded-full" style={{ background: SERIES[oi] }} />
              {o}
            </span>
          ))}
          {target != null && (
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" />
              limit {formatDuration(target)}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="relative min-w-[520px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
               aria-label="Average time at outlet per week, by outlet"
               onMouseLeave={() => setHover(null)}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={L} y1={y(v)} x2={L + pw} y2={y(v)} stroke={INK.grid} strokeWidth="1" />
                <text x={L - 10} y={y(v) + 4} textAnchor="end" fontSize="11" fill={INK.axis}>
                  {formatDuration(v)}
                </text>
              </g>
            ))}

            {/* Dashed because it IS a threshold, which is the one thing a
                dashed rule in a chart should mean. */}
            {target != null && (
              <line x1={L} y1={y(target)} x2={L + pw} y2={y(target)}
                    stroke={INK.axis} strokeWidth="2" strokeDasharray="5 4" />
            )}

            {/* Thinned so they never collide: a month of daily points is
                thirty labels in the width of eight. The first and last always
                survive, and the one under the pointer is always drawn --
                otherwise hovering a point whose label was thinned away tells
                you nothing about where you are. */}
            {spans.map((sp, i) => {
              const show = i === 0 || i === spans.length - 1 || i % labelStep === 0 || hover === i;
              if (!show) return null;
              return (
                <text key={sp.bucket_start} x={x(i)} y={H - 12} textAnchor="middle" fontSize="11"
                      fill={hover === i ? INK.label : INK.tick}
                      fontWeight={hover === i ? 600 : 400}>
                  {bucketLabel(sp, bucket)}
                </text>
              );
            })}

            {/* The crosshair finds the week; nobody aims at a 2px line. */}
            {hover != null && (
              <line x1={x(hover)} y1={T} x2={x(hover)} y2={T + ph} stroke={INK.axis} strokeWidth="1" />
            )}

            {outlets.map((o, oi) => {
              const pts = weeks
                .map((w, i) => (valueAt(o, w) == null ? null : `${x(i)},${y(valueAt(o, w))}`))
                .filter(Boolean);
              if (!pts.length) return null;
              return (
                <g key={o}>
                  <polyline points={pts.join(" ")} fill="none" stroke={SERIES[oi]} strokeWidth="2"
                            strokeLinejoin="round" strokeLinecap="round" />
                  {weeks.map((w, i) => {
                    const v = valueAt(o, w);
                    if (v == null) return null;
                    return (
                      <circle key={w} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4}
                              fill={SERIES[oi]} stroke="#fff" strokeWidth="2" />
                    );
                  })}
                </g>
              );
            })}

            {/* Names ride the marks in slate, not in the series colour -- the
                coloured dot beside them is what carries identity. */}
            {endLabels.map((l) => (
              <text key={l.outlet} x={L + pw + 10} y={l.y} fontSize="12" fontWeight="600" fill={INK.label}>
                {l.outlet}
              </text>
            ))}

            {/* One hit band per week, the full height of the plot, so the
                pointer only has to be near the right week. */}
            {weeks.map((w, i) => {
              const half = pw / Math.max(1, (weeks.length - 1) * 2);
              return (
                <rect key={w} x={Math.max(L, x(i) - half)} y={T}
                      width={Math.min(half * 2, pw)} height={ph} fill="transparent"
                      onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}
                      tabIndex={0} role="button"
                      aria-label={`Week of ${formatShortDate(w)}`} />
              );
            })}
          </svg>

          {/* Value first, outlet second: the reader already knows which week
              they are pointing at and wants the number. */}
          {hover != null && (
            <div
              className="pointer-events-none absolute z-10 w-max -translate-x-1/2 rounded-lg bg-brand-black/95 px-3 py-2 text-white shadow-lg"
              style={{
                left: `${((x(hover) / W) * 100).toFixed(2)}%`,
                top: `${((T + 8) / H) * 100}%`,
              }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
                {bucketLabel(spans[hover], bucket, { long: true })}
              </p>
              <ul className="mt-1 space-y-0.5">
                {outlets.map((o, oi) => (
                  <li key={o} className="flex items-center gap-2 text-xs">
                    <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: SERIES[oi] }} />
                    <span className="font-semibold tabular-nums">
                      {valueAt(o, weeks[hover]) == null ? "—" : formatDuration(valueAt(o, weeks[hover]))}
                    </span>
                    <span className="text-white/70">{o}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {folded.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Showing the {MAX_SERIES} busiest outlets. {folded.join(", ")}{" "}
          {folded.length === 1 ? "is" : "are"} in the table below.
        </p>
      )}

      {/* The table is not a fallback, it is the other half of the chart: every
          value reachable without hovering, and the way anyone reads a figure
          they intend to put in front of Lotus. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-brand-black">
          Show the numbers
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1.5 pr-4 font-medium">
                  {bucket === "month" ? "Month" : bucket === "week" ? "Week" : "Day"}
                </th>
                {ranked.map((o) => <th key={o} className="py-1.5 pr-4 font-medium">{o}</th>)}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {spans.map((sp) => {
                const w = sp.bucket_start;
                return (
                <tr key={w} className="border-t border-slate-100">
                  <td className="py-1.5 pr-4 whitespace-nowrap text-slate-600">
                    {bucketLabel(sp, bucket, { long: true })}
                  </td>
                  {ranked.map((o) => (
                    <td key={o} className="py-1.5 pr-4">
                      {valueAt(o, w) == null ? "—" : formatDuration(valueAt(o, w))}
                    </td>
                  ))}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
