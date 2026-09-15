import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useDriverAuth } from "../../auth/DriverAuthContext";
import AppHeader from "../../components/AppHeader";
import Icon from "../../components/Icon";
import LanguageSwitcher from "../../components/LanguageSwitcher";
import LocationBanner from "../../components/LocationBanner";
import UpdateBar from "../../components/UpdateBar";
import MyDay from "../../components/MyDay";
import TripTimeline from "../../components/TripTimeline";
import { useLanguage } from "../../i18n/LanguageContext";
import { ensureWatch, positionForSubmit } from "../../lib/geolocation";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Two surfaces, one screen: the trip in hand, and the day behind it.
//
// The trip view shows the whole run from the first screen -- all six
// checkpoints, with the next one as the only button -- rather than hiding the
// shape of the work behind a bare start button. A driver makes two or three
// runs a day, so today's trips sit as tabs above it.
export default function Home() {
  const { driver, logout } = useDriverAuth();
  const { t } = useLanguage();
  const [tab, setTab] = useState("trip");
  const [today, setToday] = useState(null); // today's trips, oldest first
  const [selected, setSelected] = useState(null); // manifest id, or null = not started
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadToday = useCallback(
    (selectLast = true) => {
      const d = todayIso();
      api
        .get(`/my-days?date_from=${d}&date_to=${d}`)
        .then((res) => {
          const trips = res.days[0]?.trips || [];
          setToday(trips);
          if (selectLast) setSelected(trips.length ? trips[trips.length - 1].id : null);
        })
        .catch((err) => {
          setToday([]);
          setError(err.detail || t("home.errorLoading"));
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    loadToday();
    api
      .get("/driver/app-settings")
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [loadToday]);

  // Once permission is granted, keep a position warm for the whole shift.
  // Without this every screen starts from nothing and asks again.
  useEffect(() => { ensureWatch(); }, []);

  // "Arrived at Lotus" always creates a NEW trip -- a driver makes more than one
  // run a day, and every order scanned afterwards groups into the newest one.
  async function startTrip(photos) {
    const shots = Array.isArray(photos) ? photos : photos ? [photos] : [];
    setStarting(true);
    setError(null);
    try {
      const formData = new FormData();
      try {
        const position = await positionForSubmit();
        if (position.lat != null) formData.append("lat", position.lat);
        if (position.lng != null) formData.append("lng", position.lng);
      } catch {
        // A refused or unavailable fix must not block the stamp: the time and
        // the photo are the evidence, GPS only corroborates them.
      }
      formData.append("occurred_at", new Date().toISOString());
      // One field name, repeated -- the same shape every other step posts.
      shots.forEach((f) => formData.append("photos", f));
      const res = await api.postForm("/manifests/start", formData);
      setSelected(res.manifest.id);
      loadToday(false);
      setRefreshKey((n) => n + 1);
    } catch (err) {
      setError(err.detail || t("home.errorStarting"));
    } finally {
      setStarting(false);
    }
  }

  const tabClass = (key) =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
      tab === key ? "bg-white text-brand-black shadow-sm" : "text-slate-500"
    }`;

  const tripTabClass = (active) =>
    `flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
      active ? "border-brand-black bg-brand-black text-white" : "border-slate-300 bg-white text-slate-600"
    }`;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader
        homeTo="/driver"
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
            {/* Asked here, where a tap can still raise the browser's dialog --
                not from inside a submit, half a second after the camera app
                handed the screen back. */}
            <UpdateBar />
            <LocationBanner />

            {/* Today's runs. A driver does two or three, and needs to be able to
                look back at the earlier one without leaving the screen. */}
            {today && today.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {today.map((trip, i) => {
                  const finished = !!trip.ended_at;
                  return (
                    <button
                      key={trip.id}
                      type="button"
                      onClick={() => setSelected(trip.id)}
                      aria-pressed={selected === trip.id}
                      className={tripTabClass(selected === trip.id)}
                    >
                      {t("myDay.trip", { n: i + 1 })}
                      {finished && <Icon name="check" className="h-3 w-3" />}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-pressed={selected === null}
                  className={`rounded-full border border-dashed px-3 py-1.5 text-xs font-semibold ${
                    selected === null ? "border-brand-black text-brand-black" : "border-slate-300 text-slate-400"
                  }`}
                >
                  {t("home.addTrip")}
                </button>
              </div>
            )}

            {!driver?.warehouse_name && (
              <p className="mb-3 text-sm text-slate-500">
                {t("home.outlet")}{" "}
                <Link to="/driver/profile" className="text-brand-red underline">
                  {t("home.setOutlet")}
                </Link>
              </p>
            )}
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

            {today === null ? (
              <p className="text-sm text-slate-500">{t("common.loading")}</p>
            ) : (
              <TripTimeline
                key={selected || "new"}
                manifestId={selected}
                settings={settings}
                starting={starting}
                onStart={startTrip}
                onChanged={() => {
                  loadToday(false);
                  setRefreshKey((n) => n + 1);
                }}
              />
            )}

          </>
        )}

        {tab === "day" && <MyDay refreshKey={refreshKey} />}

        {/* Always readable, so "which version is this phone on?" is a glance
            rather than an investigation. It cost us several rounds of fixing
            things that were already fixed. */}
        <p className="pb-2 pt-6 text-center text-[11px] text-slate-400">
          {t("update.build", { build: __BUILD_ID__ })}
        </p>
      </div>

    </main>
  );
}
