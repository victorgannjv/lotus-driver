import { useEffect, useState } from "react";
import { api } from "../../api";
import { useAccess } from "../../auth/AdminAccess";

// The Settings pages, in one place.
//
// This list was duplicated: once in Gate for the top-bar Settings menu, once in
// Configuration for the tab strip. Adding a page meant editing both, and the
// first time anyone forgot -- adding Sample data -- the page existed, routed and
// worked, but was unreachable from the menu most people use. A second copy of a
// list is a second chance to be wrong, so there is one copy now and both
// surfaces read it.
//
// Order is the order both the menu and the tab strip show.
//
// `module` is the permission that opens it (see backend/access.py). A tab the
// signed-in role cannot open is not drawn at all.
export const CONFIG_TABS = [
  { to: "/admin/config/drivers", label: "Drivers", module: "drivers" },
  { to: "/admin/config/access", label: "Access control", module: "access" },
  { to: "/admin/config/outlets", label: "Outlets", module: "outlets" },
  { to: "/admin/config/windows", label: "Delivery windows", module: "windows" },
  { to: "/admin/config/targets", label: "Time limits", module: "targets" },
  { to: "/admin/config/reasons", label: "Delay reasons", module: "reasons" },
  { to: "/admin/config/driver-app", label: "Driver app", module: "driver_app" },
  { to: "/admin/config/job-management", label: "Job management", module: "job_management" },
  { to: "/admin/config/activity", label: "Activity log", module: "activity" },
];

// Sample data is off the menu now that the pilot is running on real trips.
//
// It is a demo aid: a worked month written through the real tables so the app
// can be shown to people who have not seen it. Beside live pilot data that is
// a button whose whole purpose is to put fiction into the same tables the
// claims come out of, so it should not sit one click from Drivers.
//
// HIDDEN, NOT REMOVED, and hidden CONDITIONALLY -- the tab comes back on its
// own whenever sample rows are actually present. Hiding it outright would mean
// that anyone who loaded the sample (the route still works if you type it, and
// the banner still appears) could strand it in the live dataset with no way
// left to take it out. The way out is never allowed to disappear while there
// is something to take out.
const SAMPLE_TAB = { to: "/admin/config/sample", label: "Sample data", module: "sample" };

export function useConfigTabs() {
  const { can } = useAccess();
  const [sampleLoaded, setSampleLoaded] = useState(false);

  useEffect(() => {
    api
      .get("/admin/config/demo")
      .then((d) => setSampleLoaded(!!d.loaded))
      // A failed check hides the tab, which is the safe direction: the pilot
      // is the normal case, and the route is still reachable by URL.
      .catch(() => setSampleLoaded(false));
  }, []);

  const all = sampleLoaded ? [...CONFIG_TABS, SAMPLE_TAB] : CONFIG_TABS;
  return all.filter((tab) => can(tab.module));
}
