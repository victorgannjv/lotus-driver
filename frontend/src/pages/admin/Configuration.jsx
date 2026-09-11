import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../../api";

// Setup, kept apart from the working screens.
//
// Ops live in the dashboard daily; a reason code changes once a quarter. More
// than tidiness: editing a reason code or a target changes what every
// historical figure means, so it should not sit one mis-click away from the
// board someone reads every morning.

const subLink = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-red text-white" : "text-slate-600 hover:bg-slate-100"}`;

export function ConfigurationLayout() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-brand-black">Configuration</h1>
      <p className="mt-0.5 max-w-3xl text-xs text-slate-500">
        The lists someone maintains, rather than the work itself. Changes here apply immediately and re-score history
        where they affect it.
      </p>
      <nav className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <NavLink to="/admin/config/drivers" className={subLink}>Drivers</NavLink>
        <NavLink to="/admin/config/admins" className={subLink}>Admins</NavLink>
        <NavLink to="/admin/config/outlets" className={subLink}>Outlets</NavLink>
        <NavLink to="/admin/config/reasons" className={subLink}>Reason codes</NavLink>
        <NavLink to="/admin/config/targets" className={subLink}>Targets</NavLink>
        <NavLink to="/admin/config/roster" className={subLink}>Shift roster</NavLink>
        <NavLink to="/admin/config/driver-app" className={subLink}>Driver app</NavLink>
      </nav>
      <div className="mt-5">
        <Outlet />
      </div>
    </div>
  );
}

