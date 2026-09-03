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

// Deliberately NOT requesting an explicit focusMode constraint here: on some
// Android/Chrome + camera-HAL combinations, asking for "continuous" via
// MediaTrackConstraints has been seen to select a still-photo-oriented AF mode
// instead of the smoother CONTINUOUS_VIDEO mode Chrome already defaults video
// capture to when nothing is specified -- i.e. asking explicitly can make focus
// *worse*. Only a resolution hint (moderate, not the phone's max) is requested.
const VIDEO_CONSTRAINTS = {
  facingMode: "environment",
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

// Continuous camera barcode scanner. Calls onDetect(code) once per newly-seen
// barcode; holding the same label in frame won't keep re-firing (de-duped, cleared
// every couple seconds so scanning the same code again later still works). Tap the
// video to force a one-shot refocus at that point, and toggle the flashlight when
// the device supports it -- both are Chrome/Android-only (Image Capture API isn't
// supported on iOS Safari); both are silent no-ops elsewhere.
export default function BarcodeScanner({ onDetect }) {
  const videoRef = useRef(null);
  const onDetectRef = useRef(onDetect);
  const lastCodeRef = useRef(null);
  const controlsRef = useRef(null);
  const [error, setError] = useState(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

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
        setTorchSupported(typeof controls.switchTorch === "function");
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

  async function handleToggleTorch() {
    const next = !torchOn;
    try {
      await controlsRef.current?.switchTorch(next);
      setTorchOn(next);
    } catch {
      // Device claimed torch support but the call failed -- leave state as-is.
    }
  }

  return (
    <div>
      <div className="relative">
        <video ref={videoRef} onClick={handleTapToFocus} className="w-full rounded-xl bg-black" muted playsInline />
        {torchSupported && (
          <button
            type="button"
            onClick={handleToggleTorch}
            className={`absolute right-3 top-3 rounded-full px-3 py-1.5 text-xs font-medium ${
              torchOn ? "bg-amber-400 text-slate-900" : "bg-black/60 text-white"
            }`}
          >
            {torchOn ? "Flash on" : "Flash off"}
          </button>
        )}
      </div>
      <p className="mt-1 text-center text-xs text-slate-400">Tap the video if it won't focus</p>
      {error && <p className="mt-2 text-sm text-red-600">Camera error: {error}. Use manual entry below instead.</p>}
    </div>
  );
}
