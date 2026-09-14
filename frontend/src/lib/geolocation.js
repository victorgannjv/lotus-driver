// Where the driver was, and what to do when the phone won't say.
//
// The old version asked the browser once, with high accuracy and a 10 second
// deadline, and turned every possible failure into the same silent
// `{lat: null}`. On Chrome for Android that produced the worst outcome
// available: no coordinates, no prompt, and nothing on screen to tell the
// driver either had happened. Three separate causes were being flattened into
// that one silence --
//
//   1 PERMISSION_DENIED    the site was blocked, now or at some point in the
//                          past. Chrome remembers, so the call fails instantly
//                          and NO prompt is ever shown again. Only the driver
//                          can undo this, from the browser's own site settings.
//   2 POSITION_UNAVAILABLE no source of location at all -- usually Android
//                          location services switched off at the OS level.
//   3 TIMEOUT              there is a fix to be had, it just wasn't ready in
//                          time. A steel-roofed loading bay is close to the
//                          worst place on earth for a GPS lock, and
//                          enableHighAccuracy with maximumAge: 0 forbade the
//                          browser from offering the network fix it already
//                          had.
//
// Each one now comes back with its code so the screen can say which it is, and
// 2 and 3 get a second, gentler attempt before anyone gives up.
export const GEO_DENIED = 1;
export const GEO_UNAVAILABLE = 2;
export const GEO_TIMEOUT = 3;
export const GEO_UNSUPPORTED = -1;

// A fix good enough to submit with, kept for a minute and a half.
//
// The gap between taking the photo and confirming the checkpoint is a walk
// across a yard, not a drive to the next outlet, so a fix from ninety seconds
// ago is still a fix from this place. It is only ever a fallback: every submit
// asks for a live position first and this is what it falls back to instead of
// sending nothing.
const FRESH_MS = 90_000;
let cached = null; // { lat, lng, accuracy, at }

const supported = () => typeof navigator !== "undefined" && "geolocation" in navigator;

function once(options) {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          error: null,
          code: 0,
        }),
      (err) => resolve({ lat: null, lng: null, accuracy: null, error: err.message, code: err.code }),
      options
    );
  });
}

// Resolves, never rejects: a refused or unavailable fix must not stop a driver
// submitting a checkpoint. `code` says why it is missing.
export async function getPosition({ timeout = 8000 } = {}) {
  if (!supported()) {
    return { lat: null, lng: null, error: "geolocation not supported", code: GEO_UNSUPPORTED };
  }

  let res = await once({ enableHighAccuracy: true, timeout, maximumAge: 0 });

  // Second chance for everything except an outright refusal. Dropping
  // enableHighAccuracy lets the browser answer from wifi and cell towers, and
  // maximumAge lets it hand over a fix it already has -- accurate to a street
  // rather than a doorway, which is all "was he at the outlet" needs.
  if (res.lat == null && res.code !== GEO_DENIED) {
    res = await once({ enableHighAccuracy: false, timeout: timeout + 7000, maximumAge: 120_000 });
  }

  if (res.lat != null) {
    cached = { lat: res.lat, lng: res.lng, accuracy: res.accuracy, at: Date.now() };
    return res;
  }

  const recent = lastFix();
  if (recent) return { ...recent, error: res.error, code: res.code, stale: true };
  return res;
}

export function lastFix() {
  if (!cached || Date.now() - cached.at > FRESH_MS) return null;
  return { lat: cached.lat, lng: cached.lng, accuracy: cached.accuracy, error: null, code: 0 };
}

// "granted" | "prompt" | "denied" | "unsupported" | "unknown"
//
// Worth knowing BEFORE anything is asked, because the three states need three
// different screens: granted can just fetch, prompt needs a tap to fire the
// browser's dialog, and denied can only be fixed in the browser's own settings
// -- asking again there does nothing at all.
export async function permissionState() {
  if (!supported()) return "unsupported";
  if (!navigator.permissions?.query) return "unknown"; // older WebViews: just try
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unknown";
  }
}

// Calls back when the driver changes the setting in another tab or in the
// browser's site settings, so the screen stops nagging without a reload.
export function onPermissionChange(fn) {
  if (!supported() || !navigator.permissions?.query) return () => {};
  let status;
  const handler = () => fn(status.state);
  navigator.permissions
    .query({ name: "geolocation" })
    .then((s) => {
      status = s;
      s.addEventListener("change", handler);
    })
    .catch(() => {});
  return () => status?.removeEventListener("change", handler);
}
