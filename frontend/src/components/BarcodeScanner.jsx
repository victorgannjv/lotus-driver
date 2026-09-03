import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { useEffect, useRef, useState } from "react";

// Warehouse manifest barcodes are Code 39 (the "*CODE*" start/stop pattern); DO
// slips and other labels may be Code 128/EAN/QR, so the full common set is hinted
// explicitly -- ZXing's default (no hints) is unreliable for 1D formats like Code 39.
const HINTS = new Map();
HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_93,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
]);
HINTS.set(DecodeHintType.TRY_HARDER, true);

// Phones default getUserMedia to a low-res feed (often 640x480) unless asked
// otherwise, which blurs the fine bars on a printed Code 39 label into
// undecodable mush. Ask for a much higher resolution -- "ideal", not "exact" or
// "min", so it still degrades gracefully on hardware that can't hit it.
const VIDEO_CONSTRAINTS = {
  facingMode: "environment",
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

// Continuous camera barcode scanner. Calls onDetect(code) once per newly-seen
// barcode; holding the same label in frame won't keep re-firing (de-duped, cleared
// every couple seconds so scanning the same code again later still works).
export default function BarcodeScanner({ onDetect }) {
  const videoRef = useRef(null);
  const onDetectRef = useRef(onDetect);
  const lastCodeRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader(HINTS);
    let stopped = false;

    reader
      .decodeFromConstraints({ video: VIDEO_CONSTRAINTS }, videoRef.current, (result) => {
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
