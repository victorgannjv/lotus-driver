import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../../api";
import Icon from "../../components/Icon";

// Setup, kept apart from the working screens.
//
// Written for an ops coordinator, not a developer. Nothing on these pages shows
// a column name, a code value or a raw `true` -- a setting is a sentence with a
// control next to it, because the people who maintain these lists are the ones
// who know the Lotus contract, not the ones who know the schema.

const subLink = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-red text-white" : "text-slate-600 hover:bg-slate-100"}`;

const TABS = [
  ["/admin/config/drivers", "Drivers"],
  ["/admin/config/admins", "Admins"],
  ["/admin/config/outlets", "Outlets"],
  ["/admin/config/windows", "Delivery windows"],
  ["/admin/config/targets", "Time allowances"],
  ["/admin/config/reasons", "Delay reasons"],
  ["/admin/config/roster", "Shift roster"],
  ["/admin/config/driver-app", "Driver app"],
];

export function ConfigurationLayout() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-brand-black">Settings</h1>
      <p className="mt-0.5 max-w-3xl text-sm text-slate-500">
        The lists and rules the app runs on. Changes take effect straight away, and anything that affects how lateness
        is measured is re-applied to past trips too, so your reports stay consistent.
      </p>
      <nav className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {TABS.map(([to, label]) => (
          <NavLink key={to} to={to} className={subLink}>{label}</NavLink>
        ))}
      </nav>
      <div className="mt-5">
        <Outlet />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shared UI */

function Panel({ title, blurb, children, action }) {
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-brand-black">{title}</h2>
          {blurb && <p className="mt-0.5 max-w-2xl text-sm text-slate-500">{blurb}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Note({ children, tone = "info" }) {
  const tones = {
    info: "bg-slate-50 text-slate-600",
    warn: "bg-amber-50 text-amber-900",
    error: "bg-rose-50 text-rose-800",
  };
  return (
    <p className={`mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${tones[tone]}`}>
      <Icon name="alert" className="mt-0.5 h-4 w-4" />
      <span>{children}</span>
    </p>
  );
}

function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-emerald-600" : "bg-slate-300"} disabled:opacity-50`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? "left-[1.375rem]" : "left-0.5"}`} />
    </button>
  );
}

const inputCls = "rounded-lg border border-slate-300 px-3 py-2 text-sm";
const primaryBtn = "rounded-lg bg-brand-red px-4 py-2 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50";
const linkBtn = "text-sm font-medium text-brand-red hover:underline disabled:text-slate-300";
const quietBtn = "text-sm font-medium text-slate-500 hover:underline disabled:text-slate-300";

const PARTY = {
  lotus: { label: "Lotus", chip: "bg-amber-100 text-amber-800" },
  njv: { label: "Ninja Van", chip: "bg-blue-100 text-blue-800" },
  external: { label: "Outside both", chip: "bg-emerald-100 text-emerald-800" },
};

function useList(path, key) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get(path).then((d) => setRows(d[key])).catch((e) => setError(e.detail || "could not load this list"));
  }, [path, key]);
  useEffect(load, [load]);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      return true;
    } catch (e) {
      setError(e.detail || "could not save that change");
      return false;
    } finally {
      setBusy(false);
    }
  }, [load]);
  return { rows, error, busy, run, reload: load, setError };
}

/* ------------------------------------------------------------- delay reasons */

const GAP_CHOICES = [
  ["any", "Any step"],
  ["waiting_for_lotus", "Waiting for Lotus"],
  ["loading", "Loading"],
  ["departure_lag", "Leaving the outlet"],
  ["delivery_round", "Out delivering"],
  ["return_leg", "Coming back"],
];

function gapNames(value) {
  return value
    .split(",")
    .map((v) => (GAP_CHOICES.find((c) => c[0] === v.trim()) || [null, v.trim()])[1])
    .join(", ");
}

