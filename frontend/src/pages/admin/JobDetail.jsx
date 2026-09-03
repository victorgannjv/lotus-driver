import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api";

export default function JobDetail() {
  const { jobId } = useParams();
  const [job, setJob] = useState(null);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.get(`/admin/jobs/${jobId}`), api.get(`/admin/jobs/${jobId}/events`)])
      .then(([jobRes, eventsRes]) => {
        setJob(jobRes.job);
        setEvents(eventsRes.events);
      })
      .catch((err) => setError(err.detail || "could not load job"));
  }, [jobId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!job || !events) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div>
      <Link to="/admin/jobs" className="text-sm text-slate-500 underline">
        ← All jobs
      </Link>

      <div className="mt-3 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{job.tracking_no}</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{job.status_code}</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-slate-400">Driver</dt>
            <dd className="text-slate-700">
              {job.driver_name} ({job.driver_email})
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Session date</dt>
            <dd className="text-slate-700">{job.work_date}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Arrived at warehouse</dt>
            <dd className="text-slate-700">{job.warehouse_arrived_at || "—"}</dd>
          </div>
        </dl>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-slate-700">Event log</h3>
      <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">
        {events.map((ev) => (
          <li key={ev.id} className="relative rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-900">{ev.status_code}</span>
              <span className="text-xs text-slate-400">{ev.occurred_at}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {ev.lat != null ? `GPS: ${ev.lat.toFixed(5)}, ${ev.lng.toFixed(5)}` : "No GPS recorded"}
            </p>
          </li>
        ))}
        {events.length === 0 && <p className="text-sm text-slate-500">No events logged for this job yet.</p>}
      </ol>
    </div>
  );
}
