import { formatDuration } from "../lib/duration";

// Arrival and departure, split by which run of the day it was.
//
// The two facts a Lotus charge turns on: when the truck reached the outlet,
// and when it got back out. Both were already in the data -- every trip is
// stamped with its slot the moment it starts -- but every screen averaged the
// first run and the second together. They are measured against DIFFERENT
// contracted windows and behave nothing alike: the first waits for goods to
// be picked, the second collects what is already staged. One mean across
// both answers neither question.
//
// EVERY TIME IS SHOWN AGAINST THE TIME IT WAS SUPPOSED TO BE. "12:05" beside
// a "09:30-12:00" window is a subtraction the reader has to do, and they have
// to remember which end of the window each one is judged against while they
// do it. Each cell now says the clock time and then, in words, how far before
// or after its contracted time that landed.
//
// Arrival is judged against the time the window OPENS; departure against the
// time it CLOSES. Two different boundaries, which is the thing this table was
// hardest to follow about.

// "18m before it opens" / "2h 35m after it closes" / "right on time".
//
// The sign carries the meaning, so it is spelled out rather than shown as a
// minus. Grace is honoured so this line can never contradict the count of
// on-time trips beside it.
function Variance({ minutes, boundary, grace = 0 }) {
  if (minutes == null) return null;
  if (Math.abs(minutes) <= Math.max(grace, 0)) {
    return <span className="block text-[11px] text-emerald-700">right on time</span>;
  }
  const late = minutes > grace;
  return (
    <span className={`block text-[11px] ${late ? "text-brand-red" : "text-emerald-700"}`}>
      {formatDuration(Math.abs(minutes))} {late ? "after" : "before"} it {boundary}
    </span>
  );
}

// n of N, red only when something actually missed. A bare "3 / 6" gives no
// clue which direction is good.
function OnTime({ ok, total }) {
  if (!total) return <span className="text-slate-300">—</span>;
  return (
    <span className={total - ok ? "font-semibold text-brand-red" : "font-semibold text-emerald-700"}>
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
        Each run has its own contracted window, so they are counted separately. Arrival is measured
        against the time that window <b>opens</b>, departure against the time it <b>closes</b>.
        Times are averages across the period.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-5 font-medium">Run</th>
              <th className="py-2 pr-5 font-medium">Trips</th>
              <th className="py-2 pr-5 font-medium">
                Arrived <span className="block normal-case tracking-normal text-slate-400">
                  should be by window open
                </span>
              </th>
              <th className="py-2 pr-5 font-medium">
                Left <span className="block normal-case tracking-normal text-slate-400">
                  should be by window close
                </span>
              </th>
              <th className="py-2 pr-5 font-medium">At outlet</th>
              <th className="py-2 pr-5 font-medium">Arrived in time</th>
              <th className="py-2 font-medium">Left in time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slot_no} className="border-t border-slate-100 align-top">
                <td className="py-3 pr-5">
                  <span className="block font-medium text-brand-black">{r.label}</span>
                  {/* The window on the run, not in a column of its own: it is
                      what both times either side are judged against, so it
                      belongs with the name of the run rather than floating
                      between the two things it governs. */}
                  <span className="block text-[11px] text-slate-400">
                    {r.window_start ? `${r.window_start} – ${r.window_end}` : "no window set"}
                  </span>
                </td>
                <td className="py-3 pr-5 tabular-nums text-slate-600">{r.trips}</td>

                <td className="py-3 pr-5">
                  <span className="block font-semibold tabular-nums text-brand-black">
                    {r.avg_arrival || "—"}
                    {r.arrivals_recorded > 0 && r.arrivals_recorded < r.trips && (
                      <span className="ml-1 text-[11px] font-normal text-slate-400">
                        of {r.arrivals_recorded}
                      </span>
                    )}
                  </span>
                  <Variance minutes={r.avg_arrival_variance} boundary="opens" grace={r.grace_minutes} />
                </td>

                <td className="py-3 pr-5">
                  <span className="block font-semibold tabular-nums text-brand-black">
                    {r.avg_departure || "—"}
                    {r.departures_recorded > 0 && r.departures_recorded < r.trips && (
                      <span className="ml-1 text-[11px] font-normal text-slate-400">
                        of {r.departures_recorded}
                      </span>
                    )}
                  </span>
                  <Variance minutes={r.avg_departure_variance} boundary="closes" grace={r.grace_minutes} />
                </td>

                <td className="py-3 pr-5 tabular-nums text-slate-600">
                  {r.avg_at_outlet_minutes == null ? "—" : formatDuration(r.avg_at_outlet_minutes)}
                </td>
                <td className="py-3 pr-5 tabular-nums">
                  <OnTime ok={r.arrived_on_time} total={r.arrivals_with_window} />
                </td>
                <td className="py-3 tabular-nums">
                  <OnTime ok={r.departed_on_time} total={r.departures_with_window} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* No Lotus/ours split here. Whose fault a missed window was is a
          different question from when the truck came and went, it is already
          answered by the tiles at the top of this page, and a column reading
          "0m / 18h 6m" in the middle of a table of clock times only invited
          the question of what it was doing there. */}

      {/* Trips from before runs were numbered. Said out loud so the rows
          above always add up to the trip count on the tiles. */}
      {unnumbered > 0 && (
        <p className="mt-3 border-t border-slate-100 pt-2.5 text-xs text-slate-400">
          {unnumbered} trip{unnumbered === 1 ? "" : "s"} in this period {unnumbered === 1 ? "is" : "are"} not
          numbered by run and {unnumbered === 1 ? "is" : "are"} left out of this table.
        </p>
      )}
    </section>
  );
}
