import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import AppHeader from "../../components/AppHeader";
import BarcodeScanner from "../../components/BarcodeScanner";
import DeliveryOutcomeModal from "../../components/DeliveryOutcomeModal";
import JobCompleteModal from "../../components/JobCompleteModal";
import ScanResultModal from "../../components/ScanResultModal";
import { getPosition } from "../../lib/geolocation";

export default function ScanComplete() {
  const navigate = useNavigate();
  const [log, setLog] = useState([]);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingCode, setPendingCode] = useState(null);
  const [result, setResult] = useState(null);
  const [completedManifestId, setCompletedManifestId] = useState(null);
  const [showJobComplete, setShowJobComplete] = useState(false);

  // A code is scanned -> ask Delivered/Failed (+ reason, + proof photo) before
  // recording anything. Ignore new scans while that flow, a result confirmation, or
  // the job-complete popup is still on screen -- one scan is handled at a time.
  function handleDetect(code) {
    if (busy || pendingCode || result || showJobComplete) return;
    setPendingCode(code);
  }

  function handleManualSubmit(e) {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    setManualCode("");
    handleDetect(code);
  }

  async function handleSubmitOutcome(code, outcome, reason, photo) {
    setBusy(true);
    try {
      const position = await getPosition();
      const formData = new FormData();
      formData.append("code", code);
      formData.append("occurred_at", new Date().toISOString());
      if (position.lat != null) formData.append("lat", position.lat);
      if (position.lng != null) formData.append("lng", position.lng);
      if (outcome === "failed") formData.append("reason", reason);
      formData.append("photo", photo);

      const res = await api.postForm(outcome === "delivered" ? "/scans/complete" : "/scans/fail", formData);

      const message = outcome === "delivered" ? "Delivered" : "Marked as failed";
      const logMessage = outcome === "failed" ? `Failed — ${reason}` : message;
      setLog((l) => [{ code, ok: true, message: logMessage }, ...l]);
      setResult({ code, tone: outcome === "delivered" ? "success" : "warning", message });
      if (res.job_complete) setCompletedManifestId(res.manifest_id);
    } catch (err) {
      const message = err.detail || "Failed";
      setLog((l) => [{ code, ok: false, message }, ...l]);
      setResult({ code, tone: "error", message });
    } finally {
      setBusy(false);
      setPendingCode(null);
    }
  }

  function handleResultClose() {
    setResult(null);
    if (completedManifestId) setShowJobComplete(true);
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader backTo="/driver" title="Scan to complete a delivery" />
      <div className="mx-auto max-w-md px-4 py-6">
        <p className="text-sm text-slate-500">
          Scan the order's barcode, then say whether it was delivered or the attempt failed, and take a photo as
          proof. We'll log the time and location automatically.
        </p>

        <div className="mt-4">
          <BarcodeScanner onDetect={handleDetect} />
        </div>

        <form onSubmit={handleManualSubmit} className="mt-4 flex gap-2">
          <input
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Or type the code manually"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700">
            Add
          </button>
        </form>

        <ul className="mt-4 space-y-1">
          {log.map((entry, i) => (
            <li
              key={i}
              className={`rounded-lg px-3 py-2 text-sm ${entry.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
            >
              {entry.code} — {entry.message}
            </li>
          ))}
        </ul>

        <button
          onClick={() => navigate("/driver")}
          className="mt-6 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark"
        >
          Done
        </button>
      </div>

      <DeliveryOutcomeModal code={pendingCode} busy={busy} onSubmit={handleSubmitOutcome} />
      <ScanResultModal result={result} onClose={handleResultClose} />
      <JobCompleteModal
        open={showJobComplete}
        onViewJob={() => navigate(`/driver/manifests/${completedManifestId}`)}
        onDismiss={() => {
          setShowJobComplete(false);
          setCompletedManifestId(null);
        }}
      />
    </main>
  );
}
