import { useState } from "react";
import Icon from "./Icon";
import PhotoCapture from "./PhotoCapture";
import { useLanguage } from "../i18n/LanguageContext";
import { formatDuration } from "../lib/duration";

// Bottom sheets the trip timeline raises, in the order a checkpoint needs them:
// photo -> (job count, at loading only) -> reason, if the gap ran over target.
// Kept in one file because they share a frame and are never used apart.

function Sheet({ title, subtitle, children, onCancel, cancelLabel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-sm overflow-auto rounded-t-2xl bg-white p-5 shadow-lg sm:rounded-2xl">
        <h2 className="text-base font-semibold text-brand-black">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-4">{children}</div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-2 w-full px-4 py-2 text-sm font-medium text-slate-500"
          >
            {cancelLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// A photo is the evidence a claim rests on, so the step will not stamp without
// one. The stamp itself comes from the server clock, not the handset -- a phone
// with the wrong time would hand Lotus an argument against every photo.
export function PhotoSheet({ open, title, busy, onSubmit, onCancel }) {
  const { t } = useLanguage();
  const [photo, setPhoto] = useState(null);
  if (!open) return null;
  return (
    <Sheet
      title={title}
      subtitle={t("checkpoint.photoSubtitle")}
      onCancel={busy ? null : onCancel}
      cancelLabel={t("common.cancel")}
    >
      <PhotoCapture label={t("checkpoint.photoLabel")} onChange={setPhoto} required />
      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
        <Icon name="clock" className="h-3.5 w-3.5" />
        {t("checkpoint.stampNote")}
      </p>
      <button
        type="button"
        disabled={busy || !photo}
        onClick={() => onSubmit(photo)}
        className="mt-4 w-full rounded-xl bg-brand-red px-4 py-3.5 text-base font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50"
      >
        {busy ? t("checkpoint.saving") : t("checkpoint.confirm")}
      </button>
    </Sheet>
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
const PARTY_ORDER = ["lotus", "njv", "external"];
const PARTY_STYLE = {
  lotus: "text-amber-700",
  njv: "text-blue-700",
  external: "text-emerald-700",
};

export function ReasonSheet({ open, gap, reasons, busy, onSubmit }) {
  const { t } = useLanguage();
  if (!open || !gap) return null;

  const order = gap.default_fault_party === "njv" ? ["njv", "lotus", "external"] : PARTY_ORDER;
  const grouped = order
    .map((party) => ({ party, items: reasons.filter((r) => r.fault_party === party) }))
    .filter((g) => g.items.length > 0);

  return (
    <Sheet
      title={t("reason.title")}
      subtitle={t("reason.subtitle", {
        gap: gap.label,
        over: formatDuration(gap.minutes),
        target: formatDuration(gap.target_minutes),
      })}
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
