import { useEffect, useState } from "react";

// Shown right after a successful scan on the "complete a delivery" screen: the
// driver picks Delivered or Failed. Failed swaps in a reason textbox that must be
// submitted before the outcome is recorded -- there's no dismiss without choosing.
export default function DeliveryOutcomeModal({ code, busy, onDelivered, onFail }) {
  const [mode, setMode] = useState("choice"); // "choice" | "reason"
  const [reason, setReason] = useState("");

  useEffect(() => {
    setMode("choice");
    setReason("");
  }, [code]);

  if (!code) return null;

  function handleSubmitReason(e) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    onFail(code, trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-lg">
        <p className="text-center text-sm font-medium text-brand-black">{code}</p>

        {mode === "choice" ? (
          <>
            <p className="mt-1 text-center text-sm text-slate-500">What happened at this delivery?</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => onDelivered(code)}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Delivered
              </button>
              <button
                onClick={() => setMode("reason")}
                disabled={busy}
                className="rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
              >
                Failed
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmitReason}>
            <label className="mt-3 block text-left text-sm font-medium text-slate-700">
              Reason for failure
              <textarea
                required
                autoFocus
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !reason.trim()}
              className="mt-4 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Submit"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
