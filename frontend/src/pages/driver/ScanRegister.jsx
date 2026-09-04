import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../api";
import AppHeader from "../../components/AppHeader";
import BarcodeScanner from "../../components/BarcodeScanner";
import ScanResultModal from "../../components/ScanResultModal";
import { getPosition } from "../../lib/geolocation";

export default function ScanRegister() {
  const { manifestId } = useParams();
  const navigate = useNavigate();
  const [log, setLog] = useState([]);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function handleDetect(code) {
    // Ignore new scans while a result is still on screen or a request is in
    // flight -- one scan is confirmed at a time.
    if (busy || result) return;
    setBusy(true);
    try {
      const position = await getPosition();
      const res = await api.post("/scans/register", {
        code,
        manifest_id: Number(manifestId),
        lat: position.lat,
        lng: position.lng,
        occurred_at: new Date().toISOString(),
      });
      const message = res.already_registered ? "Already registered" : "Registered";
      setLog((l) => [{ code, ok: true, message }, ...l]);
      setResult({ code, tone: "success", message });
    } catch (err) {
      const message = err.detail || "Failed";
      setLog((l) => [{ code, ok: false, message }, ...l]);
      setResult({ code, tone: "error", message });
    } finally {
      setBusy(false);
    }
  }

  function handleManualSubmit(e) {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    setManualCode("");
    handleDetect(code);
  }

  const registeredCount = log.filter((e) => e.ok).length;

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader backTo={`/driver/manifests/${manifestId}`} title="Scan orders" />
      <div className="mx-auto max-w-md px-4 py-6">
        <p className="text-sm text-slate-500">
          Point the camera at each order's barcode. We'll register every new one into this job automatically.
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

        <div className="mt-6 grid grid-cols-1 gap-2">
          <button
            onClick={() => navigate(`/driver/manifests/${manifestId}`)}
            className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-brand-black ring-1 ring-slate-200"
          >
            View job{registeredCount > 0 ? ` (${registeredCount})` : ""}
          </button>
          <button
            onClick={() => navigate("/driver")}
            className="w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark"
          >
            Done
          </button>
        </div>
      </div>

      <ScanResultModal result={result} onClose={() => setResult(null)} />
    </main>
  );
}
