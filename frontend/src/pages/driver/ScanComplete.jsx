import { useState } from "react";
import { api } from "../../api";
import AppHeader from "../../components/AppHeader";
import BarcodeScanner from "../../components/BarcodeScanner";
import DeliveryOutcomeModal from "../../components/DeliveryOutcomeModal";
import ScanResultModal from "../../components/ScanResultModal";
import { getPosition } from "../../lib/geolocation";

export default function ScanComplete() {
  const [log, setLog] = useState([]);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingCode, setPendingCode] = useState(null);
  const [result, setResult] = useState(null);

  // A code is scanned -> ask Delivered/Failed before recording anything. Ignore
  // new scans while that choice, a reason submission, or a result confirmation is
  // still on screen -- one scan is handled at a time.
  function handleDetect(code) {
    if (busy || pendingCode || result) return;
    setPendingCode(code);
  }

  function handleManualSubmit(e) {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    setManualCode("");
    handleDetect(code);
  }

  async function handleDelivered(code) {
    setBusy(true);
    try {
      const position = await getPosition();
      await api.post("/scans/complete", {
        code,
        lat: position.lat,
        lng: position.lng,
        occurred_at: new Date().toISOString(),
      });
      setLog((l) => [{ code, ok: true, message: "Delivered" }, ...l]);
      setResult({ code, tone: "success", message: "Delivered" });
    } catch (err) {
      const message = err.detail || "Failed";
      setLog((l) => [{ code, ok: false, message }, ...l]);
      setResult({ code, tone: "error", message });
    } finally {
      setBusy(false);
      setPendingCode(null);
    }
  }

  async function handleFail(code, reason) {
    setBusy(true);
    try {
      const position = await getPosition();
      await api.post("/scans/fail", {
        code,
        reason,
        lat: position.lat,
        lng: position.lng,
        occurred_at: new Date().toISOString(),
      });
      setLog((l) => [{ code, ok: true, message: `Failed — ${reason}` }, ...l]);
      setResult({ code, tone: "warning", message: "Marked as failed" });
    } catch (err) {
      const message = err.detail || "Failed";
      setLog((l) => [{ code, ok: false, message }, ...l]);
      setResult({ code, tone: "error", message });
    } finally {
      setBusy(false);
      setPendingCode(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader backTo="/driver" title="Scan to complete a delivery" />
      <div className="mx-auto max-w-md px-4 py-6">
        <p className="text-sm text-slate-500">
          Scan the order's barcode, then say whether it was delivered or the attempt failed. We'll log the time and
          location automatically.
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
      </div>

      <DeliveryOutcomeModal code={pendingCode} busy={busy} onDelivered={handleDelivered} onFail={handleFail} />
      <ScanResultModal result={result} onClose={() => setResult(null)} />
    </main>
  );
}
