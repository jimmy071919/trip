"""Turn a Google Maps share link into a place (name + coordinates [+ details]).

* The URL itself is parsed — no Google page is downloaded or scraped.
* Short links (maps.app.goo.gl / goo.gl/maps) are expanded by following HTTP
  redirects, only ever contacting Google hosts (SSRF guard).
* If GOOGLE_MAPS_API_KEY is set, the Places API (New) Text Search is used to
  fill address / phone / website / opening hours and to locate links that
  carry no coordinates.
"""

from __future__ import annotations

import math
import re
import threading
import time
from dataclasses import dataclass, field
from urllib.parse import parse_qs, unquote_plus, urlparse

import httpx

from ..config import get_settings

SHORT_HOSTS = {"maps.app.goo.gl", "goo.gl", "g.co"}
_GOOGLE_HOST = re.compile(r"^(?:www\.|maps\.)?google\.(?:com|[a-z]{2,3}|com?\.[a-z]{2})$")
_COORD = r"(-?\d{1,3}(?:\.\d+)?)"
_PAIR = re.compile(rf"^\s*{_COORD}\s*,\s*{_COORD}\s*$")
_DATA_PIN = re.compile(rf"!3d{_COORD}!4d{_COORD}")
_AT = re.compile(rf"@{_COORD},{_COORD}(?:,(\d+(?:\.\d+)?)z)?")


class LinkError(ValueError):
    pass


@dataclass
class Place:
    name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    precise: bool = False  # True = the place pin; False = map viewport / geocoded estimate
    address: str | None = None
    phone: str | None = None
    website: str | None = None
    opening_hours: list[str] = field(default_factory=list)
    rating: float | None = None
    google_maps_url: str | None = None
    query: str | None = None
    source: str = "url"
    warnings: list[str] = field(default_factory=list)


def _valid(lat: float, lng: float) -> bool:
    return -90 <= lat <= 90 and -180 <= lng <= 180 and not (lat == 0 and lng == 0)


def _pair(text: str | None) -> tuple[float, float] | None:
    if not text:
        return None
    m = _PAIR.match(text)
    if m:
        lat, lng = float(m.group(1)), float(m.group(2))
        if _valid(lat, lng):
            return lat, lng
    return None


def is_google_maps_host(host: str) -> bool:
    return bool(_GOOGLE_HOST.match(host.lower()))


def normalise(url: str) -> str:
    url = url.strip()
    # people often paste "text https://maps.app.goo.gl/xxx" from the share sheet
    m = re.search(r"https?://\S+", url)
    if m:
        url = m.group(0)
    elif not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url.rstrip(").,，。")


