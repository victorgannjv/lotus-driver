import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import AppHeader from "../../components/AppHeader";
import LanguageSwitcher from "../../components/LanguageSwitcher";
import { useDriverAuth } from "../../auth/DriverAuthContext";
import { useLanguage } from "../../i18n/LanguageContext";

export default function Signup() {
  const { signup } = useDriverAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", warehouseId: "" });
  const [warehouses, setWarehouses] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get("/warehouses")
      .then((d) => setWarehouses(d.warehouses))
      .catch(() => setWarehouses([]));
  }, []);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup(form.email, form.password, form.name, form.phone || null, Number(form.warehouseId));
      navigate("/driver");
    } catch (err) {
      setError(err.detail || t("signup.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader right={<LanguageSwitcher />} />
      <div className="flex items-center justify-center px-4 py-10">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-brand-black">{t("signup.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("common.appName")}</p>

        <label className="mt-6 block text-sm font-medium text-slate-700">
          {t("signup.fullName")}
          <input required value={form.name} onChange={update("name")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          {t("signup.email")}
          <input type="email" required value={form.email} onChange={update("email")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          {t("signup.phone")}
          <input value={form.phone} onChange={update("phone")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          {t("signup.warehouseOutlet")}
          <select
            required
            value={form.warehouseId}
            onChange={update("warehouseId")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              {t("signup.selectOutlet")}
            </option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          {t("signup.password")}
          <input type="password" required minLength={8} value={form.password} onChange={update("password")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={busy} className="mt-6 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50">
          {busy ? t("signup.creating") : t("signup.createAccount")}
        </button>

        <p className="mt-4 text-center text-sm text-slate-500">
          {t("signup.haveAccount")} <Link to="/driver/login" className="font-medium text-brand-red underline">{t("signup.signIn")}</Link>
        </p>
      </form>
      </div>
    </main>
  );
}
