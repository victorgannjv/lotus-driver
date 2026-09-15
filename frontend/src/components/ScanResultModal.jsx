import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useLanguage } from "../i18n/LanguageContext";

const TONE_STYLES = {
  success: { icon: "check", ring: "bg-emerald-100 text-emerald-700", textClass: "text-emerald-700" },
  warning: { icon: "alert", ring: "bg-amber-100 text-amber-700", textClass: "text-amber-700" },
  error: { icon: "alert", ring: "bg-rose-100 text-brand-red", textClass: "text-brand-red" },
};

// Confirmation after every scan attempt. The scanner stays paused behind it, so
// two scans in quick succession cannot be conflated.
//
// A SUCCESS TAKES THE DRIVER BACK. Scanning a parcel used to end in a dialog
// that said the outcome and then sat there: tap OK, then find Done, then tap
// that -- three actions to finish one parcel, at a door, holding the rest of
// them. When the scanner was opened for a particular drop, a good outcome now
// counts down and returns on its own, with "Scan another" for the driver who
// has more parcels for the same stop. Failures never auto-close: those are the
// ones worth reading.
const AUTO_RETURN_SECONDS = 4;

export default function ScanResultModal({ result, onClose, onFinish, scannedCount = 0 }) {
  const { t } = useLanguage();
  const autoReturn = !!onFinish && result?.tone === "success";
  const [left, setLeft] = useState(AUTO_RETURN_SECONDS);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!result) return undefined;
    setLeft(AUTO_RETURN_SECONDS);
    setHeld(false);
  }, [result]);

  useEffect(() => {
    if (!result || !autoReturn || held) return undefined;
    if (left <= 0) {
      onFinish();
      return undefined;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [result, autoReturn, held, left, onFinish]);

  if (!result) return null;
  const tone = TONE_STYLES[result.tone] || TONE_STYLES.success;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-lg">
        <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${tone.ring}`}>
          <Icon name={tone.icon} className="h-7 w-7" />
        </span>
        <p className={`mt-3 text-base font-semibold ${tone.textClass}`}>{result.message}</p>
        <p className="mt-1 break-all text-xs text-slate-500">{result.code}</p>
        {scannedCount > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {t("scanComplete.scannedSoFar", { n: scannedCount })}
          </p>
        )}

        {autoReturn && !held ? (
          <>
            <button
              onClick={onFinish}
              autoFocus
              className="mt-5 w-full rounded-lg bg-brand-red px-4 py-3 text-sm font-semibold text-white"
            >
              {t("scanComplete.backNow", { n: left })}
            </button>
            <button
              onClick={() => setHeld(true)}
              className="mt-2 w-full py-2 text-sm font-medium text-slate-500"
            >
              {t("scanComplete.scanAnother")}
            </button>
          </>
        ) : (
          <button
            onClick={onClose}
            autoFocus
            className="mt-5 w-full rounded-lg bg-brand-red px-4 py-3 text-sm font-semibold text-white"
          >
            {t("common.ok")}
          </button>
        )}
      </div>
    </div>
  );
}
