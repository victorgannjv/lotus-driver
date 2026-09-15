import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deployed in-cluster with the backend behind one ingress host (/api → backend).
// The platform builds with VITE_API_URL="" so the app calls the API same-origin via
// relative /api paths. Locally, the dev server proxies those same /api calls to the
// backend on :8000 — so dev behaves exactly like production (same-origin, no CORS).
export default defineConfig({
  plugins: [react()],
  // Stamped into the bundle at build time so a screen can say which build it
  // is. Without it, "the fix did not work" and "the phone is still running
  // last week's JS" are indistinguishable -- and we spent a while unable to
  // tell them apart.
  define: {
    __BUILD_ID__: JSON.stringify(
      new Date().toISOString().slice(0, 16).replace("T", " ") + "Z",
    ),
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
