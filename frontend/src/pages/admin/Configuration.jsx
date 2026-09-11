import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../../api";
import Icon from "../../components/Icon";

// Settings, written for an ops coordinator rather than a developer.
//
// No column names, no code values, no raw `true`. Every row is a plain sentence
// with a real control beside it, and every action is a button you can see --
// underlined text reads as a link, and people hesitate to click links that
// change data.

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
  ["/admin/config/activity", "Activity log"],
];

export function ConfigurationLayout() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-brand-black">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        Changes save straight away and are recorded in the activity log.
      </p>
      <nav className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {TABS.map(([to, label]) => (
          <NavLink key={to} to={to} className={subLink}>{label}</NavLink>
        ))}
      </nav>
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shared UI */

const input = "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-red focus:outline-none";
const btnPrimary = "rounded-lg bg-brand-red px-4 py-2 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50";
const btn = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40";
const btnDanger = "rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40";

function Panel({ title, blurb, action, children, footer }) {
  return (
    <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-brand-black">{title}</h2>
          {blurb && <p className="mt-0.5 text-sm text-slate-500">{blurb}</p>}
        </div>
        {action}
      </header>
      <div className="px-6 py-4">{children}</div>
      {footer && (
        <footer className="border-t border-slate-100 px-6 py-3 text-xs text-slate-500">{footer}</footer>
      )}
    </section>
  );
}

function Row({ children }) {
  return <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 py-4 last:border-0">{children}</div>;
}

function Err({ children }) {
  if (!children) return null;
  return (
    <p className="mb-4 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
      <Icon name="alert" className="mt-0.5 h-4 w-4" />
      <span>{children}</span>
    </p>
  );
}

function Toggle({ on, onChange, disabled, label }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-emerald-600" : "bg-slate-300"} disabled:opacity-50`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
    </button>
  );
}

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
    api.get(path).then((d) => setRows(d[key])).catch((e) => setError(e.detail || "Could not load this list."));
  }, [path, key]);
  useEffect(load, [load]);
  const run = useCallback(async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); load(); return true; }
    catch (e) { setError(e.detail || "Could not save that change."); return false; }
    finally { setBusy(false); }
  }, [load]);
  return { rows, error, busy, run };
}

const confirmed = (msg) => window.confirm(msg);

/* ------------------------------------------------------------- delay reasons */

const GAP_CHOICES = [
  ["any", "Any step"],
  ["waiting_for_lotus", "Waiting for Lotus"],
  ["loading", "Loading"],
  ["departure_lag", "Leaving the outlet"],
  ["delivery_round", "Out delivering"],
  ["return_leg", "Coming back"],
];
const gapName = (v) => (GAP_CHOICES.find((c) => c[0] === v.trim()) || [null, v.trim()])[1];

