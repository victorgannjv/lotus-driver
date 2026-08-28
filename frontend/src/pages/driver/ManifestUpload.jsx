import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { resizeImage } from "../../lib/imageResize";

export default function ManifestUpload() {
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(e) {
    const raw = e.target.files?.[0];
    if (!raw) return;
    const resized = await resizeImage(raw);
    setFile(resized);
    setPreview(URL.createObjectURL(resized));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { manifest } = await api.postForm("/manifests", formData);
      navigate(`/driver/manifests/${manifest.id}`);
    } catch (err) {
      setError(err.detail || "upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <h1 className="text-lg font-semibold text-slate-900">Upload today's manifest</h1>
        <p className="mt-1 text-sm text-slate-500">
          Take a clear photo of the delivery manifest. We'll read it automatically and build your job list.
        </p>

        <form onSubmit={handleSubmit} className="mt-6">
          <input type="file" accept="image/*" capture="environment" onChange={handleFile} className="block w-full text-sm" />
          {preview && <img src={preview} alt="manifest preview" className="mt-4 w-full rounded-xl ring-1 ring-slate-200" />}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={!file || busy}
            className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Reading manifest…" : "Upload & process"}
          </button>
        </form>
      </div>
    </main>
  );
}
