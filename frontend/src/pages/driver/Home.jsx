import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useDriverAuth } from "../../auth/DriverAuthContext";
import ArrivalPhotoModal from "../../components/ArrivalPhotoModal";
import AppHeader from "../../components/AppHeader";
import LanguageSwitcher from "../../components/LanguageSwitcher";
import MyDay from "../../components/MyDay";
import TripTimeline from "../../components/TripTimeline";
import { useLanguage } from "../../i18n/LanguageContext";
import { getPosition } from "../../lib/geolocation";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Two surfaces, one screen: the trip in hand, and the day behind it.
//
// The trip view is deliberately single-action -- whatever comes next is the only
// button on it -- because this gets used one-handed in a loading bay. The day
// view is where a driver looks back, and what they open if anyone disputes how
// long a run took.
export default function Home() {
  const { driver, logout } = useDriverAuth();
  const { t } = useLanguage();
  const [tab, setTab] = useState("trip");
  const [trip, setTrip] = useState(undefined); // undefined = loading, null = none open
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [showArrivalPhoto, setShowArrivalPhoto] = useState(false);
  const [arrivalAttempt, setArrivalAttempt] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadTrip = useCallback(() => {
    api
      .get("/my-open-trip")
      .then((d) => setTrip(d.trip === null ? null : d))
      .catch((err) => {
        setTrip(null);
        setError(err.detail || t("home.errorLoading"));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadTrip();
    api
      .get("/driver/app-settings")
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [loadTrip]);

  // "Arrived at Lotus" always starts a brand-new trip -- a driver makes more than
  // one warehouse run a day, and every order scanned afterwards groups into
  // whichever trip was started most recently.
  function handleArrivedClick() {
    setError(null);
    setArrivalAttempt((n) => n + 1); // remounts the modal with a clean photo
    setShowArrivalPhoto(true);
  }

  async function handleArrivalConfirm(photo) {
    setStarting(true);
    try {
      const formData = new FormData();
      try {
        const position = await getPosition();
        if (position.lat != null) formData.append("lat", position.lat);
        if (position.lng != null) formData.append("lng", position.lng);
      } catch {
        // A refused or unavailable fix must not block the stamp: the time and
        // the photo are the evidence, GPS only corroborates them.
      }
      formData.append("occurred_at", new Date().toISOString());
      formData.append("photo", photo);
      await api.postForm("/manifests/start", formData);
      setShowArrivalPhoto(false);
      setStarting(false);
      setTab("trip");
      loadTrip();
      setRefreshKey((n) => n + 1);
    } catch (err) {
      setError(err.detail || t("home.errorStarting"));
      setShowArrivalPhoto(false);
      setStarting(false);
    }
  }

  const tabClass = (key) =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
      tab === key ? "bg-white text-brand-black shadow-sm" : "text-slate-500"
    }`;

  const tripFinished = trip && trip.trip && trip.next_checkpoint === null;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader
        greeting={driver?.name ? t("home.greeting", { name: driver.name }) : t("home.title")}
        place={driver?.warehouse_name}
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

      <div className="mx-auto max-w-md px-4 py-5">
        <div className="mb-4 flex gap-1 rounded-xl bg-slate-200/70 p-1">
          <button type="button" className={tabClass("trip")} onClick={() => setTab("trip")}>
            {t("home.tabTrip")}
          </button>
          <button type="button" className={tabClass("day")} onClick={() => setTab("day")}>
            {t("home.tabDay")}
          </button>
        </div>

        {tab === "trip" && (
          <>
            <p className="mb-3 text-sm text-slate-500">{todayIso()}</p>
            {!driver?.warehouse_name && (
              <p className="mb-3 text-sm text-slate-500">
                {t("home.outlet")}{" "}
                <Link to="/driver/profile" className="text-brand-red underline">
                  {t("home.setOutlet")}
                </Link>
              </p>
            )}
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

            {trip === undefined && <p className="text-sm text-slate-500">{t("common.loading")}</p>}

            {trip === null && (
              <>
                <button
                  onClick={handleArrivedClick}
                  disabled={starting}
                  className="block w-full rounded-2xl bg-brand-red px-6 py-5 text-center text-base font-semibold text-white shadow-sm hover:bg-brand-red-dark disabled:opacity-50"
                >
                  {starting ? t("home.oneSec") : t("checkpoint.arrived")}
                </button>
                <p className="mt-2 text-center text-xs text-slate-400">{t("trip.ctaHint")}</p>
                <Link
                  to="/driver/scans/complete"
                  className="mt-3 block rounded-2xl bg-white px-6 py-4 text-center text-sm font-medium text-brand-black shadow-sm ring-1 ring-slate-200"
                >
                  {t("home.scanToComplete")}
                </Link>
              </>
            )}

            {trip && trip.trip && (
              <TripTimeline
                manifestId={trip.trip.id}
                settings={settings}
                onChanged={() => setRefreshKey((n) => n + 1)}
              />
            )}

            {tripFinished && (
              <button
                onClick={handleArrivedClick}
                disabled={starting}
                className="mt-4 block w-full rounded-2xl bg-brand-red px-6 py-4 text-center text-base font-semibold text-white shadow-sm hover:bg-brand-red-dark disabled:opacity-50"
              >
                {starting ? t("home.oneSec") : t("home.startNextTrip")}
              </button>
            )}
          </>
        )}

        {tab === "day" && <MyDay refreshKey={refreshKey} />}
      </div>

      <ArrivalPhotoModal
        key={arrivalAttempt}
        open={showArrivalPhoto}
        busy={starting}
        onSubmit={handleArrivalConfirm}
        onCancel={() => setShowArrivalPhoto(false)}
      />
    </main>
  );
}