export function ReasonCodes() {
  const { rows, error, busy, run } = useList("/admin/config/reason-codes", "reason_codes");
  const [edit, setEdit] = useState({});
  const [adding, setAdding] = useState(null);

  const Fields = ({ draft, set }) => (
    <>
      <label className="flex min-w-[15rem] flex-1 flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-600">What the driver sees</span>
        <input className={input} value={draft.label} placeholder="e.g. Goods not staged"
               onChange={(e) => set({ ...draft, label: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-600">Who is responsible</span>
        <select className={input} value={draft.fault_party} onChange={(e) => set({ ...draft, fault_party: e.target.value })}>
          <option value="lotus">Lotus</option>
          <option value="njv">Ninja Van</option>
          <option value="external">Outside both</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-600">Offered at</span>
        <select className={input} value={draft.applies_to_gap} onChange={(e) => set({ ...draft, applies_to_gap: e.target.value })}>
          {GAP_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
    </>
  );

  return (
    <Panel
      title="Delay reasons"
      blurb="What a driver picks from when a step runs late."
      action={!adding && (
        <button type="button" className={btnPrimary}
                onClick={() => setAdding({ label: "", fault_party: "lotus", applies_to_gap: "any" })}>
          Add a reason
        </button>
      )}
      footer="Who you mark responsible decides whether the lost time goes into a claim against Lotus or comes out of it."
    >
      <Err>{error}</Err>

      {adding && (
        <div className="mb-5 flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4">
          <Fields draft={adding} set={setAdding} />
          <button type="button" className={btnPrimary} disabled={busy || !adding.label.trim()}
                  onClick={async () => {
                    const code = adding.label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40);
                    if (await run(() => api.post("/admin/config/reason-codes", { ...adding, code }))) setAdding(null);
                  }}>Add</button>
          <button type="button" className={btn} onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}

      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.map((r) => {
        const d = edit[r.code];
        return d ? (
          <div key={r.code} className="mb-3 flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4">
            <Fields draft={d} set={(next) => setEdit((v) => ({ ...v, [r.code]: next }))} />
            <button type="button" className={btnPrimary} disabled={busy}
                    onClick={async () => {
                      if (await run(() => api.put(`/admin/config/reason-codes/${r.code}`, d))) {
                        setEdit((v) => ({ ...v, [r.code]: undefined }));
                      }
                    }}>Save</button>
            <button type="button" className={btn} onClick={() => setEdit((v) => ({ ...v, [r.code]: undefined }))}>Cancel</button>
          </div>
        ) : (
          <Row key={r.code}>
            <span className={`min-w-[14rem] flex-1 text-sm ${r.is_active ? "text-brand-black" : "text-slate-400 line-through"}`}>
              {r.label}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${PARTY[r.fault_party].chip}`}>
              {PARTY[r.fault_party].label}
            </span>
            <span className="text-xs text-slate-400">{gapName(r.applies_to_gap.split(",")[0])}</span>
            <span className="flex-1" />
            <button type="button" className={btn}
                    onClick={() => setEdit((v) => ({ ...v, [r.code]: {
                      label: r.label, fault_party: r.fault_party, applies_to_gap: r.applies_to_gap } }))}>
              Edit
            </button>
            <button type="button" className={r.is_active ? btnDanger : btn} disabled={busy}
                    onClick={() => run(() => r.is_active
                      ? api.del(`/admin/config/reason-codes/${r.code}`)
                      : api.put(`/admin/config/reason-codes/${r.code}`, { is_active: true }))}>
              {r.is_active ? "Stop offering" : "Offer again"}
            </button>
          </Row>
        );
      })}
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
      blurb="The times each run is contracted to happen between."
      action={!adding && (
        <button type="button" className={btnPrimary}
                onClick={() => setAdding({ warehouse_id: "", slot_no: (rows?.length || 0) + 1, label: "",
                                           window_start: "09:00", window_end: "11:00", grace_minutes: 0 })}>
          Add a window
        </button>
      )}
      footer="A run that leaves after its window closes is late, whatever the individual steps looked like. Grace is how many minutes you will tolerate first."
    >
      <Err>{error}</Err>

      {adding && (
        <div className="mb-5 flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Applies to</span>
            <select className={input} value={adding.warehouse_id}
                    onChange={(e) => setAdding((a) => ({ ...a, warehouse_id: e.target.value }))}>
              <option value="">Every outlet</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name} only</option>)}
            </select>
          </label>
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Name</span>
            <input className={input} placeholder="e.g. First trip" value={adding.label}
                   onChange={(e) => setAdding((a) => ({ ...a, label: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Run number</span>
            <input type="number" min="1" max="12" className={`${input} w-24`} value={adding.slot_no}
                   onChange={(e) => setAdding((a) => ({ ...a, slot_no: Number(e.target.value) }))} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">From</span>
            <input type="time" className={input} value={adding.window_start}
                   onChange={(e) => setAdding((a) => ({ ...a, window_start: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">To</span>
            <input type="time" className={input} value={adding.window_end}
                   onChange={(e) => setAdding((a) => ({ ...a, window_end: e.target.value }))} />
          </label>
          <button type="button" className={btnPrimary} disabled={busy || !adding.label.trim()}
                  onClick={async () => {
                    const ok = await run(() => api.post("/admin/config/schedule", {
                      ...adding,
                      warehouse_id: adding.warehouse_id ? Number(adding.warehouse_id) : null,
                      window_start: `${adding.window_start}:00`,
                      window_end: `${adding.window_end}:00`,
                    }));
                    if (ok) setAdding(null);
                  }}>Add</button>
          <button type="button" className={btn} onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}

      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.map((r) => {
        const d = edit[r.id] || {};
        const start = d.window_start ?? hhmm(r.window_start);
        const end = d.window_end ?? hhmm(r.window_end);
        const grace = d.grace_minutes ?? r.grace_minutes;
        const dirty = start !== hhmm(r.window_start) || end !== hhmm(r.window_end) || grace !== r.grace_minutes;
        return (
          <Row key={r.id}>
            <span className="min-w-[9rem]">
              <span className="block text-sm font-medium text-brand-black">{r.label}</span>
              <span className="block text-xs text-slate-400">{r.warehouse_name || "Every outlet"}</span>
            </span>
            <label className="flex items-center gap-2 text-sm text-slate-500">
              From
              <input type="time" className={input} value={start}
                     onChange={(e) => setEdit((v) => ({ ...v, [r.id]: { ...d, window_start: e.target.value } }))} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-500">
              to
              <input type="time" className={input} value={end}
                     onChange={(e) => setEdit((v) => ({ ...v, [r.id]: { ...d, window_end: e.target.value } }))} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-500">
              Grace
              <input type="number" min="0" max="120" className={`${input} w-20`} value={grace}
                     onChange={(e) => setEdit((v) => ({ ...v, [r.id]: { ...d, grace_minutes: Number(e.target.value) } }))} />
              min
            </label>
            <span className="flex-1" />
            <button type="button" className={btnPrimary} disabled={busy || !dirty}
                    onClick={async () => {
                      const ok = await run(() => api.post("/admin/config/schedule", {
                        warehouse_id: r.warehouse_id, slot_no: r.slot_no, label: r.label,
                        window_start: `${start}:00`, window_end: `${end}:00`, grace_minutes: grace,
                      }));
                      if (ok) setEdit((v) => ({ ...v, [r.id]: undefined }));
                    }}>Save</button>
            <button type="button" className={btnDanger} disabled={busy}
                    onClick={() => confirmed(
                      r.warehouse_id
                        ? `Delete the ${r.label} window for ${r.warehouse_name}? It will fall back to the every-outlet times.`
                        : `Delete the ${r.label} window? Runs in that slot will have no contracted time to be measured against.`
                    ) && run(() => api.del(`/admin/config/schedule/${r.id}`))}>
              Delete
            </button>
          </Row>
        );
      })}
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
      blurb="How long each step may take before it is flagged."
      footer="These explain why a run was late. The delivery windows decide whether it was."
    >
      <Err>{error}</Err>
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.map((r) => {
        const value = edits[r.id] ?? r.target_minutes;
        const dirty = Number(value) !== r.target_minutes;
        return (
          <Row key={r.id}>
            <span className="min-w-[18rem] flex-1">
              <span className="block text-sm text-brand-black">{GAP_LABEL[r.gap_code] || r.gap_code}</span>
              <span className="block text-xs text-slate-400">{r.warehouse_name ? `${r.warehouse_name} only` : "Every outlet"}</span>
            </span>
            <label className="flex items-center gap-2 text-sm text-slate-500">
              <input type="number" min="1" max="1440" className={`${input} w-24`} value={value}
                     onChange={(e) => setEdits((v) => ({ ...v, [r.id]: e.target.value }))} />
              minutes
            </label>
            <button type="button" className={btnPrimary} disabled={busy || !dirty}
                    onClick={async () => {
                      const ok = await run(() => api.post("/admin/config/targets", {
                        gap_code: r.gap_code, warehouse_id: r.warehouse_id, target_minutes: Number(value),
                      }));
                      if (ok) setEdits((v) => ({ ...v, [r.id]: undefined }));
                    }}>Save</button>
            <button type="button" className={btnDanger} disabled={busy}
                    onClick={() => confirmed(
                      r.warehouse_id
                        ? "Delete this outlet's allowance? It will fall back to the every-outlet one."
                        : "Delete this allowance? That step will stop being flagged as late."
                    ) && run(() => api.del(`/admin/config/targets/${r.id}`))}>
              Delete
            </button>
          </Row>
        );
      })}
    </Panel>
  );
}

/* ----------------------------------------------------------------- driver app */

const CHECKPOINTS = [
  ["arrived", "Arrived at Lotus"],
  ["goods_ready", "Lotus goods ready"],
  ["loaded", "Loaded to truck"],
  ["departed", "Departed outlet"],
  ["returned", "Returned to Lotus"],
];

const SETTING_UI = {
  job_count_quick_picks: { label: "Quick buttons for number of jobs", help: "Shown when the driver is asked how many drops the trip carries.", type: "numbers" },
  job_count_manual_max: { label: "Most jobs a driver can type", help: "A safety limit on the typed box.", type: "number", min: 1, max: 200 },
  allow_add_job_mid_trip: { label: "Let drivers add a job after loading", help: "For when the load changes on the road.", type: "bool" },
  photo_required_checkpoints: { label: "Steps that need a photo", help: "A step without a photo cannot be recorded.", type: "checkpoints" },
  photo_burn_timestamp: { label: "Print the date and time onto the photo", help: "Written into the picture, so it cannot be argued with.", type: "bool" },
  photo_timestamp_source: { label: "Where the photo's time comes from", help: "A phone with the wrong clock would weaken every photo.", type: "choice",
    options: [["server", "Our server's clock (recommended)"], ["handset", "The driver's phone"]] },
  photo_capture_gps: { label: "Record location with each photo", help: "Supporting detail — the time matters more.", type: "bool" },
  reason_prompt_on_breach: { label: "Ask why when a step runs late", help: "Off means late steps are recorded but never explained.", type: "bool" },
  default_language: { label: "Language the app opens in", help: "Drivers can still switch it themselves.", type: "choice",
    options: [["en", "English"], ["ms", "Bahasa Malaysia"]] },
};
const ORDER = Object.keys(SETTING_UI);

export function DriverApp() {
  const { rows, error, busy, run } = useList("/admin/config/settings", "settings");
  const [draft, setDraft] = useState({});

  const value = (s) => (draft[s.setting_key] !== undefined ? draft[s.setting_key] : s.value);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const commit = async (k, v) => {
    const ok = await run(() => api.put(`/admin/config/settings/${k}`, { value: String(v) }));
    if (ok) setDraft((d) => ({ ...d, [k]: undefined }));
  };
  const isOn = (v) => String(v).toLowerCase() === "true";
  const sorted = rows ? [...rows].sort((a, b) => ORDER.indexOf(a.setting_key) - ORDER.indexOf(b.setting_key)) : null;

  return (
    <Panel title="Driver app" blurb="What the app asks drivers for." footer="Changes reach drivers on their next screen — nobody needs to update anything.">
      <Err>{error}</Err>
      {!sorted ? <p className="text-sm text-slate-500">Loading…</p> : sorted.map((s) => {
        const ui = SETTING_UI[s.setting_key];
        if (!ui) return null;
        const v = value(s);
        const dirty = draft[s.setting_key] !== undefined && String(draft[s.setting_key]) !== s.value;
        return (
          <Row key={s.setting_key}>
            <span className="min-w-[18rem] flex-1">
              <span className="block text-sm font-medium text-brand-black">{ui.label}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{ui.help}</span>
            </span>

            {ui.type === "bool" && (
              <Toggle on={isOn(v)} disabled={busy} label={ui.label}
                      onChange={(next) => { set(s.setting_key, String(next)); commit(s.setting_key, next); }} />
            )}

            {ui.type === "choice" && (
              <select className={input} value={v} disabled={busy}
                      onChange={(e) => { set(s.setting_key, e.target.value); commit(s.setting_key, e.target.value); }}>
                {ui.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            )}

            {ui.type === "number" && (
              <>
                <input type="number" min={ui.min} max={ui.max} className={`${input} w-24`} value={v}
                       onChange={(e) => set(s.setting_key, e.target.value)} />
                <button type="button" className={btnPrimary} disabled={busy || !dirty}
                        onClick={() => commit(s.setting_key, v)}>Save</button>
              </>
            )}

            {ui.type === "numbers" && (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  {String(v).split(",").filter(Boolean).map((n, i, arr) => (
                    <span key={i} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm">
                      {n.trim()}
                      <button type="button" aria-label={`Remove ${n}`} className="text-slate-400 hover:text-rose-600"
                              onClick={() => set(s.setting_key, arr.filter((_, j) => j !== i).join(","))}>×</button>
                    </span>
                  ))}
                  <button type="button" className={btn}
                          onClick={() => {
                            const n = parseInt(window.prompt("Add a number"), 10);
                            if (!Number.isNaN(n) && n > 0) {
                              set(s.setting_key, [...String(v).split(",").filter(Boolean), String(n)].join(","));
                            }
                          }}>Add</button>
                </span>
                <button type="button" className={btnPrimary} disabled={busy || !dirty}
                        onClick={() => commit(s.setting_key, v)}>Save</button>
              </>
            )}

            {ui.type === "checkpoints" && (
              <>
                <span className="flex flex-wrap gap-2">
                  {CHECKPOINTS.map(([code, label]) => {
                    const list = String(v).split(",").map((x) => x.trim()).filter(Boolean);
                    const on = list.includes(code);
                    return (
                      <label key={code}
                             className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${on ? "bg-emerald-50 text-emerald-900" : "bg-slate-100 text-slate-500"}`}>
                        <input type="checkbox" checked={on}
                               onChange={() => set(s.setting_key, (on ? list.filter((x) => x !== code) : [...list, code]).join(","))} />
                        {label}
                      </label>
                    );
                  })}
                </span>
                <button type="button" className={btnPrimary} disabled={busy || !dirty}
                        onClick={() => commit(s.setting_key, v)}>Save</button>
              </>
            )}
          </Row>
        );
      })}
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
      blurb="Who can sign into the driver app, and where they work from."
      footer="The outlet decides which delivery windows and allowances a driver's trips are measured against. Turning someone off stops them signing in but keeps their trips — those are the evidence behind past claims."
    >
      <Err>{error}</Err>
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No drivers have signed up yet.</p>
      ) : rows.map((d) => {
        const draft = edit[d.id];
        return (
          <Row key={d.id}>
            <span className="min-w-[14rem] flex-1">
              <span className="block text-sm font-medium text-brand-black">{d.name}</span>
              <span className="block text-xs text-slate-400">{d.email}{d.phone ? ` · ${d.phone}` : ""}</span>
            </span>
            {draft ? (
              <select className={input} value={draft.warehouse_id ?? ""}
                      onChange={(e) => setEdit((v) => ({ ...v, [d.id]: { warehouse_id: e.target.value } }))}>
                <option value="">Not set</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) : (
              <span className="text-sm text-slate-600">
                {d.warehouse_name || <span className="text-amber-700">No outlet set</span>}
              </span>
            )}
            <span className="flex items-center gap-2 text-sm text-slate-500">
              <Toggle on={d.status === "active"} disabled={busy} label={`Sign-in for ${d.name}`}
                      onChange={(next) => run(() => next
                        ? api.put(`/admin/config/drivers/${d.id}`, { status: "active" })
                        : api.del(`/admin/config/drivers/${d.id}`))} />
              Can sign in
            </span>
            <span className="flex-1" />
            {draft ? (
              <>
                <button type="button" className={btnPrimary} disabled={busy}
                        onClick={async () => {
                          const ok = await run(() => api.put(`/admin/config/drivers/${d.id}`,
                            { warehouse_id: draft.warehouse_id ? Number(draft.warehouse_id) : null }));
                          if (ok) setEdit((v) => ({ ...v, [d.id]: undefined }));
                        }}>Save</button>
                <button type="button" className={btn} onClick={() => setEdit((v) => ({ ...v, [d.id]: undefined }))}>Cancel</button>
              </>
            ) : (
              <button type="button" className={btn}
                      onClick={() => setEdit((v) => ({ ...v, [d.id]: { warehouse_id: d.warehouse_id ?? "" } }))}>
                Change outlet
              </button>
            )}
          </Row>
        );
      })}
    </Panel>
  );
}

