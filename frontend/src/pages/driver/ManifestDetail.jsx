import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reprocessing, setReprocessing] = useState(false);

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

  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  const { manifest, jobs } = data;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <Link to="/driver" className="text-sm text-slate-500 underline">
          ← Back
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">{manifest.work_date}</h1>

        {manifest.ocr_status === "pending" && <p className="mt-2 text-sm text-slate-500">Still reading the manifest…</p>}
        {manifest.ocr_status === "failed" && (
          <div className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            <p>Could not read this manifest{manifest.ocr_error ? `: ${manifest.ocr_error}` : "."}</p>
            <button onClick={handleReprocess} disabled={reprocessing} className="mt-2 font-medium underline disabled:opacity-50">
              {reprocessing ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}

        <ul className="mt-4 space-y-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                to={`/driver/jobs/${job.id}/checkin`}
                className="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{job.tracking_no || "(no tracking no.)"}</p>
                  <p className="text-xs text-slate-500">{job.recipient_name || "—"}</p>
                  <p className="text-xs text-slate-400">{job.address || "—"}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[job.status_code] || "bg-slate-100 text-slate-700"}`}>
                  {job.status_code}
                </span>
              </Link>
            </li>
          ))}
          {jobs.length === 0 && manifest.ocr_status === "done" && (
            <p className="text-sm text-slate-500">No jobs were read from this manifest.</p>
          )}
        </ul>
      </div>
    </main>
  );
}
