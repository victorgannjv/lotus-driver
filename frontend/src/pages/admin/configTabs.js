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
export const CONFIG_TABS = [
  { to: "/admin/config/drivers", label: "Drivers" },
  { to: "/admin/config/admins", label: "Admins" },
  { to: "/admin/config/outlets", label: "Outlets" },
  { to: "/admin/config/windows", label: "Delivery windows" },
  { to: "/admin/config/targets", label: "Time allowances" },
  { to: "/admin/config/reasons", label: "Delay reasons" },
  { to: "/admin/config/driver-app", label: "Driver app" },
  { to: "/admin/config/activity", label: "Activity log" },
  { to: "/admin/config/sample", label: "Sample data" },
];
