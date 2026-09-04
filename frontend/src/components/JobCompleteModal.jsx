// Shown once every order scanned into a job has a resolved outcome (delivered or
// failed) -- a distinct, congratulatory popup so the driver notices the job wrapped
// up, separate from the routine per-scan result confirmation.
export default function JobCompleteModal({ open, onViewJob, onDismiss }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-lg">
        <p className="text-3xl">🎉</p>
        <p className="mt-2 text-lg font-semibold text-brand-black">Job complete!</p>
        <p className="mt-1 text-sm text-slate-500">Every order in this job has been delivered or marked failed.</p>
        <div className="mt-5 grid grid-cols-1 gap-2">
          <button
            onClick={onViewJob}
            className="w-full rounded-lg bg-brand-red px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-red-dark"
          >
            View job
          </button>
          <button
            onClick={onDismiss}
            className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-brand-black ring-1 ring-slate-200"
          >
            Keep scanning
          </button>
        </div>
      </div>
    </div>
  );
}
