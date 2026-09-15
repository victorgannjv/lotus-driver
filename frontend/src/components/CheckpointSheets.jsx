import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon";
import PhotoCapture from "./PhotoCapture";
import { useLanguage } from "../i18n/LanguageContext";
import { formatDuration } from "../lib/duration";

// Shared by both places a reason is offered: the photo page and the sheet.
const PARTY_ORDER = ["lotus", "njv", "external"];

// The screens the trip timeline raises, in the order a checkpoint needs them:
// photo -> (job count, at loading only) -> reason, if the gap ran over target.
// Kept in one file because they are never used apart.
//
// Two frames, chosen by how much work the step is. The job count and the delay
// reason are one tap on a short list, so they stay bottom sheets with the trip
// still visible behind them. The photo step is not: it is a camera, a strip of
// thumbnails, a location to check and a confirm, and as a sheet it arrived as a
// 90%-tall box that scrolled inside its own scroll and cropped the buttons. It
// gets the whole screen.

function FullPage({ title, subtitle, children, onCancel, cancelLabel, action }) {
  // The trip list behind this is a long scroll. Left live, a phone scrolls IT
  // instead of the page on top -- the photo strip moves, the background moves
  // with it, and the driver loses the confirm button.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <header className="flex items-center gap-1 border-b border-slate-200 px-3 py-2.5">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label={cancelLabel}
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          >
            <Icon name="chevron" className="h-5 w-5 rotate-180" />
          </button>
        ) : (
          <span className="h-10 w-2 shrink-0" />
        )}
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-brand-black">{title}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-md">
          {subtitle && <p className="mb-4 text-sm text-slate-500">{subtitle}</p>}
          {children}
        </div>
      </div>

      {/* Confirm sits on the frame, not at the end of the content, so it is
          reachable with a thumb however many photos are in the strip. */}
      {action && (
        <div className="border-t border-slate-200 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto max-w-md">{action}</div>
        </div>
      )}
    </div>
  );
}

function Sheet({ title, subtitle, children, onCancel, cancelLabel }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onCancel || undefined}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-sm flex-col rounded-t-2xl bg-white shadow-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* The way out sits at the top and stays there. It used to be a text
            button under the content, which on the delay-reason sheet is below
            two dozen options -- so the only exit was off the bottom of the
            list you were trying to escape. The header is outside the scroller
            rather than sticky inside it, so it cannot move at all. */}
        <div className="flex items-start gap-3 px-5 pb-2 pt-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-brand-black">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              aria-label={cancelLabel}
              title={cancelLabel}
              className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5"
                   fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">{children}</div>
      </div>
    </div>
  );
}

