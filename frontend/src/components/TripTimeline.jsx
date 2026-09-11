import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import Icon, { CHECKPOINT_ICON } from "./Icon";
import { JobCountSheet, PhotoSheet, ReasonSheet } from "./CheckpointSheets";
import { useLanguage } from "../i18n/LanguageContext";
import { formatDuration, formatTime } from "../lib/duration";
import { getPosition } from "../lib/geolocation";

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

export default function TripTimeline({ manifestId, settings, onChanged }) {
  const { t } = useLanguage();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState(null); // { kind, checkpoint|jobId }
  const [pendingCount, setPendingCount] = useState(false);
  const [pendingReason, setPendingReason] = useState(null); // { checkpoint, gap }
  const [reasons, setReasons] = useState([]);

  const load = useCallback(() => {
    api
      .get(`/trips/${manifestId}`)
      .then(setState)
      .catch((err) => setError(err.detail || t("trip.loadError")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestId]);

  useEffect(load, [load]);

  async function withPosition(formData) {
    try {
      const pos = await getPosition();
      if (pos.lat != null) formData.append("lat", pos.lat);
      if (pos.lng != null) formData.append("lng", pos.lng);
    } catch {
      // A refused or unavailable fix must never block the stamp: the timestamp
      // and the photo are the evidence that matters, GPS is corroboration.
    }
    return formData;
  }

  async function stampCheckpoint(checkpoint, photo) {
    setBusy(true);
    setError(null);
    try {
      const fd = await withPosition(new FormData());
      fd.append("checkpoint", checkpoint);
      if (photo) fd.append("photo", photo);
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

  async function completeJob(jobId, photo) {
    setBusy(true);
    setError(null);
    try {
      const fd = await withPosition(new FormData());
      if (photo) fd.append("photo", photo);
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
      setState(await api.postForm(`/trips/${manifestId}/jobs`, fd));
      setPendingCount(false);
    } catch (err) {
      setError(err.detail || t("trip.stampError"));
      setPendingCount(false);
    } finally {
      setBusy(false);
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
      run: () => setPendingPhoto({ kind: "job", jobId: nextJob.id, title: t("trip.jobPhotoTitle", { n: nextJob.seq }) }),
    };
  } else if (nextCp && !SERVER_FIRED.has(nextCp)) {
    action = {
      label: t(`checkpoint.${nextCp}`),
      run: () =>
        setPendingPhoto({ kind: "checkpoint", checkpoint: nextCp, title: t(`checkpoint.${nextCp}`) }),
    };
  }

  return (
    <div>
      {tao && (
        <div className="mb-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("trip.timeAtOutlet")}</p>
          <p className={`mt-0.5 text-2xl font-semibold ${tao.over_target ? "text-brand-red" : "text-emerald-700"}`}>
            {formatDuration(tao.minutes)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {t("trip.target", { target: formatDuration(tao.target_minutes) })}
            {tao.over_target ? ` · ${t("trip.over", { over: formatDuration(tao.over_by_minutes) })}` : ""}
          </p>
        </div>
      )}

      {action && (
        <>
          <button
            type="button"
            onClick={action.run}
            disabled={busy}
            className="block w-full rounded-2xl bg-brand-red px-6 py-5 text-center text-base font-semibold text-white shadow-sm hover:bg-brand-red-dark disabled:opacity-50"
          >
            {action.label}
          </button>
          <p className="mt-2 text-center text-xs text-slate-400">{t("trip.ctaHint")}</p>
        </>
      )}

      {!action && state.next_checkpoint === null && (
        <div className="rounded-2xl bg-emerald-50 px-5 py-4 text-center ring-1 ring-emerald-200">
          <p className="text-sm font-semibold text-emerald-800">{t("trip.complete")}</p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <ol className="mt-6 space-y-0">
        {STEPS.map((cp) => {
          const done = stamped.get(cp);
          const isNext = cp === nextCp && !done;
          const gap = gapFor(state, cp);
          const over = gap && gap.over_target;
          return (
            <li key={cp} className="relative pl-8 pb-5 last:pb-0">
              <span
                className={`absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full ring-2 ${
                  done
                    ? "bg-emerald-600 text-white ring-emerald-600"
                    : isNext
                      ? "bg-brand-red text-white ring-brand-red"
                      : "bg-white text-slate-300 ring-slate-300"
                }`}
              >
                <Icon name={CHECKPOINT_ICON[cp]} className="h-3.5 w-3.5" />
              </span>
              <span
                className="absolute left-3 top-7 -ml-px h-[calc(100%-1.75rem)] w-0.5 bg-slate-200 last:hidden"
                aria-hidden="true"
              />
              <p className={`text-sm font-semibold ${done || isNext ? "text-brand-black" : "text-slate-400"}`}>
                {t(`checkpoint.${cp}`)}
              </p>
              {done ? (
                <p className="font-mono text-xs text-slate-500">{formatTime(done.occurred_at)}</p>
              ) : (
                <p className="text-xs text-slate-400">
                  {SERVER_FIRED.has(cp) ? t("checkpoint.auto") : t("checkpoint.pending")}
                </p>
              )}
              {gap && (
                <p className={`font-mono text-xs ${over ? "font-semibold text-brand-red" : "text-emerald-700"}`}>
                  {gap.label} {formatDuration(gap.minutes)} / {formatDuration(gap.target_minutes)}
                </p>
              )}
              {done && done.reason_label && (
                <p className="mt-1 rounded-r-md border-l-2 border-amber-300 bg-amber-50 px-2 py-1 text-xs text-slate-600">
                  {done.reason_label}
                </p>
              )}
              {over && done && !done.reason_code && (
                <button
                  type="button"
                  onClick={() => openReason(cp)}
                  className="mt-1 flex items-center gap-1 text-xs font-semibold text-brand-red underline"
                >
                  <Icon name="alert" className="h-3.5 w-3.5" />
                  {t("trip.addReason")}
                </button>
              )}

              {cp === "deliveries_done" && state.jobs.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {state.jobs.map((j) => (
                    <li
                      key={j.id}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ring-1 ${
                        j.status === "pending" ? "bg-white text-slate-400 ring-slate-200" : "bg-white text-brand-black ring-slate-200"
                      }`}
                    >
                      <span className="font-semibold">{t("trip.job", { n: j.seq })}</span>
                      <span className="flex items-center gap-1.5 font-mono text-xs text-slate-500">
                        {j.status === "pending" ? (
                          t("trip.jobPending")
                        ) : (
                          <>
                            {formatTime(j.completed_at)}
                            <Icon name="camera" className="h-3 w-3 text-emerald-600" />
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {/* Scanning orders in happens BETWEEN goods being ready and the truck
          being confirmed loaded -- that is the order in the driver's own
          process flow, so the link lives in that window. */}
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
        onCancel={() => setPendingPhoto(null)}
        onSubmit={(photo) =>
          pendingPhoto.kind === "job"
            ? completeJob(pendingPhoto.jobId, photo)
            : stampCheckpoint(pendingPhoto.checkpoint, photo)
        }
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
      />
    </div>
  );
}
