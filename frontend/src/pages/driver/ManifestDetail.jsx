import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";

const STATUS_STYLES = {
  pending: "bg-slate-100 text-slate-700",
  arrived: "bg-amber-100 text-amber-800",
  delivered: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-500",
};

export default function ManifestDetail() {
  const { manifestId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  function load() {
    api
      .get(`/manifests/${manifestId}`)
      .then(setData)
      .catch((err) => setError(err.detail || "could not load manifest"));
  }

  useEffect(load, [manifestId]);

  async function handleReprocess() {
    setReprocessing(true);
    try {
      await api.post(`/manifests/${manifestId}/reprocess`, {});
      load();
    } catch (err) {
      setError(err.detail || "reprocess failed");
    } finally {
      setReprocessing(false);
    }
  }

  async function handleCancel() {
    if (!window.confirm("Cancel this manifest? You'll need to upload a new photo to start over. This can't be undone.")) {
      return;
    }
    setCancelling(true);
    setError(null);
    try {
      await api.post(`/manifests/${manifestId}/cancel`, {});
      navigate("/driver/manifests/new");
    } catch (err) {
      setError(err.detail || "could not cancel this manifest");
    } finally {
      setCancelling(false);
    }
  }

  if (error && !data) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  const { manifest, jobs } = data;
  const canCancel = !manifest.cancelled_at && jobs.every((j) => j.status_code === "pending");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <Link to="/driver" className="text-sm text-slate-500 underline">
          ← Back
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">{manifest.work_date}</h1>

        {manifest.cancelled_at && (
          <div className="mt-2 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
            <p>This manifest was cancelled.</p>
            <Link to="/driver/manifests/new" className="mt-2 inline-block font-medium underline">
              Upload a new manifest
            </Link>
          </div>
        )}
        {!manifest.cancelled_at && manifest.ocr_status === "pending" && (
          <p className="mt-2 text-sm text-slate-500">Still reading the manifest…</p>
        )}
        {!manifest.cancelled_at && manifest.ocr_status === "failed" && (
          <div className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            <p>Could not read this manifest{manifest.ocr_error ? `: ${manifest.ocr_error}` : "."}</p>
            <button onClick={handleReprocess} disabled={reprocessing} className="mt-2 font-medium underline disabled:opacity-50">
              {reprocessing ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <ul className="mt-4 space-y-2">
          {jobs.map((job) => {
            const cancelled = job.status_code === "cancelled";
            const content = (
              <>
                <div>
                  <p className="text-sm font-medium text-slate-900">{job.tracking_no || "(no tracking no.)"}</p>
                  <p className="text-xs text-slate-500">{job.recipient_name || "—"}</p>
                  <p className="text-xs text-slate-400">{job.address || "—"}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[job.status_code] || "bg-slate-100 text-slate-700"}`}>
                  {job.status_code}
                </span>
              </>
            );
            return (
              <li key={job.id}>
                {cancelled ? (
                  <div className="flex items-center justify-between rounded-lg bg-white px-4 py-3 opacity-60 shadow-sm ring-1 ring-slate-200">
                    {content}
                  </div>
                ) : (
                  <Link
                    to={`/driver/jobs/${job.id}/checkin`}
                    className="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
                  >
                    {content}
                  </Link>
                )}
              </li>
            );
          })}
          {jobs.length === 0 && manifest.ocr_status === "done" && (
            <p className="text-sm text-slate-500">No jobs were read from this manifest.</p>
          )}
        </ul>

        {canCancel && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="mt-6 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-red-600 ring-1 ring-red-200 disabled:opacity-50"
          >
            {cancelling ? "Cancelling…" : "Cancel this manifest"}
          </button>
        )}
      </div>
    </main>
  );
}
