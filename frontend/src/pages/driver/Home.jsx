import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useDriverAuth } from "../../auth/DriverAuthContext";
import AppHeader from "../../components/AppHeader";
import LanguageSwitcher from "../../components/LanguageSwitcher";
import { useLanguage } from "../../i18n/LanguageContext";
import { getPosition } from "../../lib/geolocation";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function Home() {
  const navigate = useNavigate();
  const { driver, logout } = useDriverAuth();
  const { t } = useLanguage();
  const [manifests, setManifests] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api
      .get("/manifests")
      .then((d) => setManifests(d.manifests))
      .catch((err) => setError(err.detail || t("home.errorLoading")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Arrived at warehouse" always starts a brand-new job -- a driver may make more
  // than one warehouse trip a day (typically 1-2), and every order scanned after
  // this groups into whichever job was started most recently.
  async function handleArrived() {
    setStarting(true);
    setError(null);
    try {
      const position = await getPosition();
      const res = await api.post("/manifests/start", {
        lat: position.lat,
        lng: position.lng,
        occurred_at: new Date().toISOString(),
      });
      navigate(`/driver/manifests/${res.manifest.id}/register`);
    } catch (err) {
      setError(err.detail || t("home.errorStarting"));
      setStarting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader
        title={t("home.title")}
        right={
          <>
            <LanguageSwitcher />
            <Link to="/driver/profile" className="text-sm text-white/70 hover:text-white">
              {t("home.profile")}
            </Link>
            <button onClick={logout} className="text-sm text-white/70 hover:text-white">
              {t("home.logOut")}
            </button>
          </>
        }
      />
      <div className="mx-auto max-w-md px-4 py-6">
        <h2 className="text-lg font-semibold text-brand-black">{t("home.greeting", { name: driver?.name })}</h2>
        <p className="text-sm text-slate-500">{todayIso()}</p>
        <p className="text-sm text-slate-500">
          {t("home.outlet")} {driver?.warehouse_name || <Link to="/driver/profile" className="text-brand-red underline">{t("home.setOutlet")}</Link>}
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 grid grid-cols-1 gap-3">
          <button
            onClick={handleArrived}
            disabled={starting}
            className="block rounded-2xl bg-brand-red px-6 py-5 text-center text-sm font-medium text-white shadow-sm hover:bg-brand-red-dark disabled:opacity-50"
          >
            {starting ? t("home.oneSec") : t("home.arrivedButton")}
          </button>
          <Link
            to="/driver/scans/complete"
            className="block rounded-2xl bg-white px-6 py-5 text-center text-sm font-medium text-brand-black shadow-sm ring-1 ring-slate-200"
          >
            {t("home.scanToComplete")}
          </Link>
        </div>

        {manifests !== null && manifests.length > 0 && (
          <div className="mt-8">
            <p className="text-sm font-medium text-slate-700">{t("home.yourJobs")}</p>
            <ul className="mt-2 space-y-2">
              {manifests.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/driver/manifests/${m.id}`}
                    className="block rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-slate-200"
                  >
                    <span className="font-medium text-brand-black">{m.work_date}</span>
                    {m.warehouse_arrived_at && <span className="text-slate-500"> — {m.warehouse_arrived_at}</span>}
                    {m.cancelled_at && <span className="text-slate-400"> — {t("home.cancelled")}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