export function AdminsConfig() {
  // The endpoint answers with { admins: [...] } and already filters to admins --
  // reading it as "users" left the list undefined and the panel on "Loading…".
  const { rows: admins, error, busy, run } = useList("/admin/users", "admins");
  const [adding, setAdding] = useState(null);

  return (
    <Panel
      title="Admins"
      blurb="Who can open this dashboard."
      action={!adding && (
        <button type="button" className={btnPrimary} onClick={() => setAdding({ name: "", email: "" })}>
          Add an admin
        </button>
      )}
      footer="Sign-in is through Google — adding someone puts them on the allowlist, it does not create a password. The last active admin cannot be removed."
    >
      <Err>{error}</Err>
      {adding && (
        <div className="mb-5 flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Name</span>
            <input className={input} value={adding.name} onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} />
          </label>
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Work email</span>
            <input className={input} type="email" placeholder="name@ninjavan.co" value={adding.email}
                   onChange={(e) => setAdding((a) => ({ ...a, email: e.target.value }))} />
          </label>
          <button type="button" className={btnPrimary} disabled={busy || !adding.email.trim()}
                  onClick={async () => { if (await run(() => api.post("/admin/users", adding))) setAdding(null); }}>Add</button>
          <button type="button" className={btn} onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}
      {!admins ? <p className="text-sm text-slate-500">Loading…</p> : admins.map((u) => (
        <Row key={u.id}>
          <span className="min-w-[14rem] flex-1">
            <span className="block text-sm font-medium text-brand-black">{u.name}</span>
            <span className="block text-xs text-slate-400">{u.email}</span>
          </span>
          {u.status !== "active" && <span className="text-xs text-slate-400">Access removed</span>}
          <span className="flex-1" />
          {u.status === "active" && (
            <button type="button" className={btnDanger} disabled={busy}
                    onClick={() => confirmed(`Remove dashboard access for ${u.name}?`)
                      && run(() => api.del(`/admin/config/admins/${u.id}`))}>
              Remove access
            </button>
          )}
        </Row>
      ))}
    </Panel>
  );
}

