import { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import PhotoCapture from "./PhotoCapture";

// Shown when the driver taps "Arrived at warehouse" -- a photo proving they're
// actually there is required before the job (manifest) is created, same
// proof-photo pattern as a delivery outcome. No dismiss without a photo; Cancel
// just backs out without starting a job.
export default function ArrivalPhotoModal({ open, busy, onSubmit, onCancel }) {
  const { t } = useLanguage();
  const [photo, setPhoto] = useState(null);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!photo) return;
    onSubmit(photo);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-lg">
        <p className="text-center text-sm font-medium text-brand-black">{t("arrivalPhoto.title")}</p>
        <p className="mt-1 text-center text-sm text-slate-500">{t("arrivalPhoto.instructions")}</p>
        <form onSubmit={handleSubmit}>
          <div className="mt-3">
            <PhotoCapture label={t("arrivalPhoto.photoLabel")} onChange={setPhoto} required />
          </div>
          <button
            type="submit"
            disabled={busy || !photo}
            className="mt-4 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
          >
            {busy ? t("arrivalPhoto.submitting") : t("arrivalPhoto.submit")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="mt-2 w-full px-4 py-1.5 text-sm font-medium text-slate-500 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
        </form>
      </div>
    </div>
  );
}
