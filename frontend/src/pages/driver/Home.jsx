import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useDriverAuth } from "../../auth/DriverAuthContext";
import { getPosition } from "../../lib/geolocation";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function Home() {
  const navigate = useNavigate();
  const { driver, logout } = useDriverAuth();
  const [manifests, setManifests] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api
      .get("/manifests")
      .then((d) => setManifests(d.manifests))
      .catch((err) => setError(err.detail || "could not load manifests"));
  }, []);

  const todayManifest = manifests?.find((m) => m.work_date === todayIso() && !m.cancelled_at);

  async function handleStartScanning() {
    // Only the first press of the day actually records an arrival time (the
    // backend is idempotent on this) -- later presses just navigate through.
    setStarting(true);
    try {
      const position = await getPosition();
      await api.post("/warehouse-arrival", {
        lat: position.lat,
        lng: position.lng,
        occurred_at: new Date().toISOString(),
      });
    } catch {
      // Best-effort logging -- don't block the driver from starting work over it.
    } finally {
      navigate("/driver/scans/register");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Hi, {driver?.name}</h1>
            <p className="text-sm text-slate-500">{todayIso()}</p>
          </div>
          <button onClick={logout} className="text-sm text-slate-500 underline">
            Log out
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 grid grid-cols-1 gap-3">
          <button
            onClick={handleStartScanning}
            disabled={starting}
            className="block rounded-2xl bg-slate-900 px-6 py-5 text-center text-sm font-medium text-white shadow-sm disabled:opacity-50"
          >
            {starting ? "One sec…" : todayManifest ? "Scan more orders" : "Scan orders to start today's job"}
          </button>
          <Link
            to="/driver/scans/complete"
            className="block rounded-2xl bg-white px-6 py-5 text-center text-sm font-medium text-slate-900 shadow-sm ring-1 ring-slate-200"
          >
            Scan to complete a delivery
          </Link>
        </div>

        {todayManifest && (
          <Link
            to={`/driver/manifests/${todayManifest.id}`}
            className="mt-6 block rounded-lg bg-white px-4 py-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200"
          >
            View today's jobs →
          </Link>
        )}

        {manifests !== null && manifests.length > 0 && (
          <div className="mt-8">
            <p className="text-sm font-medium text-slate-700">Past sessions</p>
            <ul className="mt-2 space-y-2">
              {manifests
                .filter((m) => m.work_date !== todayIso() || m.cancelled_at)
                .map((m) => (
                  <li key={m.id}>
                    <Link
                      to={`/driver/manifests/${m.id}`}
                      className="block rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-slate-200"
                    >
                      {m.work_date}
                      {m.cancelled_at ? " — cancelled" : ""}
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
