import { useNavigate } from "react-router-dom";
import Icon from "./Icon";
import SectionNote, { NoteItem } from "./SectionNote";
import { formatDate, formatDuration, formatShortDate } from "../lib/duration";

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

// The spread behind the mean.
//
// A mean on its own is what makes a reader distrust a dashboard: six arrivals
// averaging 11:40 is equally true of six trucks at 11:40 and of five at nine
// with one at half past one, and those are completely different days. Anyone
// who spot-checks a single early trip against the average alone has no way to
// tell which they are looking at.
function Spread({ earliest, latest }) {
  if (!earliest || !latest || earliest === latest) return null;
  return (
    <span className="block text-[11px] text-slate-400">{earliest} to {latest}</span>
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

// "1–17 Sep", or "Thu 17 Sep" when the period is a single day. An average
// has to name the days it averaged.
function spanLabel(from, to) {
  if (!from || !to) return null;
  if (from === to) return formatDate(from);
  const a = formatShortDate(from);
  const b = formatShortDate(to);
  return a.split(" ")[1] === b.split(" ")[1] ? `${a.split(" ")[0]}–${b}` : `${a} – ${b}`;
}

export default function TripOfDay({ rows, unnumbered, from, to }) {
  const navigate = useNavigate();
  if (!rows || rows.length === 0) return null;
  const span = spanLabel(from, to);

  // A row in the breakdown is a door to that trip.
  //
  // Not an underlined link on the date or the driver: the whole row is the
  // target, because every cell in it belongs to the same trip and there is
  // no second place a click could sensibly go. Evidence already opens one
  // trip expanded from its URL, so this lands on the full checkpoint trail
  // -- times, places, photos, reasons -- rather than a summary of it.
  const openTrip = (tripId) => navigate(`/admin/evidence?trip=${tripId}`);

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-base font-semibold text-brand-black">Arrival and departure, by run of the day</h2>
      {/* NAME THE DAYS. An average with no base is a number nobody can
          check: these are means across whatever period is selected at the
          top of the page, and that has to be said here rather than inferred
          from a control several sections away. Whether the figures are
          getting better or worse is a different question, answered by the
          day-on-day and week-on-week rows in the Manpower section above. */}
      <SectionNote
        more={<>
          <NoteItem term="Two different boundaries.">
            Arrival is measured against the time the window <b>opens</b>. Departure is measured against
            the time it <b>closes</b>. The columns say which is which.
          </NoteItem>
          <NoteItem term="Why the runs are split.">
            The first run and the second have different agreed windows and behave nothing alike. The
            first waits for goods to be picked, the second collects what is already packed. Averaged
            together, you cannot answer either question.
          </NoteItem>
          <NoteItem term="Why the two counts differ.">
            You know whether a truck arrived in time the moment it arrives. You cannot know whether it
            left in time until it has left. A run still at the outlet counts in the first, not the second.
          </NoteItem>
        </>}
      >
        Averages across {span ? <b className="font-semibold text-slate-600">{span}</b> : "the selected period"},
        counted separately for each run of the day.
      </SectionNote>

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
                  <Spread earliest={r.arrival_earliest} latest={r.arrival_latest} />
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
                  <Spread earliest={r.departure_earliest} latest={r.departure_latest} />
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

      {/* The working, on demand. The averages above are checkable now rather
          than takeable on trust -- which is what someone sample-checking a
          figure against one trip they remember actually needs. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-brand-black">
          Show the trips behind these averages
        </summary>
        <p className="mt-2 text-xs text-slate-400">
          Click any row to open that trip in Evidence, with its checkpoints, times, places and photos.
        </p>
        <div className="mt-1 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1.5 pr-4 font-medium">Run</th>
                <th className="py-1.5 pr-4 font-medium">Date</th>
                <th className="py-1.5 pr-4 font-medium">Driver</th>
                <th className="py-1.5 pr-4 font-medium">Outlet</th>
                <th className="py-1.5 pr-4 font-medium">Arrived</th>
                <th className="py-1.5 pr-4 font-medium">Left</th>
                <th className="py-1.5 pr-4 font-medium">At outlet</th>
                <th className="py-1.5 font-medium sr-only">Open</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.flatMap((r) => (r.detail || []).map((d) => (
                <tr
                  key={`${r.slot_no}-${d.trip_id}`}
                  className="group cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  role="link"
                  tabIndex={0}
                  title={`Open trip T-${d.trip_id} in Evidence`}
                  onClick={() => openTrip(d.trip_id)}
                  // Enter and Space, because a row given a tab stop that does
                  // nothing on the keyboard is worse than one with no tab stop.
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openTrip(d.trip_id);
                    }
                  }}
                >
                  <td className="py-1.5 pr-4 text-slate-500">{r.label}</td>
                  <td className="py-1.5 pr-4 whitespace-nowrap text-slate-600">{formatDate(d.work_date)}</td>
                  <td className="py-1.5 pr-4 text-slate-600">{d.driver}</td>
                  <td className="py-1.5 pr-4 text-slate-500">{d.outlet || "—"}</td>
                  <td className="py-1.5 pr-4 font-medium text-brand-black">{d.arrived || "—"}</td>
                  {/* A trip still at the outlet says so. A dash here would
                      read as a missing stamp rather than a truck that has
                      not left yet. */}
                  <td className="py-1.5 pr-4 font-medium text-brand-black">
                    {d.departed || <span className="font-normal text-slate-400">still there</span>}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-600">
                    {d.at_outlet_minutes == null ? "—" : formatDuration(d.at_outlet_minutes)}
                  </td>
                  {/* The affordance. Faint until the row is under the pointer,
                      so fourteen of them do not read as fourteen buttons. */}
                  <td className="py-1.5 text-right">
                    <Icon name="chevron"
                          className="inline h-3 w-3 text-slate-300 group-hover:text-brand-red" />
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
          {rows.some((r) => r.detail_truncated > 0) && (
            <p className="mt-2 text-xs text-slate-400">
              Showing the 100 most recent trips per run. Narrow the period above to see the rest.
            </p>
          )}
        </div>
      </details>

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
