import { useEffect, useState } from "react";
import { api } from "../../api";

function formatLeadTime(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatRate(rate) {
  if (rate === null || rate === undefined) return "—";
  return `${rate.toFixed(1)}%`;
}

function StatTile({ label, value, sublabel, tone = "default" }) {
  const toneClasses = {
    default: "text-slate-900",
    good: "text-emerald-700",
    bad: "text-amber-700",
  };
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${toneClasses[tone]}`}>{value}</p>
      {sublabel && <p className="mt-1 text-xs text-slate-400">{sublabel}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ warehouseId: "", dateFrom: "", dateTo: "" });
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/admin/warehouses").then((d) => setWarehouses(d.warehouses));
  }, []);

  const params = new URLSearchParams();
  if (filters.warehouseId) params.set("warehouse_id", filters.warehouseId);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  const queryString = params.toString();

  useEffect(() => {
    setSummary(null);
    api
      .get(`/admin/dashboard?${queryString}`)
      .then((d) => setSummary(d))
      .catch((err) => setError(err.detail || "could not load dashboard"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function updateFilter(field) {
    return (e) => setFilters((f) => ({ ...f, [field]: e.target.value }));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Warehouse</span>
          <select
            value={filters.warehouseId}
            onChange={updateFilter("warehouseId")}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
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
          <input
            type="date"
            value={filters.dateFrom}
            onChange={updateFilter("dateFrom")}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Date to</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={updateFilter("dateTo")}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!summary && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {summary && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              label="Average lead time per job"
              value={formatLeadTime(summary.avg_lead_time_seconds)}
              sublabel={
                summary.lead_time_sample_size
                  ? `based on ${summary.lead_time_sample_size} job${summary.lead_time_sample_size === 1 ? "" : "s"} with a registered scan`
                  : "no jobs with both a registered and a completed scan yet"
              }
            />
            <StatTile
              label="Success rate"
              value={formatRate(summary.success_rate)}
              sublabel={summary.resolved_jobs ? `${summary.delivered} of ${summary.resolved_jobs} resolved jobs delivered` : "no resolved jobs yet"}
              tone="good"
            />
            <StatTile
              label="Failure rate"
              value={formatRate(summary.failure_rate)}
              sublabel={summary.resolved_jobs ? `${summary.failed} of ${summary.resolved_jobs} resolved jobs failed` : "no resolved jobs yet"}
              tone="bad"
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <StatTile label="Total orders" value={summary.total_jobs} />
            <StatTile label="Delivered" value={summary.delivered} tone="good" />
            <StatTile label="Failed" value={summary.failed} tone="bad" />
            <StatTile label="In progress" value={summary.registered} />
            <StatTile label="Cancelled" value={summary.cancelled} />
          </div>
        </>
      )}
    </div>
  );
}
