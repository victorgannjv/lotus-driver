import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useDriverAuth } from "../../auth/DriverAuthContext";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function Home() {
  const { driver, logout } = useDriverAuth();
  const [manifests, setManifests] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get("/manifests")
      .then((d) => setManifests(d.manifests))
      .catch((err) => setError(err.detail || "could not load manifests"));
  }, []);

  const todayManifest = manifests?.find((m) => m.work_date === todayIso() && !m.cancelled_at);

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

        {manifests === null && !error && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

        {manifests !== null && !todayManifest && (
          <Link
            to="/driver/manifests/new"
            className="mt-6 block rounded-2xl bg-slate-900 px-6 py-5 text-center text-sm font-medium text-white shadow-sm"
          >
            Upload today's manifest to start
          </Link>
        )}

        {todayManifest && (
          <Link
            to={`/driver/manifests/${todayManifest.id}`}
            className="mt-6 block rounded-2xl bg-white px-6 py-5 shadow-sm ring-1 ring-slate-200"
          >
            <p className="text-sm font-medium text-slate-900">Today's jobs</p>
            <p className="mt-1 text-sm text-slate-500">
              {todayManifest.ocr_status === "done" && "Tap to view your delivery jobs"}
              {todayManifest.ocr_status === "pending" && "Manifest is still being processed…"}
              {todayManifest.ocr_status === "failed" && "Manifest could not be read — tap to retry"}
            </p>
          </Link>
        )}

        {manifests !== null && manifests.length > 0 && (
          <div className="mt-8">
            <p className="text-sm font-medium text-slate-700">Past manifests</p>
            <ul className="mt-2 space-y-2">
              {manifests
                .filter((m) => m.work_date !== todayIso() || m.cancelled_at)
                .map((m) => (
                  <li key={m.id}>
                    <Link
                      to={`/driver/manifests/${m.id}`}
                      className="block rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-slate-200"
                    >
                      {m.work_date} — {m.cancelled_at ? "cancelled" : m.ocr_status}
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
