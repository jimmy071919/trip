import httpx
import pytest

from app.config import get_settings
from app.services import gmaps

PLACE_URL = (
    "https://www.google.com/maps/place/%E6%B7%BA%E8%8D%89%E5%AF%BA/@35.7147651,139.7940837,17z/"
    "data=!3m1!4b1!4m6!3m5!1s0x60188ec2baad39d3:0x2!8m2!3d35.7147651!4d139.7966586!16zL20vMDJn?entry=ttu"
)


@pytest.mark.parametrize(
    "url, name, lat, lng, precise",
    [
        (PLACE_URL, "淺草寺", 35.7147651, 139.7966586, True),
        ("https://www.google.com/maps/place/Tokyo+Tower/@35.6585805,139.7454329,17z", "Tokyo Tower", 35.6585805, 139.7454329, False),
        ("https://www.google.com/maps?q=35.681236,139.767125", None, 35.681236, 139.767125, True),
        ("https://maps.google.com/?q=loc:25.0339,121.5645", None, 25.0339, 121.5645, True),
        ("https://www.google.com/maps/search/?api=1&query=24.1477,120.6736", None, 24.1477, 120.6736, True),
        ("https://www.google.com/maps/@25.04,121.56,15z", None, 25.04, 121.56, True),
        ("https://www.google.com.tw/maps/place/25%C2%B002'02.0%22N/@25.0339,121.5645,17z/data=!3m1!4b1!4m4!3m3!8m2!3d25.0339!4d121.5645", None, 25.0339, 121.5645, True),
        ("https://www.google.co.jp/maps/place/35.6595,139.7005", None, 35.6595, 139.7005, True),
    ],
)
def test_parse_variants(url, name, lat, lng, precise):
    p = gmaps.parse_url(url)
    if name:
        assert p.name == name
    assert (p.latitude, p.longitude, p.precise) == (lat, lng, precise)


def test_parse_query_without_coords_splits_name_and_address():
    p = gmaps.parse_url("https://maps.google.com/maps?q=%E5%8F%B0%E5%8C%97101,+110%E5%8F%B0%E5%8C%97%E5%B8%82%E4%BF%A1%E7%BE%A9%E5%8D%80&ftid=0x1:0x2")
    assert p.name == "台北101" and p.address.startswith("台北101") and p.latitude is None


@pytest.mark.parametrize(
    "url",
    ["https://evil.example.com/maps/place/x/@1,2,3z", "https://www.google.com/search?q=tokyo", "https://www.google.com/maps/dir/A/B"],
)
def test_parse_rejects(url):
    with pytest.raises(gmaps.LinkError):
        gmaps.parse_url(url)


def test_normalise_extracts_url_from_share_text():
    assert gmaps.normalise("淺草寺\nhttps://maps.app.goo.gl/AbC123 ") == "https://maps.app.goo.gl/AbC123"


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_short_link_expansion():
    def handler(req: httpx.Request):
        assert req.url.host == "maps.app.goo.gl"
        return httpx.Response(302, headers={"location": PLACE_URL})

    p = gmaps.resolve("https://maps.app.goo.gl/AbC123", client=_client(handler))
    assert p.name == "淺草寺" and p.precise and p.latitude == 35.7147651


def test_short_link_to_non_google_is_blocked():
    calls = []

    def handler(req):
        calls.append(str(req.url))
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})

    with pytest.raises(gmaps.LinkError):
        gmaps.resolve("https://maps.app.goo.gl/x", client=_client(handler))
    assert calls == ["https://maps.app.goo.gl/x"]  # never contacted the redirect target


def test_places_enrichment(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "k")
    get_settings.cache_clear()
    try:
        def handler(req: httpx.Request):
            assert req.url.host == "places.googleapis.com"
            assert req.headers["X-Goog-Api-Key"] == "k"
            return httpx.Response(200, json={"places": [{
                "displayName": {"text": "淺草寺"}, "formattedAddress": "東京都台東區淺草2-3-1",
                "location": {"latitude": 35.71476, "longitude": 139.79666},
                "nationalPhoneNumber": "03-3842-0181", "websiteUri": "https://www.senso-ji.jp/",
                "regularOpeningHours": {"weekdayDescriptions": ["星期一: 06:00–17:00"]}, "rating": 4.5,
            }]})

        p = gmaps.resolve(PLACE_URL, client=_client(handler))
        assert p.source == "google_places"
        assert p.address == "東京都台東區淺草2-3-1" and p.phone == "03-3842-0181"
        assert p.opening_hours == ["星期一: 06:00–17:00"]
        assert p.latitude == 35.7147651  # precise pin from link is kept

        # far-away result is ignored
        def far(req):
            return httpx.Response(200, json={"places": [{"displayName": {"text": "X"}, "location": {"latitude": 34.0, "longitude": 135.0}}]})

        p = gmaps.resolve(PLACE_URL, client=_client(far))
        assert p.source == "url" and p.warnings
    finally:
        monkeypatch.delenv("GOOGLE_MAPS_API_KEY")
        get_settings.cache_clear()


def test_places_locates_link_without_coords(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "k")
    get_settings.cache_clear()
    try:
        def handler(req):
            return httpx.Response(200, json={"places": [{"displayName": {"text": "台北101"}, "location": {"latitude": 25.0339, "longitude": 121.5645}}]})

        p = gmaps.resolve("https://maps.google.com/maps?q=台北101,+信義區&ftid=0x1:0x2", client=_client(handler))
        assert (p.latitude, p.longitude, p.precise) == (25.0339, 121.5645, True)
    finally:
        monkeypatch.delenv("GOOGLE_MAPS_API_KEY")
        get_settings.cache_clear()


def test_endpoint(api, anon):
    r = api.post("/places/resolve-google-link", {"url": PLACE_URL})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "淺草寺"
    r = api.post("/places/resolve-google-link", {"url": "https://example.com"})
    assert r.status_code == 422 and "url" in r.json()["error"]["fields"]
    api.post("/auth/logout")
    assert api.post("/places/resolve-google-link", {"url": PLACE_URL}).status_code == 401


def test_nominatim_fallback_for_links_without_coords(monkeypatch):
    seen = []

    def handler(req: httpx.Request):
        seen.append(req)
        assert req.url.host == "nominatim.openstreetmap.org"
        assert "MapTripPlanner" in req.headers["User-Agent"]
        return httpx.Response(200, json=[{"lat": "25.0339", "lon": "121.5645"}])

    p = gmaps.resolve("https://maps.google.com/maps?q=台北101,+信義區信義路五段7號&ftid=0x1:0x2", client=_client(handler))
    assert (p.latitude, p.longitude) == (25.0339, 121.5645)
    assert p.source == "nominatim" and not p.precise
    assert seen[0].url.params["q"].startswith("台北101")  # full address tried first


def test_nominatim_no_result_and_disabled(monkeypatch):
    p = gmaps.resolve("https://maps.google.com/maps?q=某個不存在的地方", client=_client(lambda r: httpx.Response(200, json=[])))
    assert p.latitude is None and any("點選" in w for w in p.warnings)

    monkeypatch.setenv("ENABLE_NOMINATIM", "false")
    get_settings.cache_clear()
    try:
        def boom(req):
            raise AssertionError("should not be called")

        p = gmaps.resolve("https://maps.google.com/maps?q=台北101", client=_client(boom))
        assert p.latitude is None
    finally:
        monkeypatch.delenv("ENABLE_NOMINATIM")
        get_settings.cache_clear()
