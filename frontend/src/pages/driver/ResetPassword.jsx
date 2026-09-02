import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useDriverAuth } from "../../auth/DriverAuthContext";

export default function ResetPassword() {
  const { resetPassword } = useDriverAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError("passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      navigate("/driver");
    } catch (err) {
      setError(err.detail || "reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-slate-900">Reset password</h1>
        <p className="mt-1 text-sm text-slate-500">Lotus Driver Tracking System</p>

        {!token ? (
          <p className="mt-6 text-sm text-red-600">
            This link is missing its reset token. Request a new one from the{" "}
            <Link to="/driver/forgot-password" className="font-medium underline">forgot password</Link> page.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="mt-6 block text-sm font-medium text-slate-700">
              New password
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Confirm new password
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Resetting…" : "Reset password"}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-slate-500">
          <Link to="/driver/login" className="font-medium text-slate-900 underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
