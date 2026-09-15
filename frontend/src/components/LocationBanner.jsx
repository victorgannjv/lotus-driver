import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { useLanguage } from "../i18n/LanguageContext";
import {
  GEO_DENIED,
  GEO_UNAVAILABLE,
  ensureWatch,
  getPosition,
  lastFix,
  onPermissionChange,
  permissionState,
} from "../lib/geolocation";

// Ask at the top of the shift, not at the loading bay.
//
// Every coordinate this app records is collected inside a submit -- after the
// camera app has been and gone, in a promise the browser did not see anybody
// tap. That is the one moment a permission dialog is least likely to appear,
// and when it doesn't the checkpoint is simply filed without a location and
// nobody finds out until an admin needs it.
//
// SHOWN ONLY ON EVIDENCE THAT LOCATION WILL NOT WORK. The first version hid
// itself for "granted" and "unsupported" and showed for everything else, which
// got it backwards: "unknown" is what permissionState returns when the browser
// has no Permissions API to interrogate, or when the query throws -- common on
// Android WebViews -- and location may well be working perfectly. It also
// never looked at whether a fix had actually been obtained, so a driver who
// granted access still got told it was off. Silence is the default now, and
// the banner has to earn its place.
export default function LocationBanner() {
  const { t } = useLanguage();
  const [perm, setPerm] = useState(null);
  const [busy, setBusy] = useState(false);
  // A fix from anywhere in the app counts -- geolocation caches the last good
  // one, so if the photo screen already got coordinates there is nothing here
  // worth saying.
  const [fix, setFix] = useState(() => lastFix());
  const [result, setResult] = useState(null); // last attempt, for its error code

  const recheck = useCallback(async () => {
    const state = await permissionState();
    setPerm(state);
    if (state === "granted") await ensureWatch();
    setFix((current) => lastFix() || current);
  }, []);

  const ask = useCallback(async () => {
    setBusy(true);
    try {
      const p = await getPosition();
      setResult(p);
      if (p.lat != null) setFix(p);
      const state = await permissionState();
      setPerm(state);
      // Granted once, warm for the rest of the shift -- no later screen asks.
      if (state === "granted") await ensureWatch();
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    recheck();
    const off = onPermissionChange((s) => setPerm(s));
    // The fix for a block is made in the browser's own settings, which means
    // leaving this tab and coming back. onPermissionChange covers browsers
    // with a working Permissions API; this covers the ones that sent us here
    // in the first place.
    const onReturn = () => { if (!document.hidden) recheck(); };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [recheck]);

  // Coordinates in hand beat any opinion the Permissions API has.
  if (fix?.lat != null) return null;
  // Still checking, working, or a browser we cannot ask about. The photo screen
  // is the backstop for that last one -- it reports what actually happened at
  // the moment it mattered, rather than guessing here.
  if (perm === null || perm === "granted" || perm === "unsupported" || perm === "unknown") return null;

  const blocked = perm === "denied" || result?.code === GEO_DENIED;
  const deviceOff = !blocked && result?.code === GEO_UNAVAILABLE;

  // Three different problems, three different sentences. "Location is not
  // switched on" was being shown for all of them, including the case where
  // nothing is wrong and we simply have not asked yet.
  const title = blocked
    ? t("location.blockedTitle")
    : deviceOff
      ? t("location.offTitle")
      : t("location.needTitle");
  const body = blocked
    ? t("location.blockedHow")
    : deviceOff
      ? t("location.deviceOffHow")
      : t("location.why");

  return (
    <div className="mb-4 rounded-xl bg-amber-50 px-3 py-3 text-sm ring-1 ring-amber-200">
      <p className="flex items-start gap-2 font-semibold text-amber-900">
        <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0" />
        {title}
      </p>
      <p className="mt-1 leading-snug text-amber-800">{body}</p>
      {!blocked && (
        <button
          type="button"
          onClick={ask}
          disabled={busy}
          className="mt-2 w-full rounded-lg bg-brand-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? t("location.asking") : result ? t("location.retry") : t("location.allow")}
        </button>
      )}
    </div>
  );
}
