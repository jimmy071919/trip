import json

from .conftest import legs_by_pair


def _upload(api, payload):
    data = json.dumps(payload).encode() if not isinstance(payload, bytes) else payload
    return api.post("/projects/import", files={"file": ("backup.json", data, "application/json")})


def test_ac07_export_import_roundtrip(api, day_abc):
    pid, day, stops = day_abc
    legs = legs_by_pair(api, day["id"], stops)
    api.patch(f"/legs/{legs['AB']['id']}", {"transport_mode": "train", "cost_amount": "580.50", "currency": "JPY", "duration_minutes": 40})
    api.patch(f"/stops/{stops['A']['id']}", {"arrival_time": "09:30", "stay_minutes": 45, "address": "東京都", "reference_url": "https://example.com"})
    api.post(f"/projects/{pid}/stops", {"title": "未排程", "latitude": -33.8, "longitude": 151.2})
    api.patch(f"/projects/{pid}", {"map_center_lat": 35.68, "map_center_lon": 139.76, "map_zoom": 12})

    exported = api.get(f"/projects/{pid}/export")
    assert exported.status_code == 200
    assert "attachment" in exported.headers["content-disposition"]
    data = exported.json()
    assert data["format"] == "map-trip-planner" and data["version"] == 1

    r = _upload(api, data)
    assert r.status_code == 201, r.text
    new_pid = r.json()["id"]
    assert new_pid != pid
    b = api.get(f"/projects/{new_pid}/bundle").json()
    assert b["project"]["map_zoom"] == 12
    assert len(b["days"]) == 1 and b["days"][0]["date"] == "2026-11-05"
    by_title = {s["title"]: s for s in b["stops"]}
    assert by_title["未排程"]["day_id"] is None
    assert by_title["A"]["arrival_time"] == "09:30:00" and by_title["A"]["stay_minutes"] == 45
    assert [s["title"] for s in sorted((s for s in b["stops"] if s["day_id"]), key=lambda s: s["sort_order"])] == ["A", "B", "C"]
    name = {s["id"]: s["title"] for s in b["stops"]}
    legs_new = {name[l["from_stop_id"]] + name[l["to_stop_id"]]: l for l in b["legs"]}
    assert set(legs_new) == {"AB", "BC"}
    assert legs_new["AB"]["transport_mode"] == "train" and float(legs_new["AB"]["cost_amount"]) == 580.5
    # ids were remapped, not reused
    assert not ({s["id"] for s in b["stops"]} & {s["id"] for s in stops.values()})


def test_import_rejects_bad_files(api, day_abc):
    pid, day, stops = day_abc
    data = api.get(f"/projects/{pid}/export").json()

    assert _upload(api, b"{not json").status_code == 422
    assert _upload(api, {**data, "format": "other"}).status_code == 422
    assert _upload(api, {**data, "version": 99}).status_code == 422

    broken = json.loads(json.dumps(data))
    broken["stops"][0]["day_id"] = "00000000-0000-0000-0000-000000000000"
    r = _upload(api, broken)
    assert r.status_code == 422 and "stops.0.day_id" in r.json()["error"]["fields"]

    broken = json.loads(json.dumps(data))
    broken["legs"][0]["to_stop_id"] = "00000000-0000-0000-0000-000000000000"
    assert _upload(api, broken).status_code == 422

    broken = json.loads(json.dumps(data))
    broken["stops"][0]["latitude"] = 200
    assert _upload(api, broken).status_code == 422

    assert len(api.get("/projects").json()) == 1  # nothing partially imported
