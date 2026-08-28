import { useEffect, useState } from "react";

// No client-side token for the admin surface: identity comes from the Substrait
// platform's Google SSO proxy (server-side X-Forwarded-Email), so we just ask the
// backend "am I an admin?" and gate on the answer. This is also the visible proof
// that the backend's "no header -> refuse" path actually works: with SSO off (or
// in local dev, where no proxy runs) this always renders the access-denied panel.
export default function RequireAdmin({ children }) {
  const [state, setState] = useState({ loading: true, isAdmin: false, email: null });

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setState({ loading: false, isAdmin: d.is_admin, email: d.email }))
      .catch(() => setState({ loading: false, isAdmin: false, email: null }));
  }, []);

  if (state.loading) return null;

  if (!state.isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-xl font-semibold text-slate-900">Admin access required</h1>
          <p className="mt-3 text-sm text-slate-600">
            {state.email
              ? `Signed in as ${state.email}, but this account is not on the admin allowlist.`
              : "No signed-in identity was found."}
          </p>
          <p className="mt-3 text-sm text-slate-600">
            Ask the app owner to enable Google SSO for this app in the Substrait portal's
            Access tab, and to add your email to the admin list (POST /api/admin/users).
          </p>
        </div>
      </main>
    );
  }

  return children;
}
