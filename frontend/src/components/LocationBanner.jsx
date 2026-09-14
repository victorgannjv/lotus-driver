import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { useLanguage } from "../i18n/LanguageContext";
import { GEO_DENIED, GEO_UNAVAILABLE, getPosition, onPermissionChange, permissionState } from "../lib/geolocation";

// Ask at the top of the shift, not at the loading bay.
//
// Every coordinate this app records is collected inside a submit -- after the
// camera app has been and gone, in a promise the browser did not see anybody
// tap. That is the one moment a permission dialog is least likely to appear,
// and when it doesn't the checkpoint is simply filed without a location and
// nobody finds out until an admin needs it.
//
// So the state of the permission gets its own line on the first screen of the
// day, with a real button behind it. Granted: the line is gone entirely, and
// nothing here ever shows again.
export default function LocationBanner() {
  const { t } = useLanguage();
  const [perm, setPerm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // last attempt, for its error code

  const ask = useCallback(async () => {
    setBusy(true);
    try {
      const p = await getPosition();
      setResult(p);
      setPerm(await permissionState());
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    permissionState().then((s) => live && setPerm(s));
    const off = onPermissionChange((s) => setPerm(s));
    return () => {
      live = false;
      off();
    };
  }, []);

  // Nothing to say when it works, and nothing useful to say on a browser that
  // has no geolocation at all.
  if (perm === null || perm === "granted" || perm === "unsupported") return null;

  const blocked = perm === "denied" || result?.code === GEO_DENIED;
  const off = !blocked && result?.code === GEO_UNAVAILABLE;

  return (
    <div className="mb-4 rounded-xl bg-amber-50 px-3 py-3 text-sm ring-1 ring-amber-200">
      <p className="flex items-start gap-2 font-semibold text-amber-900">
        <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0" />
        {blocked ? t("location.blockedTitle") : t("location.offTitle")}
      </p>
      <p className="mt-1 leading-snug text-amber-800">
        {blocked ? t("location.blockedHow") : off ? t("location.deviceOffHow") : t("location.why")}
      </p>
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
