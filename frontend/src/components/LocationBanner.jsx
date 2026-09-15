import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { useLanguage } from "../i18n/LanguageContext";
import {
  GEO_DENIED,
  GEO_UNAVAILABLE,
  ensureWatch,
  everWorked,
  getPosition,
  lastFix,
  permissionState,
  quickProbe,
} from "../lib/geolocation";

// Ask at the top of the shift, not at the loading bay.
//
// Every coordinate this app records is collected inside a submit -- after the
// camera app has been and gone, in a promise the browser did not see anybody
// tap. That is the one moment a permission dialog is least likely to appear,
// and when it doesn't the checkpoint is filed without a location and nobody
// finds out until an admin needs it.
//
// IT ASKS THE DEVICE, NOT THE PERMISSIONS API. Earlier versions decided
// whether to nag from navigator.permissions.query, and on Chrome for Android
// that reports "prompt" to people who have plainly granted -- so the banner
// sat there after every reload insisting location was off while the app was
// happily stamping coordinates onto photos. Being wrong in that direction is
// the worst of the options: it teaches a driver to ignore the one warning
// that matters on the day location really is broken.
//
// So it runs a real probe when the screen opens. One attempt, network
// accuracy, content with a ten-minute-old cached position: where permission is
// granted that returns immediately and silently and the banner never renders.
// Only a probe that actually FAILS puts it on screen -- and once this device
// has ever produced a coordinate, that is remembered across reloads.
export default function LocationBanner() {
  const { t } = useLanguage();
  const [perm, setPerm] = useState(null);
  const [probe, setProbe] = useState(null); // last attempt; null while running
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  const check = useCallback(async () => {
    const res = await quickProbe();
    setProbe(res);
    const state = await permissionState();
    setPerm(state);
    if (res.lat != null || state === "granted") ensureWatch();
  }, []);

  // The explicit tap -- the only request a browser is obliged to raise a
  // dialog for.
  const ask = useCallback(async () => {
    setBusy(true);
    try {
      const p = await getPosition();
      setProbe(p);
      const state = await permissionState();
      setPerm(state);
      if (p.lat != null || state === "granted") ensureWatch();
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    check();
    const onReturn = () => { if (!document.hidden) check(); };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [check]);

  if (hidden) return null;
  // Working, or working a moment ago. Either way there is nothing to warn about.
  if (probe?.lat != null || lastFix()?.lat != null) return null;
  if (perm === "granted" || perm === "unsupported") return null;
  // Still probing. Silence beats a banner that appears and then withdraws.
  if (probe === null) return null;

  const blocked = perm === "denied" || probe.code === GEO_DENIED;
  const deviceOff = !blocked && probe.code === GEO_UNAVAILABLE;

  // A timeout means the fix was slow, not that anything is switched off -- a
  // steel-roofed loading bay does that routinely. If location has worked on
  // this device before, there is nothing here worth saying; the photo screen
  // reports it where it actually matters.
  if (!blocked && !deviceOff && everWorked()) return null;

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
      <p className="mt-1.5 text-[11px] text-amber-700/80">
        {t("location.state", { state: perm })} · {t("location.build", { build: __BUILD_ID__ })}
      </p>
      {!blocked && (
        <button
          type="button"
          onClick={ask}
          disabled={busy}
          className="mt-2 w-full rounded-lg bg-brand-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? t("location.asking") : probe ? t("location.retry") : t("location.allow")}
        </button>
      )}
      <button
        type="button"
        onClick={() => setHidden(true)}
        className="mt-1.5 w-full py-1.5 text-xs font-medium text-amber-800/80"
      >
        {t("location.dismiss")}
      </button>
    </div>
  );
}
