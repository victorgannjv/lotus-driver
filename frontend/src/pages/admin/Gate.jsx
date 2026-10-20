import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../../api";
import { useAccess } from "../../auth/AdminAccess";
import RequireAdmin from "../../auth/RequireAdmin";
import AppHeader from "../../components/AppHeader";
import SampleDataBanner from "../../components/SampleDataBanner";
import UpdateBar from "../../components/UpdateBar";
import { useConfigTabs } from "./configTabs";
import Icon from "../../components/Icon";

// Work on the left, setup on the right.
//
// Dashboard and Evidence are read daily; Drivers, Outlets, reason codes and
// targets are lists someone maintains occasionally. Keeping them in the same
// row implied the same frequency, and put schema-shaped settings one mis-click
// from the board ops read every morning.
//
// What is drawn is what this person's role can open (see useAccess). A tab
// that would only refuse them is not shown, and the Settings menu disappears
// entirely for a role with no settings in it.

const linkClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-red text-white" : "text-slate-600 hover:bg-slate-100"}`;

const WORK_TABS = [
  { to: "/admin/dashboard", label: "Dashboard", module: "dashboard" },
  { to: "/admin/evidence", label: "Evidence", module: "evidence" },
  { to: "/admin/performance", label: "Driver performance", module: "driver_performance" },
  { to: "/admin/jobs", label: "Orders", module: "orders" },
];

// The shell proper. Split from Gate so it renders INSIDE RequireAdmin and can
// read the access context that component provides.
function Shell() {
  const { can, email, role } = useAccess();
  const [menuOpen, setMenuOpen] = useState(false);
  const tabs = useConfigTabs();
  const menuRef = useRef(null);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Unresolved errors from the last day, on the Diagnostics tab. Refreshed on
  // every page change rather than polled: an admin moving around the app is
  // the moment a new problem is worth surfacing, and it costs nothing while
  // they are idle. A failed check shows no badge -- never a false alarm. Only
  // asked of a role that can open Diagnostics; anyone else would just be
  // refused.
  const [openErrors, setOpenErrors] = useState(0);
  const seesDiagnostics = can("diagnostics");
  useEffect(() => {
    if (!seesDiagnostics) return;
    api
      .get("/admin/diagnostics/summary")
      .then((d) => setOpenErrors(d.open_errors_24h || 0))
      .catch(() => setOpenErrors(0));
  }, [location.pathname, seesDiagnostics]);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const inConfig = location.pathname.startsWith("/admin/config");

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader
        homeTo="/admin"
        greeting={`Hi, ${email ? email.split("@")[0] : "admin"}`}
        place={role || "Admin"}
      />
      <nav className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-6 py-3">
        {WORK_TABS.filter((t) => can(t.module)).map((t) => (
          <NavLink key={t.to} to={t.to} className={linkClass}>{t.label}</NavLink>
        ))}
        {seesDiagnostics && (
          <NavLink to="/admin/diagnostics" className={linkClass}>
            {({ isActive }) => (
              <span className="flex items-center gap-1.5">
                Diagnostics
                {openErrors > 0 && (
                  <span
                    title={`${openErrors} unresolved error${openErrors === 1 ? "" : "s"} in the last 24 hours`}
                    className={`rounded-full px-1.5 py-px text-[10px] font-bold leading-4 ${
                      isActive ? "bg-white text-brand-red" : "bg-brand-red text-white"
                    }`}
                  >
                    {openErrors > 99 ? "99+" : openErrors}
                  </span>
                )}
              </span>
            )}
          </NavLink>
        )}

        <span className="flex-1" />

        {tabs.length > 0 && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                inConfig
                  ? "border-brand-red bg-brand-red text-white"
                  : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
              }`}
            >
              Settings
              <Icon name="chevron" className={`h-3 w-3 ${menuOpen ? "-rotate-90" : "rotate-90"}`} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {tabs.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `block px-4 py-2 text-sm ${isActive ? "bg-slate-100 font-semibold text-brand-black" : "text-slate-600 hover:bg-slate-50"}`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>
      <div className="px-6 py-6">
        <UpdateBar />
        <SampleDataBanner />
        <Outlet />
      </div>
    </div>
  );
}

export default function Gate() {
  return (
    <RequireAdmin>
      <Shell />
    </RequireAdmin>
  );
}
