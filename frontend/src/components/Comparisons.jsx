import { formatDate, formatDuration, formatShortDate } from "../lib/duration";

// Day on day, week on week, four weeks on four weeks.
//
// The table above says what happened. It never said whether that was better or
// worse than the last time, so every figure on this dashboard was a number
// without a direction -- and a commercial reader cannot take "3m average at
// outlet" into a conversation with Lotus. "3m, up from 1m last week, on twice
// the trips" is a position.
//
// Laid out as measures down and periods across. The other way round -- three
// rows of seven measures -- puts the comparison a reader came for on the
// short axis and makes them read across to find it.

// Which way is up. Trips and orders rising is the business working; time at
// outlet, missed windows and lost minutes rising is not.
const ROWS = [
  { key: "trips", label: "Trips", good: "up" },
  { key: "orders", label: "Parcels", good: "up" },
  { key: "trips_per_driver", label: "Trips per driver", good: "up", decimals: 1 },
  { key: "avg_at_outlet_minutes", label: "Avg time at outlet", good: "down", duration: true },
  { key: "missed_window", label: "Missed their window", good: "down" },
  { key: "lotus_late_minutes", label: "Delay caused by Lotus", good: "down", duration: true },
];

function show(row, value) {
  if (value == null) return "—";
  if (row.duration) return formatDuration(value);
  if (row.decimals) return value.toFixed(row.decimals);
  return String(value);
}

// "2026-09-11..2026-09-17" -> "11–17 Sep"; a single date -> "Thu 17 Sep".
function periodLabel(raw) {
  if (!raw) return "";
  if (!raw.includes("..")) return formatDate(raw);
  const [a, b] = raw.split("..");
  const left = formatShortDate(a);
  const right = formatShortDate(b);
  // Same month reads as "11–17 Sep"; across a month boundary both need naming.
  const sameMonth = left.split(" ")[1] === right.split(" ")[1];
  return sameMonth ? `${left.split(" ")[0]}–${right}` : `${left} – ${right}`;
}

// "Sep" + "1–17 Sep" -> "Sep 1–17". The month is already the name of the
// window; printing it again at the end of the range is the same word twice.
// Week prefixes (W38) never match a month, so those keep their "14–17 Sep".
function withPrefix(prefix, raw) {
  const label = periodLabel(raw);
  if (!prefix) return label;
  return label.endsWith(` ${prefix}`) ? `${prefix} ${label.slice(0, -prefix.length - 1)}` : `${prefix} ${label}`;
}

function Delta({ row, current, previous }) {
  // No prior figure is not a fall to zero. A first week has nothing to be
  // compared against and should say so rather than imply a collapse.
  if (current == null && previous == null) return <span className="text-slate-300">—</span>;
  if (previous == null) return <span className="text-xs text-slate-400">no earlier figure</span>;
  if (current == null) return <span className="text-xs text-slate-400">nothing recorded</span>;

  const diff = current - previous;
  if (Math.abs(diff) < (row.decimals ? 0.05 : 0.5)) {
    return <span className="text-sm text-slate-500">no change</span>;
  }
  const better = row.good === "up" ? diff > 0 : diff < 0;
  return (
    <span className={`text-sm font-semibold ${better ? "text-emerald-700" : "text-brand-red"}`}>
      {/* The arrow says which way, the colour says whether that is good. Both,
          because colour alone is not a signal everyone receives. */}
      {diff > 0 ? "▲" : "▼"} {show(row, Math.abs(diff))}
    </span>
  );
}

export default function Comparisons({ comparisons }) {
  if (!comparisons || comparisons.length === 0) return null;

  return (
    <div className="mt-5 border-t border-slate-200 pt-4">
      <h3 className="text-sm font-semibold text-brand-black">Against the same stretch before</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Each window runs to today and is measured against the same slice of the one before — this
        week so far against the same days last week, this month so far against the same dates last
        month. Fixed, so they read the same whichever period is selected above.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-4 font-medium">Measure</th>
              {/* Three lines, not one run of text. "Tue 15 Sep → Thu 17 Sep"
                  in small grey type makes a reader parse two dates, an arrow
                  and a dash to work out which end is now. Stacked, the period
                  being reported is the dark line and what it is measured
                  against sits under it, and the eye never has to parse. */}
              {comparisons.map((c) => (
                <th key={c.key} className="py-2 pr-6 align-bottom font-medium">
                  <span className="block text-slate-400">{c.label}</span>
                  {/* The name people say -- W38, Sep -- leads, with the dates
                      it actually covers behind it. A week number alone is
                      unverifiable; a date range alone makes the reader count
                      back to work out which week it was. */}
                  <span className="mt-1 block whitespace-nowrap text-sm font-semibold normal-case tracking-normal text-brand-black">
                    {withPrefix(c.current_prefix, c.current_label)}
                  </span>
                  <span className="block whitespace-nowrap text-xs font-normal normal-case tracking-normal text-slate-400">
                    vs {withPrefix(c.previous_prefix, c.previous_label)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 align-top">
                <td className="py-2.5 pr-4 text-slate-600">{row.label}</td>
                {comparisons.map((c) => (
                  <td key={c.key} className="py-2.5 pr-6">
                    <Delta row={row} current={c.current[row.key]} previous={c.previous[row.key]} />
                    {/* Both figures underneath, because a change with no
                        magnitudes behind it cannot be checked -- "down 40%"
                        is 5 trips or 500. Current first, matching the header:
                        one reading order for the whole block. */}
                    <span className="mt-0.5 block whitespace-nowrap text-xs tabular-nums text-slate-400">
                      {show(row, c.current[row.key])} vs {show(row, c.previous[row.key])}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {comparisons.some((c) => c.partial) && (
        <p className="mt-2 text-xs text-slate-400">
          The current side of each pair ends today, a day still being worked, so it is short by
          however much of today is left.
        </p>
      )}
    </div>
  );
}
