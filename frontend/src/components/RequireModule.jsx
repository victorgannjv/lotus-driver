import { Link, Navigate } from "react-router-dom";
import { useAccess } from "../auth/AdminAccess";
import { CONFIG_TABS } from "../pages/admin/configTabs";

// Guards one admin screen with the module it belongs to.
//
//   no View    -> a plain "you don't have access" page, naming the role, rather
//                 than a screen that loads and fills with 403 errors.
//   View only  -> the screen, with every form control on it disabled and a
//                 banner saying so. A <fieldset disabled> does that for every
//                 input, select and button inside it in one stroke, which is
//                 why this is a wrapper and not a prop threaded through
//                 fifteen forms. Links still work, so a view-only person can
//                 still read and follow everything.
//
// Screens that mix reading controls with a few write actions (Diagnostics: its
// filters are not an edit, resolving an issue is) pass fieldset={false} and
// gate their own buttons with useAccess().can instead.
//
// So do screens that hold an action behind a DIFFERENT permission (Drivers:
// setting a password is its own switch). A disabled <fieldset> cannot be
// overridden from inside, so a blanket one would disable that action even for
// the role that holds it. `also` names that permission, so the banner can say
// what the page is still good for.
export default function RequireModule({ module, fieldset = true, also = null, children }) {
  const { can, role, byKey } = useAccess();
  const mod = byKey[module];

  if (!can(module, "view")) {
    return (
      <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <h1 className="text-lg font-semibold text-brand-black">You don't have access to {mod?.label || "this page"}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {role ? `Your role (${role}) doesn't include it. ` : ""}Ask an administrator if you need it.
        </p>
        <Link to="/admin" className="mt-5 inline-block text-sm font-semibold text-brand-red">
          Go to something you can open
        </Link>
      </div>
    );
  }

  const offersEdit = !!mod?.levels?.includes("edit");
  const readOnly = offersEdit && !can(module, "edit");
  const exception = also && can(also.module, "edit") ? also.text : null;

  if (!readOnly) return children;

  return (
    <>
      <div className="mb-4 rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-700 ring-1 ring-slate-200">
        <b>View only.</b> Your role{role ? ` (${role})` : ""} can see this page but not change it
        {exception ? `, apart from ${exception}` : ""}.
      </div>
      {fieldset ? (
        <fieldset disabled className="m-0 min-w-0 border-0 p-0">
          {children}
        </fieldset>
      ) : (
        children
      )}
    </>
  );
}

// Where /admin lands. The first screen this person can actually open, in the
// order the nav shows them -- not always the dashboard, which a role may not
// include.
const WORK = [
  ["dashboard", "/admin/dashboard"],
  ["evidence", "/admin/evidence"],
  ["driver_performance", "/admin/performance"],
  ["orders", "/admin/jobs"],
  ["diagnostics", "/admin/diagnostics"],
];

export function AdminLanding() {
  const { can } = useAccess();
  const first = WORK.find(([m]) => can(m));
  const setting = CONFIG_TABS.find((t) => can(t.module));
  const to = first ? first[1] : setting ? setting.to : null;
  return to ? <Navigate to={to} replace /> : <div className="p-6 text-sm text-slate-500">Nothing here is available to your role.</div>;
}
