import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import RequireAdmin from "../../auth/RequireAdmin";
import AppHeader from "../../components/AppHeader";

const linkClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-red text-white" : "text-slate-600 hover:bg-slate-100"}`;

export default function Gate() {
  // Same greeting shape as the driver app. Identity comes from the SSO proxy, so
  // this is just an echo of who the platform says you are -- RequireAdmin has
  // already refused anyone who isn't on the allowlist.
  const [email, setEmail] = useState(null);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setEmail(d.email))
      .catch(() => setEmail(null));
  }, []);

  return (
    <RequireAdmin>
      <div className="min-h-screen bg-slate-50">
        <AppHeader greeting={`Hi, ${email ? email.split("@")[0] : "admin"}`} place="Admin" />
        <nav className="flex gap-2 border-b border-slate-200 bg-white px-6 py-3">
          <NavLink to="/admin/dashboard" className={linkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/admin/jobs" className={linkClass}>
            Jobs
          </NavLink>
          <NavLink to="/admin/drivers" className={linkClass}>
            Drivers
          </NavLink>
          <NavLink to="/admin/admins" className={linkClass}>
            Admins
          </NavLink>
          <NavLink to="/admin/warehouses" className={linkClass}>
            Warehouses
          </NavLink>
        </nav>
        <div className="px-6 py-6">
          <Outlet />
        </div>
      </div>
    </RequireAdmin>
  );
}
