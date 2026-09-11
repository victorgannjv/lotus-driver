"""Photo storage and the evidence caption burned into every proof photo.

The platform provides no object storage, so photos live as LONGBLOB rows in
OceanBase; the frontend resizes/compresses client-side before upload to keep
row sizes reasonable.

The caption is burned HERE, on the server, and never by the browser. A photo is
the thing a claim rests on, and a caption drawn by the handset is a caption the
handset could have been made to lie about -- same argument that already puts the
checkpoint clock on the server rather than the phone. Burning it server-side
means the time in the pixels is the same value written to trip_checkpoint, from
the same clock, in the same request.
"""
import io

from PIL import Image, ImageDraw, ImageFont, ImageOps


def _font(size: int):
    """Pillow ships Aileron and scales it through FreeType; DejaVu is used when
    the image is present, purely because it is wider-covering. Either way the
    caption renders -- a missing font must never cost us the photo."""
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:          # Pillow < 10.1 -- fixed-size bitmap fallback
        return ImageFont.load_default()


def _wrap(draw, text: str, font, max_width: int) -> list[str]:
    """Greedy word wrap against the real rendered width, so a long delivery
    address folds instead of running off the edge of the frame."""
    words, lines, line = text.split(), [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if draw.textlength(trial, font=font) <= max_width or not line:
            line = trial
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def burn_caption(img: Image.Image, lines: list[str]) -> Image.Image:
    """Draws the caption bottom-left over a dark scrim.

    The scrim is what makes this readable: white text alone disappears against
    a pale warehouse floor or a white parcel, and a caption nobody can read is
    not evidence. Size is proportional to the image so a 640px upload and a
    2000px one look like the same document.
    """
    lines = [l for l in lines if l]
    if not lines:
        return img

    w, h = img.size
    size = max(11, round(w / 40))
    pad = max(8, round(w / 60))
    font = _font(size)

    scratch = ImageDraw.Draw(img)
    wrapped: list[str] = []
    for line in lines:
        wrapped.extend(_wrap(scratch, line, font, w - 2 * pad))

    leading = round(size * 1.35)
    block = leading * len(wrapped) + 2 * pad

    # Scrim on its own layer so it stays translucent -- the photo underneath has
    # to remain visible, or we have covered up the thing we are proving.
    scrim = Image.new("RGBA", (w, block), (0, 0, 0, 150))
    img = img.convert("RGBA")
    img.alpha_composite(scrim, (0, max(0, h - block)))

    draw = ImageDraw.Draw(img)
    y = max(0, h - block) + pad
    for line in wrapped:
        draw.text((pad, y), line, font=font, fill=(255, 255, 255, 255))
        y += leading

    return img.convert("RGB")


def evidence_caption(*, ref: str, what: str, who: str | None = None,
                     lat: float | None = None, lng: float | None = None,
                     place: str | None = None, when: str = "") -> list[str]:
    """The four lines every proof photo carries, in the order someone reading
    it back needs them: what this photo is of, where it was taken, and when.

    Coordinates are printed to 7 places because that is what the handset
    reports; rounding them would invite the question of what else was rounded.
    The place line is the address we already hold for the outlet or the drop --
    not a reverse geocode. A contracted address is a fact both sides signed;
    a lookup is a third party's guess, and a guess in a dispute document is a
    thread for Lotus to pull.
    """
    head = " · ".join(x for x in (ref, what, who) if x)
    coords = (
        f"Lat.: {lat:.7f}, Long.: {lng:.7f}"
        if lat is not None and lng is not None
        else "Location not recorded"
    )
    return [head, coords, place or "", when]


def normalize_image(raw: bytes, caption: list[str] | None = None) -> tuple[bytes, str]:
    """Re-encodes to JPEG, fixing EXIF orientation and stripping metadata -- a
    safety net behind the client-side resize -- and burns the caption while the
    image is already decoded. Falls back to the original bytes if Pillow can't
    read the upload, because an undecodable photo is still better evidence than
    no photo."""
    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        if caption:
            img = burn_caption(img, caption)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85)
        return out.getvalue(), "image/jpeg"
    except Exception:
        return raw, "application/octet-stream"


async def store_photo(pool, raw: bytes, content_type: str, uploaded_by: int | None,
                      caption: list[str] | None = None) -> int:
    data, normalized_content_type = normalize_image(raw, caption)
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
