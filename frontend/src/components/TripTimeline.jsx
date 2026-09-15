import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import Icon, { CHECKPOINT_ICON } from "./Icon";
import PhotoThumb from "./PhotoThumb";
import { JobCountSheet, PhotoSheet, ReasonSheet } from "./CheckpointSheets";
import { useLanguage } from "../i18n/LanguageContext";
import { formatDuration, formatTime } from "../lib/duration";
import { positionForSubmit } from "../lib/geolocation";

// Which gap each checkpoint closes. Mirrors CHECKPOINT_GAP in backend/trips.py
// so the photo page can offer the right reasons before the stamp exists --
// "arrived" is absent on purpose, nothing precedes it.
const GAP_FOR_CHECKPOINT = {
  goods_ready: "waiting_for_lotus",
  loaded: "loading",
  departed: "departure_lag",
  deliveries_done: "delivery_round",
  returned: "return_leg",
};

// The whole trip as one vertical timeline: what is done keeps its time and its
// delay, the current step is the only button on screen, and what is still to
// come stays visible but dim so the driver can see the shape of the run.
//
// Order matters more than decoration here -- this is read in a loading bay, at
// speed, by someone holding a scanner in the other hand.
const STEPS = ["arrived", "goods_ready", "loaded", "departed", "deliveries_done", "returned"];

// deliveries_done is fired by the server when the last job resolves; the driver
// is never asked to confirm what the app already knows.
const SERVER_FIRED = new Set(["deliveries_done"]);

function gapFor(state, checkpoint) {
  return (state.gaps || []).find((g) => g.to_checkpoint === checkpoint) || null;
}

// Shown before the first trip of the day exists, so the driver sees the shape of
// the run from the first screen rather than a bare button. Tapping the first
// step starts the trip for real.
const EMPTY_STATE = {
  trip: null,
  checkpoints: [],
  gaps: [],
  jobs: [],
  jobs_done: 0,
  time_at_outlet: null,
  next_checkpoint: "arrived",
};

