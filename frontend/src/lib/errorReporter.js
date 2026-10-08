// Reports what only the browser can see.
//
// A request that fails with a 4xx or 5xx is written to the error log by the
// server, with the real route and who asked -- reporting it again from here
// would count every one twice. What the server CANNOT see is everything that
// never reached it: a render crash, an uncaught exception, a promise nobody
// caught, a request that died on a bad signal, a gateway that answered instead
// of the app. Those come through here.
//
// Rules this file keeps, because it runs inside the failure it is describing:
//   - it never throws, and never reports its own failures (that is a loop);
//   - it uses plain fetch, not api.js, which reports errors through here;
//   - it is bounded -- the same error is sent once a minute, and a page sends
//     at most MAX_PER_PAGE, so a crash loop cannot flood the log or the phone;
//   - a report that could not be sent (no signal is exactly when drivers hit
//     problems) is kept and sent when the phone is back online, with its age,
//     so the log shows when it happened rather than when it got through.

const ENDPOINT = "/api/diagnostics/client-error";
const TOKEN_KEY = "lotus_driver_token"; // read directly: importing api.js would be circular
const QUEUE_KEY = "njv.errors.queue";
const MAX_PER_PAGE = 25;
const MAX_QUEUED = 20;
const DEDUPE_MS = 60_000;

const BUILD = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : null;

// Noise that says nothing about the app: a browser grumbling about its own
// layout loop, a cross-origin script that will not give details, and anything
// that comes from a browser extension rather than our code.
const IGNORED = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Non-Error promise rejection captured/i,
  /(chrome|moz|safari)-extension:/i,
];

const seen = new Map();
let sentThisPage = 0;

function surface() {
  return window.location.pathname.startsWith("/admin") ? "admin" : "driver";
}

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeQueue(items) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUED)));
  } catch {
    // Storage full or blocked. Losing a report is better than breaking the page.
  }
}

function enqueue(payload) {
  writeQueue([...readQueue(), { payload, queuedAt: Date.now() }]);
}

async function post(payload) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });
  // 4xx means the server looked at it and said no (rate limit, malformed) --
  // retrying the same thing later will not change the answer. Only a server
  // that could not answer is worth retrying.
  if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
}

export async function flushQueue() {
  try {
    const items = readQueue();
    if (!items.length || !navigator.onLine) return;
    writeQueue([]);
    for (const { payload, queuedAt } of items) {
      try {
        await post({ ...payload, age_seconds: Math.round((Date.now() - queuedAt) / 1000) });
      } catch {
        enqueue(payload);
      }
    }
  } catch {
    // never throws
  }
}

// kind: js_error | promise_rejection | render_error | network_error | gateway_error | test
export function reportError({ kind, message, stack, apiMethod, apiPath, status, level = "error" }) {
  try {
    const text = String(message || "").slice(0, 1000);
    if (!text) return;
    if (IGNORED.some((re) => re.test(text) || re.test(String(stack || "")))) return;

    // A query string can carry what someone typed into a search box.
    const path = apiPath ? String(apiPath).split("?")[0] : null;

    const key = [kind, apiMethod, path, status, text].join("|");
    const now = Date.now();
    if (now - (seen.get(key) || 0) < DEDUPE_MS) return;
    seen.set(key, now);
    if (sentThisPage >= MAX_PER_PAGE) return;
    sentThisPage += 1;

    const payload = {
      source: surface(),
      kind,
      level,
      message: text,
      stack: stack ? String(stack).slice(0, 8000) : null,
      page: window.location.pathname,
      method: apiMethod || null,
      api_path: path,
      status: status || null,
      build: BUILD,
    };
    post(payload).then(flushQueue, () => enqueue(payload));
  } catch {
    // never throws
  }
}

export function installGlobalErrorHandlers() {
  window.addEventListener("error", (event) => {
    // Failed <img>/<script> loads also fire "error" on window, but as plain
    // Events; only runtime exceptions are ErrorEvents.
    if (!(event instanceof ErrorEvent)) return;
    reportError({
      kind: "js_error",
      message: event.message,
      stack: event.error?.stack || `at ${event.filename}:${event.lineno}:${event.colno}`,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    // A failed API call nobody caught is already in the log: with its real
    // status from the server's side, or as a network error from api.js.
    if (reason?.isApiError || reason?.alreadyReported) return;
    reportError({
      kind: "promise_rejection",
      message: reason?.message || String(reason),
      stack: reason?.stack,
    });
  });

  window.addEventListener("online", flushQueue);
  // Whatever was left over from a previous visit, once the page has settled.
  setTimeout(flushQueue, 3000);
}