def parse_url(url: str) -> Place:
    """Extract what we can from a full (non-short) Google Maps URL."""
    u = urlparse(url)
    host = (u.hostname or "").lower()
    if not is_google_maps_host(host):
        raise LinkError("這不是 Google 地圖的連結")
    qs = {k: v[0] for k, v in parse_qs(u.query).items() if v}

    # consent.google.* wraps the real URL in ?continue=
    if host.startswith("consent.") and "continue" in qs:
        return parse_url(qs["continue"])

    path = unquote_plus(u.path)
    if not (path.startswith("/maps") or host.startswith("maps.")):
        raise LinkError("這不是 Google 地圖的連結")
    if "/maps/dir/" in path:
        raise LinkError("這是路線規劃連結，請改分享單一地點")

    p = Place(google_maps_url=url)
    segments = [s for s in path.split("/") if s]

    # /maps/place/<name>/... and /maps/search/<query>/...
    for marker in ("place", "search"):
        if marker in segments:
            i = segments.index(marker)
            if i + 1 < len(segments) and not segments[i + 1].startswith(("@", "data=")):
                text = segments[i + 1].strip()
                coords = _pair(text)
                if coords:
                    p.latitude, p.longitude = coords
                    p.precise = True
                elif marker == "place":
                    p.name = text
                else:
                    p.query = text

    # query parameters: ?q= / ?query= / ?ll= / ?destination= ...
    for key in ("q", "query", "destination", "daddr", "ll", "center", "sll"):
        if key not in qs:
            continue
        val = qs[key].strip()
        coords = _pair(val.removeprefix("loc:"))
        if coords and p.latitude is None:
            p.latitude, p.longitude = coords
            p.precise = key not in ("center", "sll")
        elif not coords and key in ("q", "query", "destination", "daddr") and not p.name and not p.query:
            p.query = val

    # data=...!3d<lat>!4d<lng> is the actual place pin; take the last one
    pins = _DATA_PIN.findall(url)
    if pins:
        lat, lng = float(pins[-1][0]), float(pins[-1][1])
        if _valid(lat, lng):
            p.latitude, p.longitude, p.precise = lat, lng, True

    # @lat,lng,zoom is the viewport centre — only an estimate when a place is named
    if p.latitude is None:
        m = _AT.search(path)
        if m and _valid(float(m.group(1)), float(m.group(2))):
            p.latitude, p.longitude = float(m.group(1)), float(m.group(2))
            p.precise = not (p.name or p.query)

    # "Name, street, city" queries (mobile share links with ftid=) → title + address
    if not p.name and p.query:
        if "," in p.query or "，" in p.query:
            head = re.split(r"[,，]", p.query, maxsplit=1)[0].strip()
            p.name, p.address = head or p.query, p.query
        else:
            p.name = p.query

    if p.name is None and p.latitude is None:
        raise LinkError("無法從連結取得地點資訊，請在 Google 地圖中開啟地點後按「分享」複製連結")
    return p


def expand_short_link(url: str, client: httpx.Client, max_hops: int = 6) -> str:
    """Follow redirects of a short link, contacting Google hosts only."""
    current = url
    for _ in range(max_hops):
        host = (urlparse(current).hostname or "").lower()
        if host not in SHORT_HOSTS and not is_google_maps_host(host):
            raise LinkError("短網址導向了非 Google 的網站，已停止")
        if is_google_maps_host(host) and not host.startswith("consent."):
            return current
        try:
            r = client.get(current, follow_redirects=False)
        except httpx.HTTPError:
            raise LinkError("無法展開短網址，請確認伺服器可以連上網路") from None
        loc = r.headers.get("location")
        if r.status_code in (301, 302, 303, 307, 308) and loc:
            current = str(httpx.URL(current).join(loc))
            continue
        if host.startswith("consent."):
            return current
        raise LinkError("短網址無效或已失效")
    raise LinkError("短網址轉址次數過多")


def _distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


PLACES_FIELDS = ",".join(
    "places." + f
    for f in (
        "displayName", "formattedAddress", "location", "nationalPhoneNumber", "internationalPhoneNumber",
        "websiteUri", "regularOpeningHours.weekdayDescriptions", "rating", "googleMapsUri",
    )
)


