import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";

const STATUS_STYLES = {
  pending: "bg-slate-100 text-slate-700",
  arrived: "bg-amber-100 text-amber-800",
  delivered: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-500",
};

export default function Jobs() {
  const [statuses, setStatuses] = useState([]);
  const [status, setStatus] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/statuses").then((d) => setStatuses(d.statuses));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (needsReview) params.set("needs_review", "true");
    api
      .get(`/admin/jobs?${params.toString()}`)
      .then((d) => setJobs(d.jobs))
      .catch((err) => setError(err.detail || "could not load jobs"));
  }, [status, needsReview]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={needsReview} onChange={(e) => setNeedsReview(e.target.checked)} />
          Needs review only
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!jobs && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {jobs && (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Tracking No.</th>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-4 py-3">
                    <Link to={`/admin/jobs/${job.id}`} className="font-medium text-slate-900 underline">
                      {job.tracking_no || `#${job.id}`}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{job.recipient_name || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{job.driver_name}</td>
                  <td className="px-4 py-3 text-slate-600">{job.work_date}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[job.status_code] || "bg-slate-100 text-slate-700"}`}>
                      {job.status_code}
                    </span>
                    {job.needs_review && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                        needs review
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No jobs match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