/* --------------------------------------------------------------------- roster */

// A roster is built a week at a time: pick the week, tick who is on.
//
// The previous version asked for one driver-day per submit -- fifty-six
// decisions for eight drivers over a week. That is data entry, not planning,
// and it is why the page sat empty. Drivers are listed for you, grouped by the
// outlet they belong to, so the only question left is who works which day.
function mondayOf(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const isoDay = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Roster() {
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [drivers, setDrivers] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const days = [...Array(7)].map((_, i) => addDays(week, i));
  const from = isoDay(days[0]);
  const to = isoDay(days[6]);

  const load = useCallback(() => {
    setRows(null);
    api.get(`/admin/config/roster?date_from=${from}&date_to=${to}`)
      .then((d) => setRows(d.roster))
      .catch((e) => setError(e.detail || "Could not load the roster."));
  }, [from, to]);

  useEffect(() => {
    api.get("/admin/drivers")
      .then((d) => setDrivers(d.drivers.filter((x) => x.status === "active")))
      .catch(() => setDrivers([]));
  }, []);
  useEffect(load, [load]);

  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); load(); }
    catch (e) { setError(e.detail || "Could not save that change."); }
    finally { setBusy(false); }
  }

  // rostered[driverId][date] -> the row, so a tick knows what it would remove
  const rostered = {};
  (rows || []).forEach((r) => {
    rostered[r.driver_id] = rostered[r.driver_id] || {};
    rostered[r.driver_id][r.work_date] = r;
  });

  const needsOutlet = (d) => {
    setError(`${d.name} has no outlet yet — set one on the Drivers tab first, since the outlet decides which delivery windows their trips are measured against.`);
  };

  const toggle = (driver, date) => {
    const existing = rostered[driver.id]?.[date];
    if (existing) return run(() => api.del(`/admin/config/roster/${existing.id}`));
    if (!driver.warehouse_id) return needsOutlet(driver);
    return run(() => api.post("/admin/config/roster", {
      work_date: date, warehouse_id: driver.warehouse_id, driver_id: driver.id, shift: "full",
    }));
  };

  const setWholeRow = (driver, on) => {
    if (on && !driver.warehouse_id) return needsOutlet(driver);
    const entries = [], remove_ids = [];
    days.forEach((d) => {
      const date = isoDay(d);
      const ex = rostered[driver.id]?.[date];
      if (on && !ex) {
        entries.push({ work_date: date, warehouse_id: driver.warehouse_id, driver_id: driver.id, shift: "full" });
      }
      if (!on && ex) remove_ids.push(ex.id);
    });
    if (!entries.length && !remove_ids.length) return;
    return run(() => api.post("/admin/config/roster/bulk", { entries, remove_ids }));
  };

  const byOutlet = {};
  (drivers || []).forEach((d) => {
    const key = d.warehouse_name || "No outlet set";
    (byOutlet[key] = byOutlet[key] || []).push(d);
  });

  const total = (rows || []).length;

  return (
    <Panel
      title="Shift roster"
      blurb="Who is scheduled to work each day. Tick a driver on for a day."
      action={
        <div className="flex items-center gap-2">
          <button type="button" className={btn} onClick={() => setWeek(addDays(week, -7))}>← Previous</button>
          <span className="min-w-[9rem] text-center text-sm font-medium text-brand-black">
            {days[0].toLocaleDateString(undefined, { day: "2-digit", month: "short" })} – {days[6].toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
          </span>
          <button type="button" className={btn} onClick={() => setWeek(addDays(week, 7))}>Next →</button>
        </div>
      }
      footer="The dashboard already counts who actually drove; this is the only way it can know who was meant to. Owning up to a short-handed day is what keeps a claim against Lotus credible."
    >
      <Err>{error}</Err>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" className={btn} disabled={busy}
                onClick={() => run(() => api.post(
                  `/admin/config/roster/copy-week?from_monday=${isoDay(addDays(week, -7))}&to_monday=${from}`))}>
          Copy last week
        </button>
        <button type="button" className={btn} onClick={() => setWeek(mondayOf(new Date()))}>This week</button>
        <span className="text-sm text-slate-500">{total} shift{total === 1 ? "" : "s"} scheduled</span>
      </div>

      {!drivers || !rows ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : drivers.length === 0 ? (
        <p className="text-sm text-slate-500">No active drivers yet — they appear here once they sign up.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 text-left">Driver</th>
                {days.map((d, i) => (
                  <th key={i} className="px-2 py-2 text-center font-semibold">
                    <span className="block">{DOW[i]}</span>
                    <span className="block font-mono text-[10px] font-normal text-slate-300">{d.getDate()}</span>
                  </th>
                ))}
                <th className="py-2 pl-2 text-right">All week</th>
              </tr>
            </thead>
            {Object.entries(byOutlet).map(([outlet, list]) => (
              <tbody key={outlet}>
                <tr>
                  <td colSpan={9} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {outlet}
                  </td>
                </tr>
                {list.map((d) => {
                  const onCount = days.filter((x) => rostered[d.id]?.[isoDay(x)]).length;
                  return (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className="py-2 pr-4">
                        <span className="block font-medium text-brand-black">{d.name}</span>
                        {!d.warehouse_id && <span className="block text-xs text-amber-700">No outlet set</span>}
                      </td>
                      {days.map((x, i) => {
                        const date = isoDay(x);
                        const on = !!rostered[d.id]?.[date];
                        return (
                          <td key={i} className="px-2 py-2 text-center">
                            <button
                              type="button" disabled={busy} onClick={() => toggle(d, date)}
                              aria-pressed={on} aria-label={`${d.name}, ${DOW[i]}`}
                              className={`h-8 w-8 rounded-lg border text-sm font-semibold transition ${
                                on
                                  ? "border-emerald-600 bg-emerald-600 text-white"
                                  : "border-slate-200 bg-white text-slate-300 hover:border-slate-400"
                              } disabled:opacity-50`}
                            >
                              {on ? "✓" : ""}
                            </button>
                          </td>
                        );
                      })}
                      <td className="py-2 pl-2 text-right">
                        <button type="button" className={btn} disabled={busy}
                                onClick={() => setWholeRow(d, onCount < 7)}>
                          {onCount === 7 ? "Clear" : "All 7"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- activity log */

const ENTITY_LABEL = {
  reason_code: "Delay reason", target: "Time allowance", schedule: "Delivery window",
  driver: "Driver", admin: "Admin", roster: "Shift roster", setting: "Driver app",
};
const ACTION_CHIP = {
  create: "bg-emerald-100 text-emerald-800",
  update: "bg-blue-100 text-blue-800",
  delete: "bg-rose-100 text-rose-800",
};

export function ActivityLog() {
  const [entity, setEntity] = useState("");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setRows(null);
    const qs = entity ? `?entity=${entity}` : "";
    api.get(`/admin/config/activity${qs}`)
      .then((d) => setRows(d.activity))
      .catch((e) => setError(e.detail || "Could not load the activity log."));
  }, [entity]);

  return (
    <Panel
      title="Activity log"
      blurb="Every settings change, who made it and when."
      action={
        <select className={input} value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Everything</option>
          {Object.entries(ENTITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      }
      footer="Changing a window or an allowance re-scores past trips, so this is how you answer “why does last month read differently now?” — and how a claim survives Lotus asking whether the bar moved after the fact."
    >
      <Err>{error}</Err>
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing changed yet.</p>
      ) : rows.map((a) => (
        <Row key={a.id}>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ACTION_CHIP[a.action]}`}>
            {a.action === "create" ? "Added" : a.action === "delete" ? "Deleted" : "Changed"}
          </span>
          <span className="min-w-[8rem] text-xs font-medium uppercase tracking-wide text-slate-400">
            {ENTITY_LABEL[a.entity] || a.entity}
          </span>
          <span className="min-w-[16rem] flex-1 text-sm text-brand-black">{a.summary}</span>
          <span className="text-sm text-slate-500">{a.actor_email || "—"}</span>
          <span className="font-mono text-xs text-slate-400">{a.created_at}</span>
        </Row>
      ))}
    </Panel>
  );
}

/* -------------------------------------------------------------------- outlets */

export function OutletsConfig() {
  const { rows, error, busy, run } = useList("/admin/warehouses", "warehouses");
  const [edit, setEdit] = useState({});
  const [adding, setAdding] = useState(null);

  return (
    <Panel
      title="Outlets"
      blurb="The Lotus sites drivers collect from."
      action={!adding && (
        <button type="button" className={btnPrimary} onClick={() => setAdding({ name: "", address: "" })}>
          Add an outlet
        </button>
      )}
      footer="Removing an outlet keeps its history and any trips already recorded against it — it just stops appearing when a driver picks where they work."
    >
      <Err>{error}</Err>

      {adding && (
        <div className="mb-5 flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Name</span>
            <input className={input} value={adding.name} placeholder="e.g. Puchong"
                   onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} />
          </label>
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Address (optional)</span>
            <input className={input} value={adding.address}
                   onChange={(e) => setAdding((a) => ({ ...a, address: e.target.value }))} />
          </label>
          <button type="button" className={btnPrimary} disabled={busy || !adding.name.trim()}
                  onClick={async () => {
                    const ok = await run(() => api.post("/admin/warehouses", {
                      name: adding.name.trim(), address: adding.address.trim() || null,
                    }));
                    if (ok) setAdding(null);
                  }}>Add</button>
          <button type="button" className={btn} onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}

      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.map((o) => {
        const d = edit[o.id];
        return d ? (
          <div key={o.id} className="mb-3 flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Name</span>
              <input className={input} value={d.name}
                     onChange={(e) => setEdit((v) => ({ ...v, [o.id]: { ...d, name: e.target.value } }))} />
            </label>
            <label className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Address</span>
              <input className={input} value={d.address}
                     onChange={(e) => setEdit((v) => ({ ...v, [o.id]: { ...d, address: e.target.value } }))} />
            </label>
            <button type="button" className={btnPrimary} disabled={busy || !d.name.trim()}
                    onClick={async () => {
                      const ok = await run(() => api.put(`/admin/warehouses/${o.id}`, {
                        name: d.name.trim(), address: d.address.trim() || null,
                      }));
                      if (ok) setEdit((v) => ({ ...v, [o.id]: undefined }));
                    }}>Save</button>
            <button type="button" className={btn} onClick={() => setEdit((v) => ({ ...v, [o.id]: undefined }))}>Cancel</button>
          </div>
        ) : (
          <Row key={o.id}>
            <span className="min-w-[14rem] flex-1">
              <span className={`block text-sm font-medium ${o.is_active ? "text-brand-black" : "text-slate-400"}`}>
                {o.name}
                {!o.is_active && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    removed
                  </span>
                )}
              </span>
              <span className="block text-xs text-slate-400">{o.address || "No address set"}</span>
            </span>
            <span className="flex-1" />
            {o.is_active && (
              <>
                <button type="button" className={btn}
                        onClick={() => setEdit((v) => ({ ...v, [o.id]: { name: o.name, address: o.address || "" } }))}>
                  Edit
                </button>
                <button type="button" className={btnDanger} disabled={busy}
                        onClick={() => confirmed(`Remove ${o.name}? Drivers will no longer be able to pick it.`)
                          && run(() => api.del(`/admin/warehouses/${o.id}`))}>
                  Remove
                </button>
              </>
            )}
          </Row>
        );
      })}
    </Panel>
  );
}
