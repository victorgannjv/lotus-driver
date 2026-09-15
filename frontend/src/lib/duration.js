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

// "2026-09-15" -> "Mon 15 Sep". An ISO date sorts well and reads badly: on a
// dashboard scanned every morning, "2026-09-15" makes a person count back to
// work out whether that row is today.
//
// Month and weekday names are fixed rather than taken from toLocaleDateString.
// The browser's locale decides that otherwise -- en-GB renders September as
// "Sept", which is both wider than every other month and different from what
// the next person sees. A shared dashboard should read the same to everyone
// looking at it.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseISODate(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(iso) {
  const d = parseISODate(iso);
  if (!d) return iso || "";
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// The same, with the two labels that save the counting entirely.
export function formatDayRelative(iso) {
  const d = parseISODate(iso);
  if (!d) return iso || "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return `Today · ${formatDate(iso)}`;
  if (days === 1) return `Yesterday · ${formatDate(iso)}`;
  return formatDate(iso);
}

// "2026-09-07" -> "7 Sep", for an axis where the weekday is noise.
export function formatShortDate(iso) {
  const d = parseISODate(iso);
  if (!d) return iso || "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
