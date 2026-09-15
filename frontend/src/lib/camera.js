// One camera stream for the whole session.
//
// Every scanner mount used to call getUserMedia itself and stop the tracks on
// unmount, so a driver who opened the scanner, scanned, came back and opened
// it again went through the whole acquisition each time -- and on any browser
// where the grant is not persistent, a permission prompt each time with it.
// Scanning is the most repeated action in the app; asking for the camera is
// the one thing it should do least.
//
// The stream is kept alive between mounts and handed back to whoever asks.
// Tracks are only really stopped when the page goes away, which is also the
// point at which the browser drops the camera indicator.
let stream = null;
let pending = null;

// Deliberately no explicit focusMode: on some Android/Chrome + camera-HAL
// combinations, asking for "continuous" selects a still-photo AF mode instead
// of the smoother CONTINUOUS_VIDEO that Chrome already defaults video capture
// to when nothing is specified.
const CONSTRAINTS = {
  facingMode: "environment",
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

function alive(s) {
  return !!s && s.getVideoTracks().some((t) => t.readyState === "live");
}

export async function acquireCamera() {
  if (alive(stream)) return stream;
  // A track can end on its own -- the OS camera taken by another app, or the
  // handset waking from sleep. Drop it and ask again rather than handing back
  // a dead stream.
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  // Two scanners mounting at once must not raise two prompts.
  if (!pending) {
    pending = navigator.mediaDevices
      .getUserMedia({ video: CONSTRAINTS })
      .then((s) => { stream = s; return s; })
      .finally(() => { pending = null; });
  }
  return pending;
}

// Deliberately does NOT stop the tracks. Kept for the next scanner mount; the
// browser releases everything on unload.
export function releaseCamera() {}

export function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", stopCamera);
}

// "granted" | "prompt" | "denied" | "unknown"
export async function cameraPermission() {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "camera" });
    return status.state;
  } catch {
    return "unknown"; // Firefox and some WebViews do not expose the camera name
  }
}
