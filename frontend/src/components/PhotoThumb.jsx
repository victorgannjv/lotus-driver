import { useEffect, useState } from "react";
import { getToken } from "../api";

// Plain <img src="/api/photos/x"> can't carry the driver's Bearer token (the
// admin surface gets away with it because the platform's SSO proxy attaches
// identity to every request via cookies), so this always fetches the photo
// itself and renders it as a blob URL -- works for both driver JWT and admin SSO.
export default function PhotoThumb({ photoId, size = "h-16 w-16" }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!photoId) return;
    let objectUrl;
    let cancelled = false;
    const token = getToken();
    fetch(`/api/photos/${photoId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r)))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  if (!photoId) return null;
  if (!src) return <div className={`${size} animate-pulse rounded-lg bg-slate-200`} />;
  return (
    <a href={src} target="_blank" rel="noreferrer">
      <img src={src} alt="delivery photo" className={`${size} rounded-lg object-cover ring-1 ring-slate-200`} />
    </a>
  );
}