export function ReasonCodes() {
  const { rows, error, busy, run } = useList("/admin/config/reason-codes", "reason_codes");
  const [edit, setEdit] = useState({});
  const [adding, setAdding] = useState(null);

  const blank = { label: "", fault_party: "lotus", applies_to_gap: "any" };

  function Form({ draft, set, onSave, onCancel, saveLabel }) {
    return (
      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">What the driver sees</span>
          <input className={inputCls} value={draft.label} placeholder="e.g. Goods not staged"
                 onChange={(e) => set({ ...draft, label: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Who is responsible</span>
          <select className={inputCls} value={draft.fault_party}
                  onChange={(e) => set({ ...draft, fault_party: e.target.value })}>
            <option value="lotus">Lotus</option>
            <option value="njv">Ninja Van</option>
            <option value="external">Outside both</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Offered at</span>
          <select className={inputCls} value={draft.applies_to_gap}
                  onChange={(e) => set({ ...draft, applies_to_gap: e.target.value })}>
            {GAP_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button type="button" className={primaryBtn} disabled={busy || !draft.label.trim()} onClick={onSave}>
          {saveLabel}
        </button>
        <button type="button" className={quietBtn} onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  return (
    <Panel
      title="Delay reasons"
      blurb="The choices a driver picks from when a step runs late. Who you mark responsible is what decides whether the lost time goes into a claim against Lotus or comes out of it."
      action={
        !adding && (
          <button type="button" className={primaryBtn} onClick={() => setAdding({ ...blank })}>
            Add a reason
          </button>
        )
      }
    >
      {error && <Note tone="error">{error}</Note>}

      {adding && (
        <div className="mb-4">
          <Form
            draft={adding}
            set={setAdding}
            saveLabel="Add"
            onCancel={() => setAdding(null)}
            onSave={async () => {
              const code = adding.label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40);
              const ok = await run(() => api.post("/admin/config/reason-codes", { ...adding, code }));
              if (ok) setAdding(null);
            }}
          />
        </div>
      )}

      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="divide-y divide-slate-100">
          {rows.map((r) => {
            const d = edit[r.code];
            return (
              <div key={r.code} className="py-3">
                {d ? (
                  <Form
                    draft={d}
                    set={(next) => setEdit((v) => ({ ...v, [r.code]: next }))}
                    saveLabel="Save"
                    onCancel={() => setEdit((v) => ({ ...v, [r.code]: undefined }))}
                    onSave={async () => {
                      const ok = await run(() => api.put(`/admin/config/reason-codes/${r.code}`, d));
                      if (ok) setEdit((v) => ({ ...v, [r.code]: undefined }));
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`text-sm ${r.is_active ? "text-brand-black" : "text-slate-400 line-through"}`}>
                      {r.label}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PARTY[r.fault_party].chip}`}>
                      {PARTY[r.fault_party].label}
                    </span>
                    <span className="text-xs text-slate-400">Offered at: {gapNames(r.applies_to_gap)}</span>
                    <span className="flex-1" />
                    <button type="button" className={linkBtn}
                            onClick={() => setEdit((v) => ({ ...v, [r.code]: {
                              label: r.label, fault_party: r.fault_party, applies_to_gap: r.applies_to_gap } }))}>
                      Edit
                    </button>
                    <button type="button" className={quietBtn} disabled={busy}
                            onClick={() => run(() => r.is_active
                              ? api.del(`/admin/config/reason-codes/${r.code}`)
                              : api.put(`/admin/config/reason-codes/${r.code}`, { is_active: true }))}>
                      {r.is_active ? "Stop offering" : "Offer again"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Note>
        A reason is never deleted, only stopped — past trips still point at it, and a claim you filed last month has to
        keep reading the same way next month.
      </Note>
    </Panel>
  );
}

/* ----------------------------------------------------------- delivery windows */

export function TripWindows() {
  const { rows, error, busy, run } = useList("/admin/config/schedule", "schedule");
  const [outlets, setOutlets] = useState([]);
  const [edit, setEdit] = useState({});
  const [adding, setAdding] = useState(null);

  useEffect(() => {
    api.get("/admin/warehouses").then((d) => setOutlets(d.warehouses)).catch(() => {});
  }, []);

  const hhmm = (v) => String(v).slice(0, 5);

  return (
    <Panel
      title="Delivery windows"
      blurb="The times each run is contracted to happen between. This is what lateness is judged against — a run that leaves the outlet after its window has closed is late, whatever the individual steps looked like."
      action={
        !adding && (
          <button type="button" className={primaryBtn}
                  onClick={() => setAdding({ warehouse_id: "", slot_no: (rows?.length || 0) + 1,
                                             label: "", window_start: "09:00", window_end: "11:00", grace_minutes: 0 })}>
            Add a window
          </button>
        )
      }
    >
      {error && <Note tone="error">{error}</Note>}

      {adding && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Applies to</span>
            <select className={inputCls} value={adding.warehouse_id}
                    onChange={(e) => setAdding((a) => ({ ...a, warehouse_id: e.target.value }))}>
              <option value="">Every outlet</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name} only</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Which run</span>
            <input type="number" min="1" max="12" className={`${inputCls} w-20`} value={adding.slot_no}
                   onChange={(e) => setAdding((a) => ({ ...a, slot_no: Number(e.target.value) }))} />
          </label>
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Name</span>
            <input className={inputCls} placeholder="e.g. First trip" value={adding.label}
                   onChange={(e) => setAdding((a) => ({ ...a, label: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">From</span>
            <input type="time" className={inputCls} value={adding.window_start}
                   onChange={(e) => setAdding((a) => ({ ...a, window_start: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">To</span>
            <input type="time" className={inputCls} value={adding.window_end}
                   onChange={(e) => setAdding((a) => ({ ...a, window_end: e.target.value }))} />
          </label>
          <button type="button" className={primaryBtn} disabled={busy || !adding.label.trim()}
                  onClick={async () => {
                    const ok = await run(() => api.post("/admin/config/schedule", {
                      ...adding,
                      warehouse_id: adding.warehouse_id ? Number(adding.warehouse_id) : null,
                      window_start: `${adding.window_start}:00`,
                      window_end: `${adding.window_end}:00`,
                    }));
                    if (ok) setAdding(null);
                  }}>
            Add
          </button>
          <button type="button" className={quietBtn} onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}

      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4">Run</th><th className="py-2 pr-4">Applies to</th>
                <th className="py-2 pr-4">From</th><th className="py-2 pr-4">To</th>
                <th className="py-2 pr-4">Grace</th><th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = edit[r.id] || {};
                const start = d.window_start ?? hhmm(r.window_start);
                const end = d.window_end ?? hhmm(r.window_end);
                const grace = d.grace_minutes ?? r.grace_minutes;
                const dirty = start !== hhmm(r.window_start) || end !== hhmm(r.window_end) || grace !== r.grace_minutes;
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-medium">{r.label}</td>
                    <td className="py-2 pr-4 text-slate-500">{r.warehouse_name || "Every outlet"}</td>
                    <td className="py-2 pr-4">
                      <input type="time" className={`${inputCls} py-1`} value={start}
                             onChange={(e) => setEdit((v) => ({ ...v, [r.id]: { ...d, window_start: e.target.value } }))} />
                    </td>
                    <td className="py-2 pr-4">
                      <input type="time" className={`${inputCls} py-1`} value={end}
                             onChange={(e) => setEdit((v) => ({ ...v, [r.id]: { ...d, window_end: e.target.value } }))} />
                    </td>
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-1">
                        <input type="number" min="0" max="120" className={`${inputCls} w-16 py-1`} value={grace}
                               onChange={(e) => setEdit((v) => ({ ...v, [r.id]: { ...d, grace_minutes: Number(e.target.value) } }))} />
                        <span className="text-xs text-slate-400">min</span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 text-right">
                      {dirty && (
                        <button type="button" className={`${linkBtn} mr-3`} disabled={busy}
                                onClick={async () => {
                                  const ok = await run(() => api.post("/admin/config/schedule", {
                                    warehouse_id: r.warehouse_id, slot_no: r.slot_no, label: r.label,
                                    window_start: `${start}:00`, window_end: `${end}:00`, grace_minutes: grace,
                                  }));
                                  if (ok) setEdit((v) => ({ ...v, [r.id]: undefined }));
                                }}>
                          Save
                        </button>
                      )}
                      {r.warehouse_id && (
                        <button type="button" className={quietBtn} disabled={busy}
                                onClick={() => run(() => api.del(`/admin/config/schedule/${r.id}`))}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Note>
        Grace is how many minutes late you will tolerate before a run counts as missing its window. Add an outlet row to
        give one outlet different times — those replace the “every outlet” ones for that site.
      </Note>
    </Panel>
  );
}

/* ------------------------------------------------------------ time allowances */

const GAP_LABEL = {
  waiting_for_lotus: "Waiting for Lotus to have the goods ready",
  loading: "Loading the truck",
  departure_lag: "Leaving once loaded",
  delivery_round: "Out on the delivery round",
  return_leg: "Coming back to the outlet",
  time_at_outlet: "Total time at the outlet",
};

export function Targets() {
  const { rows, error, busy, run } = useList("/admin/config/targets", "targets");
  const [edits, setEdits] = useState({});

  return (
    <Panel
      title="Time allowances"
      blurb="How long each step is allowed to take before it is flagged. These explain why a run was late; the delivery windows decide whether it was."
    >
      {error && <Note tone="error">{error}</Note>}
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="divide-y divide-slate-100">
          {rows.map((r) => {
            const value = edits[r.id] ?? r.target_minutes;
            const dirty = Number(value) !== r.target_minutes;
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-[18rem] flex-1 text-sm text-brand-black">
                  {GAP_LABEL[r.gap_code] || r.gap_code}
                  {r.warehouse_name && <span className="ml-2 text-xs text-slate-400">{r.warehouse_name} only</span>}
                </span>
                <span className="flex items-center gap-2">
                  <input type="number" min="1" max="1440" className={`${inputCls} w-24`} value={value}
                         onChange={(e) => setEdits((v) => ({ ...v, [r.id]: e.target.value }))} />
                  <span className="text-sm text-slate-500">minutes</span>
                </span>
                {dirty && (
                  <button type="button" className={linkBtn} disabled={busy}
                          onClick={async () => {
                            const ok = await run(() => api.post("/admin/config/targets", {
                              gap_code: r.gap_code, warehouse_id: r.warehouse_id, target_minutes: Number(value),
                            }));
                            if (ok) setEdits((v) => ({ ...v, [r.id]: undefined }));
                          }}>
                    Save
                  </button>
                )}
                {r.warehouse_id && (
                  <button type="button" className={quietBtn} disabled={busy}
                          onClick={() => run(() => api.del(`/admin/config/targets/${r.id}`))}>
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- driver app */

// Every setting is a sentence and a control. The stored key never appears --
// a coordinator should not have to know what photo_burn_timestamp is called.
const CHECKPOINTS = [
  ["arrived", "Arrived at Lotus"],
  ["goods_ready", "Lotus goods ready"],
  ["loaded", "Loaded to truck"],
  ["departed", "Departed outlet"],
  ["returned", "Returned to Lotus"],
];

const SETTING_UI = {
  job_count_quick_picks: {
    label: "Quick buttons for the number of jobs",
    help: "Shown when the driver is asked how many drops the trip is carrying.",
    type: "numbers",
  },
  job_count_manual_max: {
    label: "Highest number of jobs a driver can type",
    help: "A safety limit on the typed box, so a slip of the thumb cannot create 400 drops.",
    type: "number", min: 1, max: 200,
  },
  allow_add_job_mid_trip: {
    label: "Let drivers add a job after loading",
    help: "For when the load changes once they are already on the road.",
    type: "bool",
  },
  photo_required_checkpoints: {
    label: "Steps that need a photo",
    help: "A step without a photo cannot be recorded. These photos are the evidence behind a claim.",
    type: "checkpoints",
  },
  photo_burn_timestamp: {
    label: "Print the date and time onto the photo",
    help: "Written into the picture itself, so it cannot be argued with later.",
    type: "bool",
  },
  photo_timestamp_source: {
    label: "Where the time on the photo comes from",
    help: "The server's clock is the safer choice — a phone with the wrong time would weaken every photo.",
    type: "choice",
    options: [["server", "Our server's clock (recommended)"], ["handset", "The driver's phone"]],
  },
  photo_capture_gps: {
    label: "Record location with each photo",
    help: "Supporting detail. The date and time matter more.",
    type: "bool",
  },
  reason_prompt_on_breach: {
    label: "Ask the driver why when a step runs late",
    help: "Turning this off means late steps are still recorded, but nobody explains them.",
    type: "bool",
  },
  default_language: {
    label: "Language the app opens in",
    help: "Drivers can still switch it themselves.",
    type: "choice",
    options: [["en", "English"], ["ms", "Bahasa Malaysia"]],
  },
};

const ORDER = Object.keys(SETTING_UI);

export function DriverApp() {
  const { rows, error, busy, run } = useList("/admin/config/settings", "settings");
  const [draft, setDraft] = useState({});

  const value = (s) => (draft[s.setting_key] !== undefined ? draft[s.setting_key] : s.value);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async (k) => {
    const ok = await run(() => api.put(`/admin/config/settings/${k}`, { value: String(draft[k]) }));
    if (ok) setDraft((d) => ({ ...d, [k]: undefined }));
  };
  const isOn = (v) => String(v).toLowerCase() === "true";

  const sorted = rows
    ? [...rows].sort((a, b) => ORDER.indexOf(a.setting_key) - ORDER.indexOf(b.setting_key))
    : null;

  return (
    <Panel
      title="Driver app"
      blurb="What the app asks drivers for. Changes reach them on their next screen — nobody needs to update anything."
    >
      {error && <Note tone="error">{error}</Note>}
      {!sorted ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="divide-y divide-slate-100">
          {sorted.map((s) => {
            const ui = SETTING_UI[s.setting_key];
            if (!ui) return null;
            const v = value(s);
            const dirty = draft[s.setting_key] !== undefined && String(draft[s.setting_key]) !== s.value;

            return (
              <div key={s.setting_key} className="flex flex-wrap items-start gap-4 py-4">
                <div className="min-w-[16rem] flex-1">
                  <p className="text-sm font-medium text-brand-black">{ui.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{ui.help}</p>
                </div>

                <div className="flex items-center gap-3">
                  {ui.type === "bool" && (
                    <Toggle on={isOn(v)} disabled={busy}
                            onChange={async (next) => {
                              setDraft((d) => ({ ...d, [s.setting_key]: String(next) }));
                              await run(() => api.put(`/admin/config/settings/${s.setting_key}`, { value: String(next) }));
                              setDraft((d) => ({ ...d, [s.setting_key]: undefined }));
                            }} />
                  )}

                  {ui.type === "choice" && (
                    <select className={inputCls} value={v} disabled={busy}
                            onChange={async (e) => {
                              const next = e.target.value;
                              setDraft((d) => ({ ...d, [s.setting_key]: next }));
                              await run(() => api.put(`/admin/config/settings/${s.setting_key}`, { value: next }));
                              setDraft((d) => ({ ...d, [s.setting_key]: undefined }));
                            }}>
                      {ui.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                    </select>
                  )}

                  {ui.type === "number" && (
                    <>
                      <input type="number" min={ui.min} max={ui.max} className={`${inputCls} w-24`} value={v}
                             onChange={(e) => set(s.setting_key, e.target.value)} />
                      {dirty && <button type="button" className={linkBtn} disabled={busy}
                                        onClick={() => save(s.setting_key)}>Save</button>}
                    </>
                  )}

                  {ui.type === "numbers" && (
                    <>
                      <span className="flex items-center gap-1.5">
                        {String(v).split(",").filter(Boolean).map((n, i, arr) => (
                          <span key={i} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-sm">
                            {n.trim()}
                            <button type="button" aria-label={`Remove ${n}`} className="text-slate-400 hover:text-brand-red"
                                    onClick={() => set(s.setting_key, arr.filter((_, j) => j !== i).join(","))}>
                              ×
                            </button>
                          </span>
                        ))}
                        <button type="button" className="rounded-lg border border-dashed border-slate-300 px-2 py-1 text-sm text-slate-500"
                                onClick={() => {
                                  const next = window.prompt("Add a number");
                                  const n = parseInt(next, 10);
                                  if (!Number.isNaN(n) && n > 0) {
                                    set(s.setting_key, [...String(v).split(",").filter(Boolean), String(n)].join(","));
                                  }
                                }}>
                          + Add
                        </button>
                      </span>
                      {dirty && <button type="button" className={linkBtn} disabled={busy}
                                        onClick={() => save(s.setting_key)}>Save</button>}
                    </>
                  )}

                  {ui.type === "checkpoints" && (
                    <>
                      <span className="flex flex-wrap gap-2">
                        {CHECKPOINTS.map(([code, label]) => {
                          const list = String(v).split(",").map((x) => x.trim()).filter(Boolean);
                          const on = list.includes(code);
                          return (
                            <label key={code} className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm ${on ? "bg-emerald-50 text-emerald-900" : "bg-slate-100 text-slate-500"}`}>
                              <input type="checkbox" checked={on}
                                     onChange={() => set(s.setting_key,
                                       (on ? list.filter((x) => x !== code) : [...list, code]).join(","))} />
                              {label}
                            </label>
                          );
                        })}
                      </span>
                      {dirty && <button type="button" className={linkBtn} disabled={busy}
                                        onClick={() => save(s.setting_key)}>Save</button>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------------- people */

export function DriversConfig() {
  const { rows, error, busy, run } = useList("/admin/drivers", "drivers");
  const [outlets, setOutlets] = useState([]);
  const [edit, setEdit] = useState({});

  useEffect(() => {
    api.get("/admin/warehouses").then((d) => setOutlets(d.warehouses)).catch(() => {});
  }, []);

  return (
    <Panel
      title="Drivers"
      blurb="Who can sign into the driver app, and which outlet they work from. The outlet matters: it decides which delivery windows and time allowances their trips are measured against."
    >
      {error && <Note tone="error">{error}</Note>}
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No drivers have signed up yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Phone</th><th className="py-2 pr-4">Outlet</th>
                <th className="py-2 pr-4">Can sign in</th><th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const draft = edit[d.id];
                return (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-medium">{d.name}</td>
                    <td className="py-2 pr-4 text-slate-500">{d.email}</td>
                    <td className="py-2 pr-4 text-slate-500">{d.phone || "—"}</td>
                    <td className="py-2 pr-4">
                      {draft ? (
                        <select className={inputCls} value={draft.warehouse_id ?? ""}
                                onChange={(e) => setEdit((v) => ({ ...v, [d.id]: { ...draft, warehouse_id: e.target.value } }))}>
                          <option value="">Not set</option>
                          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      ) : (d.warehouse_name || <span className="text-amber-700">Not set</span>)}
                    </td>
                    <td className="py-2 pr-4">
                      <Toggle on={d.status === "active"} disabled={busy}
                              onChange={(next) => run(() => next
                                ? api.put(`/admin/config/drivers/${d.id}`, { status: "active" })
                                : api.del(`/admin/config/drivers/${d.id}`))} />
                    </td>
                    <td className="whitespace-nowrap py-2 text-right">
                      {draft ? (
                        <>
                          <button type="button" className={`${linkBtn} mr-3`} disabled={busy}
                                  onClick={async () => {
                                    const ok = await run(() => api.put(`/admin/config/drivers/${d.id}`,
                                      { warehouse_id: draft.warehouse_id ? Number(draft.warehouse_id) : null }));
                                    if (ok) setEdit((v) => ({ ...v, [d.id]: undefined }));
                                  }}>Save</button>
                          <button type="button" className={quietBtn}
                                  onClick={() => setEdit((v) => ({ ...v, [d.id]: undefined }))}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className={linkBtn}
                                onClick={() => setEdit((v) => ({ ...v, [d.id]: { warehouse_id: d.warehouse_id ?? "" } }))}>
                          Change outlet
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Note>
        Turning someone off stops them signing in but keeps all their trips — those are the evidence behind past claims,
        so a driver is never deleted.
      </Note>
    </Panel>
  );
}

export function AdminsConfig() {
  const { rows, error, busy, run } = useList("/admin/users", "users");
  const [adding, setAdding] = useState(null);

  const admins = (rows || []).filter((u) => u.role === "admin");

  return (
    <Panel
      title="Admins"
      blurb="Who can open this dashboard. Sign-in is through Google — adding someone here puts them on the allowlist; it does not create a password."
      action={
        !adding && (
          <button type="button" className={primaryBtn} onClick={() => setAdding({ name: "", email: "" })}>
            Add an admin
          </button>
        )
      }
    >
      {error && <Note tone="error">{error}</Note>}

      {adding && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Name</span>
            <input className={inputCls} value={adding.name}
                   onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} />
          </label>
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Work email</span>
            <input className={inputCls} type="email" placeholder="name@ninjavan.co" value={adding.email}
                   onChange={(e) => setAdding((a) => ({ ...a, email: e.target.value }))} />
          </label>
          <button type="button" className={primaryBtn} disabled={busy || !adding.email.trim()}
                  onClick={async () => {
                    const ok = await run(() => api.post("/admin/users", adding));
                    if (ok) setAdding(null);
                  }}>Add</button>
          <button type="button" className={quietBtn} onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}

      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="divide-y divide-slate-100">
          {admins.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="text-sm font-medium text-brand-black">{u.name}</span>
              <span className="text-sm text-slate-500">{u.email}</span>
              {u.status !== "active" && <span className="text-xs text-slate-400">(turned off)</span>}
              <span className="flex-1" />
              {u.status === "active" && (
                <button type="button" className={quietBtn} disabled={busy}
                        onClick={() => run(() => api.del(`/admin/config/admins/${u.id}`))}>
                  Remove access
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------------- roster */

export function Roster() {
  const { rows, error, busy, run } = useList("/admin/config/roster", "roster");
  const [drivers, setDrivers] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [form, setForm] = useState({ work_date: "", warehouse_id: "", driver_id: "", shift: "full" });

  useEffect(() => {
    api.get("/admin/drivers").then((d) => setDrivers(d.drivers)).catch(() => {});
    api.get("/admin/warehouses").then((d) => setOutlets(d.warehouses)).catch(() => {});
  }, []);

  return (
    <Panel
      title="Shift roster"
      blurb="Who is scheduled to work, per outlet per day. The dashboard already counts who actually drove; this is the only way it can know who was meant to — and owning up to a short-handed day is what keeps a claim against Lotus credible."
    >
      {error && <Note tone="error">{error}</Note>}

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Day</span>
          <input type="date" className={inputCls} value={form.work_date}
                 onChange={(e) => setForm((f) => ({ ...f, work_date: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Outlet</span>
          <select className={inputCls} value={form.warehouse_id}
                  onChange={(e) => setForm((f) => ({ ...f, warehouse_id: e.target.value }))}>
            <option value="">Choose…</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Driver</span>
          <select className={inputCls} value={form.driver_id}
                  onChange={(e) => setForm((f) => ({ ...f, driver_id: e.target.value }))}>
            <option value="">Choose…</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <button type="button" className={primaryBtn}
                disabled={busy || !form.work_date || !form.warehouse_id || !form.driver_id}
                onClick={async () => {
                  const ok = await run(() => api.post("/admin/config/roster", {
                    work_date: form.work_date, warehouse_id: Number(form.warehouse_id),
                    driver_id: Number(form.driver_id), shift: form.shift,
                  }));
                  if (ok) setForm((f) => ({ ...f, driver_id: "" }));
                }}>
          Add to roster
        </button>
      </div>

      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nothing rostered yet. Until there is, the dashboard can show who drove but not who was meant to.
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="font-mono text-xs text-slate-500">{r.work_date}</span>
              <span className="font-medium">{r.driver_name}</span>
              <span className="text-slate-500">{r.warehouse_name}</span>
              <span className="flex-1" />
              <button type="button" className={quietBtn} disabled={busy}
                      onClick={() => run(() => api.del(`/admin/config/roster/${r.id}`))}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
