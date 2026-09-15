import { api } from "../api";

// "Puchong, Selangor" from a coordinate, on the client.
//
// The photo screen has to name a location BEFORE anything is uploaded, so it
// cannot ask the server per fix -- and a steel-roofed loading bay is the last
// place to make a round trip a precondition for showing the driver what is
// about to be written on his photo.
//
// The table comes from the backend with the settings the app already fetches
// at start-up, so there is still ONE list: backend/localities.py. If the two
// had their own copies they would drift, and the preview would promise a
// place name the burned caption did not use.
//
// Fetched once per session and held here. A failure is silent: no place name
// is a smaller problem than a blocked photo screen.
const MAX_KM = 25;

let table = null;
let pending = null;

async function load() {
  if (table) return table;
  if (!pending) {
    pending = api
      .get("/driver/app-settings")
      .then((d) => {
        table = Array.isArray(d?.localities) ? d.localities : [];
        return table;
      })
      .catch(() => {
        table = [];
        return table;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}

function km(lat1, lng1, lat2, lng2) {
  const r = (d) => (d * Math.PI) / 180;
  const dp = r(lat2 - lat1);
  const dl = r(lng2 - lng1);
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Same rule as the server: nearest known town, and nothing at all when the
// nearest is too far to name honestly.
export function nearest(lat, lng, list) {
  if (lat == null || lng == null || !list?.length) return null;
  let best = null;
  let bestKm = Infinity;
  for (const p of list) {
    const d = km(lat, lng, p.lat, p.lng);
    if (d < bestKm) {
      best = p;
      bestKm = d;
    }
  }
  if (!best || bestKm > MAX_KM) return null;
  return best.name === best.state ? best.state : `${best.name}, ${best.state}`;
}

export async function placeFor(lat, lng) {
  if (lat == null || lng == null) return null;
  return nearest(lat, lng, await load());
}

// For a screen that already holds a fix and wants the name synchronously
// after the table has loaded once.
export function placeForSync(lat, lng) {
  return nearest(lat, lng, table);
}

export function warmPlaces() {
  load();
}
