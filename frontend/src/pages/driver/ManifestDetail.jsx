import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api";
import AppHeader from "../../components/AppHeader";

const STATUS_STYLES = {
  registered: "bg-slate-100 text-slate-700",
  delivered: "bg-emerald-100 text-emerald-800",
  failed: "bg-amber-100 text-amber-800",
  cancelled: "bg-slate-100 text-slate-500",
};

export default function ManifestDetail() {
  const { manifestId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  function load() {
    api
      .get(`/manifests/${manifestId}`)
      .then(setData)
      .catch((err) => setError(err.detail || "could not load job"));
  }

  useEffect(load, [manifestId]);

  async function handleCancel() {
    if (!window.confirm("Cancel this job? Registered-but-undelivered orders will be voided. This can't be undone.")) {
      return;
    }
    setCancelling(true);
    setError(null);
    try {
      await api.post(`/manifests/${manifestId}/cancel`, {});
      load();
    } catch (err) {
      setError(err.detail || "could not cancel this job");
    } finally {
      setCancelling(false);
    }
  }

  if (error && !data) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  const { manifest, jobs } = data;
  const canCancel = !manifest.cancelled_at && jobs.every((j) => j.status_code === "registered");
  const isComplete = !manifest.cancelled_at && jobs.length > 0 && jobs.every((j) => j.status_code !== "registered");

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader backTo="/driver" />
      <div className="mx-auto max-w-md px-4 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-brand-black">{manifest.work_date}</h1>
          {isComplete && (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
              Job complete
            </span>
          )}
        </div>
        {manifest.warehouse_arrived_at && (
          <p className="mt-1 text-xs text-slate-400">Arrived at warehouse: {manifest.warehouse_arrived_at}</p>
        )}

        {manifest.cancelled_at && (
          <div className="mt-2 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
            <p>This job was cancelled.</p>
            <Link to="/driver" className="mt-2 inline-block font-medium underline">
              Back to home
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
          {jobs.length === 0 && <p className="text-sm text-slate-500">No orders scanned into this job yet.</p>}
        </ul>

        {!manifest.cancelled_at && (
          <div className="mt-6 grid grid-cols-1 gap-2">
            <Link
              to={`/driver/manifests/${manifestId}/register`}
              className="block rounded-lg bg-white px-4 py-2.5 text-center text-sm font-medium text-brand-black ring-1 ring-slate-200"
            >
              Scan more orders
            </Link>
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-brand-red ring-1 ring-brand-red/30 disabled:opacity-50"
              >
                {cancelling ? "Cancelling…" : "Cancel this job"}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
