import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import BarcodeScanner from "../../components/BarcodeScanner";
import { getPosition } from "../../lib/geolocation";

export default function ScanRegister() {
  const navigate = useNavigate();
  const [log, setLog] = useState([]);
  const [manifestId, setManifestId] = useState(null);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleDetect(code) {
    if (busy) return;
    setBusy(true);
    try {
      const position = await getPosition();
      const res = await api.post("/scans/register", {
        code,
        lat: position.lat,
        lng: position.lng,
        occurred_at: new Date().toISOString(),
      });
      setManifestId(res.manifest_id);
      setLog((l) => [{ code, ok: true, message: res.already_registered ? "already registered" : "registered" }, ...l]);
    } catch (err) {
      setLog((l) => [{ code, ok: false, message: err.detail || "failed" }, ...l]);
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
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <Link to="/driver" className="text-sm text-slate-500 underline">
          ← Back
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">Scan orders to start</h1>
        <p className="mt-1 text-sm text-slate-500">
          Point the camera at each order's barcode. We'll register every new one automatically.
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

        {manifestId && (
          <button
            onClick={() => navigate(`/driver/manifests/${manifestId}`)}
            className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
          >
            Done — view today's jobs ({registeredCount})
          </button>
        )}
      </div>
    </main>
  );
}
