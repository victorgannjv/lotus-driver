import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deployed in-cluster with the backend behind one ingress host (/api → backend).
// The platform builds with VITE_API_URL="" so the app calls the API same-origin via
// relative /api paths. Locally, the dev server proxies those same /api calls to the
// backend on :8000 — so dev behaves exactly like production (same-origin, no CORS).
const BUILD_ID = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";

// Publishes the build id as a tiny file the running app can poll. index.html
// being cacheable pinned phones to old bundles for days; that is fixed in
// nginx, but a browser already holding a stale copy only finds out when it
// chooses to revalidate. This lets the app find out for itself and say so.
const emitVersion = {
  name: "emit-version",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
  },
};

export default defineConfig({
  plugins: [react(), emitVersion],
  // Stamped into the bundle at build time so a screen can say which build it
  // is. Without it, "the fix did not work" and "the phone is still running
  // last week's JS" are indistinguishable -- and we spent a while unable to
  // tell them apart.
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
