"""Photo storage. The platform provides no object storage, so photos live as
LONGBLOB rows in OceanBase; the frontend must resize/compress client-side before
upload to keep row sizes reasonable (see frontend/src/lib/imageResize.js)."""
import io

from PIL import Image, ImageOps


def normalize_image(raw: bytes) -> tuple[bytes, str]:
    """Re-encodes to JPEG, fixing EXIF orientation and stripping metadata -- a
    safety net behind the client-side resize. Falls back to the original bytes
    if Pillow can't decode the upload."""
    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85)
        return out.getvalue(), "image/jpeg"
    except Exception:
        return raw, "application/octet-stream"


async def store_photo(pool, raw: bytes, content_type: str, uploaded_by: int | None) -> int:
    data, normalized_content_type = normalize_image(raw)
    final_content_type = normalized_content_type if normalized_content_type != "application/octet-stream" else content_type
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO photos (content_type, byte_size, data, uploaded_by) VALUES (%s, %s, %s, %s)",
            (final_content_type, len(data), data, uploaded_by),
        )
        return cur.lastrowid


async def fetch_photo(pool, photo_id: int) -> tuple[bytes, str, int | None] | None:
    async with pool.acquire() as conn, conn.cursor() as cur:
        await cur.execute("SELECT data, content_type, uploaded_by FROM photos WHERE id = %s", (photo_id,))
        row = await cur.fetchone()
    if row is None:
        return None
    return row[0], row[1], row[2]
