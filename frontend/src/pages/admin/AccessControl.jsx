import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { useAccess } from "../../auth/AdminAccess";

// Who can sign in to this site, and what each of them may do once they have.
//
// Two lists that work together. A ROLE is a named set of permissions -- for
// each part of the site, no access, view, or edit (edit includes view). A
// member of STAFF has exactly one role. Permissions live on roles, not on
// people, so "Finance sees the dashboard and evidence" is decided once, and a
// new hire gets it by being given the role.
//
// Everything here is enforced on the server; this page and the menus only
// reflect it. Two guards keep the site from locking itself: the built-in
// Administrator role cannot be edited, and the last person able to manage
// access cannot be demoted, removed, or have their role trimmed.
//
// A role with only View on this module sees the lists and every control is
// disabled (RequireModule), so a supervisor can audit who has what.

const input = "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-red focus:outline-none disabled:bg-slate-50";
const btnPrimary = "rounded-lg bg-brand-red px-4 py-2 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50";
const btn = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40";
const btnDanger = "rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40";

const LEVEL_LABEL = { none: "No access", view: "View", edit: "Edit" };

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
      {footer && <footer className="border-t border-slate-100 px-6 py-3 text-xs text-slate-500">{footer}</footer>}
    </section>
  );
}

// "Edit: Drivers, Outlets · View: Dashboard, Evidence" -- the whole of a role
// in a line, so the list can be read without opening each one.
function Grants({ permissions, byKey, order }) {
  const labelsAt = (level) =>
    order.filter((k) => permissions[k] === level).map((k) => byKey[k]?.label || k);
  const edit = labelsAt("edit");
  const view = labelsAt("view");
  if (!edit.length && !view.length) return <span className="text-xs text-slate-400">No access to anything</span>;
  return (
    <span className="space-y-1 text-xs text-slate-600">
      {edit.length > 0 && (
        <span className="block">
          <b className="mr-1.5 rounded bg-brand-red/10 px-1.5 py-0.5 font-semibold text-brand-red">Edit</b>
          {edit.join(", ")}
        </span>
      )}
      {view.length > 0 && (
        <span className="block">
          <b className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">View</b>
          {view.join(", ")}
        </span>
      )}
    </span>
  );
}

