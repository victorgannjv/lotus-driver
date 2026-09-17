import { dayParts, formatDate, formatDuration, formatShortDate } from "../lib/duration";

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

// The two halves of a period label, kept apart.
//
// "Thu 17 Sep" as one run of text puts the weekday and the date in the same
// weight and the same colour, so the eye has nothing to catch and reads a
// four-word blur. Every one of these labels is really a NAME and a SPAN --
// Thu / 17 Sep, W38 / 14-17 Sep, Sep / 1-17 -- and separating them is the
// same fix the day column in the table above needed.
function labelParts(prefix, raw) {
  if (!raw) return { name: "", span: "" };
  if (!raw.includes("..")) {
    const d = dayParts(raw);
    return { name: d.weekday, span: d.date };
  }
  const label = periodLabel(raw);
  if (prefix && label.endsWith(` ${prefix}`)) {
    // "1–17 Sep" under the name "Sep" would say September twice.
    return { name: prefix, span: label.slice(0, -prefix.length - 1) };
  }
  return { name: prefix || "", span: label };
}

// Two different typefaces' worth of difference, not just a space.
//
// Same size, same weight, same colour, one space apart is what made "Thu 17
// Sep" read as a blur. The name is set small, spaced and upper-case in grey;
// the dates stay full size and near-black. They no longer look like one
// phrase, which is the point -- they are not one.
function PeriodLabel({ prefix, raw, muted }) {
  const { name, span } = labelParts(prefix, raw);
  return (
    <span className="inline-flex items-baseline gap-2">
      {name && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{name}</span>
      )}
      <span className={muted ? "text-slate-500" : "text-brand-black"}>{span}</span>
    </span>
  );
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

  // A window with no trips before it is not a comparison.
  //
  // September against an August this app did not exist for produced "▲ 34
  // (34 vs 0)" -- which reads as growth and is really just the difference
  // between existing and not. Every figure in that column was a number
  // measured against nothing, and a column of those next to two real ones
  // makes the real ones look like the same kind of claim.
  //
  // So the column is dropped and the reason is printed. Missing beats wrong.
  const usable = comparisons.filter((c) => (c.previous?.trips || 0) > 0);
  const empty = comparisons.filter((c) => (c.previous?.trips || 0) === 0);

  if (usable.length === 0) {
    return (
      <div className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-brand-black">Against the same stretch before</h3>
        <p className="mt-1 text-xs text-slate-500">
          Nothing to compare against yet — there are no trips in any of the earlier windows. Day on
          day appears after two days of trips, week on week after two weeks, month on month after
          two months.
        </p>
      </div>
    );
  }

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
              {usable.map((c) => (
                <th key={c.key} className="py-2 pr-6 align-bottom font-medium">
                  <span className="block text-slate-400">{c.label}</span>
                  {/* The name people say -- W38, Sep -- leads, with the dates
                      it actually covers behind it. A week number alone is
                      unverifiable; a date range alone makes the reader count
                      back to work out which week it was. */}
                  <span className="mt-1 block whitespace-nowrap text-sm font-semibold normal-case tracking-normal">
                    <PeriodLabel prefix={c.current_prefix} raw={c.current_label} />
                  </span>
                  <span className="block whitespace-nowrap text-xs font-normal normal-case tracking-normal text-slate-400">
                    vs <PeriodLabel prefix={c.previous_prefix} raw={c.previous_label} muted />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-t border-slate-100 align-top">
                <td className="py-2.5 pr-4 text-slate-600">{row.label}</td>
                {usable.map((c) => (
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

      {/* Named, not silently absent. A column that vanishes without a word
          looks like something failed to load. */}
      {empty.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {empty.map((c) => c.label).join(" and ")} {empty.length === 1 ? "is" : "are"} not shown:
          no trips in {empty.map((c) => periodLabel(c.previous_label)).join(" or ")} to compare against.
        </p>
      )}

      {usable.some((c) => c.partial) && (
        <p className="mt-2 text-xs text-slate-400">
          The current side of each pair ends today, a day still being worked, so it is short by
          however much of today is left.
        </p>
      )}
    </div>
  );
}
