import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import PhotoThumb from "./PhotoThumb";
import Icon, { CHECKPOINT_ICON } from "./Icon";
import { useLanguage } from "../i18n/LanguageContext";
import { formatDayLabel, formatDuration, formatTime } from "../lib/duration";

// The driver's own history, openable down to the evidence.
//
// This is not just a log: a driver who gets told their Wednesday ran long can
// open Wednesday and show that 42 minutes of it was Lotus with no loading bay
// free -- the same checkpoints, times and photos ops sees, from their own
// phone. That is why every level expands rather than summarising.

function Stat({ n, label, tone }) {
  return (
    <div className="rounded-lg bg-slate-100 px-2 py-2">
      <p className={`text-lg font-semibold leading-none ${tone || "text-brand-black"}`}>{n}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

function CheckpointTrail({ trip }) {
  const { t } = useLanguage();
  const gapFor = (cp) => (trip.gaps || []).find((g) => g.to_checkpoint === cp);
  return (
    <ol className="mt-3 space-y-2 border-l-2 border-slate-200 pl-4">
      {trip.checkpoints.map((c) => {
        const gap = gapFor(c.checkpoint);
        const over = gap && gap.over_target;
        return (
          <li key={c.checkpoint} className="relative">
            <span
              className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full ring-2 ring-white ${
                over ? "bg-brand-red" : "bg-emerald-600"
              }`}
            />
            <div className="flex items-start justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-black">
                <Icon name={CHECKPOINT_ICON[c.checkpoint]} className="h-3.5 w-3.5 text-slate-400" />
                {t(`checkpoint.${c.checkpoint}`)}
              </p>
              <p className="shrink-0 text-xs text-slate-500">{formatTime(c.occurred_at)}</p>
            </div>
            {gap && (
              <p className={`text-[11px] ${over ? "font-semibold text-brand-red" : "text-slate-400"}`}>
                {gap.label} {formatDuration(gap.minutes)} / {formatDuration(gap.target_minutes)}
              </p>
            )}
            {c.reason_label && (
              <p className="mt-1 rounded-r border-l-2 border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-slate-600">
                {c.reason_label}
              </p>
            )}
            {/* The driver's own copy of the evidence. He is the one Lotus's
                version of events lands on first, so he gets to see the same
                stamped photo ops would attach -- not just a note saying one
                exists. */}
            {(c.photo_ids?.length ? c.photo_ids : c.photo_id ? [c.photo_id] : []).length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(c.photo_ids?.length ? c.photo_ids : [c.photo_id]).map((pid) => (
                  <PhotoThumb key={pid} photoId={pid} size="h-14 w-14"
                              caption={`${t(`checkpoint.${c.checkpoint}`)} · ${formatTime(c.occurred_at)}`} />
                ))}
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Icon name="camera" className="h-3 w-3" />
                  {t("myDay.photoStamped")}
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function MyDay({ refreshKey }) {
  const { t } = useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openDay, setOpenDay] = useState(null);
  const [openTrip, setOpenTrip] = useState(null);
  const [closing, setClosing] = useState(false);

  const load = useCallback(() => {
    api
      .get("/my-days")
      .then(setData)
      .catch((err) => setError(err.detail || t("myDay.loadError")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(load, [load]);

  async function closeDay(workDate) {
    setClosing(true);
    try {
      await api.postForm(`/days/${workDate}/close`, new FormData());
      load();
    } catch (err) {
      setError(err.detail || t("myDay.closeError"));
    } finally {
      setClosing(false);
    }
  }

  if (error && !data) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">{t("common.loading")}</p>;
  if (data.days.length === 0) return <p className="text-sm text-slate-500">{t("myDay.empty")}</p>;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {data.days.map((day) => {
        const isOpen = openDay === day.work_date;
        const isToday = day.work_date === today;
        // A finished trip and a closed DAY are not the same thing, and the chip
        // only knew the second one — so a driver who had stamped "Returned to
        // Lotus" and seen "Trip complete" still read "Day open" here, with
        // nothing saying what was left to do. Auto-closing today would be
        // wrong: a second trip this afternoon is normal. So the chip now says
        // the truth in three states, and names the one action outstanding.
        const live = (day.trips || []).filter((tr) => !tr.cancelled);
        const allBack = live.length > 0 && live.every((tr) => tr.ended_at);
        const readyToClose = !day.day_closed_at && allBack;
        return (
          <div key={day.work_date} className="mb-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => {
                setOpenDay(isOpen ? null : day.work_date);
                setOpenTrip(null);
              }}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-2 text-left"
            >
              <Icon name="chevron" className={`h-3.5 w-3.5 text-slate-400 ${isOpen ? "rotate-90" : ""}`} />
              <span className="text-base font-semibold text-brand-black">
                {isToday ? t("myDay.today", { date: formatDayLabel(day.work_date) }) : formatDayLabel(day.work_date)}
              </span>
              <span className="flex-1" />
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  day.day_closed_at
                    ? "bg-emerald-100 text-emerald-800"
                    : readyToClose
                      ? "bg-amber-100 text-amber-800"
                      : "bg-rose-100 text-rose-800"
                }`}
              >
                {day.day_closed_at
                  ? t("myDay.closedAt", { time: formatTime(day.day_closed_at) })
                  : readyToClose
                    ? t("myDay.readyToClose")
                    : t("myDay.open")}
              </span>
            </button>

            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <Stat n={day.totals.trips} label={t("myDay.trips")} />
              <Stat n={day.totals.jobs} label={t("myDay.jobs")} />
              <Stat n={day.totals.orders} label={t("myDay.orders")} />
              <Stat
                n={day.totals.over_target}
                label={t("myDay.overTarget")}
                tone={day.totals.over_target ? "text-brand-red" : undefined}
              />
            </div>

            {isOpen && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                {day.trips.map((trip, i) => {
                  const key = `${day.work_date}-${trip.id}`;
                  const tOpen = openTrip === key;
                  const tao = trip.time_at_outlet;
                  return (
                    <div key={trip.id} className={i ? "mt-3" : ""}>
                      <button
                        type="button"
                        onClick={() => setOpenTrip(tOpen ? null : key)}
                        aria-expanded={tOpen}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <Icon name="chevron" className={`h-3 w-3 text-slate-400 ${tOpen ? "rotate-90" : ""}`} />
                        <span>
                          <span className="block text-sm font-semibold text-brand-black">
                            {t("myDay.trip", { n: i + 1 })}
                          </span>
                          <span className="block text-[11px] text-slate-500">
                            {formatTime(trip.started_at)}
                            {trip.ended_at ? ` – ${formatTime(trip.ended_at)}` : ` – ${t("myDay.running")}`} ·{" "}
                            {t("myDay.jobsOrders", { jobs: trip.jobs, orders: trip.orders })}
                          </span>
                        </span>
                        <span className="flex-1" />
                        {tao && (
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                              tao.over_target ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {formatDuration(tao.minutes)}
                          </span>
                        )}
                      </button>
                      {tOpen && <CheckpointTrail trip={trip} />}
                    </div>
                  );
                })}

                {/* Any open day can be closed, not just today -- a driver who
                    forgot to tap on Tuesday should not be stuck with it open
                    forever. Past days whose trips all came back are closed
                    automatically server-side; this is the manual way out for
                    the ones that did not. */}
                {!day.day_closed_at && (
                  <>
                    {readyToClose && (
                      <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                        {t("myDay.readyToCloseHint")}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={closing}
                      onClick={() => closeDay(day.work_date)}
                      className="mt-4 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-brand-black ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {closing ? t("myDay.closing") : isToday ? t("myDay.closeDay") : t("myDay.closeThisDay")}
                    </button>
                    <p className="mt-1.5 text-center text-xs text-slate-400">{t("myDay.closeHint")}</p>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("myDay.rollup")}</p>
        <div className="grid grid-cols-2 gap-2">
          <Stat n={data.rollup.trips} label={t("myDay.trips")} />
          <Stat n={data.rollup.jobs} label={t("myDay.jobs")} />
          <Stat n={data.rollup.orders} label={t("myDay.orders")} />
          <Stat
            n={data.rollup.over_target}
            label={t("myDay.overTarget")}
            tone={data.rollup.over_target ? "text-brand-red" : undefined}
          />
        </div>
      </div>
    </div>
  );
}
