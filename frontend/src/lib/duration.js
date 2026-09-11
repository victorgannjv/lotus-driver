// One duration format for the whole app -- driver screens, admin screens and
// exports. Under an hour reads "47m", over it reads "1h 53m", exact hours read
// "2h". Nobody should have to convert 113 minutes in their head, and a figure
// has to mean the same thing wherever it appears.
export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  const neg = minutes < 0;
  const total = Math.abs(Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const body = h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
  return neg ? `−${body}` : body;
}

// "2026-09-11 08:05:12" -> "08:05". The API converts to Malaysia time before
// it serialises (backend/clocks.py), so what arrives is already the wall clock
// a driver would have read. Parsing this into a Date would re-apply the
// browser's own offset and shift it a second time.
export function formatTime(value) {
  if (!value) return "";
  const m = String(value).match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : String(value);
}

export function formatDayLabel(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
}
