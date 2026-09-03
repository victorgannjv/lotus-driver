import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import AppHeader from "../../components/AppHeader";
import { getPosition } from "../../lib/geolocation";

const STATUS_STYLES = {
  registered: "bg-slate-100 text-slate-700",
  delivered: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-100 text-slate-500",
};

export default function ManifestDetail() {
  const { manifestId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [starting, setStarting] = useState(false);

  function load() {
    api
      .get(`/manifests/${manifestId}`)
      .then(setData)
      .catch((err) => setError(err.detail || "could not load manifest"));
  }

  useEffect(load, [manifestId]);

  async function handleCancel() {
    if (!window.confirm("Cancel this session? Registered-but-undelivered orders will be voided. This can't be undone.")) {
      return;
    }
    setCancelling(true);
    setError(null);
    try {
      await api.post(`/manifests/${manifestId}/cancel`, {});
      load();
    } catch (err) {
      setError(err.detail || "could not cancel this session");
    } finally {
      setCancelling(false);
    }
  }

  async function handleScanMore() {
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

  if (error && !data) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  const { manifest, jobs } = data;
  const canCancel = !manifest.cancelled_at && jobs.every((j) => j.status_code === "registered");

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader backTo="/driver" />
      <div className="mx-auto max-w-md px-4 py-6">
        <h1 className="text-lg font-semibold text-brand-black">{manifest.work_date}</h1>
        {manifest.warehouse_arrived_at && (
          <p className="mt-1 text-xs text-slate-400">Arrived at warehouse: {manifest.warehouse_arrived_at}</p>
        )}

        {manifest.cancelled_at && (
          <div className="mt-2 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
            <p>This session was cancelled.</p>
            <Link to="/driver/scans/register" className="mt-2 inline-block font-medium underline">
              Start a new session
            </Link>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <ul className="mt-4 space-y-2">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
            >
              <p className="text-sm font-medium text-brand-black">{job.tracking_no}</p>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[job.status_code] || "bg-slate-100 text-slate-700"}`}>
                {job.status_code}
              </span>
            </li>
          ))}
          {jobs.length === 0 && <p className="text-sm text-slate-500">No orders scanned in this session yet.</p>}
        </ul>

        <div className="mt-6 grid grid-cols-1 gap-2">
          <button
            onClick={handleScanMore}
            disabled={starting}
            className="block rounded-lg bg-white px-4 py-2.5 text-center text-sm font-medium text-brand-black ring-1 ring-slate-200 disabled:opacity-50"
          >
            {starting ? "One sec…" : "Scan more orders"}
          </button>
          {canCancel && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-brand-red ring-1 ring-brand-red/30 disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Cancel this session"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
