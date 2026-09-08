import { useEffect, useState } from "react";
import { api } from "../../api";
import AppHeader from "../../components/AppHeader";
import LanguageSwitcher from "../../components/LanguageSwitcher";
import { useDriverAuth } from "../../auth/DriverAuthContext";
import { useLanguage } from "../../i18n/LanguageContext";

export default function Profile() {
  const { driver, updateWarehouse } = useDriverAuth();
  const { t } = useLanguage();
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState(driver?.warehouse_id ? String(driver.warehouse_id) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get("/warehouses")
      .then((d) => setWarehouses(d.warehouses))
      .catch(() => setWarehouses([]));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateWarehouse(Number(warehouseId));
      setSaved(true);
    } catch (err) {
      setError(err.detail || t("profile.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader backTo="/driver" title={t("profile.title")} />
      <div className="mx-auto max-w-md px-4 py-6">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm font-medium text-brand-black">{driver?.name}</p>
          <p className="text-sm text-slate-500">{driver?.email}</p>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">{t("profile.language")}</span>
            <LanguageSwitcher />
          </div>

          <form onSubmit={handleSubmit} className="mt-6">
            <label className="block text-sm font-medium text-slate-700">
              {t("profile.warehouseOutlet")}
              <select
                required
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="" disabled>
                  {t("profile.selectOutlet")}
                </option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            {saved && <p className="mt-3 text-sm text-emerald-700">{t("profile.saved")}</p>}

            <button
              type="submit"
              disabled={busy || !warehouseId}
              className="mt-6 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
