import { useEffect, useState } from "react";
import { api } from "../../api";

export default function Admins() {
  const [admins, setAdmins] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  function load() {
    api
      .get("/admin/users")
      .then((d) => setAdmins(d.admins))
      .catch((err) => setError(err.detail || "could not load admins"));
  }

  useEffect(load, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post("/admin/users", form);
      setForm({ name: "", email: "" });
      load();
    } catch (err) {
      setFormError(err.detail || "could not add admin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="mb-6 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Name</span>
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Google email</span>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-red px-4 py-2 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add admin"}
        </button>
        {formError && <span className="text-sm text-red-600">{formError}</span>}
      </form>
      <p className="mb-4 text-xs text-slate-400">
        Admins sign in with Google SSO, not a password -- adding someone here just puts their Google account email on
        the allowlist. They must also be able to sign in via the app's SSO gate (ask the app owner if it's not enabled
        yet).
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!admins && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {admins && (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {admins.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{a.name}</td>
                  <td className="px-4 py-3 text-slate-600">{a.email}</td>
                  <td className="px-4 py-3 text-slate-600">{a.status}</td>
                  <td className="px-4 py-3 text-slate-600">{a.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
