import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import BarcodeScanner from "../../components/BarcodeScanner";
import { getPosition } from "../../lib/geolocation";

export default function ScanComplete() {
  const [log, setLog] = useState([]);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function complete(code) {
    if (busy) return;
    setBusy(true);
    try {
      const position = await getPosition();
      await api.post("/scans/complete", {
        code,
        lat: position.lat,
        lng: position.lng,
        occurred_at: new Date().toISOString(),
      });
      setLog((l) => [{ code, ok: true, message: "delivered" }, ...l]);
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
    complete(code);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <Link to="/driver" className="text-sm text-slate-500 underline">
          ← Back
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">Scan to complete a delivery</h1>
        <p className="mt-1 text-sm text-slate-500">
          Scan the order's barcode when it's delivered. We'll log the time and location automatically.
        </p>

        <div className="mt-4">
          <BarcodeScanner onDetect={complete} />
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
    </main>
  );
}
