const TONE_STYLES = {
  success: { icon: "✓", iconClass: "text-emerald-600", textClass: "text-emerald-700" },
  warning: { icon: "⚠", iconClass: "text-amber-600", textClass: "text-amber-700" },
  error: { icon: "✗", iconClass: "text-brand-red", textClass: "text-brand-red" },
};

// Blocking confirmation shown after every scan attempt -- the driver must tap OK to
// dismiss before the scanner resumes reporting new codes, so two scans in quick
// succession can't be missed or conflated. `result.tone` picks the icon/color:
// "success" (registered/delivered), "warning" (recorded but not a good outcome,
// e.g. a failed delivery), "error" (the request itself didn't go through).
export default function ScanResultModal({ result, onClose }) {
  if (!result) return null;
  const tone = TONE_STYLES[result.tone] || TONE_STYLES.success;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-lg">
        <p className={`text-2xl ${tone.iconClass}`}>{tone.icon}</p>
        <p className="mt-2 text-sm font-medium text-brand-black">{result.code}</p>
        <p className={`mt-1 text-sm ${tone.textClass}`}>{result.message}</p>
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
