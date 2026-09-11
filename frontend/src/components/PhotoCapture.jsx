import { useRef, useState } from "react";
import Icon from "./Icon";
import { useLanguage } from "../i18n/LanguageContext";
import { resizeImage } from "../lib/imageResize";

// Two explicit ways in, rather than one "Choose File" control.
//
// A single file input with capture="environment" opens the camera directly on
// most phones and a file browser on the rest -- so the driver could not choose,
// and on desktop it read as upload-only. Two buttons say what each one does:
// the camera one carries `capture`, the other deliberately does not.
export default function PhotoCapture({ label, onChange, required = false }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef(null);
  const fileRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const resized = await resizeImage(file);
      setPreview(URL.createObjectURL(resized));
      onChange(resized);
    } finally {
      setBusy(false);
      e.target.value = ""; // let the same file be picked twice running
    }
  }

  const btn =
    "flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-brand-black hover:bg-slate-50";

  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-brand-red">*</span>}
      </span>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />

      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" className="h-4 w-4" />
          {t("photoCapture.takePhoto")}
        </button>
        <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
          <Icon name="upload" className="h-4 w-4" />
          {t("photoCapture.chooseFile")}
        </button>
      </div>

      {/* Says up front what the server is going to do to the picture. A driver
          who does not know the stamp is coming frames the shot for himself, not
          for a dispute -- and wonders later who wrote on his photo. */}
      <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
        <Icon name="clock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("photoCapture.stampNote")}
      </p>

      {busy && <p className="mt-2 text-xs text-slate-500">{t("photoCapture.compressing")}</p>}
      {preview && (
        <div className="mt-3 flex items-center gap-3">
          <img src={preview} alt="" className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <Icon name="check" className="h-3.5 w-3.5" />
            {t("photoCapture.ready")}
          </span>
        </div>
      )}
    </div>
  );
}
