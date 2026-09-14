import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getToken } from "../api";
import Icon from "./Icon";

// Plain <img src="/api/photos/x"> can't carry the driver's Bearer token (the
// admin surface gets away with it because the platform's SSO proxy attaches
// identity to every request via cookies), so this always fetches the photo
// itself and renders it as a blob URL -- works for both driver JWT and admin SSO.
function usePhoto(photoId, attempt) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null); // { status } once a fetch has failed

  useEffect(() => {
    if (!photoId) return undefined;
    let objectUrl;
    let cancelled = false;
    setSrc(null);
    setError(null);

    // Two attempts, and the second one matters.
    //
    // `get_current_user_any` authenticates as a DRIVER whenever an
    // Authorization header is present, and only falls back to the admin's SSO
    // identity when there is none. So one stale or foreign driver token in this
    // browser's localStorage turned every proof photo on the admin screens into
    // a 401/403 — the photos were stored and linked the whole time, the request
    // for them was simply being signed as the wrong person. Dropping the header
    // and retrying lets the proxy identify the admin, which is what should have
    // happened first.
    async function load() {
      const token = getToken();
      const tries = token ? [{ Authorization: `Bearer ${token}` }, {}] : [{}];
      let last = null;
      for (const headers of tries) {
        let res;
        try {
          res = await fetch(`/api/photos/${photoId}`, { headers });
        } catch {
          last = { status: 0 };
          continue;
        }
        if (res.ok) return res.blob();
        last = { status: res.status };
        if (res.status !== 401 && res.status !== 403) break;
      }
      throw last || { status: 0 };
    }

    load()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch((e) => {
        if (!cancelled) setError({ status: e?.status ?? 0 });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId, attempt]);

  return { src, error };
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
  const [attempt, setAttempt] = useState(0);
  const { src, error } = usePhoto(photoId, attempt);
  const [open, setOpen] = useState(false);

  if (!photoId) return null;
  if (error) {
    // "no photo" was a lie, and an expensive one: it read as "the driver never
    // took one" when the truth was "this request could not fetch it". A photo
    // that exists and a photo that failed to load are different problems with
    // different fixes, so they no longer look identical. Tapping retries.
    const what =
      error.status === 404
        ? { line: "missing", why: "This photo is no longer stored." }
        : error.status === 401 || error.status === 403
          ? { line: "no access", why: "Signed in as someone who cannot open this photo. Tap to retry." }
          : { line: "failed", why: "Could not load the photo. Tap to retry." };
    return (
      <button
        type="button"
        onClick={() => setAttempt((n) => n + 1)}
        title={`${what.why} (${error.status || "network"})`}
        className={`${size} flex flex-col items-center justify-center rounded-lg bg-amber-50 text-[9px] leading-tight text-amber-700 ring-1 ring-amber-200`}
      >
        <Icon name="alert" className="h-3 w-3" />
        {what.line}
      </button>
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
