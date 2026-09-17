import { formatDuration } from "../lib/duration";

// Arrival and departure, split by which run of the day it was.
//
// The two facts a Lotus charge turns on: when the truck reached the outlet,
// and when it got back out. Both were already in the data -- every trip is
// stamped with its slot the moment it starts -- but every screen averaged the
// first run and the second together, which is the one thing that makes them
// unreadable. They are measured against DIFFERENT contracted windows and they
// behave nothing alike: the first run waits for goods to be picked, the
// second collects what is already staged. One mean across both answers
// neither question.
//
// Times of day, not durations. "Arrived 09:48, left 12:20" is the sentence
// someone says out loud in a meeting; "152 minutes at the outlet" is the
// same fact in a form nobody can check against a delivery window.

function Cell({ children, tone }) {
  return <td className={`py-2.5 pr-4 tabular-nums ${tone || "text-slate-600"}`}>{children}</td>;
}

// n of N, and red only when something actually missed. A bare "2 / 6" gives
// no clue which direction is good.
function OnTime({ ok, total }) {
  if (!total) return <span className="text-slate-300">—</span>;
  const missed = total - ok;
  return (
    <span className={missed ? "font-semibold text-brand-red" : "text-emerald-700"}>
      {ok} of {total}
    </span>
  );
}

export default function TripOfDay({ rows, unnumbered }) {
  if (!rows || rows.length === 0) return null;

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-base font-semibold text-brand-black">Arrival and departure, by run of the day</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        The first run of the day and the second are measured against different contracted windows,
        so they are counted separately. Times are the average across the period.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-4 font-medium">Run</th>
              <th className="py-2 pr-4 font-medium">Window</th>
              <th className="py-2 pr-4 font-medium">Trips</th>
              <th className="py-2 pr-4 font-medium">Avg arrival</th>
              <th className="py-2 pr-4 font-medium">Avg departure</th>
              <th className="py-2 pr-4 font-medium">At outlet</th>
              <th className="py-2 pr-4 font-medium">Arrived in time</th>
              <th className="py-2 pr-4 font-medium">Left in time</th>
              <th className="py-2 font-medium">Lotus / ours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slot_no} className="border-t border-slate-100">
                <td className="py-2.5 pr-4 font-medium text-brand-black">{r.label}</td>
                <Cell tone="text-slate-500">
                  {r.window_start ? `${r.window_start}–${r.window_end}` : "none set"}
                </Cell>
                <Cell>{r.trips}</Cell>
                {/* A time averaged over fewer trips than the run had is a
                    weaker figure, and the count says so rather than leaving
                    it to be assumed. */}
                <Cell tone="font-semibold text-brand-black">
                  {r.avg_arrival || "—"}
                  {r.arrivals_recorded > 0 && r.arrivals_recorded < r.trips && (
                    <span className="ml-1 text-[11px] font-normal text-slate-400">
                      of {r.arrivals_recorded}
                    </span>
                  )}
                </Cell>
                <Cell tone="font-semibold text-brand-black">
                  {r.avg_departure || "—"}
                  {r.departures_recorded > 0 && r.departures_recorded < r.trips && (
                    <span className="ml-1 text-[11px] font-normal text-slate-400">
                      of {r.departures_recorded}
                    </span>
                  )}
                </Cell>
                <Cell>{r.avg_at_outlet_minutes == null ? "—" : formatDuration(r.avg_at_outlet_minutes)}</Cell>
                <Cell><OnTime ok={r.arrived_on_time} total={r.arrivals_with_window} /></Cell>
                <Cell><OnTime ok={r.departed_on_time} total={r.departures_with_window} /></Cell>
                {/* Both sides of the split, always. A Lotus figure shown on
                    its own invites the question the next column answers. */}
                <td className="py-2 tabular-nums">
                  <span className={r.lotus_late_minutes ? "font-semibold text-amber-700" : "text-slate-400"}>
                    {formatDuration(r.lotus_late_minutes)}
                  </span>
                  <span className="text-slate-300"> / </span>
                  <span className={r.njv_late_minutes ? "font-semibold text-blue-700" : "text-slate-400"}>
                    {formatDuration(r.njv_late_minutes)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
          <b className="font-semibold text-slate-700">Lotus</b> — still at the outlet after the window closed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-blue-600" />
          <b className="font-semibold text-slate-700">Ours</b> — arrived after the window opened, counted first
        </span>
      </div>

      {/* Trips from before runs were numbered. Said out loud so the rows
          above always add up to the trip count on the tiles. */}
      {unnumbered > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {unnumbered} trip{unnumbered === 1 ? "" : "s"} in this period {unnumbered === 1 ? "is" : "are"} not
          numbered by run and {unnumbered === 1 ? "is" : "are"} left out of this table.
        </p>
      )}
    </section>
  );
}
