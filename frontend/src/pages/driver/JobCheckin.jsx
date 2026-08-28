import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import PhotoCapture from "../../components/PhotoCapture";
import StatusPicker from "../../components/StatusPicker";
import { getPosition } from "../../lib/geolocation";

export default function JobCheckin() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [statuses, setStatuses] = useState([]);
  const [statusCode, setStatusCode] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [position, setPosition] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get("/statuses").then((d) => setStatuses(d.statuses));
    getPosition().then((pos) => {
      setPosition(pos);
      if (pos.error) setGpsError(pos.error);
    });
  }, []);

  const selectedStatus = statuses.find((s) => s.code === statusCode);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!statusCode) return;
    if (selectedStatus?.requires_photo && !photo) {
      setError(`Status "${selectedStatus.label}" requires a photo`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("status_code", statusCode);
      formData.append("occurred_at", new Date().toISOString());
      if (position?.lat != null) formData.append("lat", position.lat);
      if (position?.lng != null) formData.append("lng", position.lng);
      if (photo) formData.append("photo", photo);
      const res = await api.postForm(`/jobs/${jobId}/checkins`, formData);
      setResult(res);
    } catch (err) {
      setError(err.detail || "check-in failed");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-semibold text-slate-900">Check-in recorded</h1>
          {result.needs_review ? (
            <p className="mt-2 text-sm text-amber-700">
              We couldn't automatically match this delivery to a job on the manifest. It's
              logged and flagged for admin review.
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">Match type: {result.match_type}</p>
          )}
          <button
            onClick={() => navigate(-1)}
            className="mt-6 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
          >
            Back to jobs
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <button onClick={() => navigate(-1)} className="text-sm text-slate-500 underline">
          ← Back
        </button>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">Check in</h1>

        <form onSubmit={handleSubmit} className="mt-4 space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Status</p>
            <StatusPicker statuses={statuses} value={statusCode} onChange={setStatusCode} />
          </div>

          <div className="rounded-lg bg-white px-4 py-3 text-xs text-slate-500 ring-1 ring-slate-200">
            {position?.lat != null ? (
              <p>
                GPS: {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
              </p>
            ) : gpsError ? (
              <p>No GPS fix ({gpsError}) — check-in will still be recorded without coordinates.</p>
            ) : (
              <p>Getting GPS location…</p>
            )}
          </div>

          {selectedStatus?.requires_photo && <PhotoCapture label="Delivery order slip" onChange={setPhoto} required />}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={!statusCode || busy}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit check-in"}
          </button>
        </form>
      </div>
    </main>
  );
}
