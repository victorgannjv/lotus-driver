import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api";
import AppHeader from "../../components/AppHeader";
import { useLanguage } from "../../i18n/LanguageContext";

const STATUS_STYLES = {
  registered: "bg-slate-100 text-slate-700",
  delivered: "bg-emerald-100 text-emerald-800",
  failed: "bg-amber-100 text-amber-800",
  cancelled: "bg-slate-100 text-slate-500",
};

export default function ManifestDetail() {
  const { manifestId } = useParams();
  const { t } = useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  function load() {
    api
      .get(`/manifests/${manifestId}`)
      .then(setData)
      .catch((err) => setError(err.detail || t("manifestDetail.loadError")));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [manifestId]);

  async function handleCancel() {
    if (!window.confirm(t("manifestDetail.confirmCancel"))) {
      return;
    }
    setCancelling(true);
    setError(null);
    try {
      await api.post(`/manifests/${manifestId}/cancel`, {});
      load();
    } catch (err) {
      setError(err.detail || t("manifestDetail.cancelError"));
    } finally {
      setCancelling(false);
    }
  }

  if (error && !data) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-slate-500">{t("common.loading")}</p>;

  const { manifest, jobs } = data;
  const canCancel = !manifest.cancelled_at && jobs.every((j) => j.status_code === "registered");
  const isComplete = !manifest.cancelled_at && jobs.length > 0 && jobs.every((j) => j.status_code !== "registered");

  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeader backTo="/driver" />
      <div className="mx-auto max-w-md px-4 py-6">
        <p className="text-xs font-medium text-slate-400">{t("manifestDetail.jobLabel", { id: manifestId })}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-brand-black">{manifest.work_date}</h1>
          {isComplete && (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
              {t("manifestDetail.jobComplete")}
            </span>
          )}
        </div>
        {manifest.warehouse_arrived_at && (
          <p className="mt-1 text-xs text-slate-400">{t("manifestDetail.arrivedAt", { time: manifest.warehouse_arrived_at })}</p>
        )}

        {manifest.cancelled_at && (
          <div className="mt-2 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
            <p>{t("manifestDetail.cancelledNotice")}</p>
            <Link to="/driver" className="mt-2 inline-block font-medium underline">
              {t("manifestDetail.backHome")}
            </Link>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <ul className="mt-4 space-y-2">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
            >
              <p className="text-sm font-medium text-brand-black">{job.tracking_no}</p>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[job.status_code] || "bg-slate-100 text-slate-700"}`}>
                {t(`status.${job.status_code}`)}
              </span>
            </li>
          ))}
          {jobs.length === 0 && <p className="text-sm text-slate-500">{t("manifestDetail.noOrders")}</p>}
        </ul>

        {!manifest.cancelled_at && (
          <div className="mt-6 grid grid-cols-1 gap-2">
            <Link
              to={`/driver/manifests/${manifestId}/register`}
              className="block rounded-lg bg-white px-4 py-2.5 text-center text-sm font-medium text-brand-black ring-1 ring-slate-200"
            >
              {t("manifestDetail.scanMore")}
            </Link>
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-brand-red ring-1 ring-brand-red/30 disabled:opacity-50"
              >
                {cancelling ? t("manifestDetail.cancelling") : t("manifestDetail.cancelJob")}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
