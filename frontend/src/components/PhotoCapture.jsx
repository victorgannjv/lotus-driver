import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useLanguage } from "../i18n/LanguageContext";
import { resizeImage } from "../lib/imageResize";

// Two explicit ways in, rather than one "Choose File" control.
//
// A single file input with capture="environment" opens the camera directly on
// most phones and a file browser on the rest -- so the driver could not choose,
// and on desktop it read as upload-only. Two buttons say what each one does:
// the camera one carries `capture`, the other deliberately does not.
//
// Several photos, not one. A checkpoint is argued from its pictures, and one
// frame of a loading bay cannot show the seal, the pallet and the invoice at
// once -- so the driver adds as many as the step allows, and the caller gets an
// array. `max={1}` keeps the single-photo flows exactly as they were.
//
// And the photos are reviewable BEFORE they are sent. They used to go up the
// moment the file was chosen, with a 80px thumbnail as the only feedback: a
// blurred shot or a thumb over the lens was found out after it had become
// evidence. Each one can now be opened full-screen and removed.
export default function PhotoCapture({ label, onChange, required = false, max = 4 }) {
  const { t } = useLanguage();
  const [shots, setShots] = useState([]); // { id, file, url }
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const cameraRef = useRef(null);
  const fileRef = useRef(null);

  // Object URLs are a real allocation, not a string. Released when the shot is
  // dropped or the sheet closes, or a long shift leaks every photo it took.
  useEffect(() => {
    return () => shots.forEach((s) => URL.revokeObjectURL(s.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function publish(next) {
    setShots(next);
    onChange(max === 1 ? next[0]?.file || null : next.map((s) => s.file));
  }

  async function handleFiles(e) {
    const picked = Array.from(e.target.files || []).slice(0, max - shots.length);
    e.target.value = ""; // let the same file be picked twice running
    if (!picked.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const file of picked) {
        const resized = await resizeImage(file);
        added.push({ id: `${Date.now()}-${added.length}`, file: resized, url: URL.createObjectURL(resized) });
      }
      publish(max === 1 ? added.slice(0, 1) : [...shots, ...added]);
    } finally {
      setBusy(false);
    }
  }

  function remove(id) {
    const gone = shots.find((s) => s.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    publish(shots.filter((s) => s.id !== id));
  }

  const full = shots.length >= max;
  const btn =
    "flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-brand-black hover:bg-slate-50 disabled:opacity-40";

  return (
    <div>
      <span className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">
          {label} {required && <span className="text-brand-red">*</span>}
        </span>
        {max > 1 && (
          <span className="text-xs text-slate-400">
            {t("photoCapture.count", { n: shots.length, max })}
          </span>
        )}
      </span>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFiles}
        className="hidden"
      />
      {/* `multiple` only on the library picker. A camera intent returns one
          frame whatever you ask it for, and on some handsets asking for both
          silently drops the capture hint and opens the gallery instead. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple={max > 1}
        onChange={handleFiles}
        className="hidden"
      />

      <div className="flex gap-2">
        <button type="button" disabled={full || busy} className={btn} onClick={() => cameraRef.current?.click()}>
          <Icon name="camera" className="h-4 w-4" />
          {shots.length > 0 && max > 1 ? t("photoCapture.addAnother") : t("photoCapture.takePhoto")}
        </button>
        <button type="button" disabled={full || busy} className={btn} onClick={() => fileRef.current?.click()}>
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

      {shots.length > 0 && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {shots.map((s, i) => (
              <span key={s.id} className="relative">
                <button
                  type="button"
                  onClick={() => setViewing(s)}
                  className="block h-20 w-20 overflow-hidden rounded-lg ring-1 ring-slate-200"
                  title={t("photoCapture.tapToCheck")}
                >
                  <img src={s.url} alt="" className="h-full w-full object-cover" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  aria-label={t("photoCapture.remove")}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/80 text-xs font-bold text-white"
                >
                  ✕
                </button>
                {max > 1 && (
                  <span className="absolute bottom-1 left-1 rounded bg-slate-900/70 px-1 text-[10px] font-semibold text-white">
                    {i + 1}
                  </span>
                )}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">{t("photoCapture.tapToCheck")}</p>
        </>
      )}

      {/* Full-screen check before it becomes evidence. */}
      {viewing && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/90 p-4"
          onClick={() => setViewing(null)}
        >
          <img src={viewing.url} alt="" className="min-h-0 flex-1 object-contain" />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(viewing.id);
                setViewing(null);
              }}
              className="flex-1 rounded-xl border border-white/40 px-4 py-3 text-sm font-semibold text-white"
            >
              {t("photoCapture.retake")}
            </button>
            <button
              type="button"
              onClick={() => setViewing(null)}
              className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-brand-black"
            >
              {t("photoCapture.looksRight")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
