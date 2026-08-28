// Renders off GET /api/statuses -- never a hardcoded status list, so adding a
// new status server-side (a one-row migration) shows up here with no code change.
export default function StatusPicker({ statuses, value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {statuses.map((s) => (
        <button
          key={s.code}
          type="button"
          onClick={() => onChange(s.code)}
          className={`rounded-lg px-4 py-3 text-sm font-medium ring-1 transition ${
            value === s.code
              ? "bg-slate-900 text-white ring-slate-900"
              : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          {s.label}
          {s.requires_photo && <span className="ml-1 text-xs opacity-70">📷</span>}
        </button>
      ))}
    </div>
  );
}
