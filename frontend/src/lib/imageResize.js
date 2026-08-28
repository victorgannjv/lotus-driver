// Resizes/compresses a photo client-side before upload. Hard requirement, not a
// nice-to-have: photos are stored as LONGBLOB rows in the database (the platform
// has no object storage), so keeping uploads small matters.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.75;

export async function resizeImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  return new File([blob], "photo.jpg", { type: "image/jpeg" });
}
