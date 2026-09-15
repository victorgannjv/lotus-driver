import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../../api";
import Icon from "../../components/Icon";
import { CONFIG_TABS } from "./configTabs";

// Settings, written for an ops coordinator rather than a developer.
//
// No column names, no code values, no raw `true`. Every row is a plain sentence
// with a real control beside it, and every action is a button you can see --
// underlined text reads as a link, and people hesitate to click links that
// change data.

const subLink = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-red text-white" : "text-slate-600 hover:bg-slate-100"}`;


export function ConfigurationLayout() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-brand-black">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        Changes save straight away and are recorded in the activity log.
      </p>
      <nav className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {CONFIG_TABS.map(({ to, label }) => (
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

// A labelled block inside a panel. A tab with nine unrelated switches on it is
// a list to be scanned; the same nine under three headings is three decisions.
function Section({ title, blurb, action, children }) {
  return (
    <section className="border-b border-slate-200 pb-2 last:border-0">
      <header className="flex flex-wrap items-end justify-between gap-3 pb-1 pt-5 first:pt-1">
        <div>
          <h3 className="text-sm font-semibold text-brand-black">{title}</h3>
          {blurb && <p className="mt-0.5 text-xs text-slate-500">{blurb}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Row({ children }) {
  return <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 py-4 last:border-0">{children}</div>;
}

// Columns that line up down the page. `cols` is a Tailwind grid-template, applied
// from md up; below that everything stacks.
function GridRow({ cols, children }) {
  return (
    <div className={`grid grid-cols-1 items-center gap-2 border-b border-slate-100 py-4 last:border-0 md:gap-4 ${cols}`}>
      {children}
    </div>
  );
}

const actionsCell = "flex flex-wrap items-center gap-2 md:justify-end";

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

// Module scope on purpose. Declared inside ReasonCodes this is a NEW component
// type on every render, so React unmounts the old subtree and mounts a fresh
// one after each keystroke -- which throws focus out of the input mid-word.
function ReasonFields({ draft, set }) {
  return (
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
          <option value="external">Outside anyone's control</option>
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
}

// Split by who pays for the delay, because that is the only distinction that
// changes what a reason is worth -- and with two dozen of them, one flat list
// is a wall. Each section says what marking a reason that way costs or earns.
const PARTY_SECTIONS = [
  { party: "lotus", title: "Lotus caused the delay",
    blurb: "Time we can put in a claim. This is the list a dispute is built from." },
  { party: "njv", title: "Our side (Ninja Van)",
    blurb: "Delay attributable to Ninja Van. Recorded accurately so the Lotus figures stand up to scrutiny." },
  { party: "external", title: "Outside anyone's control",
    blurb: "Left out of both columns — neither claimed nor conceded." },
];

export function ReasonCodes() {
  const { rows, error, busy, run } = useList("/admin/config/reason-codes", "reason_codes");
  const [edit, setEdit] = useState({});
  const [adding, setAdding] = useState(null);

  const save = async (r, d) => {
    if (await run(() => api.put(`/admin/config/reason-codes/${r.code}`, d))) {
      setEdit((v) => ({ ...v, [r.code]: undefined }));
    }
  };

  return (
    <Panel
      title="Delay reasons"
      blurb="What a driver picks from when a step runs late. Add a reason to the section that will pay for it."
      footer="Who you mark responsible decides whether the lost time goes into a claim against Lotus or comes out of it. Retired reasons stop being offered but stay readable on the trips that already used them."
    >
      <Err>{error}</Err>

      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : PARTY_SECTIONS.map((sec) => {
        // Active first inside a section: a retired reason is history, not a choice.
        const items = rows
          .filter((r) => r.fault_party === sec.party)
          .sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0) || a.sort_order - b.sort_order);
        const live = items.filter((r) => r.is_active).length;

        return (
          <Section
            key={sec.party}
            title={sec.title}
            blurb={sec.blurb}
            action={
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">{live} offered</span>
                <button type="button" className={btn}
                        onClick={() => setAdding({ label: "", fault_party: sec.party, applies_to_gap: "any" })}>
                  Add a reason
                </button>
              </div>
            }
          >
            {adding && adding.fault_party === sec.party && (
              <div className="mb-3 mt-3 flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4">
                <ReasonFields draft={adding} set={setAdding} />
                <button type="button" className={btnPrimary} disabled={busy || !adding.label.trim()}
                        onClick={async () => {
                          const code = adding.label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40);
                          if (await run(() => api.post("/admin/config/reason-codes", { ...adding, code }))) setAdding(null);
                        }}>Add</button>
                <button type="button" className={btn} onClick={() => setAdding(null)}>Cancel</button>
              </div>
            )}

            {items.length === 0 && !adding && (
              <p className="py-3 text-sm text-slate-400">Nothing here yet.</p>
            )}

            {items.map((r) => {
              const d = edit[r.code];
              return d ? (
                <div key={r.code} className="mb-3 mt-3 flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4">
                  <ReasonFields draft={d} set={(next) => setEdit((v) => ({ ...v, [r.code]: next }))} />
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => save(r, d)}>Save</button>
                  <button type="button" className={btn}
                          onClick={() => setEdit((v) => ({ ...v, [r.code]: undefined }))}>Cancel</button>
                </div>
              ) : (
                <GridRow key={r.code} cols="md:grid-cols-[minmax(0,1fr)_10rem_auto]">
                  <span className={`text-sm ${r.is_active ? "text-brand-black" : "text-slate-400 line-through"}`}>
                    {r.label}
                  </span>
                  <span className="text-xs text-slate-400">{gapName(r.applies_to_gap.split(",")[0])}</span>
                  <span className={actionsCell}>
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
                  </span>
                </GridRow>
              );
            })}
          </Section>
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

  // Not a blind slice. The API now sends "09:30", but a row written before
  // that fix still reads back "9:30:00", and slicing that to "9:30:" gives
  // <input type="time"> a value it silently refuses to render -- which is what
  // made a saved 09:30 look like it had reset itself.
  const hhmm = (v) => {
    const m = String(v ?? "").match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
  };
  const valid = (v) => /^\d{2}:\d{2}$/.test(v);

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
            <button type="button" className={btnPrimary}
                    disabled={busy || !dirty || !valid(start) || !valid(end)}
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
  // The master switch lives in app_setting, not in this table -- it governs
  // whether the whole idea applies, and the table is the numbers it governs.
  const [enabled, setEnabled] = useState(null);
  const [settingBusy, setSettingBusy] = useState(false);

  const loadSetting = useCallback(() => {
    api.get("/admin/config/settings")
      .then((d) => {
        const row = (d.settings || []).find((x) => x.setting_key === "gap_targets_enabled");
        setEnabled(String(row?.value).toLowerCase() === "true");
      })
      .catch(() => setEnabled(false));
  }, []);
  useEffect(loadSetting, [loadSetting]);

  async function setMaster(next) {
    setSettingBusy(true);
    try {
      await api.put("/admin/config/settings/gap_targets_enabled", { value: String(next) });
      setEnabled(next);
    } finally {
      setSettingBusy(false);
    }
  }

  return (
    <Panel
      title="Time allowances"
      blurb="How long each step may take before it is flagged as late."
      footer="Allowances explain WHY a run was late. The delivery windows decide WHETHER it was — those work on their own and are unaffected by anything on this page."
    >
      <Err>{error}</Err>

      <Section
        title="Use time allowances"
        blurb="Off by default. These per-step figures are internal working assumptions, not terms agreed with Lotus. Enable them once the allowances are contractually settled; until then lateness is measured against the delivery windows alone."
      >
        <Row>
          <span className="min-w-[18rem] flex-1">
            <span className="block text-sm font-medium text-brand-black">
              Flag steps that run over their allowance
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {enabled
                ? "On — steps over their allowance are flagged, the driver is asked why, and the time is attributed."
                : "Off — no step is flagged, no reason is demanded, and lateness comes only from the delivery windows. Drivers can still add a reason whenever they want to."}
            </span>
          </span>
          {enabled === null ? (
            <span className="text-sm text-slate-500">Loading…</span>
          ) : (
            <Toggle on={enabled} disabled={settingBusy} label="Use time allowances"
                    onChange={setMaster} />
          )}
        </Row>
      </Section>

      <Section
        title="The allowances"
        blurb={enabled
          ? "Switch individual steps off to leave them unflagged while the rest apply."
          : "Kept, and editable, but none of them apply while the switch above is off."}
      >
        {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.map((r) => {
          const value = edits[r.id] ?? r.target_minutes;
          const dirty = Number(value) !== r.target_minutes;
          // Dimmed rather than hidden while the feature is off: the numbers
          // are still the record of what was proposed.
          const muted = !enabled || !r.is_active;
          return (
            <GridRow key={r.id} cols="md:grid-cols-[minmax(0,1fr)_11rem_5rem_auto]">
              <span className={muted ? "opacity-60" : ""}>
                <span className="block text-sm text-brand-black">{GAP_LABEL[r.gap_code] || r.gap_code}</span>
                <span className="block text-xs text-slate-400">
                  {r.warehouse_name ? `${r.warehouse_name} only` : "Every outlet"}
                  {enabled && !r.is_active ? " · not applied" : ""}
                </span>
              </span>
              <label className={`flex items-center gap-2 text-sm text-slate-500 ${muted ? "opacity-60" : ""}`}>
                <input type="number" min="1" max="1440" className={`${input} w-24`} value={value}
                       onChange={(e) => setEdits((v) => ({ ...v, [r.id]: e.target.value }))} />
                minutes
              </label>
              <Toggle
                on={!!r.is_active}
                disabled={busy || !enabled}
                label={`Apply the ${GAP_LABEL[r.gap_code] || r.gap_code} allowance`}
                onChange={(next) => run(() => api.put(`/admin/config/targets/${r.id}/active`, { is_active: next }))}
              />
              <span className={actionsCell}>
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
                            : "Delete this allowance? Switching it off keeps the number; deleting loses it."
                        ) && run(() => api.del(`/admin/config/targets/${r.id}`))}>
                  Delete
                </button>
              </span>
            </GridRow>
          );
        })}
      </Section>
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

// The steps a trip can be made of, and what switching one off actually costs.
// Two are shown but cannot be turned off: "Arrived" is the tap that creates a
// trip, and "Deliveries done" is written by the system when the last drop
// closes, so there is nobody to stop asking.
const TRIP_STEPS = [
  ["arrived", "Arrived at Lotus", "This is the tap that starts a trip", true],
  ["goods_ready", "Lotus goods ready", "Ends the wait we bill Lotus for", false],
  ["loaded", "Loaded to truck", "Where the driver is asked how many drops the trip carries", false],
  ["departed", "Departed outlet", "Time at outlet is measured from Arrived to here", false],
  ["deliveries_done", "Deliveries done", "Recorded by the system when the last drop closes", true],
  ["returned", "Returned to Lotus", "Ends the trip and closes the driver's day", false],
];

const SETTING_UI = {
  active_checkpoints: {
    label: "Steps a trip is made of",
    help: "Switch one off and the app stops asking for it — the driver goes straight to the next step. Trips that already recorded it keep it, and so does every claim built on them.",
    type: "steps",
  },
  job_count_quick_picks: { label: "Quick buttons for number of jobs", help: "Shown when the driver is asked how many drops the trip carries.", type: "numbers" },
  job_count_manual_max: { label: "Most jobs a driver can type", help: "A safety limit on the typed box.", type: "number", min: 1, max: 200 },
  allow_add_job_mid_trip: { label: "Let drivers add a job after loading", help: "For when the load changes on the road.", type: "bool" },
  photo_required_checkpoints: { label: "Steps that need a photo", help: "Ticked: the step will not record without one. Unticked: the driver records it now and can add the photo later, while the trip is still open. Delivery proof photos are always required and are not affected by this.", type: "checkpoints" },
  photo_burn_timestamp: { label: "Print the date and time onto the photo", help: "Written into the picture, so it cannot be argued with.", type: "bool" },
  photo_timestamp_source: { label: "Where the photo's time comes from", help: "A phone with the wrong clock would weaken every photo.", type: "choice",
    options: [["server", "Our server's clock (recommended)"], ["handset", "The driver's phone"]] },
  photo_capture_gps: { label: "Record location with each photo", help: "Supporting detail — the time matters more.", type: "bool" },
  reason_prompt_on_breach: { label: "Ask why when a step runs late", help: "Off means late steps are recorded but never explained.", type: "bool" },
  default_language: { label: "Language the app opens in", help: "Drivers can still switch it themselves.", type: "choice",
    options: [["en", "English"], ["ms", "Bahasa Malaysia"]] },
};

// Grouped by the question each block answers, so you can find the one setting
// you came to change instead of reading all nine. A key not listed here simply
// does not appear -- and a key the backend does not return is skipped, so this
// list can name a setting before the migration that creates it lands.
const SETTING_GROUPS = [
  {
    title: "Steps in a trip",
    blurb: "Which checkpoints the driver app asks for. Change it whenever the run changes — drivers pick it up on their next screen, with nothing to install.",
    keys: ["active_checkpoints"],
  },
  {
    title: "Counting the jobs",
    blurb: "What the app accepts when a driver says how many drops a trip carries.",
    keys: ["job_count_quick_picks", "job_count_manual_max", "allow_add_job_mid_trip"],
  },
  {
    title: "Photo evidence",
    blurb: "What a photo has to carry for it to hold up when Lotus disputes a time.",
    keys: ["photo_required_checkpoints", "photo_burn_timestamp", "photo_timestamp_source", "photo_capture_gps"],
  },
  {
    title: "Prompts and language",
    blurb: "What the app asks the driver, and the words it asks in.",
    keys: ["reason_prompt_on_breach", "default_language"],
  },
];

// Module scope on purpose -- see the note on ReasonFields. Declared inside
// DriverApp this would remount the number box on every keystroke.
function SettingRow({ s, ui, v, dirty, busy, set, commit }) {
  const k = s.setting_key;
  const isOn = (x) => String(x).toLowerCase() === "true";

  return (
    <Row>
      <span className="min-w-[18rem] flex-1">
        <span className="block text-sm font-medium text-brand-black">{ui.label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{ui.help}</span>
      </span>

      {ui.type === "bool" && (
        <Toggle on={isOn(v)} disabled={busy} label={ui.label}
                onChange={(next) => { set(k, String(next)); commit(k, next); }} />
      )}

      {ui.type === "choice" && (
        <select className={input} value={v} disabled={busy}
                onChange={(e) => { set(k, e.target.value); commit(k, e.target.value); }}>
          {ui.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      )}

      {ui.type === "number" && (
        <>
          <input type="number" min={ui.min} max={ui.max} className={`${input} w-24`} value={v}
                 onChange={(e) => set(k, e.target.value)} />
          <button type="button" className={btnPrimary} disabled={busy || !dirty}
                  onClick={() => commit(k, v)}>Save</button>
        </>
      )}

      {ui.type === "numbers" && (
        <>
          <span className="flex flex-wrap items-center gap-2">
            {String(v).split(",").filter(Boolean).map((n, i, arr) => (
              <span key={i} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm">
                {n.trim()}
                <button type="button" aria-label={`Remove ${n}`} className="text-slate-400 hover:text-rose-600"
                        onClick={() => set(k, arr.filter((_, j) => j !== i).join(","))}>×</button>
              </span>
            ))}
            <button type="button" className={btn}
                    onClick={() => {
                      const n = parseInt(window.prompt("Add a number"), 10);
                      if (!Number.isNaN(n) && n > 0) {
                        set(k, [...String(v).split(",").filter(Boolean), String(n)].join(","));
                      }
                    }}>Add</button>
          </span>
          <button type="button" className={btnPrimary} disabled={busy || !dirty}
                  onClick={() => commit(k, v)}>Save</button>
        </>
      )}

      {ui.type === "steps" && (
        <>
          <span className="flex w-full min-w-0 flex-col gap-1.5 sm:w-[24rem]">
            {TRIP_STEPS.map(([code, label, note, locked]) => {
              const list = String(v).split(",").map((x) => x.trim()).filter(Boolean);
              const on = locked || list.includes(code);
              return (
                <span key={code}
                      className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
                        on ? "bg-emerald-50" : "bg-slate-100"
                      }`}>
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${on ? "text-emerald-900" : "text-slate-500"}`}>
                      {label}
                    </span>
                    <span className="block text-[11px] leading-snug text-slate-500">{note}</span>
                  </span>
                  {/* Shown greyed and explained rather than hidden. A list that
                      silently omits two of the six steps reads as a list of
                      all the steps there are. */}
                  {locked ? (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Always on
                    </span>
                  ) : (
                    <Toggle on={on} disabled={busy} label={label}
                            onChange={() => set(k, (on ? list.filter((x) => x !== code) : [...list, code]).join(","))} />
                  )}
                </span>
              );
            })}
          </span>
          <button type="button" className={btnPrimary} disabled={busy || !dirty}
                  onClick={() => commit(k, v)}>Save</button>
        </>
      )}

      {ui.type === "checkpoints" && (
        <>
          <span className="flex flex-wrap items-center gap-2">
            {/* An empty row of boxes looks like a control that failed to load.
                Say what none of them ticked actually means. */}
            {String(v).split(",").filter(Boolean).length === 0 && (
              <span className="text-xs text-slate-400">
                None — every step can be recorded without a photo
              </span>
            )}
            {CHECKPOINTS.map(([code, label]) => {
              const list = String(v).split(",").map((x) => x.trim()).filter(Boolean);
              const on = list.includes(code);
              return (
                <label key={code}
                       className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${on ? "bg-emerald-50 text-emerald-900" : "bg-slate-100 text-slate-500"}`}>
                  <input type="checkbox" checked={on}
                         onChange={() => set(k, (on ? list.filter((x) => x !== code) : [...list, code]).join(","))} />
                  {label}
                </label>
              );
            })}
          </span>
          <button type="button" className={btnPrimary} disabled={busy || !dirty}
                  onClick={() => commit(k, v)}>Save</button>
        </>
      )}
    </Row>
  );
}

export function DriverApp() {
  const { rows, error, busy, run } = useList("/admin/config/settings", "settings");
  const [draft, setDraft] = useState({});

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const commit = async (k, v) => {
    const ok = await run(() => api.put(`/admin/config/settings/${k}`, { value: String(v) }));
    if (ok) setDraft((d) => ({ ...d, [k]: undefined }));
  };

  const byKey = {};
  (rows || []).forEach((s) => { byKey[s.setting_key] = s; });

  return (
    <Panel title="Driver app" blurb="What the app asks drivers for." footer="Changes reach drivers on their next screen — nobody needs to update anything.">
      <Err>{error}</Err>
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : SETTING_GROUPS.map((g) => {
        const items = g.keys.map((k) => byKey[k]).filter((s) => s && SETTING_UI[s.setting_key]);
        if (items.length === 0) return null;
        return (
          <Section key={g.title} title={g.title} blurb={g.blurb}>
            {items.map((s) => {
              const k = s.setting_key;
              const v = draft[k] !== undefined ? draft[k] : s.value;
              return (
                <SettingRow key={k} s={s} ui={SETTING_UI[k]} v={v} busy={busy}
                            dirty={draft[k] !== undefined && String(draft[k]) !== s.value}
                            set={set} commit={commit} />
              );
            })}
          </Section>
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
          <GridRow key={d.id} cols="md:grid-cols-[minmax(0,1fr)_11rem_9rem_auto]">
            <span>
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
            <span className={actionsCell}>
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
            </span>
          </GridRow>
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
        <GridRow key={u.id} cols="md:grid-cols-[minmax(0,1fr)_9rem_auto]">
          <span>
            <span className="block text-sm font-medium text-brand-black">{u.name}</span>
            <span className="block text-xs text-slate-400">{u.email}</span>
          </span>
          <span className="text-xs text-slate-400">
            {u.status === "active" ? "" : "Access removed"}
          </span>
          <span className={actionsCell}>
          {u.status === "active" && (
            <button type="button" className={btnDanger} disabled={busy}
                    onClick={() => confirmed(`Remove dashboard access for ${u.name}?`)
                      && run(() => api.del(`/admin/config/admins/${u.id}`))}>
              Remove access
            </button>
          )}
          </span>
        </GridRow>
      ))}
    </Panel>
  );
}

/* --------------------------------------------------------------------- roster */

// PARKED -- not routed or linked anywhere as of Sep 2026. The roster only makes
// sense alongside the manpower story on the dashboard, and on its own it read as
// an unexplained chore, so it is out of the way until that lands. The table,
// endpoints and this component all stay, so bringing it back is a route and a
// tab, not a rewrite.
//
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
      footer="The dashboard counts who actually drove. The roster records who was scheduled, which is what makes a short-handed day visible rather than inferred."
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
                    <span className="block text-[10px] font-normal text-slate-300">{d.getDate()}</span>
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

const PAGE_SIZE = 25;

export function ActivityLog() {
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Changing the filter has to reset the page: staying on page 4 of a filter
  // with two entries shows an empty table and looks like a bug.
  const pick = (v) => { setEntity(v); setPage(1); };

  useEffect(() => {
    setData(null);
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    if (entity) qs.set("entity", entity);
    api.get(`/admin/config/activity?${qs}`)
      .then(setData)
      .catch((e) => setError(e.detail || "Could not load the activity log."));
  }, [entity, page]);

  const rows = data?.activity;
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <Panel
      title="Activity log"
      blurb="Every settings change, who made it and when."
      action={
        <select className={input} value={entity} onChange={(e) => pick(e.target.value)}>
          <option value="">Everything</option>
          {Object.entries(ENTITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      }
      footer="Changing a window or an allowance re-scores past trips, so this is how you answer “why does last month read differently now?” — and how a claim survives Lotus asking whether the bar moved after the fact."
    >
      <Err>{error}</Err>

      {rows && total > 0 && (
        <p className="pb-2 text-xs text-slate-500">
          Showing {first}–{last} of {total} change{total === 1 ? "" : "s"}
        </p>
      )}

      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing changed yet.</p>
      ) : rows.map((a) => (
        <GridRow key={a.id} cols="md:grid-cols-[5.5rem_9rem_minmax(0,1fr)_13rem_10rem]">
          <span>
            <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${ACTION_CHIP[a.action]}`}>
              {a.action === "create" ? "Added" : a.action === "delete" ? "Deleted" : "Changed"}
            </span>
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {ENTITY_LABEL[a.entity] || a.entity}
          </span>
          <span className="text-sm text-brand-black">{a.summary}</span>
          <span className="truncate text-sm text-slate-500">{a.actor_email || "—"}</span>
          <span className="text-xs text-slate-400">{a.created_at}</span>
        </GridRow>
      ))}

      {pages > 1 && (
        <div className="flex items-center justify-between gap-3 pt-4">
          <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </button>
          <span className="text-xs text-slate-500">Page {page} of {pages}</span>
          <button type="button" className={btn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}
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


/* ---------------------------------------------------------------- sample data */

export function SampleData() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/admin/config/demo").then(setState)
      .catch((e) => setError(e.detail || "Could not check the sample data."));
  }, []);
  useEffect(load, [load]);

  async function run(path, ok) {
    setBusy(true); setError(null);
    try { await api.post(path, {}); load(); if (ok) window.alert(ok); }
    catch (e) { setError(e.detail || "That did not work."); }
    finally { setBusy(false); }
  }

  const loaded = state?.loaded;

  return (
    <Panel
      title="Sample data"
      blurb="A worked example month, for showing the app to people who have not seen it."
      footer="Loading and removing sample data are both recorded in the activity log, so a figure can always be traced back to whether the sample was present when it was read."
    >
      <Err>{error}</Err>

      {!state ? <p className="text-sm text-slate-500">Loading…</p> : (
        <>
          <div className={`mb-5 rounded-xl px-4 py-3 text-sm ${
            loaded ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-slate-50 text-slate-600"
          }`}>
            {loaded
              ? `Sample data is loaded — ${state.trips} trips across ${state.drivers} sample drivers. Every figure on the dashboard and in Evidence currently includes it.`
              : "No sample data is loaded. Everything you see is real."}
          </div>

          <Section
            title="What it puts in"
            blurb="Four weeks of trips written through the same tables a driver's phone writes to — so the walkthrough exercises the real scoring, not a mock."
          >
            <ul className="space-y-1.5 py-2 text-sm text-slate-600">
              <li>· Six sample drivers, named with “(sample)” and spread across your real outlets.</li>
              <li>· About three trips a day each, aligned to the contracted delivery windows.</li>
              <li>· Roughly a third run over target, with delay reasons attached where they do.</li>
              <li>· One outlet performs noticeably worse than the others, so the outlet breakdown has something to point at.</li>
              <li>· The same numbers every time — you can rehearse on Monday and present on Thursday against identical figures.</li>
            </ul>
          </Section>

          <Section
            title="Removing it"
            blurb="Every sample row hangs off a sample driver, so removing it is a delete by ownership rather than a guess about which rows were pretend. Nothing real can be caught by it."
          >
            <div className="flex flex-wrap items-center gap-3 py-2">
              <button type="button" className={btnPrimary} disabled={busy || loaded}
                      onClick={() => run("/admin/config/demo/seed", "Sample data loaded. Open the Dashboard to see it.")}>
                Load sample data
              </button>
              <button type="button" className={btnDanger} disabled={busy || !loaded}
                      onClick={() => confirmed(
                        `Remove all sample data? This deletes ${state.trips} sample trips and ${state.drivers} sample drivers. Real trips are untouched.`
                      ) && run("/admin/config/demo/reset", "Sample data removed. You are back to real figures.")}>
                Remove sample data
              </button>
              {busy && <span className="text-sm text-slate-500">Working… this takes a few seconds.</span>}
            </div>
          </Section>
        </>
      )}
    </Panel>
  );
}
