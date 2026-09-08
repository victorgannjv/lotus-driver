import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppHeader from "../../components/AppHeader";
import LanguageSwitcher from "../../components/LanguageSwitcher";
import { useDriverAuth } from "../../auth/DriverAuthContext";
import { useLanguage } from "../../i18n/LanguageContext";

export default function Login() {
  const { login } = useDriverAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/driver");
    } catch (err) {
      setError(err.detail || t("login.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader right={<LanguageSwitcher />} />
      <div className="flex items-center justify-center px-4 py-10">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-brand-black">{t("login.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("common.appName")}</p>

        <label className="mt-6 block text-sm font-medium text-slate-700">
          {t("login.email")}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          {t("login.password")}
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
        >
          {busy ? t("login.signingIn") : t("login.signIn")}
        </button>

        <p className="mt-3 text-center text-sm">
          <Link to="/driver/forgot-password" className="font-medium text-brand-red underline">{t("login.forgotPassword")}</Link>
        </p>
        <p className="mt-4 text-center text-sm text-slate-500">
          {t("login.noAccount")} <Link to="/driver/signup" className="font-medium text-brand-red underline">{t("login.signUp")}</Link>
        </p>
      </form>
      </div>
    </main>
  );
}