// A photo is the evidence a claim rests on, so the step will not stamp without
// one. The stamp itself comes from the server clock, not the handset -- a phone
// with the wrong time would hand Lotus an argument against every photo.
export function PhotoSheet({ open, title, busy, onSubmit, onCancel, maxPhotos = 4, reasons = [], scanTo = null }) {
  const { t } = useLanguage();
  const [photos, setPhotos] = useState([]);
  const [reason, setReason] = useState("");
  if (!open) return null;

  // Asked here, while the driver is still standing in the thing he is
  // describing. The old flow only asked AFTER the stamp, and only if the gap
  // had already breached -- by which point he has put the phone away, and the
  // answer is a memory rather than an observation. Optional: most steps are
  // fine, and a required field on a clean trip trains people to pick anything.
  const grouped = PARTY_ORDER
    .map((party) => ({ party, items: reasons.filter((r) => r.fault_party === party) }))
    .filter((g) => g.items.length > 0);
  return (
    <FullPage
      title={title}
      subtitle={t("checkpoint.photoSubtitle")}
      onCancel={busy ? null : onCancel}
      cancelLabel={t("common.cancel")}
      action={
        <button
          type="button"
          disabled={busy || photos.length === 0}
          onClick={() => onSubmit(photos, reason || null)}
          className="w-full rounded-xl bg-brand-red px-4 py-3.5 text-base font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50"
        >
          {busy ? t("checkpoint.saving") : t("checkpoint.confirm")}
        </button>
      }
    >
      {/* Scanning belongs on the page where the drop is being closed, not
          only on the row behind it: this is where the driver is standing at
          the door with the parcels in hand. Above the camera because leaving
          for the scanner unmounts this page -- scan first, photograph second,
          and nothing taken is lost on the way out. */}
      {scanTo && (
        <Link
          to={scanTo}
          className="mb-4 flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-brand-black"
        >
          <Icon name="route" className="h-4 w-4" />
          {t("trip.scanOrdersForJob")}
        </Link>
      )}

      <PhotoCapture
        label={t("checkpoint.photoLabel")}
        onChange={(v) => setPhotos(Array.isArray(v) ? v : v ? [v] : [])}
        max={maxPhotos}
        required
      />

      {grouped.length > 0 && (
        <label className="mt-5 block">
          <span className="block text-sm font-medium text-slate-700">{t("reason.inlineLabel")}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{t("reason.inlineHelp")}</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-brand-black focus:border-brand-red focus:outline-none"
          >
            <option value="">{t("reason.inlineNone")}</option>
            {grouped.map((g) => (
              <optgroup key={g.party} label={t(`reason.party.${g.party}`)}>
                {g.items.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
    </FullPage>
  );
}

// Quick picks come from admin settings; the typed field is there because a real
// day does not always land on one of four numbers.
export function JobCountSheet({ open, busy, quickPicks, max, onSubmit, onCancel }) {
  const { t } = useLanguage();
  const [typed, setTyped] = useState("");
  if (!open) return null;

  function submitTyped() {
    const n = parseInt(typed, 10);
    if (Number.isNaN(n) || n < 1 || n > max) return;
    onSubmit(n);
  }

  return (
    <Sheet title={t("jobCount.title")} subtitle={t("jobCount.subtitle")} onCancel={busy ? null : onCancel} cancelLabel={t("common.cancel")}>
      <div className="grid grid-cols-4 gap-2">
        {quickPicks.map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy}
            onClick={() => onSubmit(n)}
            className="rounded-xl border border-slate-300 py-3 text-xl font-semibold text-brand-black hover:bg-slate-50 disabled:opacity-50"
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-4 border-t border-slate-200 pt-4">
        <label htmlFor="jobcount" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("jobCount.otherLabel")}
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="jobcount"
            type="number"
            inputMode="numeric"
            min="1"
            max={max}
            value={typed}
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitTyped();
              }
            }}
            placeholder={t("jobCount.placeholder", { max })}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3 text-base"
          />
          <button
            type="button"
            disabled={busy || !typed}
            onClick={submitTyped}
            className="rounded-xl bg-brand-black px-5 text-base font-semibold text-white disabled:opacity-40"
          >
            {t("jobCount.set")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// Only raised when a gap actually ran over its target, so a clean trip is never
// interrupted. Codes are grouped by who owns the delay, with the gap's likely
// owner listed first -- that grouping is the whole basis of the dispute split.
const PARTY_STYLE = {
  lotus: "text-amber-700",
  njv: "text-blue-700",
  external: "text-emerald-700",
};

// There was no way out of this sheet at all -- no cancel, no back, and tapping
// outside did nothing, so the only move was to pick something. A driver
// cornered into an answer picks the nearest one, which is how a dispute
// register fills up with reasons nobody meant. Skipping is allowed now, and it
// is not free: the trip reads "No reason given" in Evidence, which is a queue
// someone chases.
export function ReasonSheet({ open, gap, reasons, busy, onSubmit, onSkip }) {
  const { t } = useLanguage();
  if (!open || !gap) return null;

  const order = gap.default_fault_party === "njv" ? ["njv", "lotus", "external"] : PARTY_ORDER;
  const grouped = order
    .map((party) => ({ party, items: reasons.filter((r) => r.fault_party === party) }))
    .filter((g) => g.items.length > 0);

  return (
    <Sheet
      title={t("reason.title")}
      subtitle={
        // With allowances switched off there is no target to quote, but the
        // driver can still open this from the timeline to explain a step.
        gap.target_minutes != null
          ? t("reason.subtitle", {
              gap: gap.label,
              over: formatDuration(gap.minutes),
              target: formatDuration(gap.target_minutes),
            })
          : t("reason.subtitleNoTarget", { gap: gap.label, took: formatDuration(gap.minutes) })
      }
      onCancel={busy ? null : onSkip}
      cancelLabel={t("reason.skip")}
    >
      {grouped.map((g) => (
        <div key={g.party} className="mb-4">
          <p className={`text-xs font-bold uppercase tracking-wider ${PARTY_STYLE[g.party]}`}>
            {t(`reason.party.${g.party}`)}
          </p>
          {/* Says what the group MEANS, not who is at fault. A driver who reads
              "Ninja Van caused" over his own options picks the vaguest reason he
              can find, and a reason nobody picks honestly is worth nothing in a
              dispute. */}
          <p className="mb-2 mt-0.5 text-xs text-slate-500">{t(`reason.partyNote.${g.party}`)}</p>
          {g.items.map((r) => (
            <button
              key={r.code}
              type="button"
              disabled={busy}
              onClick={() => onSubmit(r.code)}
              className="mb-2 block w-full rounded-xl border border-slate-300 px-4 py-3 text-left text-sm text-brand-black hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
            >
              {r.label}
            </button>
          ))}
        </div>
      ))}
    </Sheet>
  );
}
