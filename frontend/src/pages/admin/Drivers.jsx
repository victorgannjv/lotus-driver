import { useEffect, useState } from "react";
import { api } from "../../api";

export default function Drivers() {
  const [drivers, setDrivers] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get("/admin/drivers")
      .then((d) => setDrivers(d.drivers))
      .catch((err) => setError(err.detail || "could not load drivers"));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!drivers) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Joined</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {drivers.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-3 font-medium text-slate-900">{d.name}</td>
              <td className="px-4 py-3 text-slate-600">{d.email}</td>
              <td className="px-4 py-3 text-slate-600">{d.phone || "—"}</td>
              <td className="px-4 py-3 text-slate-600">{d.status}</td>
              <td className="px-4 py-3 text-slate-600">{d.created_at}</td>
            </tr>
          ))}
          {drivers.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                No drivers have signed up yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
