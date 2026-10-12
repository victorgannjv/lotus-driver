import { createContext, useContext } from "react";

// What the signed-in admin's role lets them use.
//
// This is a convenience for the screens, not the control. Every admin endpoint
// checks the same role again on the server, so a tampered copy of this only
// ever shows someone a button that answers 403. What it buys is that a person
// is not shown a menu full of things that will refuse them.
//
// `modules` is the catalogue exactly as the server sent it with /api/me
// (key, label, group, and the levels that module offers), so there is no second
// list in this app to fall out of step with backend/access.py.

const RANK = { view: 1, edit: 2 };

export function buildAccess({ permissions = {}, modules = [], role = null, email = null, refresh = () => {} }) {
  // can("evidence")            -> may view it
  // can("drivers", "edit")     -> may change it
  // can(["drivers", "orders"]) -> may use ANY of them
  const can = (module, level = "view") => {
    const wanted = Array.isArray(module) ? module : [module];
    return wanted.some((m) => permissions[m] && RANK[permissions[m]] >= RANK[level]);
  };
  const byKey = Object.fromEntries(modules.map((m) => [m.key, m]));
  return { permissions, modules, byKey, role, email, can, refresh };
}

const AccessContext = createContext(buildAccess({}));

export const AccessProvider = AccessContext.Provider;

export function useAccess() {
  return useContext(AccessContext);
}
