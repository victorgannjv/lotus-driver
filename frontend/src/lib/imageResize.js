// Client-side downscale + JPEG re-encode before upload -- keeps photo rows in
// the DB reasonable (no object storage on this platform) and cuts upload time
// on mobile data.
//
// NOW TO A BYTE BUDGET, not just a pixel cap. A 1600px JPEG at quality 0.8 is
// usually 300-600KB but a detailed scene can be well over a megabyte, and a
// step may carry four of them in one request. Ingresses commonly cap a request
// body at 1MB and reject the rest with a 413 carrying no JSON -- which the app
// could only report as "Failed". Sizing to a budget here is what stops a POD
// being lost to a limit nobody can see from the cab.
//
// Quality first, then dimension: dropping quality on a photo of a label costs
// far less legibility than shrinking it.
const MAX_DIMENSION = 1600;
const MIN_DIMENSION = 900;
const QUALITY_STEPS = [0.8, 0.68, 0.58, 0.48];
const DEFAULT_MAX_BYTES = 400 * 1024;

function draw(img, maxDim) {
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas;
}

function encode(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not process image"))),
      "image/jpeg",
      quality,
    );
  });
}

export function resizeImage(file, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        let best = null;
        for (let dim = MAX_DIMENSION; dim >= MIN_DIMENSION; dim = Math.round(dim * 0.75)) {
          const canvas = draw(img, dim);
          for (const q of QUALITY_STEPS) {
            const blob = await encode(canvas, q);
            best = blob; // keep the smallest attempt in case nothing fits
            if (blob.size <= maxBytes) return resolve(blob);
          }
        }
        // Nothing got under the budget. Send the smallest we managed rather
        // than refusing: a large photo that might be rejected still beats no
        // evidence at all, and the error will say why if it is.
        resolve(best);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not read image"));
    };
    img.src = url;
  });
}