function Panel({ title, blurb, children }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-base font-semibold text-brand-black">{title}</h2>
      {blurb && <p className="mt-0.5 max-w-2xl text-xs text-slate-500">{blurb}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const PARTY_CHIP = {
  lotus: "bg-amber-100 text-amber-800",
  njv: "bg-blue-100 text-blue-800",
  external: "bg-emerald-100 text-emerald-800",
};
const PARTY_LABEL = { lotus: "Lotus", njv: "Ninja Van", external: "External" };

export function ReasonCodes() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    api.get("/admin/config/reason-codes").then((d) => setRows(d.reason_codes)).catch((e) => setError(e.detail));
  }, []);
  useEffect(load, [load]);

  async function toggle(code, isActive) {
    try {
      if (isActive) await api.del(`/admin/config/reason-codes/${code}`);
      else await api.put(`/admin/config/reason-codes/${code}`, { is_active: true });
      load();
    } catch (e) {
      setError(e.detail || "could not update that code");
    }
  }

  return (
    <Panel
      title="Reason codes"
      blurb="Why a gap ran over. The owner on each code is what splits a dispute — a code is deactivated rather than deleted, because historical trips still point at it."
    >
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4">Code</th><th className="py-2 pr-4">Label</th>
                <th className="py-2 pr-4">Owner</th><th className="py-2 pr-4">Applies to</th>
                <th className="py-2 pr-4">Status</th><th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-t border-slate-100">
                  <td className="py-2 pr-4 font-mono text-xs">{r.code}</td>
                  <td className="py-2 pr-4">{r.label}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PARTY_CHIP[r.fault_party]}`}>
                      {PARTY_LABEL[r.fault_party]}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-500">{r.applies_to_gap}</td>
                  <td className="py-2 pr-4 text-xs">{r.is_active ? "Active" : "Retired"}</td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => toggle(r.code, r.is_active)}
                            className="text-xs font-semibold text-brand-red hover:underline">
                      {r.is_active ? "Retire" : "Restore"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const GAP_LABEL = {
  waiting_for_lotus: "Waiting for Lotus",
  loading: "Loading",
  departure_lag: "Departure lag",
  delivery_round: "Delivery round",
  return_leg: "Return leg",
  time_at_outlet: "Time at outlet",
};

export function Targets() {
  const [rows, setRows] = useState(null);
  const [edits, setEdits] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);

  const load = useCallback(() => {
    api.get("/admin/config/targets").then((d) => setRows(d.targets)).catch((e) => setError(e.detail));
  }, []);
  useEffect(load, [load]);

  async function save(row) {
    const value = parseInt(edits[row.id], 10);
    if (Number.isNaN(value)) return;
    setSaving(row.id);
    try {
      await api.post("/admin/config/targets", {
        gap_code: row.gap_code, warehouse_id: row.warehouse_id, target_minutes: value,
      });
      setEdits((e) => ({ ...e, [row.id]: undefined }));
      load();
    } catch (e) {
      setError(e.detail || "could not save that target");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Panel
      title="Targets"
      blurb="The minutes each gap is allowed before it counts as over. A row with no outlet is the global default; an outlet row overrides it. Changing a target re-scores history, which is intended while the target is still being negotiated with Lotus."
    >
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4">Gap</th><th className="py-2 pr-4">Outlet</th>
                <th className="py-2 pr-4">Target (minutes)</th><th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-2 pr-4 font-medium">{GAP_LABEL[r.gap_code] || r.gap_code}</td>
                  <td className="py-2 pr-4 text-slate-500">{r.warehouse_name || <em>all outlets</em>}</td>
                  <td className="py-2 pr-4">
                    <input
                      type="number" min="1" max="1440"
                      value={edits[r.id] ?? r.target_minutes}
                      onChange={(e) => setEdits((v) => ({ ...v, [r.id]: e.target.value }))}
                      className="w-24 rounded-lg border border-slate-300 px-2 py-1 font-mono text-sm"
                    />
                  </td>
                  <td className="py-2 text-right">
                    {edits[r.id] !== undefined && String(edits[r.id]) !== String(r.target_minutes) && (
                      <button type="button" disabled={saving === r.id} onClick={() => save(r)}
                              className="text-xs font-semibold text-brand-red hover:underline disabled:text-slate-300">
                        {saving === r.id ? "Saving…" : "Save"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function DriverApp() {
  const [rows, setRows] = useState(null);
  const [edits, setEdits] = useState({});
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get("/admin/config/settings").then((d) => setRows(d.settings)).catch((e) => setError(e.detail));
  }, []);
  useEffect(load, [load]);

  async function save(key) {
    try {
      await api.put(`/admin/config/settings/${key}`, { value: String(edits[key]) });
      setEdits((e) => ({ ...e, [key]: undefined }));
      load();
    } catch (e) {
      setError(e.detail || "could not save that setting");
    }
  }

  return (
    <Panel
      title="Driver app"
      blurb="What the driver app asks for, set here rather than hard-coded. Changes reach drivers on their next screen — no app update."
    >
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.setting_key} className="flex flex-wrap items-center gap-3 border-t border-slate-100 py-2 first:border-0">
              <span className="w-56 shrink-0">
                <span className="block font-mono text-xs text-brand-black">{s.setting_key}</span>
                <span className="block text-xs text-slate-400">{s.notes}</span>
              </span>
              <input
                value={edits[s.setting_key] ?? s.value}
                onChange={(e) => setEdits((v) => ({ ...v, [s.setting_key]: e.target.value }))}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm"
              />
              {edits[s.setting_key] !== undefined && edits[s.setting_key] !== s.value && (
                <button type="button" onClick={() => save(s.setting_key)}
                        className="text-xs font-semibold text-brand-red hover:underline">Save</button>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function Roster() {
  const [rows, setRows] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [form, setForm] = useState({ work_date: "", warehouse_id: "", driver_id: "", shift: "full" });
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get("/admin/config/roster").then((d) => setRows(d.roster)).catch((e) => setError(e.detail));
  }, []);
  useEffect(() => {
    load();
    api.get("/admin/drivers").then((d) => setDrivers(d.drivers)).catch(() => {});
    api.get("/admin/warehouses").then((d) => setWarehouses(d.warehouses)).catch(() => {});
  }, [load]);

  async function add(e) {
    e.preventDefault();
    try {
      await api.post("/admin/config/roster", {
        work_date: form.work_date,
        warehouse_id: Number(form.warehouse_id),
        driver_id: Number(form.driver_id),
        shift: form.shift,
      });
      setForm((f) => ({ ...f, driver_id: "" }));
      load();
    } catch (err) {
      setError(err.detail || "could not add that roster line");
    }
  }

  return (
    <Panel
      title="Shift roster"
      blurb="Who is planned to work, per outlet per day. On duty is already counted from trips actually run; rostered has no other source — without it, “we ran two drivers short” is an assertion rather than a number, and conceding our own shortfalls is what keeps a Lotus claim credible."
    >
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <form onSubmit={add} className="mb-4 flex flex-wrap items-end gap-2">
        <input type="date" required value={form.work_date}
               onChange={(e) => setForm((f) => ({ ...f, work_date: e.target.value }))}
               className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <select required value={form.warehouse_id}
                onChange={(e) => setForm((f) => ({ ...f, warehouse_id: e.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Outlet…</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select required value={form.driver_id}
                onChange={(e) => setForm((f) => ({ ...f, driver_id: e.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Driver…</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="submit" className="rounded-lg bg-brand-red px-4 py-2 text-sm font-medium text-white hover:bg-brand-red-dark">
          Add
        </button>
      </form>

      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nothing rostered yet. Until there is, the dashboard’s manpower panel can show who worked but not who was
          meant to.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Outlet</th>
                <th className="py-2 pr-4">Driver</th><th className="py-2 pr-4">Shift</th><th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-2 pr-4 font-mono text-xs">{r.work_date}</td>
                  <td className="py-2 pr-4">{r.warehouse_name}</td>
                  <td className="py-2 pr-4">{r.driver_name}</td>
                  <td className="py-2 pr-4 text-xs text-slate-500">{r.shift}</td>
                  <td className="py-2 text-right">
                    <button type="button"
                            onClick={() => api.del(`/admin/config/roster/${r.id}`).then(load).catch(() => {})}
                            className="text-xs font-semibold text-brand-red hover:underline">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
