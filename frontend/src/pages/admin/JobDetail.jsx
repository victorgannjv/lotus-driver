import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api";
import PhotoThumb from "../../components/PhotoThumb";

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
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{job.tracking_no || `Job #${job.id}`}</h2>
            <p className="text-sm text-slate-500">{job.recipient_name || "—"}</p>
            <p className="text-sm text-slate-500">{job.address || "—"}</p>
          </div>
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
            <dt className="text-slate-400">Manifest date</dt>
            <dd className="text-slate-700">{job.work_date}</dd>
          </div>
        </dl>
        <PhotoThumb photoId={job.manifest_photo_id} size="mt-4 h-24 w-24" />
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
            {ev.match_type !== "n_a" && (
              <p className="mt-1 text-xs text-slate-500">
                OCR match: {ev.match_type} {ev.ocr_candidate_text && `(read "${ev.ocr_candidate_text}")`}
              </p>
            )}
            {ev.needs_review && <p className="mt-1 text-xs font-medium text-amber-700">Needs review</p>}
            <PhotoThumb photoId={ev.photo_id} size="mt-2 h-20 w-20" />
          </li>
        ))}
        {events.length === 0 && <p className="text-sm text-slate-500">No events logged for this job yet.</p>}
      </ol>
    </div>
  );
}
