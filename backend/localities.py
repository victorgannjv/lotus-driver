"""Turn a coordinate into "Puchong, Selangor" for people to read.

Offline, from a fixed table, on purpose.

A reverse-geocoding service would be more precise and would also mean sending
every driver's position to a third party, adding a network call to the path
that stamps a photo, and making an evidence document depend on an API being up
years from now when a claim is argued. None of that is worth a place name.

So this is a nearest-known-locality lookup against a table of Malaysian towns.
It is an APPROXIMATION and the caption still prints the exact coordinates
beside it -- the locality is there to save a reader pasting numbers into a map,
not to be the record. Anything further than MAX_KM from a known town returns
nothing rather than naming somewhere it might not be.

Klang Valley is dense here because that is where the fleet runs; the rest of
the country is covered at city level.
"""
from math import asin, cos, radians, sin, sqrt

MAX_KM = 25.0

# (name, state, lat, lng)
LOCALITIES: list[tuple[str, str, float, float]] = [
    # Klang Valley
    ("Kuala Lumpur", "Kuala Lumpur", 3.1390, 101.6869),
    ("Cheras", "Kuala Lumpur", 3.1000, 101.7500),
    ("Kepong", "Kuala Lumpur", 3.2100, 101.6300),
    ("Setapak", "Kuala Lumpur", 3.2000, 101.7200),
    ("Putrajaya", "Putrajaya", 2.9264, 101.6964),
    ("Petaling Jaya", "Selangor", 3.1073, 101.6067),
    ("Kota Damansara", "Selangor", 3.1500, 101.5800),
    ("Shah Alam", "Selangor", 3.0733, 101.5185),
    ("Subang Jaya", "Selangor", 3.0438, 101.5810),
    ("Sunway", "Selangor", 3.0700, 101.6000),
    ("Puchong", "Selangor", 3.0319, 101.6169),
    ("Seri Kembangan", "Selangor", 3.0300, 101.7000),
    ("Klang", "Selangor", 3.0449, 101.4455),
    ("Port Klang", "Selangor", 3.0000, 101.3900),
    ("Ampang", "Selangor", 3.1500, 101.7600),
    ("Gombak", "Selangor", 3.2500, 101.7000),
    ("Sungai Buloh", "Selangor", 3.2060, 101.5800),
    ("Rawang", "Selangor", 3.3210, 101.5770),
    ("Kajang", "Selangor", 2.9930, 101.7880),
    ("Bangi", "Selangor", 2.9200, 101.7800),
    ("Semenyih", "Selangor", 2.9500, 101.8400),
    ("Cyberjaya", "Selangor", 2.9213, 101.6559),
    ("Sepang", "Selangor", 2.6900, 101.7500),
    ("Banting", "Selangor", 2.8167, 101.5000),
    ("Kuala Selangor", "Selangor", 3.3400, 101.2500),
    # Elsewhere, city level
    ("Seremban", "Negeri Sembilan", 2.7297, 101.9381),
    ("Nilai", "Negeri Sembilan", 2.8135, 101.7977),
    ("Port Dickson", "Negeri Sembilan", 2.5228, 101.7960),
    ("Melaka", "Melaka", 2.1896, 102.2501),
    ("Muar", "Johor", 2.0442, 102.5689),
    ("Batu Pahat", "Johor", 1.8548, 102.9325),
    ("Kluang", "Johor", 2.0250, 103.3167),
    ("Segamat", "Johor", 2.5148, 102.8158),
    ("Johor Bahru", "Johor", 1.4927, 103.7414),
    ("Ipoh", "Perak", 4.5975, 101.0901),
    ("Taiping", "Perak", 4.8500, 100.7333),
    ("Teluk Intan", "Perak", 4.0259, 101.0210),
    ("George Town", "Pulau Pinang", 5.4141, 100.3288),
    ("Butterworth", "Pulau Pinang", 5.3991, 100.3638),
    ("Alor Setar", "Kedah", 6.1248, 100.3678),
    ("Sungai Petani", "Kedah", 5.6470, 100.4870),
    ("Langkawi", "Kedah", 6.3500, 99.8000),
    ("Kangar", "Perlis", 6.4414, 100.1986),
    ("Kuantan", "Pahang", 3.8077, 103.3260),
    ("Temerloh", "Pahang", 3.4506, 102.4176),
    ("Bentong", "Pahang", 3.5221, 101.9089),
    ("Kota Bharu", "Kelantan", 6.1254, 102.2381),
    ("Kuala Terengganu", "Terengganu", 5.3302, 103.1408),
    ("Kuching", "Sarawak", 1.5533, 110.3592),
    ("Sibu", "Sarawak", 2.2870, 111.8308),
    ("Bintulu", "Sarawak", 3.1667, 113.0333),
    ("Miri", "Sarawak", 4.3995, 113.9914),
    ("Kota Kinabalu", "Sabah", 5.9804, 116.0735),
    ("Sandakan", "Sabah", 5.8402, 118.1179),
    ("Tawau", "Sabah", 4.2448, 117.8911),
    ("Labuan", "Labuan", 5.2831, 115.2308),
]


def _km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = p2 - p1, radians(lng2 - lng1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * 6371.0 * asin(sqrt(a))


def describe(lat, lng) -> str | None:
    """"Puchong, Selangor", or None when nothing known is close enough."""
    if lat is None or lng is None:
        return None
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    best, best_km = None, None
    for name, state, la, ln in LOCALITIES:
        d = _km(lat, lng, la, ln)
        if best_km is None or d < best_km:
            best, best_km = (name, state), d
    if best is None or best_km > MAX_KM:
        return None
    name, state = best
    return state if name == state else f"{name}, {state}"
