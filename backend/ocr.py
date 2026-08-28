"""Claude vision OCR for manifest photos and delivery-order slips.

Both entry points return a plain dict rather than raising on a bad/unreadable
photo or API failure, so callers persist an ocr_status='failed'/needs_review
row instead of 500ing the request.
"""
import base64
import json
import os

from anthropic import AsyncAnthropic

_client: AsyncAnthropic | None = None

MANIFEST_PROMPT = (
    "This is a photo of a courier delivery manifest listing multiple parcels to be "
    "delivered today. Extract every legible delivery job. Respond with ONLY a JSON "
    "object of this exact shape, no prose, no markdown code fences:\n"
    '{"jobs": [{"tracking_no": string|null, "recipient_name": string|null, '
    '"address": string|null}]}\n'
    "Use null for any field you cannot read confidently. Do not guess or invent values."
)

DO_SLIP_PROMPT = (
    "This is a photo of a signed delivery order (DO) slip for a single parcel that was "
    "just delivered. Extract the parcel's tracking/order number. Respond with ONLY a "
    "JSON object of this exact shape, no prose, no markdown code fences:\n"
    '{"tracking_no": string|null}\n'
    "Use null if you cannot read a tracking/order number confidently."
)

_MOCK_MANIFEST = {
    "jobs": [
        {"tracking_no": "LT1001", "recipient_name": "Ahmad Bin Ali", "address": "12 Jalan Ampang, KL"},
        {"tracking_no": "LT1002", "recipient_name": "Siti Nurhaliza", "address": "45 Jalan Bukit Bintang, KL"},
        {"tracking_no": "LT1003", "recipient_name": "Wong Mei Ling", "address": "7 Jalan Sultan Ismail, KL"},
    ],
    "raw": "OCR_MOCK=true fixture",
}
_MOCK_DO_SLIP = {"tracking_no": "LT1001", "raw": "OCR_MOCK=true fixture"}


def _mock_enabled() -> bool:
    return os.getenv("OCR_MOCK", "false").lower() == "true"


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def _model() -> str:
    return os.getenv("OCR_MODEL", "claude-sonnet-5")


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        if text.endswith("```"):
            text = text[:-3]
    return text.strip()


async def _call_vision_json(image_bytes: bytes, media_type: str, prompt: str) -> dict:
    client = _get_client()
    b64 = base64.b64encode(image_bytes).decode("ascii")
    response = await client.messages.create(
        model=_model(),
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    raw_text = "".join(block.text for block in response.content if block.type == "text")
    try:
        parsed = json.loads(_strip_json_fence(raw_text))
    except (json.JSONDecodeError, ValueError):
        return {"error": "could not parse OCR response as JSON", "raw": raw_text}
    parsed["raw"] = raw_text
    return parsed


async def extract_manifest(image_bytes: bytes, media_type: str) -> dict:
    if _mock_enabled():
        return dict(_MOCK_MANIFEST)
    try:
        result = await _call_vision_json(image_bytes, media_type, MANIFEST_PROMPT)
    except Exception as exc:  # Anthropic/network errors -- never bubble as a 500
        return {"jobs": [], "error": str(exc)}
    result.setdefault("jobs", [])
    return result


async def extract_do_identifier(image_bytes: bytes, media_type: str) -> dict:
    if _mock_enabled():
        return dict(_MOCK_DO_SLIP)
    try:
        result = await _call_vision_json(image_bytes, media_type, DO_SLIP_PROMPT)
    except Exception as exc:
        return {"tracking_no": None, "error": str(exc)}
    result.setdefault("tracking_no", None)
    return result
