import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppHeader from "../../components/AppHeader";
import { useDriverAuth } from "../../auth/DriverAuthContext";

export default function Signup() {
  const { signup } = useDriverAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup(form.email, form.password, form.name, form.phone || null);
      navigate("/driver");
    } catch (err) {
      setError(err.detail || "signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader />
      <div className="flex items-center justify-center px-4 py-10">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-brand-black">Create driver account</h1>
        <p className="mt-1 text-sm text-slate-500">Lotus Driver Tracking System</p>

        <label className="mt-6 block text-sm font-medium text-slate-700">
          Full name
          <input required value={form.name} onChange={update("name")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Email
          <input type="email" required value={form.email} onChange={update("email")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Phone (optional)
          <input value={form.phone} onChange={update("phone")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Password
          <input type="password" required minLength={8} value={form.password} onChange={update("password")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={busy} className="mt-6 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50">
          {busy ? "Creating account…" : "Create account"}
        </button>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account? <Link to="/driver/login" className="font-medium text-brand-red underline">Sign in</Link>
        </p>
      </form>
      </div>
    </main>
  );
}
