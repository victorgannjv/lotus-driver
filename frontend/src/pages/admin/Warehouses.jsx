import { useEffect, useState } from "react";
import { api } from "../../api";

function WarehouseRow({ warehouse, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: warehouse.name, address: warehouse.address || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put(`/admin/warehouses/${warehouse.id}`, form);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err.detail || "could not save");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!window.confirm(`Remove "${warehouse.name}"? Drivers already assigned to it keep their assignment, but it won't be selectable anymore.`)) {
      return;
    }
    setBusy(true);
    try {
      await api.del(`/admin/warehouses/${warehouse.id}`);
      onChanged();
    } catch (err) {
      setError(err.detail || "could not remove");
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td className="px-4 py-3" colSpan={3}>
          <form onSubmit={handleSave} className="flex flex-wrap items-end gap-2">
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
              <span className="mb-1 block font-medium text-slate-700">Address</span>
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button type="submit" disabled={busy} className="rounded-lg bg-brand-red px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200">
              Cancel
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className={warehouse.is_active ? "" : "opacity-50"}>
      <td className="px-4 py-3 font-medium text-slate-900">
        {warehouse.name}
        {!warehouse.is_active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">removed</span>}
      </td>
      <td className="px-4 py-3 text-slate-600">{warehouse.address || "—"}</td>
      <td className="px-4 py-3 text-right">
        {warehouse.is_active && (
          <div className="inline-flex gap-2">
            <button onClick={() => setEditing(true)} className="text-sm font-medium text-brand-red underline">
              Edit
            </button>
            <button onClick={handleRemove} disabled={busy} className="text-sm font-medium text-slate-500 underline disabled:opacity-50">
              Remove
            </button>
          </div>
        )}
        {error && !editing && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </td>
    </tr>
  );
}

export default function Warehouses() {
  const [warehouses, setWarehouses] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: "", address: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  function load() {
    api
      .get("/admin/warehouses")
      .then((d) => setWarehouses(d.warehouses))
      .catch((err) => setError(err.detail || "could not load outlets"));
  }

  useEffect(load, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post("/admin/warehouses", { name: form.name, address: form.address || null });
      setForm({ name: "", address: "" });
      load();
    } catch (err) {
      setFormError(err.detail || "could not add outlet");
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
          <span className="mb-1 block font-medium text-slate-700">Address (optional)</span>
          <input
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-red px-4 py-2 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add outlet"}
        </button>
        {formError && <span className="text-sm text-red-600">{formError}</span>}
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!warehouses && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {warehouses && (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {warehouses.map((w) => (
                <WarehouseRow key={w.id} warehouse={w} onChanged={load} />
              ))}
              {warehouses.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                    No outlets yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
