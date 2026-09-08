import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";

const STATUS_STYLES = {
  registered: "bg-slate-100 text-slate-700",
  delivered: "bg-emerald-100 text-emerald-800",
  failed: "bg-amber-100 text-amber-800",
  cancelled: "bg-slate-100 text-slate-500",
};

export default function Jobs() {
  const [statuses, setStatuses] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ status: "", driverId: "", warehouseId: "", dateFrom: "", dateTo: "" });
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/statuses").then((d) => setStatuses(d.statuses));
    api.get("/admin/drivers").then((d) => setDrivers(d.drivers));
    api.get("/admin/warehouses").then((d) => setWarehouses(d.warehouses));
  }, []);

  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.driverId) params.set("driver_id", filters.driverId);
  if (filters.warehouseId) params.set("warehouse_id", filters.warehouseId);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  const queryString = params.toString();

  useEffect(() => {
    api
      .get(`/admin/jobs?${queryString}`)
      .then((d) => setJobs(d.jobs))
      .catch((err) => setError(err.detail || "could not load jobs"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function updateFilter(field) {
    return (e) => setFilters((f) => ({ ...f, [field]: e.target.value }));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Status</span>
          <select value={filters.status} onChange={updateFilter("status")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Driver</span>
          <select value={filters.driverId} onChange={updateFilter("driverId")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All drivers</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Warehouse</span>
          <select value={filters.warehouseId} onChange={updateFilter("warehouseId")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {!w.is_active ? " (removed)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Date from</span>
          <input type="date" value={filters.dateFrom} onChange={updateFilter("dateFrom")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Date to</span>
          <input type="date" value={filters.dateTo} onChange={updateFilter("dateTo")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <a
          href={`/api/admin/exports/jobs.csv${queryString ? `?${queryString}` : ""}`}
          download
          className="rounded-lg bg-brand-red px-4 py-2 text-sm font-medium text-white hover:bg-brand-red-dark"
        >
          Export CSV
        </a>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!jobs && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {jobs && (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Tracking No.</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Job started</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-4 py-3">
                    <Link to={`/admin/jobs/${job.id}`} className="font-medium text-brand-red underline">
                      {job.tracking_no}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{job.driver_name}</td>
                  <td className="px-4 py-3 text-slate-600">{job.warehouse_name || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{job.work_date}</td>
                  <td className="px-4 py-3 text-slate-600">{job.warehouse_arrived_at || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[job.status_code] || "bg-slate-100 text-slate-700"}`}>
                      {job.status_code}
                    </span>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No jobs match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
