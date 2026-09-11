import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import RequireAdmin from "../../auth/RequireAdmin";
import AppHeader from "../../components/AppHeader";
import Icon from "../../components/Icon";

// Work on the left, setup on the right.
//
// Dashboard and Evidence are read daily; Drivers, Outlets, reason codes and
// targets are lists someone maintains occasionally. Keeping them in the same
// row implied the same frequency, and put schema-shaped settings one mis-click
// from the board ops read every morning.

const linkClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-red text-white" : "text-slate-600 hover:bg-slate-100"}`;

const CONFIG_ITEMS = [
  { to: "/admin/config/drivers", label: "Drivers" },
  { to: "/admin/config/admins", label: "Admins" },
  { to: "/admin/config/outlets", label: "Outlets" },
  { to: "/admin/config/windows", label: "Delivery windows" },
  { to: "/admin/config/targets", label: "Time allowances" },
  { to: "/admin/config/reasons", label: "Delay reasons" },
  { to: "/admin/config/roster", label: "Shift roster" },
  { to: "/admin/config/driver-app", label: "Driver app" },
  { to: "/admin/config/activity", label: "Activity log" },
];

export default function Gate() {
  // Identity comes from the SSO proxy; RequireAdmin has already refused anyone
  // not on the allowlist, so this is only an echo of who you are.
  const [email, setEmail] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setEmail(d.email))
      .catch(() => setEmail(null));
  }, []);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const inConfig = location.pathname.startsWith("/admin/config");

  return (
    <RequireAdmin>
      <div className="min-h-screen bg-slate-50">
        <AppHeader greeting={`Hi, ${email ? email.split("@")[0] : "admin"}`} place="Admin" />
        <nav className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-6 py-3">
          <NavLink to="/admin/dashboard" className={linkClass}>Dashboard</NavLink>
          <NavLink to="/admin/evidence" className={linkClass}>Evidence</NavLink>
          <NavLink to="/admin/jobs" className={linkClass}>Orders</NavLink>

          <span className="flex-1" />

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
                {CONFIG_ITEMS.map((item) => (
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
        </nav>
        <div className="px-6 py-6">
          <Outlet />
        </div>
      </div>
    </RequireAdmin>
  );
}