def enrich_with_places(p: Place, client: httpx.Client, api_key: str, language: str) -> None:
    text = p.address if p.address and p.name and p.name in p.address else " ".join(x for x in (p.name, p.address) if x)
    if not text:
        return  # coordinates only — nothing to search for
    body: dict = {"textQuery": text, "languageCode": language, "pageSize": 1}
    if p.latitude is not None:
        body["locationBias"] = {"circle": {"center": {"latitude": p.latitude, "longitude": p.longitude}, "radius": 2000.0}}
    try:
        r = client.post(
            "https://places.googleapis.com/v1/places:searchText",
            json=body,
            headers={"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": PLACES_FIELDS},
        )
    except httpx.HTTPError:
        p.warnings.append("Google Places 查詢失敗（網路錯誤），僅使用連結中的資訊")
        return
    if r.status_code != 200:
        p.warnings.append(f"Google Places 查詢失敗（HTTP {r.status_code}），僅使用連結中的資訊")
        return
    places = r.json().get("places") or []
    if not places:
        p.warnings.append("Google Places 找不到符合的地點，僅使用連結中的資訊")
        return
    g = places[0]
    loc = g.get("location") or {}
    glat, glng = loc.get("latitude"), loc.get("longitude")
    if glat is not None and glng is not None:
        if p.precise and _distance_m((p.latitude, p.longitude), (glat, glng)) > 1500:
            p.warnings.append("Google Places 結果與連結位置差距過大，已忽略詳細資訊")
            return
        if not p.precise:
            p.latitude, p.longitude, p.precise = glat, glng, True
    p.name = (g.get("displayName") or {}).get("text") or p.name
    p.address = g.get("formattedAddress") or p.address
    p.phone = g.get("nationalPhoneNumber") or g.get("internationalPhoneNumber")
    p.website = g.get("websiteUri")
    p.opening_hours = (g.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []
    p.rating = g.get("rating")
    p.source = "google_places"


_nominatim_lock = threading.Lock()
_nominatim_last = 0.0


def geocode_nominatim(p: Place, client: httpx.Client) -> None:
    """Locate a place from its address / name via Nominatim (max 1 req/s)."""
    global _nominatim_last
    s = get_settings()
    candidates = [q for q in (p.address, p.name) if q]
    for q in dict.fromkeys(candidates):
        with _nominatim_lock:
            wait = 1.0 - (time.monotonic() - _nominatim_last)
            if wait > 0:
                time.sleep(wait)
            params = {"q": q, "format": "jsonv2", "limit": 1, "accept-language": s.google_places_language}
            if s.nominatim_email:
                params["email"] = s.nominatim_email
            try:
                r = client.get(
                    s.nominatim_url.rstrip("/") + "/search",
                    params=params,
                    headers={"User-Agent": "MapTripPlanner/1.0 (self-hosted trip planner)"},
                )
            except httpx.HTTPError:
                p.warnings.append("地址定位服務無法連線")
                return
            finally:
                _nominatim_last = time.monotonic()
        if r.status_code != 200:
            p.warnings.append(f"地址定位服務錯誤（HTTP {r.status_code}）")
            return
        results = r.json() or []
        if results:
            lat, lng = float(results[0]["lat"]), float(results[0]["lon"])
            if _valid(lat, lng):
                p.latitude, p.longitude, p.precise = lat, lng, False
                p.source = "nominatim" if p.source == "url" else p.source
                p.warnings.append("連結中沒有座標，位置由地址推算（OpenStreetMap），請確認標記位置")
                return


def resolve(raw_url: str, client: httpx.Client | None = None) -> Place:
    settings = get_settings()
    own = client is None
    client = client or httpx.Client(
        timeout=8.0, headers={"User-Agent": "Mozilla/5.0 (compatible; MapTripPlanner/1.0)"}
    )
    try:
        url = normalise(raw_url)
        if len(url) > 4000:
            raise LinkError("連結過長")
        host = (urlparse(url).hostname or "").lower()
        if host in SHORT_HOSTS:
            url = expand_short_link(url, client)
        place = parse_url(url)
        if place.google_maps_url and len(place.google_maps_url) > 1900:
            place.google_maps_url = raw_url.strip() if len(raw_url.strip()) < 1900 else None
        if settings.google_maps_api_key:
            enrich_with_places(place, client, settings.google_maps_api_key, settings.google_places_language)
        if place.latitude is None and settings.enable_nominatim:
            geocode_nominatim(place, client)
        if place.latitude is None:
            place.warnings.append("無法取得座標，請在地圖上點選地點位置")
        elif not place.precise and place.source != "nominatim":
            place.warnings.append("座標為連結中的地圖中心，可能與實際地點略有差距，請確認標記位置")
        return place
    finally:
        if own:
            client.close()
