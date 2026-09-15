import { useEffect, useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import PhotoCapture from "./PhotoCapture";

// Shown right after a successful scan on the "complete a delivery" screen: the
// driver picks Delivered or Failed (Failed also collects a reason), then either
// way takes a proof photo before the outcome is actually recorded. There's no
// dismiss without completing every step.
export default function DeliveryOutcomeModal({ code, busy, onSubmit }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState("choice"); // "choice" | "reason" | "photo"
  const [outcome, setOutcome] = useState(null); // "delivered" | "failed"
  const [reason, setReason] = useState("");
  const [photos, setPhotos] = useState([]);

  useEffect(() => {
    setMode("choice");
    setOutcome(null);
    setReason("");
    setPhoto(null);
  }, [code]);

  if (!code) return null;

  function handleReasonSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) return;
    setMode("photo");
  }

  function handlePhotoSubmit(e) {
    e.preventDefault();
    if (photos.length === 0) return;
    onSubmit(code, outcome, reason.trim(), photos);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-lg">
        <p className="text-center text-sm font-medium text-brand-black">{code}</p>

        {mode === "choice" && (
          <>
            <p className="mt-1 text-center text-sm text-slate-500">{t("deliveryOutcome.whatHappened")}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setOutcome("delivered");
                  setMode("photo");
                }}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {t("deliveryOutcome.delivered")}
              </button>
              <button
                onClick={() => {
                  setOutcome("failed");
                  setMode("reason");
                }}
                disabled={busy}
                className="rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
              >
                {t("deliveryOutcome.failed")}
              </button>
            </div>
          </>
        )}

        {mode === "reason" && (
          <form onSubmit={handleReasonSubmit}>
            <label className="mt-3 block text-left text-sm font-medium text-slate-700">
              {t("deliveryOutcome.reasonLabel")}
              <textarea
                required
                autoFocus
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={!reason.trim()}
              className="mt-4 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
            >
              {t("deliveryOutcome.next")}
            </button>
          </form>
        )}

        {mode === "photo" && (
          <form onSubmit={handlePhotoSubmit}>
            <p className="mt-1 text-center text-sm text-slate-500">
              {outcome === "delivered" ? t("deliveryOutcome.proofOfDelivery") : t("deliveryOutcome.proofOfFailure")}
            </p>
            <div className="mt-3">
              {/* A proof of delivery is often more than one frame: the parcel at the
                door, the unit number, who took it. One was a choice nobody
                should have to make. */}
            <PhotoCapture
              label={t("deliveryOutcome.proofPhotoLabel")}
              onChange={(v) => setPhotos(Array.isArray(v) ? v : v ? [v] : [])}
              max={4}
              required
            />
            </div>
            <button
              type="submit"
              disabled={busy || photos.length === 0}
              className="mt-4 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
            >
              {busy ? t("deliveryOutcome.submitting") : t("deliveryOutcome.submit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
