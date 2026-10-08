// Fetch wrapper for the backend. Always relative /api paths -- same-origin
// through the ingress in prod, proxied to :8000 by Vite in local dev.
import { reportError } from "./lib/errorReporter";

const TOKEN_KEY = "lotus_driver_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `request failed (${status})`);
    this.status = status;
    this.detail = detail;
    // The server already logged this one, with the real route and who asked.
    // The global handler checks this so an uncaught one is not counted twice.
    this.isApiError = true;
  }
}

async function request(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch (err) {
    // The request never got an answer -- no signal, a dropped connection, the
    // server unreachable. The backend cannot log what it never received, and
    // this is the failure drivers hit most in a loading bay.
    reportError({
      kind: "network_error",
      level: "warning",
      message: `${method} ${path.split("?")[0]} failed: ${err?.message || "network error"}`,
      apiMethod: method,
      apiPath: `/api${path}`,
    });
    err.alreadyReported = true;
    throw err;
  }

  // An answer that did not come from the app. Our own errors are JSON; an HTML
  // or empty body on a failed call is the ingress or a proxy speaking (502,
  // 503, 504, a 413 for an oversized upload), which the backend never saw.
  if (!res.ok && res.status !== 401 && !(res.headers.get("content-type") || "").includes("application/json")) {
    reportError({
      kind: "gateway_error",
      level: res.status >= 500 ? "error" : "warning",
      message: `${method} ${path.split("?")[0]} returned HTTP ${res.status} from the gateway, not the app`,
      apiMethod: method,
      apiPath: `/api${path}`,
      status: res.status,
    });
  }

  if (res.status === 401) {
    setToken(null);
    if (!window.location.pathname.startsWith("/driver/login")) {
      window.location.href = "/driver/login";
    }
  }

  if (!res.ok) {
    // statusText is an empty string over HTTP/2, which every ingress speaks.
    // So a 413 or a 502 -- exactly the failures that carry no JSON -- used to
    // arrive as a blank detail and get shown as a bare "Failed", which is
    // indistinguishable from any other problem and impossible to act on.
    // Whatever else happens, the status code gets through.
    let detail;
    try {
      const body = await res.json();
      // FastAPI validation errors are a LIST of objects; rendering one as a
      // React child throws, so flatten it here rather than in three screens.
      detail = Array.isArray(body?.detail)
        ? body.detail.map((d) => d?.msg || JSON.stringify(d)).join("; ")
        : body?.detail;
    } catch {
      detail = null;
    }
    if (!detail) {
      detail = res.status === 413
        ? "The photos were too large to upload. Take fewer, or retake them."
        : `Upload failed (HTTP ${res.status}). Check your signal and try again.`;
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body, opts = {}) => request(path, { method: "POST", body, ...opts }),
  postForm: (path, formData) => request(path, { method: "POST", body: formData, isForm: true }),
  putForm: (path, formData) => request(path, { method: "PUT", body: formData, isForm: true }),
  put: (path, body) => request(path, { method: "PUT", body }),
  del: (path) => request(path, { method: "DELETE" }),
};
