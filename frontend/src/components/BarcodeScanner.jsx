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

// Phones default getUserMedia to a moderate-res feed tuned for face-distance video
// calls, whose autofocus often won't rack in close enough to resolve a barcode a
// few cm from the lens. 1280x720 is high enough to resolve fine bars without
// pushing some devices into an unusual fixed-focus capture mode the way a very
// high resolution ask (e.g. 1920x1080) has been seen to.
const VIDEO_CONSTRAINTS = {
  facingMode: "environment",
  width: { ideal: 1280 },
  height: { ideal: 720 },
  advanced: [{ focusMode: "continuous" }],
};

// Continuous camera barcode scanner. Calls onDetect(code) once per newly-seen
// barcode; holding the same label in frame won't keep re-firing (de-duped, cleared
// every couple seconds so scanning the same code again later still works). Tap the
// video to refocus -- only Chrome/Android currently honors this (Image Capture API
// focus control isn't supported on iOS Safari); it's a silent no-op elsewhere.
export default function BarcodeScanner({ onDetect }) {
  const videoRef = useRef(null);
  const onDetectRef = useRef(onDetect);
  const lastCodeRef = useRef(null);
  const controlsRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader(HINTS);
    let stopped = false;

    navigator.mediaDevices
      .getUserMedia({ video: VIDEO_CONSTRAINTS })
      .then((stream) =>
        reader.decodeFromStream(stream, videoRef.current, (result) => {
          if (stopped || !result) return;
          const text = result.getText();
          if (text === lastCodeRef.current) return;
          lastCodeRef.current = text;
          onDetectRef.current(text);
        })
      )
      .then((controls) => {
        if (stopped) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        // Redundant with the initial constraint above, but some devices only pick
        // up an "advanced" focus mode when it's applied to the live track, not the
        // constraints passed to getUserMedia.
        controls.streamVideoConstraintsApply({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
      })
      .catch((err) => setError(err.message || "could not access camera"));

    return () => {
      stopped = true;
      controlsRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      lastCodeRef.current = null;
    }, 2500);
    return () => clearInterval(id);
  }, []);

  function handleTapToFocus(e) {
    const controls = controlsRef.current;
    if (!controls) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    controls
      .streamVideoConstraintsApply({ advanced: [{ focusMode: "single-shot", pointsOfInterest: [{ x, y }] }] })
      .catch(() => {});
  }

  return (
    <div>
      <video
        ref={videoRef}
        onClick={handleTapToFocus}
        className="w-full rounded-xl bg-black"
        muted
        playsInline
      />
      <p className="mt-1 text-center text-xs text-slate-400">Tap the video if it won't focus</p>
      {error && <p className="mt-2 text-sm text-red-600">Camera error: {error}. Use manual entry below instead.</p>}
    </div>
  );
}
