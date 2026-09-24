import { useLanguage } from "../i18n/LanguageContext";

// Shown once every order scanned into a trip has a resolved outcome (delivered or
// failed) -- a distinct, congratulatory popup so the driver notices the trip wrapped
// up, separate from the routine per-scan result confirmation. "Back to home" is the
// way into the next warehouse trip: Home's "Arrived at warehouse" button always
// starts a brand-new trip, so this is how a driver making 2 trips a day loops back.
export default function JobCompleteModal({ open, onViewJob, onGoHome, onDismiss }) {
  const { t } = useLanguage();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-lg">
        <p className="text-3xl">🎉</p>
        <p className="mt-2 text-lg font-semibold text-brand-black">{t("jobComplete.title")}</p>
        <p className="mt-1 text-sm text-slate-500">{t("jobComplete.subtitle")}</p>
        <div className="mt-5 grid grid-cols-1 gap-2">
          <button
            onClick={onGoHome}
            className="w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark"
          >
            {t("jobComplete.backHome")}
          </button>
          <button
            onClick={onViewJob}
            className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-brand-black ring-1 ring-slate-200"
          >
            {t("jobComplete.viewJob")}
          </button>
          <button onClick={onDismiss} className="w-full px-4 py-1.5 text-sm font-medium text-slate-500">
            {t("jobComplete.keepScanning")}
          </button>
        </div>
      </div>
    </div>
  );
}
