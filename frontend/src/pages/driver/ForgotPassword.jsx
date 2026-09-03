import { useState } from "react";
import { Link } from "react-router-dom";
import AppHeader from "../../components/AppHeader";
import { useDriverAuth } from "../../auth/DriverAuthContext";

export default function ForgotPassword() {
  const { forgotPassword } = useDriverAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.detail || "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader />
      <div className="flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-brand-black">Forgot password</h1>
        <p className="mt-1 text-sm text-slate-500">Lotus Driver Tracking System</p>

        {sent ? (
          <p className="mt-6 text-sm text-slate-700">
            If an account exists for <span className="font-medium">{email}</span>, we've sent a link to reset your
            password. Check your inbox (and spam folder) -- the link expires in 1 hour.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="mt-6 block text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="mt-6 w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-slate-500">
          <Link to="/driver/login" className="font-medium text-brand-red underline">Back to sign in</Link>
        </p>
      </div>
      </div>
    </main>
  );
}
