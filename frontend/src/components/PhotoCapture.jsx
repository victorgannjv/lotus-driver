import { useState } from "react";
import { resizeImage } from "../lib/imageResize";

export default function PhotoCapture({ label, onChange, required = false }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const resized = await resizeImage(file);
      setPreview(URL.createObjectURL(resized));
      onChange(resized);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
      />
      {busy && <p className="mt-1 text-xs text-slate-500">Compressing photo…</p>}
      {preview && <img src={preview} alt="preview" className="mt-2 h-32 w-32 rounded-lg object-cover ring-1 ring-slate-200" />}
    </label>
  );
}
