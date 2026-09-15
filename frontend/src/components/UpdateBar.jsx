import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";
import { useLanguage } from "../i18n/LanguageContext";

// Tells the app when it is running an old copy of itself.
//
// index.html was cacheable, so phones stayed pinned to bundles that were days
// old: fixes shipped, the driver's screen did not change, and from the outside
// that is indistinguishable from the fix not working. We lost several rounds
// to it. nginx no longer lets index.html be cached, but a browser already
// holding a stale copy only discovers that when it decides to revalidate --
// which could be tomorrow.
//
// So the running app asks. version.json is written at build time and served
// no-cache; if what the server reports differs from what this bundle was
// built as, the bundle is old and the driver is offered a reload. Checked on
// open and whenever the app comes back to the foreground, because a driver's
// tab lives for days.
export default function UpdateBar() {
  const { t } = useLanguage();
  const [serverBuild, setServerBuild] = useState(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      if (body?.build) setServerBuild(body.build);
    } catch {
      // Offline in a loading bay is normal. Silence is right here: nothing is
      // wrong that the driver can act on.
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

  if (!serverBuild || serverBuild === __BUILD_ID__) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-brand-black px-3 py-2.5 text-sm text-white">
      <Icon name="alert" className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{t("update.available")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-brand-black"
      >
        {t("update.reload")}
      </button>
    </div>
  );
}
