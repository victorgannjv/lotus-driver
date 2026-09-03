// Blocking confirmation shown after every scan attempt (success or failure) --
// the driver must tap OK to dismiss before the scanner resumes reporting new
// codes, so two scans in quick succession can't be missed or conflated.
export default function ScanResultModal({ result, onClose }) {
  if (!result) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-lg">
        <p className={`text-2xl ${result.ok ? "text-emerald-600" : "text-brand-red"}`}>{result.ok ? "✓" : "✗"}</p>
        <p className="mt-2 text-sm font-medium text-brand-black">{result.code}</p>
        <p className={`mt-1 text-sm ${result.ok ? "text-emerald-700" : "text-brand-red"}`}>{result.message}</p>
        <button
          onClick={onClose}
          autoFocus
          className="mt-5 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark"
        >
          OK
        </button>
      </div>
    </div>
  );
}
