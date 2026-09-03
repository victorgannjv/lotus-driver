import { NavLink, Outlet } from "react-router-dom";
import RequireAdmin from "../../auth/RequireAdmin";
import AppHeader from "../../components/AppHeader";

const linkClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-red text-white" : "text-slate-600 hover:bg-slate-100"}`;

export default function Gate() {
  return (
    <RequireAdmin>
      <div className="min-h-screen bg-slate-50">
        <AppHeader title="Lotus Driver Tracking — Admin" />
        <nav className="flex gap-2 border-b border-slate-200 bg-white px-6 py-3">
          <NavLink to="/admin/jobs" className={linkClass}>
            Jobs
          </NavLink>
          <NavLink to="/admin/drivers" className={linkClass}>
            Drivers
          </NavLink>
          <NavLink to="/admin/admins" className={linkClass}>
            Admins
          </NavLink>
        </nav>
        <div className="px-6 py-6">
          <Outlet />
        </div>
      </div>
    </RequireAdmin>
  );
}
