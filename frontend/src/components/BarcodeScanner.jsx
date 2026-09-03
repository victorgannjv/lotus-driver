import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { useEffect, useRef, useState } from "react";

// ZXing decodes by classic bar-width analysis, which is sensitive to blur/skew.
// Chrome on Android exposes a native BarcodeDetector backed by Google Play
// Services' on-device ML Kit, which is far more blur-tolerant -- prefer it when
// available and fall back to ZXing (iOS Safari, desktop, older Chrome) otherwise.
const NATIVE_FORMATS = ["code_39", "code_128", "code_93", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "qr_code"];

const ZXING_HINTS = new Map();
ZXING_HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [
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
ZXING_HINTS.set(DecodeHintType.TRY_HARDER, true);

// Deliberately not requesting an explicit focusMode constraint: on some
// Android/Chrome + camera-HAL combinations, asking for "continuous" has been seen
// to select a still-photo AF mode instead of the smoother CONTINUOUS_VIDEO mode
// Chrome already defaults video capture to when nothing is specified.
const VIDEO_CONSTRAINTS = {
  facingMode: "environment",
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

// Continuous camera barcode scanner. Calls onDetect(code) once per newly-seen
// barcode; holding the same label in frame won't keep re-firing (de-duped, cleared
// every couple seconds so scanning the same code again later still works). Tap the
// video to force a one-shot refocus at that point, and toggle the flashlight when
// the device supports it -- both act directly on the camera track, so they work
// the same whether the native detector or the ZXing fallback is doing the decoding.
export default function BarcodeScanner({ onDetect }) {
  const videoRef = useRef(null);
  const onDetectRef = useRef(onDetect);
  const lastCodeRef = useRef(null);
  const trackRef = useRef(null);
  const stopRef = useRef(null);
  const [error, setError] = useState(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    let stopped = false;
    let pollTimer = null;

    function report(code) {
      if (stopped || !code || code === lastCodeRef.current) return;
      lastCodeRef.current = code;
      onDetectRef.current(code);
    }

    async function start() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      try {
        setTorchSupported(!!track.getCapabilities?.().torch);
      } catch {
        setTorchSupported(false);
      }

      if ("BarcodeDetector" in window) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});

        let formats;
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
        } catch {
          formats = undefined;
        }
        const detector = new window.BarcodeDetector(formats?.length ? { formats } : undefined);

        const poll = async () => {
          if (stopped) return;
          try {
            const hits = await detector.detect(videoRef.current);
            if (hits[0]) report(hits[0].rawValue);
          } catch {
            // transient -- most frames don't contain a barcode
          }
          pollTimer = setTimeout(poll, 150);
        };
        poll();
        stopRef.current = () => {
          clearTimeout(pollTimer);
          stream.getTracks().forEach((t) => t.stop());
        };
        return;
      }

      const reader = new BrowserMultiFormatReader(ZXING_HINTS);
      const controls = await reader.decodeFromStream(stream, videoRef.current, (result) => {
        if (result) report(result.getText());
      });
      if (stopped) {
        controls.stop();
        return;
      }
      stopRef.current = () => controls.stop();
    }

    start().catch((err) => setError(err.message || "could not access camera"));

    return () => {
      stopped = true;
      stopRef.current?.();
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      lastCodeRef.current = null;
    }, 2500);
    return () => clearInterval(id);
  }, []);

  function handleTapToFocus(e) {
    const track = trackRef.current;
    if (!track) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    track.applyConstraints({ advanced: [{ focusMode: "single-shot", pointsOfInterest: [{ x, y }] }] }).catch(() => {});
  }

  async function handleToggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
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
