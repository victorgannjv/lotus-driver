import { NavLink, Outlet } from "react-router-dom";
import RequireAdmin from "../../auth/RequireAdmin";

const linkClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`;

export default function Gate() {
  return (
    <RequireAdmin>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-900">Lotus Driver Tracking — Admin</h1>
          <nav className="mt-3 flex gap-2">
            <NavLink to="/admin/jobs" className={linkClass}>
              Jobs
            </NavLink>
            <NavLink to="/admin/drivers" className={linkClass}>
              Drivers
            </NavLink>
            <NavLink to="/admin/review" className={linkClass}>
              Review queue
            </NavLink>
          </nav>
        </header>
        <div className="px-6 py-6">
          <Outlet />
        </div>
      </div>
    </RequireAdmin>
  );
}
