import { useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import { AccessProvider, buildAccess } from "./AdminAccess";

// No client-side token for the admin surface: identity comes from the Substrait
// platform's Google SSO proxy (server-side X-Forwarded-Email), so we just ask the
// backend "am I an admin?" and gate on the answer. This is also the visible proof
// that the backend's "no header -> refuse" path actually works: with SSO off (or
// in local dev, where no proxy runs) this always renders the access-denied panel.
//
// The same answer says what this admin's role allows, which every screen under
// here reads through useAccess(). Being on the allowlist and being allowed to do
// anything are separate questions: an admin whose role was removed can still
// sign in, and is told so plainly instead of being shown a site of 403s.
function Denied({ title, children }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader />
      <div className="flex items-center justify-center px-4 py-16">
        <div className="max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-xl font-semibold text-brand-black">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}

export default function RequireAdmin({ children }) {
  const [state, setState] = useState({ loading: true, isAdmin: false, email: null });

  // `isRefresh` is for re-reading the grants after a role change. A refresh that
  // fails (a dropped connection) keeps what was already known: ejecting a
  // signed-in admin to an "access required" page because one request failed
  // would be a worse outcome than a stale menu.
  const load = useCallback((isRefresh = false) => {
    return fetch("/api/me")
      .then((r) => r.json())
      .then((d) =>
        setState({
          loading: false,
          isAdmin: d.is_admin,
          email: d.email,
          role: d.role,
          permissions: d.permissions || {},
          modules: d.modules || [],
        }),
      )
      .catch(() => {
        if (!isRefresh) setState({ loading: false, isAdmin: false, email: null });
      });
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  // Rebuilt only when what it is built from changes, so every consumer is not
  // re-rendered by an unrelated state update up here.
  const access = useMemo(
    () =>
      buildAccess({
        permissions: state.permissions,
        modules: state.modules,
        role: state.role,
        email: state.email,
        refresh: () => load(true),
      }),
    [state, load],
  );

  if (state.loading) return null;

  if (!state.isAdmin) {
    return (
      <Denied title="Admin access required">
        <p className="mt-3 text-sm text-slate-600">
          {state.email
            ? `Signed in as ${state.email}, but this account is not on the admin allowlist.`
            : "No signed-in identity was found."}
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Ask an existing admin to add your email from the Access control page, or, if Google SSO isn't enabled for this
          app yet, ask the app owner to turn it on in the Substrait portal's Access tab.
        </p>
      </Denied>
    );
  }

  if (Object.keys(access.permissions).length === 0) {
    return (
      <Denied title="No access role assigned">
        <p className="mt-3 text-sm text-slate-600">
          Signed in as {state.email}. You're on the admin list, but you haven't been given a role, so there is
          nothing here you're allowed to open.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Ask an administrator to give you a role under Settings, Access control.
        </p>
      </Denied>
    );
  }

  return <AccessProvider value={access}>{children}</AccessProvider>;
}
