import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import AppHeader from "../../components/AppHeader";
import BarcodeScanner from "../../components/BarcodeScanner";
import Icon from "../../components/Icon";
import DeliveryOutcomeModal from "../../components/DeliveryOutcomeModal";
import JobCompleteModal from "../../components/JobCompleteModal";
import ScanResultModal from "../../components/ScanResultModal";
import { useLanguage } from "../../i18n/LanguageContext";
import { positionForSubmit } from "../../lib/geolocation";

export default function ScanComplete() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t } = useLanguage();
  // Opened from one drop's row, so everything scanned here belongs to that
  // drop. Without it the server had to guess which job an order joined, and
  // an order tied to the wrong stop is worse than one tied to none.
  const tripJobId = params.get("trip_job");
  const tripJobSeq = params.get("seq");
  const [log, setLog] = useState([]);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingCode, setPendingCode] = useState(null);
  const [result, setResult] = useState(null);
  const [completedManifestId, setCompletedManifestId] = useState(null);
  const [showJobComplete, setShowJobComplete] = useState(false);
  // Orders successfully recorded on this visit, so the driver can see the drop
  // adding up without opening anything.
  const [scanned, setScanned] = useState(0);
  // The next drop still waiting, handed back with the outcome so the driver
  // can walk straight to it instead of going back out to the trip to find it.
  const [nextDrop, setNextDrop] = useState(null);

  // Moving to the next drop reuses this route with a different query, so React
  // keeps the component mounted -- without this the running count, the log and
  // the last result would follow the driver to the next doorstep.
  useEffect(() => {
    setScanned(0);
    setLog([]);
    setResult(null);
    setNextDrop(null);
    setPendingCode(null);
  }, [tripJobId]);

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

  async function handleSubmitOutcome(code, outcome, reason, photos) {
    setBusy(true);
    try {
      const position = await positionForSubmit();
      const formData = new FormData();
      formData.append("code", code);
      formData.append("occurred_at", new Date().toISOString());
      if (position.lat != null) formData.append("lat", position.lat);
      if (position.lng != null) formData.append("lng", position.lng);
      if (outcome === "failed") formData.append("reason", reason);
      if (tripJobId) formData.append("trip_job_id", tripJobId);
      const shots = Array.isArray(photos) ? photos : photos ? [photos] : [];
      shots.forEach((f) => formData.append("photos", f));

      const res = await api.postForm(outcome === "delivered" ? "/scans/complete" : "/scans/fail", formData);

      const message = outcome === "delivered" ? t("scanComplete.delivered") : t("scanComplete.markedFailed");
      const logMessage = outcome === "failed" ? t("scanComplete.failedWithReason", { reason }) : message;
      setLog((l) => [{ code, ok: true, message: logMessage }, ...l]);
      setResult({ code, tone: outcome === "delivered" ? "success" : "warning", message });
      setScanned((n) => n + 1);
      setNextDrop(res.next_drop || null);
      if (res.job_complete) setCompletedManifestId(res.manifest_id);
    } catch (err) {
      const message = err.detail || t("scanComplete.genericFailed");
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
      <AppHeader
        backTo="/driver"
        title={tripJobSeq ? t("scanComplete.titleForJob", { n: tripJobSeq }) : t("scanComplete.title")}
      />
      <div className="mx-auto max-w-md px-4 py-6">
        <p className="text-sm text-slate-500">{t("scanComplete.instructions")}</p>

        <div className="mt-4">
          <BarcodeScanner onDetect={handleDetect} />
        </div>

        <form onSubmit={handleManualSubmit} className="mt-4 flex gap-2">
          <input
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder={t("scanRegister.manualPlaceholder")}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700">
            {t("scanRegister.add")}
          </button>
        </form>

        {scanned > 0 && (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
            <Icon name="check" className="h-4 w-4 shrink-0" />
            {t("scanComplete.scannedSoFar", { n: scanned })}
          </p>
        )}

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
          {tripJobSeq ? t("scanComplete.backToJob", { n: tripJobSeq }) : t("common.done")}
        </button>
      </div>

      <DeliveryOutcomeModal code={pendingCode} busy={busy} onSubmit={handleSubmitOutcome} />
      <ScanResultModal
        result={result}
        onClose={handleResultClose}
        scannedCount={scanned}
        // Only when the scanner was opened from a drop: that driver came here
        // to record one stop and has somewhere to be returned to. A scan
        // started from the trip screen has no such destination, so it keeps
        // the plain OK.
        onFinish={tripJobId && !completedManifestId ? () => navigate("/driver") : null}
        nextDrop={completedManifestId ? null : nextDrop}
        onNextDrop={
          nextDrop
            ? () => navigate(`/driver/scans/complete?trip_job=${nextDrop.id}&seq=${nextDrop.seq}`)
            : null
        }
      />
      <JobCompleteModal
        open={showJobComplete}
        onViewJob={() => navigate(`/driver/manifests/${completedManifestId}`)}
        onGoHome={() => navigate("/driver")}
        onDismiss={() => {
          setShowJobComplete(false);
          setCompletedManifestId(null);
        }}
      />
    </main>
  );
}
