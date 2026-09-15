import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useLanguage } from "../i18n/LanguageContext";
import { resizeImage } from "../lib/imageResize";
import { placeFor } from "../lib/places";
import {
  GEO_DENIED,
  GEO_UNAVAILABLE,
  GEO_UNSUPPORTED,
  ensureWatch,
  getPosition,
  lastFix,
  subscribe,
  onPermissionChange,
  permissionState,
  quickProbe,
} from "../lib/geolocation";

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
  // What the server is going to write on the picture.
  //
  // The caption is burned server-side on purpose -- a stamp drawn by the
  // handset is a stamp the handset could be made to lie about -- so the preview
  // cannot show the finished pixels. It can show the VALUES, which is what a
  // driver actually wants to check: that the coordinates were found, and that
  // the step and the time are the ones he thinks he is recording.
  // Seeded from the app-wide fix, not from nothing. Starting blank here is
  // what made every checkpoint page ask for location again.
  const [fix, setFix] = useState(() => lastFix());
  const [perm, setPerm] = useState(null); // granted | prompt | denied | unsupported | unknown
  const [locating, setLocating] = useState(false);
  // The town the fix falls in, resolved from the same table the server
  // burns into the caption -- so the preview promises exactly what the
  // photo will say.
  const [place, setPlace] = useState(null);
  const cameraRef = useRef(null);
  const fileRef = useRef(null);

  // Object URLs are a real allocation, not a string. Released when the shot is
  // dropped or the sheet closes, or a long shift leaks every photo it took.
  useEffect(() => {
    return () => shots.forEach((s) => URL.revokeObjectURL(s.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const p = await getPosition();
      setFix(p);
      const state = await permissionState();
      setPerm(state);
      if (state === "granted") ensureWatch();
      return p;
    } finally {
      setLocating(false);
    }
  }, []);

  // Find out where we stand before asking for anything.
  //
  // Fetch straight away, so the fix is warm by the time the driver comes back
  // from the camera app -- the browser will not raise a prompt while another
  // app is in the foreground, which is exactly the moment the old code chose
  // to ask.
  //
  // This used to skip the fetch unless the Permissions API said "granted", to
  // avoid a dialog nobody tapped for. That caution cost more than it saved:
  // Chrome for Android reports "prompt" to plenty of drivers who have granted,
  // so the screen sat there offering a button to turn on something already on.
  // A probe costs a silent success where permission exists and a timeout where
  // it does not, and either answer is worth more than the guess.
  useEffect(() => {
    let live = true;
    // Whatever the watch reports, this screen shows -- so a fix obtained on the
    // home screen is already here when the page opens.
    const unsubscribe = subscribe((f) => live && f && setFix(f));
    permissionState().then((state) => {
      if (!live) return;
      setPerm(state);
      if (state === "granted") ensureWatch();
      // Probe whatever the Permissions API claims. On Chrome for Android it
      // reports "prompt" to people who have granted, and taking that at face
      // value is what put a "Turn on location" button in front of drivers
      // whose location was working fine. A granted probe returns silently; an
      // ungranted one costs a timeout and tells us the truth.
      if (!lastFix()) {
        quickProbe().then((res) => {
          if (!live) return;
          if (res.lat != null) { setFix(res); ensureWatch(); }
        });
      }
    });
    const off = onPermissionChange((state) => {
      setPerm(state);
      if (state === "granted") { ensureWatch(); locate(); }
    });
    return () => {
      live = false;
      unsubscribe();
      off();
    };
  }, [locate]);

  useEffect(() => {
    let live = true;
    if (fix?.lat == null) {
      setPlace(null);
      return undefined;
    }
    placeFor(fix.lat, fix.lng).then((p) => { if (live) setPlace(p); });
    return () => { live = false; };
  }, [fix?.lat, fix?.lng]);

  function publish(next) {
    setShots(next);
    onChange(max === 1 ? next[0]?.file || null : next.map((s) => s.file));
  }

  // A photo is about to become evidence, so this is the moment a missing fix
  // matters most. Retried when the first shot lands -- but only where the
  // browser can actually answer without raising a dialog. On "prompt" the
  // button below is the way in, deliberately: that is the tap the browser
  // wants to see before it will show the driver anything.
  useEffect(() => {
    if (shots.length === 0 || fix || locating) return;
    if (perm !== "granted" && perm !== "unknown") return;
    locate();
  }, [shots.length, fix, locating, perm, locate]);

  async function handleFiles(e) {
    const picked = Array.from(e.target.files || []).slice(0, max - shots.length);
    e.target.value = ""; // let the same file be picked twice running
    if (!picked.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const file of picked) {
        // One request carries every photo for the step, so the budget is
        // shared: four photos get a quarter each. Well inside the 1MB a
        // request body is usually allowed.
        const resized = await resizeImage(file, { maxBytes: Math.round((900 * 1024) / Math.max(1, max)) });
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

  // Which of the four location stories this is. Only one of them is "tap the
  // button and it will work", and the other three used to look identical.
  const hasFix = fix?.lat != null;
  const blocked = perm === "denied" || (!hasFix && fix?.code === GEO_DENIED);
  const off = !hasFix && fix?.code === GEO_UNAVAILABLE;
  const unsupported = perm === "unsupported" || fix?.code === GEO_UNSUPPORTED;

  let whereText;
  let whereTone = "text-amber-700";
  if (locating) whereText = t("photoCapture.stampLocating");
  else if (hasFix) {
    whereText = place
      ? `${place} · ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`
      : `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`;
    whereTone = "text-slate-700";
  } else if (unsupported) whereText = t("photoCapture.stampUnsupported");
  else if (blocked) whereText = t("photoCapture.stampBlocked");
  else if (off) whereText = t("photoCapture.stampOff");
  else if (fix) whereText = t("photoCapture.stampNoFix");
  else whereText = t("photoCapture.stampNotYet");

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

      {busy && <p className="mt-2 text-xs text-slate-500">{t("photoCapture.compressing")}</p>}

      {/* Shown from the moment the sheet opens, not after the first photo.
          Says what the server is about to write -- a driver who does not know
          the stamp is coming frames the shot for himself, not for a dispute --
          and, when the coordinates are missing, says so while there is still
          time to do something about it. */}
      <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs ring-1 ring-slate-200">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-600">
          <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
          {t("photoCapture.willBeStamped")}
        </p>
        <div className="flex justify-between gap-3">
          <span className="text-slate-500">{t("photoCapture.stampWhen")}</span>
          <span className="text-slate-700">{new Date().toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-slate-500">{t("photoCapture.stampWhere")}</span>
          <span className={whereTone}>{whereText}</span>
        </div>

        {/* The button exists so the browser's own dialog is raised by a real
            tap. A permission prompt fired from a background promise is one the
            browser is entitled to ignore -- and Chrome does. */}
        {!hasFix && !unsupported && !blocked && (
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-brand-black disabled:opacity-50"
          >
            <Icon name="pin" className="h-3.5 w-3.5" />
            {locating
              ? t("photoCapture.stampLocating")
              : fix
                ? t("photoCapture.locationRetry")
                : t("photoCapture.locationAllow")}
          </button>
        )}

        {/* Nothing this app does can undo a block -- only the driver can, in
            the browser's own settings -- so it says where they are instead of
            offering a button that would do nothing. */}
        {blocked && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 leading-snug text-amber-800 ring-1 ring-amber-200">
            {t("photoCapture.locationBlockedHow")}
          </p>
        )}
        {off && !blocked && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 leading-snug text-amber-800 ring-1 ring-amber-200">
            {t("photoCapture.locationOffHow")}
          </p>
        )}

        {/* Only says something when there is something to say. The panel
            already shows the time and the place; explaining whose clock it came
            from is a paragraph the driver reads once and never again. */}
        {!hasFix && !locating && (
          <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
            {t("photoCapture.stampOptionalNote")}
          </p>
        )}
      </div>

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