export default function TripTimeline({ manifestId, settings, onChanged, onStart, starting }) {
  const { t } = useLanguage();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState(null); // { kind, checkpoint|jobId }
  const [pendingCount, setPendingCount] = useState(false);
  const [pendingReason, setPendingReason] = useState(null); // { checkpoint, gap }
  const [reasons, setReasons] = useState([]);
  // Which completed drop is open for review. A closed drop is still the
  // driver's own evidence, and until the trip ends he should be able to
  // look at it and add to it.
  const [openJob, setOpenJob] = useState(null);
  const [pendingLatePhoto, setPendingLatePhoto] = useState(null);
  // Drives the countdown. Half a minute is fine for a figure shown in minutes
  // and costs nothing; the interval is torn down with the component.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(() => {
    if (!manifestId) {
      setState(EMPTY_STATE);
      return;
    }
    api
      .get(`/trips/${manifestId}`)
      .then(setState)
      .catch((err) => setError(err.detail || t("trip.loadError")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestId]);

  useEffect(load, [load]);

  async function withPosition(formData) {
    try {
      const pos = await positionForSubmit();
      if (pos.lat != null) formData.append("lat", pos.lat);
      if (pos.lng != null) formData.append("lng", pos.lng);
    } catch {
      // A refused or unavailable fix must never block the stamp: the timestamp
      // and the photo are the evidence that matters, GPS is corroboration.
    }
    return formData;
  }

  // Photos for a step already stamped. Separate from stampCheckpoint on
  // purpose: this one does not move any timestamp.
  async function addPhotos(checkpoint, photos) {
    const shots = Array.isArray(photos) ? photos : photos ? [photos] : [];
    if (!shots.length) return setPendingLatePhoto(null);
    setBusy(true);
    setError(null);
    try {
      const fd = await withPosition(new FormData());
      shots.forEach((f) => fd.append("photos", f));
      setState(await api.postForm(`/trips/${manifestId}/checkpoints/${checkpoint}/photos`, fd));
      setPendingLatePhoto(null);
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.detail || t("trip.stampError"));
    } finally {
      setBusy(false);
    }
  }

  async function stampCheckpoint(checkpoint, photos, reasonCode) {
    const shots = Array.isArray(photos) ? photos : photos ? [photos] : [];
    // No trip yet: "Arrived at Lotus" is what creates one, so hand the photos to
    // the caller's start flow rather than posting a checkpoint into nothing.
    if (!manifestId) {
      setPendingPhoto(null);
      if (onStart) onStart(shots);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fd = await withPosition(new FormData());
      fd.append("checkpoint", checkpoint);
      // One field name, repeated. The server reads them in order and burns the
      // same caption onto every one, because they evidence the same instant.
      shots.forEach((f) => fd.append("photos", f));
      // Given at photo time, so the server does not ask again afterwards.
      if (reasonCode) fd.append("reason_code", reasonCode);
      const next = await api.postForm(`/trips/${manifestId}/checkpoints`, fd);
      setState(next);
      setPendingPhoto(null);
      if (checkpoint === "loaded" && next.trip.expected_job_count == null) {
        setPendingCount(true);
      } else if (next.reason_required_for) {
        openReason(checkpoint, next);
      }
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.detail || t("trip.stampError"));
      setPendingPhoto(null);
    } finally {
      setBusy(false);
    }
  }

  async function completeJob(jobId, photos) {
    const shots = Array.isArray(photos) ? photos : photos ? [photos] : [];
    setBusy(true);
    setError(null);
    try {
      const fd = await withPosition(new FormData());
      shots.forEach((f) => fd.append("photos", f));
      const next = await api.postForm(`/trip-jobs/${jobId}/complete`, fd);
      setState(next);
      setPendingPhoto(null);
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.detail || t("trip.stampError"));
      setPendingPhoto(null);
    } finally {
      setBusy(false);
    }
  }

  async function setJobCount(n) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("job_count", String(n));
      const path = `/trips/${manifestId}/jobs`;
      setState(
        state.jobs.length > 0
          ? await api.putForm(path, fd)
          : await api.postForm(path, fd)
      );
      setPendingCount(false);
    } catch (err) {
      setError(err.detail || t("trip.stampError"));
      setPendingCount(false);
    } finally {
      setBusy(false);
    }
  }

  // Reasons for the gap this checkpoint is about to close, fetched while the
  // driver is taking the photo so the picker is populated by the time they
  // look at it.
  async function loadReasonsFor(checkpoint) {
    const gapCode = GAP_FOR_CHECKPOINT[checkpoint];
    if (!gapCode) return setReasons([]);
    try {
      const d = await api.get(`/reason-codes?gap=${encodeURIComponent(gapCode)}`);
      setReasons(d.reason_codes);
    } catch {
      setReasons([]);
    }
  }

  async function openReason(checkpoint, fromState) {
    const gap = gapFor(fromState || state, checkpoint);
    if (!gap) return;
    try {
      const d = await api.get(`/reason-codes?gap=${encodeURIComponent(gap.gap_code)}`);
      setReasons(d.reason_codes);
      setPendingReason({ checkpoint, gap });
    } catch {
      setReasons([]);
    }
  }

  async function submitReason(code) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("reason_code", code);
      setState(await api.postForm(`/trips/${manifestId}/checkpoints/${pendingReason.checkpoint}/reason`, fd));
      setPendingReason(null);
    } catch (err) {
      setError(err.detail || t("trip.stampError"));
      setPendingReason(null);
    } finally {
      setBusy(false);
    }
  }

  if (error && !state) return <p className="text-sm text-red-600">{error}</p>;
  if (!state) return <p className="text-sm text-slate-500">{t("common.loading")}</p>;

  const stamped = new Map(state.checkpoints.map((c) => [c.checkpoint, c]));
  const jobsPending = state.jobs.filter((j) => j.status === "pending");
  const nextCp = state.next_checkpoint;
  const inDeliveries = nextCp === "returned" || (state.jobs.length > 0 && jobsPending.length > 0);
  const nextJob = jobsPending[0] || null;
  const tao = state.time_at_outlet;

  // What the one big button does right now.
  let action = null;
  if (nextJob && stamped.has("departed")) {
    action = {
      label: t("trip.completeJob", { n: nextJob.seq, total: state.jobs.length }),
      run: () => setPendingPhoto({
        kind: "job", jobId: nextJob.id, seq: nextJob.seq,
        title: t("trip.jobPhotoTitle", { n: nextJob.seq }),
      }),
    };
  } else if (nextCp && !SERVER_FIRED.has(nextCp)) {
    action = {
      label: t(`checkpoint.${nextCp}`),
      run: () => {
        setPendingPhoto({ kind: "checkpoint", checkpoint: nextCp, title: t(`checkpoint.${nextCp}`) });
        loadReasonsFor(nextCp);
      },
    };
  }

  // The job count can be set or changed for as long as the trip is open. It
  // is not a one-shot question asked at the loading bay.
  const canSetJobs = stamped.has("loaded") && !stamped.has("returned");
  const jobsMissing = canSetJobs && state.jobs.length === 0;

  const win = state.window;

  // One headline for the window card, picked for where the trip actually is.
  // Open and on time says nothing alarming; open and already late says so
  // once; finished reports the departure, which is the figure Lotus bills on.
  let winHeadline = null;
  let winTone = "text-emerald-700";
  if (win) {
    if (!win.still_open) {
      winHeadline = win.departed_on_time
        ? t("window.leftOnTime")
        : t("window.leftLate", { late: formatDuration(win.departed_late_minutes) });
      winTone = win.departed_on_time ? "text-emerald-700" : "text-brand-red";
    } else if (!win.arrived_on_time) {
      winHeadline = t("window.arrivedLate", { late: formatDuration(win.arrived_late_minutes) });
      winTone = "text-brand-red";
    } else {
      winHeadline = t("window.onSchedule");
    }
  }

  // The live countdown. Recomputed on a tick rather than only on a reload,
  // because the whole value of this card is that the number moves.
  const og = state.open_gap;
  let live = null;
  if (og && og.started_at) {
    // The API sends local wall-clock ("2026-09-15 09:41:00"); parsed as local
    // it lines up with the phone's own clock.
    const started = new Date(og.started_at.replace(" ", "T"));
    if (!Number.isNaN(started.getTime())) {
      const elapsed = Math.max(0, Math.round((now - started.getTime()) / 60000));
      // With allowances switched off there is no countdown to run, but the
      // step and how long it has taken are still the most useful thing on
      // the screen. Elapsed only, and no colour -- there is no bar to be on
      // the wrong side of.
      const hasTarget = og.target_minutes != null;
      const leftMins = hasTarget ? og.target_minutes - elapsed : null;
      live = {
        label: og.label,
        elapsed,
        hasTarget,
        target: og.target_minutes,
        leftMins: hasTarget ? Math.max(0, leftMins) : null,
        over: hasTarget && leftMins < 0,
        overBy: hasTarget ? Math.max(0, -leftMins) : 0,
      };
    }
  }

  return (
    <div>
      {/* ONE fact per card. The window card said four things at once -- a
          label, two deadlines, an arrival verdict and a departure verdict --
          and the driver had to assemble the answer himself. It now carries
          the single line that is true right now; the live card below says
          what to do about it. */}
      {win && (
        <div className="mb-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{win.label}</p>
          <p className={`mt-1 text-lg font-semibold ${winTone}`}>{winHeadline}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("window.targets", { start: win.window_start, end: win.window_end })}
          </p>
          {/* Only where a claim is actually split, and worded so it does not
              read as an accusation -- most of the time a share of it is the
              outlet, and the driver should see that said plainly. */}
          {!win.still_open && !win.departed_on_time && (
            <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
              {win.lotus_late_minutes > 0
                ? t("window.splitLotus", {
                    lotus: formatDuration(win.lotus_late_minutes),
                    njv: formatDuration(win.njv_late_minutes),
                  })
                : t("window.splitOurs", { njv: formatDuration(win.njv_late_minutes) })}
            </p>
          )}
        </div>
      )}

      {/* WHAT IS HAPPENING NOW, while the trip is open. The old second card
          showed time-at-outlet, a number that stops moving the moment the
          truck leaves and says nothing at all mid-trip. A driver standing in
          a loading bay wants one thing: how long has this step got left.
          Neutral by design -- it counts an allowance, it does not accuse
          anybody, because a good share of the time the wait is not theirs. */}
      {live && (
        <div className={`mb-3 rounded-2xl p-4 shadow-sm ring-1 ${
          live.over ? "bg-rose-50 ring-rose-200" : "bg-white ring-slate-200"
        }`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t("live.now")}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-brand-black">{live.label}</p>
          <p className={`mt-1 text-2xl font-semibold ${
            !live.hasTarget ? "text-brand-black" : live.over ? "text-brand-red" : "text-emerald-700"
          }`}>
            {!live.hasTarget
              ? formatDuration(live.elapsed)
              : live.over
                ? t("live.over", { time: formatDuration(live.overBy) })
                : t("live.left", { time: formatDuration(live.leftMins) })}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {live.hasTarget
              ? t("live.elapsed", {
                  elapsed: formatDuration(live.elapsed),
                  allowed: formatDuration(live.target),
                })
              : t("live.sinceStep")}
          </p>
          {live.over && (
            <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs text-slate-600">
              {t("live.overNote")}
            </p>
          )}
        </div>
      )}

      {tao && !live && (
        <div className="mb-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("trip.timeAtOutlet")}</p>
          <p className={`mt-0.5 text-2xl font-semibold ${tao.over_target ? "text-brand-red" : "text-emerald-700"}`}>
            {formatDuration(tao.minutes)}
          </p>
          {tao.target_minutes != null && (
            <p className="mt-0.5 text-xs text-slate-500">
              {t("trip.target", { target: formatDuration(tao.target_minutes) })}
              {tao.over_target ? ` · ${t("trip.over", { over: formatDuration(tao.over_by_minutes) })}` : ""}
            </p>
          )}
        </div>
      )}

      {action && (
        <>
          <button
            type="button"
            onClick={action.run}
            disabled={busy || starting}
            className="block w-full rounded-2xl bg-brand-red px-6 py-5 text-center text-base font-semibold text-white shadow-sm hover:bg-brand-red-dark disabled:opacity-50"
          >
            {starting ? t("home.oneSec") : action.label}
          </button>
          <p className="mt-2 text-center text-xs text-slate-400">
            {nextJob && stamped.has("departed") ? t("trip.jobCtaHint") : t("trip.ctaHint")}
          </p>
          {/* A job is a drop; a scan is one parcel inside it. Both are needed,
              so say which is which instead of leaving two similar buttons. */}
          {nextJob && stamped.has("departed") && (
            <Link
              to="/driver/scans/complete"
              className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-medium text-brand-black shadow-sm ring-1 ring-slate-200"
            >
              <Icon name="route" className="h-4 w-4" />
              {t("home.scanToComplete")}
            </Link>
          )}
        </>
      )}

      {jobsMissing && (
        <button
          type="button"
          onClick={() => setPendingCount(true)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
        >
          <Icon name="alert" className="h-4 w-4" />
          {t("trip.jobCountMissing")}
        </button>
      )}

      {!action && state.next_checkpoint === null && (
        <div className="rounded-2xl bg-emerald-50 px-5 py-4 text-center ring-1 ring-emerald-200">
          <p className="text-sm font-semibold text-emerald-800">{t("trip.complete")}</p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <ol className="mt-6 space-y-0">
        {STEPS.map((cp, i) => {
          const done = stamped.get(cp);
          const isNext = cp === nextCp && !done;
          const gap = gapFor(state, cp);
          const over = gap && gap.over_target;
          return (
            <li key={cp} className="relative pb-5 pl-10 last:pb-0">
              {/* The rail is drawn only between steps. Rendering it on the last
                  one (the old `last:hidden` never matched -- this span is not
                  the li's last child) left a line dangling into nothing. */}
              {i < STEPS.length - 1 && (
                <span
                  className="absolute bottom-0 left-[13px] top-7 w-0.5 bg-slate-200"
                  aria-hidden="true"
                />
              )}
              <span
                className={`absolute left-0 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-full ${
                  done
                    ? "bg-emerald-600 text-white"
                    : isNext
                      ? "bg-brand-red text-white"
                      : "border border-slate-300 bg-white text-slate-400"
                }`}
              >
                <Icon name={CHECKPOINT_ICON[cp]} className="h-3.5 w-3.5" />
              </span>
              <p className={`pt-1 text-sm font-semibold leading-tight ${done || isNext ? "text-brand-black" : "text-slate-400"}`}>
                {t(`checkpoint.${cp}`)}
              </p>
              {done ? (
                <p className="text-xs text-slate-500">
                  {formatTime(done.occurred_at)}
                  {/* Where the phone was when this was stamped. A coordinate
                      pair means nothing at a glance; a town does. */}
                  {done.place ? ` · ${done.place}` : ""}
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  {SERVER_FIRED.has(cp) ? t("checkpoint.auto") : t("checkpoint.pending")}
                </p>
              )}
              {gap && (
                <p className={`text-xs ${over ? "font-semibold text-brand-red" : "text-emerald-700"}`}>
                  {gap.label} {formatDuration(gap.minutes)}
                  {gap.target_minutes != null ? ` / ${formatDuration(gap.target_minutes)}` : ""}
                </p>
              )}
              {done && done.reason_label && (
                <p className="mt-1 rounded-r-md border-l-2 border-amber-300 bg-amber-50 px-2 py-1 text-xs text-slate-600">
                  {done.reason_label}
                </p>
              )}
              {/* Reason codes are the point of the whole exercise, so they are
                  offered on any stamped step -- a driver who knows Lotus held
                  them up should not have to wait for a threshold to say so. A
                  breach still asks unprompted. */}
              {/* A step stamped without a photo can still get one, for as
                  long as the trip is open. Optional would otherwise just
                  mean missing. */}
              {done && (done.photo_ids || []).length === 0 && !stamped.has("returned") && (
                <button
                  type="button"
                  onClick={() => setPendingLatePhoto({ checkpoint: cp, label: t(`checkpoint.${cp}`) })}
                  className="mt-1 mr-2 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600"
                >
                  <Icon name="camera" className="h-3.5 w-3.5" />
                  {t("checkpoint.addPhoto")}
                </button>
              )}
              {done && gap && (
                <button
                  type="button"
                  onClick={() => openReason(cp)}
                  className={`mt-1 flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                    over && !done.reason_code
                      ? "border-brand-red bg-brand-red text-white"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {over && !done.reason_code && <Icon name="alert" className="h-3.5 w-3.5" />}
                  {done.reason_code ? t("trip.changeReason") : t("trip.addReason")}
                </button>
              )}

              {/* Always reachable while the trip is open. This button used to
                  be gated on `jobs.length > 0` — the one state cancelling the
                  sheet guarantees — so a cancel, or a tap of Back mid-answer,
                  locked the driver out of setting a job count for the rest of
                  the run, and with no jobs there is nothing to deliver against. */}
              {cp === "deliveries_done" && canSetJobs && (
                <button
                  type="button"
                  onClick={() => setPendingCount(true)}
                  className="mt-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {state.jobs.length > 0
                    ? t("trip.editJobCount", { n: state.jobs.length })
                    : t("trip.setJobCount")}
                </button>
              )}
              {cp === "deliveries_done" && state.jobs.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {state.jobs.map((j) => {
                    const expanded = openJob === j.id;
                    const closed = j.status !== "pending";
                    return (
                      <li key={j.id} className="rounded-lg bg-white text-xs ring-1 ring-slate-200">
                        <div className="flex items-center justify-between gap-2 px-3 py-2">
                          <button
                            type="button"
                            // Only a closed drop has anything to show.
                            onClick={() => closed && setOpenJob(expanded ? null : j.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            {closed && (
                              <Icon name="chevron"
                                    className={`h-3 w-3 shrink-0 text-slate-400 ${expanded ? "rotate-90" : ""}`} />
                            )}
                            <span className={`font-semibold ${closed ? "text-brand-black" : "text-slate-400"}`}>
                              {t("trip.job", { n: j.seq })}
                            </span>
                            <span className="truncate text-slate-500">
                              {closed
                                ? `${formatTime(j.completed_at)}${j.orders ? ` · ${t("trip.orderCount", { n: j.orders })}` : ""}`
                                : t("trip.jobPending")}
                            </span>
                          </button>
                          {!stamped.has("returned") && (
                            <Link
                              to={`/driver/scans/complete?trip_job=${j.id}&seq=${j.seq}`}
                              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                                closed ? "border border-slate-300 bg-white text-brand-black" : "bg-brand-black text-white"
                              }`}
                            >
                              <Icon name="route" className="h-3.5 w-3.5" />
                              {t("trip.scanDelivery")}
                            </Link>
                          )}
                        </div>

                        {expanded && (
                          <div className="border-t border-slate-100 px-3 py-2.5">
                            {(j.photo_ids || []).length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {j.photo_ids.map((pid) => (
                                  <PhotoThumb key={pid} photoId={pid} size="h-16 w-16"
                                              caption={`${t("trip.job", { n: j.seq })} · ${formatTime(j.completed_at)}`} />
                                ))}
                              </div>
                            ) : (
                              <p className="text-slate-400">{t("trip.noPhotos")}</p>
                            )}

                            {(j.order_list || []).length > 0 ? (
                              <ul className="mt-2 space-y-1">
                                {j.order_list.map((o) => (
                                  <li key={o.tracking_no} className="flex items-center justify-between gap-2">
                                    <span className="truncate text-slate-600">{o.tracking_no}</span>
                                    <span className={o.status === "failed" ? "text-brand-red" : "text-emerald-700"}>
                                      {o.status === "failed" ? t("trip.orderFailed") : t("trip.orderDelivered")}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-2 text-slate-400">{t("trip.noOrders")}</p>
                            )}

                            {!stamped.has("returned") && (
                              <p className="mt-2 text-[11px] text-slate-400">{t("trip.stillEditable")}</p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {/* Scanning lives inside the trip at the step it applies to, rather than
          floating at the bottom of the screen where it competed with the one
          real next action. Parcels are scanned IN between goods-ready and
          loaded... */}
      {stamped.has("goods_ready") && !stamped.has("departed") && (
        <Link
          to={`/driver/manifests/${manifestId}/register`}
          className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-medium text-brand-black shadow-sm ring-1 ring-slate-200"
        >
          <Icon name="route" className="h-4 w-4" />
          {t("trip.scanOrders")}
        </Link>
      )}

      <PhotoSheet
        key={pendingPhoto ? `${pendingPhoto.kind}-${pendingPhoto.checkpoint || pendingPhoto.jobId}` : "none"}
        open={!!pendingPhoto}
        title={pendingPhoto?.title || ""}
        busy={busy}
        // Every step takes a set, including the one that creates the trip.
        // Arrival is the stamp a whole late-delivery argument turns on and it
        // was the last one still capped at a single frame.
        maxPhotos={4}
        onCancel={() => setPendingPhoto(null)}
        reasons={pendingPhoto?.kind === "checkpoint" ? reasons : []}
        // A drop's proof photo stays compulsory -- there is no timestamp that
        // proves a parcel reached a door. A checkpoint's does not: the stamp
        // is the evidence and a late stamp is worse than a late photo.
        photoRequired={
          pendingPhoto?.kind === "job" ||
          (settings?.photo_required_checkpoints || []).includes(pendingPhoto?.checkpoint)
        }
        scanTo={
          pendingPhoto?.kind === "job"
            ? `/driver/scans/complete?trip_job=${pendingPhoto.jobId}&seq=${pendingPhoto.seq}`
            : null
        }
        onSubmit={(photo, reasonCode) =>
          pendingPhoto.kind === "job"
            ? completeJob(pendingPhoto.jobId, photo)
            : stampCheckpoint(pendingPhoto.checkpoint, photo, reasonCode)
        }
      />
      <PhotoSheet
        key={pendingLatePhoto ? `late-${pendingLatePhoto.checkpoint}` : "late-none"}
        open={!!pendingLatePhoto}
        title={t("checkpoint.addPhotoTitle", { step: pendingLatePhoto?.label || "" })}
        busy={busy}
        maxPhotos={4}
        photoRequired
        onCancel={() => setPendingLatePhoto(null)}
        onSubmit={(photo) => addPhotos(pendingLatePhoto.checkpoint, photo)}
      />

      <JobCountSheet
        open={pendingCount}
        busy={busy}
        quickPicks={settings?.job_count_quick_picks || [4, 5, 6, 7]}
        max={settings?.job_count_manual_max || 40}
        onSubmit={setJobCount}
        onCancel={() => setPendingCount(false)}
      />
      <ReasonSheet
        open={!!pendingReason}
        gap={pendingReason?.gap}
        reasons={reasons}
        busy={busy}
        onSubmit={submitReason}
        onSkip={() => setPendingReason(null)}
      />
    </div>
  );
}
