import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { formatDate, formatTime } from "../../lib/duration";
import { statusLabel, statusStyle } from "../../lib/status";

export default function Jobs() {
  const [searchParams] = useSearchParams();
  const [statuses, setStatuses] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({
    status: "",
    driverId: "",
    warehouseId: "",
    dateFrom: "",
    dateTo: "",
    manifestId: searchParams.get("manifest_id") || "",
  });
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/statuses").then((d) => setStatuses(d.statuses));
    api.get("/admin/drivers").then((d) => setDrivers(d.drivers));
    api.get("/admin/warehouses").then((d) => setWarehouses(d.warehouses));
  }, []);

  // Re-sync when the URL's manifest_id changes -- e.g. clicking a "Job ID" link
  // elsewhere in the admin app navigates here without remounting this page, so the
  // filter state (seeded from the URL only once, at mount) needs to follow along.
  useEffect(() => {
    const fromUrl = searchParams.get("manifest_id") || "";
    setFilters((f) => (f.manifestId === fromUrl ? f : { ...f, manifestId: fromUrl }));
  }, [searchParams]);

  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.driverId) params.set("driver_id", filters.driverId);
  if (filters.warehouseId) params.set("warehouse_id", filters.warehouseId);
  if (filters.manifestId) params.set("manifest_id", filters.manifestId);
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
      {/* This page opened straight onto a row of filters with no title and no
          sentence, so the only way to learn what it was for was to use it.
          Same card and same shape as the Evidence header, so the two admin
          screens introduce themselves the same way. */}
      <div className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-base font-semibold text-brand-black">Orders</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Every parcel scanned, and how it ended. Search a tracking number when someone asks about
          one delivery — the row opens the full trail for that parcel.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Job ID</span>
          <input
            type="number"
            min="1"
            placeholder="Any"
            value={filters.manifestId}
            onChange={updateFilter("manifestId")}
            className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
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
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!jobs && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {jobs && (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Job ID</th>
                <th className="px-4 py-3">Tracking No.</th>
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Arrived</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/jobs?manifest_id=${job.manifest_id}`}
                      className="font-medium text-slate-600 underline"
                      title="Show every order in this job"
                    >
                      #{job.manifest_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/admin/jobs/${job.id}`} className="font-medium text-brand-red underline">
                      {job.tracking_no}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{job.driver_name}</td>
                  <td className="px-4 py-3 text-slate-600">{job.warehouse_name || "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(job.work_date)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatTime(job.warehouse_arrived_at) || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusStyle(job.status_code)}`}>
                      {statusLabel(job.status_code)}
                    </span>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
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