// The permission matrix: one row per module, a radio for each level it offers.
function RoleEditor({ modules, initial, busy, onSave, onCancel }) {
  const [name, setName] = useState(initial.name || "");
  const [description, setDescription] = useState(initial.description || "");
  const [perms, setPerms] = useState({ ...(initial.permissions || {}) });

  const set = (key, level) =>
    setPerms((p) => {
      const next = { ...p };
      if (level === "none") delete next[key];
      else next[key] = level;
      return next;
    });
  // "Give everything the most it offers" / "Everything view-only" / "Clear".
  const fill = (mode) =>
    setPerms(
      Object.fromEntries(
        modules
          .map((m) => [m.key, mode === "edit" ? m.levels[m.levels.length - 1] : mode === "view" ? "view" : null])
          .filter(([, v]) => v),
      ),
    );

  const groups = [...new Set(modules.map((m) => m.group))];
  const grantsAccess = perms.access === "edit";

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-600">Role name</span>
          <input className={input} value={name} maxLength={80} placeholder="e.g. Finance"
                 onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-600">What it is for (optional)</span>
          <input className={input} value={description} maxLength={255} placeholder="Who gets this role, in a sentence"
                 onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>Set every row:</span>
        <button type="button" className={btn} onClick={() => fill("view")}>View only</button>
        <button type="button" className={btn} onClick={() => fill("edit")}>Full</button>
        <button type="button" className={btn} onClick={() => fill("none")}>Clear</button>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
        {groups.map((group) => (
          <div key={group}>
            <p className="bg-slate-100 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {group}
            </p>
            {modules.filter((m) => m.group === group).map((m) => {
              const level = perms[m.key] || "none";
              return (
                <div key={m.key} className="grid gap-2 border-t border-slate-100 px-4 py-2.5 md:grid-cols-[minmax(0,1fr)_16rem] md:items-center">
                  <div>
                    <p className="text-sm font-medium text-brand-black">{m.label}</p>
                    <p className="text-xs text-slate-500">{m.about}</p>
                  </div>
                  <div role="radiogroup" aria-label={m.label} className="flex gap-1">
                    {["none", ...m.levels].map((lv) => (
                      <label key={lv}
                             className={`flex-1 cursor-pointer rounded-lg border px-2 py-1.5 text-center text-xs font-semibold ${
                               level === lv
                                 ? lv === "edit" ? "border-brand-red bg-brand-red text-white"
                                   : lv === "view" ? "border-brand-black bg-brand-black text-white"
                                   : "border-slate-300 bg-slate-200 text-slate-700"
                                 : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                             }`}>
                        <input type="radio" className="sr-only" name={`perm-${m.key}`} checked={level === lv}
                               onChange={() => set(m.key, lv)} />
                        {LEVEL_LABEL[lv]}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {grantsAccess && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          Edit on Access control lets whoever holds this role change anyone's role -- including their own. Give it
          only to people you would trust with everything.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" className={btnPrimary} disabled={busy || !name.trim()}
                onClick={() => onSave({ name, description, permissions: perms })}>
          Save role
        </button>
        <button type="button" className={btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function AccessControl() {
  const { modules, byKey, refresh } = useAccess();
  const [staff, setStaff] = useState(null);
  const [roles, setRoles] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(null);       // { name, email, role_id }
  const [editing, setEditing] = useState(null);     // role id, or "new"

  const order = modules.map((m) => m.key);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api.get("/admin/access/staff"), api.get("/admin/access/roles")]);
      setStaff(s.staff);
      setRoles(r.roles);
    } catch (e) {
      setError(e.detail || "Could not load access control.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Every change reloads both lists (member counts move with role changes) and
  // re-reads the signed-in person's own grants, since they may just have
  // changed their own role.
  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      await refresh();
      return true;
    } catch (e) {
      setError(e.detail || "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const active = (staff || []).filter((p) => p.status === "active");
  const removed = (staff || []).filter((p) => p.status !== "active");

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}

      <Panel
        title="Staff"
        blurb="Everyone who can open this site, and the role that decides what they can do."
        action={!adding && (
          <button type="button" className={btnPrimary} disabled={!roles}
                  onClick={() => setAdding({ name: "", email: "", role_id: "" })}>
            Add staff
          </button>
        )}
        footer="Sign-in is through Google. Adding someone lets that Google account in; it does not create a password. Changes apply on the person's next click."
      >
        {adding && (
          <div className="mb-5 flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Name</span>
              <input className={input} value={adding.name}
                     onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} />
            </label>
            <label className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Work email</span>
              <input className={input} type="email" placeholder="name@ninjavan.co" value={adding.email}
                     onChange={(e) => setAdding((a) => ({ ...a, email: e.target.value }))} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">Role</span>
              <select className={input} value={adding.role_id}
                      onChange={(e) => setAdding((a) => ({ ...a, role_id: e.target.value }))}>
                <option value="">Choose a role…</option>
                {(roles || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <button type="button" className={btnPrimary}
                    disabled={busy || !adding.email.trim() || !adding.name.trim() || !adding.role_id}
                    onClick={async () => {
                      const ok = await run(() => api.post("/admin/access/staff", {
                        name: adding.name, email: adding.email, role_id: Number(adding.role_id),
                      }));
                      if (ok) setAdding(null);
                    }}>
              Add
            </button>
            <button type="button" className={btn} onClick={() => setAdding(null)}>Cancel</button>
          </div>
        )}

        {!staff ? <p className="text-sm text-slate-500">Loading…</p> : (
          <>
            {active.map((p) => (
              <div key={p.id} className="grid gap-3 border-b border-slate-100 py-3 last:border-0 md:grid-cols-[minmax(0,1fr)_14rem_auto] md:items-center">
                <span>
                  <span className="block text-sm font-medium text-brand-black">
                    {p.name}
                    {p.is_self && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">You</span>}
                  </span>
                  <span className="block text-xs text-slate-400">{p.email}</span>
                </span>
                <span className="flex flex-col gap-1">
                  <select className={input} value={p.role_id || ""} aria-label={`Role for ${p.name}`} disabled={busy}
                          onChange={(e) => run(() => api.put(`/admin/access/staff/${p.id}`, { role_id: Number(e.target.value) }))}>
                    {!p.role_id && <option value="" disabled>No role -- choose one</option>}
                    {(roles || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  {!p.role_id && <span className="text-[11px] font-medium text-brand-red">Can sign in but can't open anything</span>}
                </span>
                <span className="flex justify-end">
                  <button type="button" className={btnDanger} disabled={busy}
                          onClick={() => window.confirm(`Remove ${p.name}'s access to this site?`)
                            && run(() => api.put(`/admin/access/staff/${p.id}`, { status: "disabled" }))}>
                    Remove access
                  </button>
                </span>
              </div>
            ))}
            {removed.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Access removed</p>
                {removed.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
                    <span>
                      <span className="block text-sm text-slate-500">{p.name}</span>
                      <span className="block text-xs text-slate-400">{p.email}</span>
                    </span>
                    <button type="button" className={btn} disabled={busy}
                            onClick={() => run(() => api.put(`/admin/access/staff/${p.id}`, { status: "active" }))}>
                      Restore access
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Panel>

      <Panel
        title="Roles"
        blurb="What each kind of staff member can see and change."
        action={editing !== "new" && (
          <button type="button" className={btn} disabled={!roles} onClick={() => setEditing("new")}>New role</button>
        )}
        footer="Edit includes View. The built-in Administrator role always has everything, including areas added later, and cannot be changed."
      >
        {editing === "new" && (
          <div className="mb-4">
            <RoleEditor modules={modules} initial={{}} busy={busy} onCancel={() => setEditing(null)}
                        onSave={async (body) => { if (await run(() => api.post("/admin/access/roles", body))) setEditing(null); }} />
          </div>
        )}
        {!roles ? <p className="text-sm text-slate-500">Loading…</p> : roles.map((r) => (
          <div key={r.id} className="border-b border-slate-100 py-4 last:border-0">
            {editing === r.id ? (
              <RoleEditor modules={modules} initial={r} busy={busy} onCancel={() => setEditing(null)}
                          onSave={async (body) => { if (await run(() => api.put(`/admin/access/roles/${r.id}`, body))) setEditing(null); }} />
            ) : (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-black">
                    {r.name}
                    {r.is_system && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Built in</span>}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {r.members} {r.members === 1 ? "person" : "people"}
                    </span>
                  </p>
                  {r.description && <p className="mt-0.5 text-xs text-slate-500">{r.description}</p>}
                  <div className="mt-2">
                    {r.is_system
                      ? <span className="text-xs text-slate-600">Everything, always -- and anything added later.</span>
                      : <Grants permissions={r.permissions} byKey={byKey} order={order} />}
                  </div>
                </div>
                {!r.is_system && (
                  <div className="flex items-start gap-2">
                    <button type="button" className={btn} disabled={busy} onClick={() => setEditing(r.id)}>Edit</button>
                    <button type="button" className={btnDanger} disabled={busy || r.members > 0}
                            title={r.members > 0 ? "Move its people to another role first" : undefined}
                            onClick={() => window.confirm(`Delete the role "${r.name}"?`)
                              && run(() => api.del(`/admin/access/roles/${r.id}`))}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </Panel>
    </div>
  );
}
