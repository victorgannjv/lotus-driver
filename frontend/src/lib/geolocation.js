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
    remember(res);
    return res;
  }

  const recent = lastFix();
  if (recent) return { ...recent, error: res.error, code: res.code, stale: true };
  return res;
}

// ------------------------------------------------------- one fix, app-wide
//
// Permission is granted once; it should be asked for once. The first version
// kept location in component state, so every screen that wanted coordinates
// started from nothing -- home asked, then the photo page asked again, then
// the next checkpoint asked again. Three dialogs for one permission, and the
// driver reasonably concluded it had not worked.
//
// So the fix lives here instead, and screens subscribe. Once permission is
// granted a single watchPosition keeps it warm for the rest of the shift: the
// browser feeds us a position as it changes, every screen has one the moment
// it opens, and nothing has to ask again.
//
// A WATCH RATHER THAN A LONGER CACHE, deliberately. The obvious fix for "the
// photo page has no fix" is to widen the ninety-second window, but a
// twenty-minute-old fix from the hub burned onto a photo taken at the outlet
// is not a stale location -- it is a false one, and a false coordinate on a
// dispute document is worse than an empty field. A watch stays both fresh and
// instant.
const listeners = new Set();
let watchId = null;

// Survives reloads. navigator.permissions is the only thing that can tell us
// "you already have this", and on Chrome for Android it is not reliable enough
// to hang a nagging banner on -- it reports "prompt" to plenty of people who
// have granted. Once this device has actually produced a coordinate we know
// location works here, whatever the Permissions API says afterwards.
const WORKED_KEY = "njv.geo.worked";

export function everWorked() {
  try {
    return localStorage.getItem(WORKED_KEY) === "1";
  } catch {
    return false; // private mode, storage disabled -- fall back to asking
  }
}

function remember(res) {
  cached = { lat: res.lat, lng: res.lng, accuracy: res.accuracy, at: Date.now() };
  try { localStorage.setItem(WORKED_KEY, "1"); } catch { /* not worth failing over */ }
  const fix = lastFix();
  listeners.forEach((fn) => {
    try { fn(fix); } catch { /* one bad subscriber must not stop the rest */ }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Safe to call from anywhere, as often as you like. Starts nothing unless the
// permission is already granted -- watchPosition on "prompt" would raise a
// dialog nobody tapped for, which is the thing this whole module exists to
// avoid.
export async function ensureWatch() {
  if (watchId !== null || !supported()) return;
  if ((await permissionState()) !== "granted") return;
  if (watchId !== null) return; // a second caller may have won the await
  watchId = navigator.geolocation.watchPosition(
    (pos) => remember({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
    () => {},
    // Network-accurate is plenty to keep warm, and does not sit on the GPS for
    // a whole shift. Anything that actually gets submitted still asks for a
    // high-accuracy fix first.
    { enableHighAccuracy: false, maximumAge: 15_000, timeout: 30_000 },
  );
}

export function stopWatch() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// Cheap enough to run on every screen open: one attempt, network accuracy, and
// happy with a ten-minute-old cached position. Where permission is already
// granted this comes back immediately and silently, which is the whole point
// -- it is how the banner learns that location works without asking anybody.
export async function quickProbe() {
  if (!supported()) return { lat: null, lng: null, code: GEO_UNSUPPORTED, error: "unsupported" };
  const res = await once({ enableHighAccuracy: false, timeout: 6000, maximumAge: 600_000 });
  if (res.lat != null) remember(res);
  return res;
}

// What a SUBMIT should use. Never the long retry.
//
// getPosition is 8s of high-accuracy followed by 15s of network fallback --
// up to twenty-three seconds, and it was being awaited before the upload was
// even started. On a handset with no fix that is twenty-three seconds of a
// dead-looking screen after the driver taps Confirm, which reads as a failed
// upload and gets tapped again. The photo and the timestamp are the evidence;
// coordinates corroborate. They are not worth making anyone wait.
export async function positionForSubmit() {
  const warm = lastFix();
  if (warm) return warm;
  return quickProbe();   // one attempt, six seconds, then we send without it
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
