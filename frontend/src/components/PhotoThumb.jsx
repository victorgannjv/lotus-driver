import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getToken } from "../api";
import Icon from "./Icon";

// Plain <img src="/api/photos/x"> can't carry the driver's Bearer token (the
// admin surface gets away with it because the platform's SSO proxy attaches
// identity to every request via cookies), so this always fetches the photo
// itself and renders it as a blob URL -- works for both driver JWT and admin SSO.
function usePhoto(photoId) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!photoId) return undefined;
    let objectUrl;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    const token = getToken();
    fetch(`/api/photos/${photoId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r)))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  return { src, failed };
}

// Full-bleed viewer. The evidence caption is burned into the pixels by the
// server, so there is no chrome to add here -- what you are looking at is
// exactly what a claim would attach. Rendered through a portal because the
// thumbnail usually sits inside a table cell or an overflow-hidden card.
function Lightbox({ src, caption, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={caption || "Proof photo"}
         onClick={onClose}
         className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/85 p-4">
      <div className="flex w-full max-w-3xl items-center justify-between gap-3 pb-3"
           onClick={(e) => e.stopPropagation()}>
        <p className="truncate text-sm font-medium text-white">{caption || "Proof photo"}</p>
        <div className="flex shrink-0 items-center gap-2">
          <a href={src} download="proof.jpg"
             className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20">
            Download
          </a>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20">
            Close
          </button>
        </div>
      </div>
      <img src={src} alt={caption || "Proof photo"} onClick={(e) => e.stopPropagation()}
           className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain" />
    </div>,
    document.body,
  );
}

// `caption` is only the viewer's title bar -- the lat/long, address and
// timestamp a dispute needs are burned into the image itself, server-side.
export default function PhotoThumb({ photoId, size = "h-16 w-16", caption }) {
  const { src, failed } = usePhoto(photoId);
  const [open, setOpen] = useState(false);

  if (!photoId) return null;
  if (failed) {
    return (
      <span className={`${size} flex items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400`}>
        no photo
      </span>
    );
  }
  if (!src) return <div className={`${size} animate-pulse rounded-lg bg-slate-200`} />;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={caption || "View proof photo"}
              className={`${size} group relative shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200 hover:ring-brand-red`}>
        <img src={src} alt={caption || "Proof photo"} className="h-full w-full object-cover" />
        <span className="absolute inset-0 hidden items-center justify-center bg-black/40 group-hover:flex">
          <Icon name="camera" className="h-4 w-4 text-white" />
        </span>
      </button>
      {open && <Lightbox src={src} caption={caption} onClose={() => setOpen(false)} />}
    </>
  );
}
