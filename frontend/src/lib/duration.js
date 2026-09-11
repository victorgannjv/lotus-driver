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

// "2026-09-11 08:05:12" / ISO -> "08:05". Server sends naive local-ish strings,
// so this stays deliberately dumb rather than parsing into a Date and shifting
// the clock by a timezone nobody asked for.
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
