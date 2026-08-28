"""Matches an OCR'd delivery-order tracking number against the open jobs on a
manifest. Conservative on purpose: normalization is limited to case/punctuation
stripping, with no character-substitution heuristics (e.g. O/0) that could
produce a false-positive match on a stranger's parcel."""
import re
from difflib import SequenceMatcher

FUZZY_THRESHOLD = 0.72

_NON_ALNUM = re.compile(r"[^A-Z0-9]")


def normalize(value: str | None) -> str:
    if not value:
        return ""
    return _NON_ALNUM.sub("", value.upper())


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def match_job(candidate: str | None, jobs: list[dict]) -> tuple[dict | None, str]:
    """jobs: delivery_jobs rows (as dicts with at least 'id' and 'tracking_no') from
    the same manifest, already filtered to status_code != 'delivered'.

    Returns (matched_job_or_None, match_type) where match_type is one of
    'exact' | 'fuzzy' | 'none'."""
    norm_candidate = normalize(candidate)
    if not norm_candidate:
        return None, "none"

    for job in jobs:
        if normalize(job.get("tracking_no")) == norm_candidate:
            return job, "exact"

    best_job = None
    best_score = 0.0
    for job in jobs:
        norm_tracking = normalize(job.get("tracking_no"))
        if not norm_tracking:
            continue
        score = similarity(norm_candidate, norm_tracking)
        if score > best_score:
            best_score = score
            best_job = job

    if best_job is not None and best_score >= FUZZY_THRESHOLD:
        return best_job, "fuzzy"

    return None, "none"
