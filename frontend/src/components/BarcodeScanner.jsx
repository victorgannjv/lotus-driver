import { BrowserMultiFormatReader } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";

// Continuous camera barcode scanner (Code 39/128, QR, etc. -- whatever ZXing
// supports). Calls onDetect(code) once per newly-seen barcode; holding the same
// label in frame won't keep re-firing (de-duped, cleared every couple seconds so
// scanning the same code again later still works).
export default function BarcodeScanner({ onDetect }) {
  const videoRef = useRef(null);
  const onDetectRef = useRef(onDetect);
  const lastCodeRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let stopped = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (stopped || !result) return;
        const text = result.getText();
        if (text === lastCodeRef.current) return;
        lastCodeRef.current = text;
        onDetectRef.current(text);
      })
      .catch((err) => setError(err.message || "could not access camera"));

    return () => {
      stopped = true;
      reader.reset();
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      lastCodeRef.current = null;
    }, 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <video ref={videoRef} className="w-full rounded-xl bg-black" muted playsInline />
      {error && <p className="mt-2 text-sm text-red-600">Camera error: {error}. Use manual entry below instead.</p>}
    </div>
  );
}
