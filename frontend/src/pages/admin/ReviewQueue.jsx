import { useEffect, useState } from "react";
import { api } from "../../api";
import PhotoThumb from "../../components/PhotoThumb";

function ResolveRow({ event, onResolved }) {
  const [candidates, setCandidates] = useState(null);
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/admin/jobs?manifest_id=${event.manifest_id}`).then((d) => setCandidates(d.jobs));
  }, [event.manifest_id]);

  async function handleResolve() {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/events/${event.id}/resolve`, { job_id: Number(jobId) });
      onResolved(event.id);
    } catch (err) {
      setError(err.detail || "resolve failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {event.driver_name} — {event.status_code}
          </p>
          <p className="text-xs text-slate-500">{event.occurred_at}</p>
        </div>
        <PhotoThumb photoId={event.photo_id} size="h-16 w-16" />
      </div>
      <p className="mt-2 text-xs text-slate-600">
        Driver tapped job with tracking no. <span className="font-medium">{event.tapped_tracking_no || "(none)"}</span>
        {event.ocr_candidate_text && (
          <>
            {" "}
            — OCR read <span className="font-medium">"{event.ocr_candidate_text}"</span> from the slip
          </>
        )}
        , but no confident match was found on the {event.work_date} manifest.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={jobId} onChange={(e) => setJobId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Link to job…</option>
          {candidates?.map((j) => (
            <option key={j.id} value={j.id}>
              {j.tracking_no || `#${j.id}`} — {j.recipient_name || "—"} ({j.status_code})
            </option>
          ))}
        </select>
        <button
          onClick={handleResolve}
          disabled={!jobId || busy}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Linking…" : "Resolve"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </li>
  );
}

export default function ReviewQueue() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    api
      .get("/admin/events/orphans")
      .then((d) => setEvents(d.events))
      .catch((err) => setError(err.detail || "could not load review queue"));
  }

  useEffect(load, []);

  function handleResolved(eventId) {
    setEvents((evs) => evs.filter((e) => e.id !== eventId));
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!events) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        Delivered check-ins where the delivery-order slip couldn't be automatically matched to a manifest job.
      </p>
      <ul className="space-y-3">
        {events.map((ev) => (
          <ResolveRow key={ev.id} event={ev} onResolved={handleResolved} />
        ))}
        {events.length === 0 && <p className="text-sm text-slate-500">Nothing needs review right now.</p>}
      </ul>
    </div>
  );
}
