from .conftest import legs_by_pair


def test_create_stop_validation(api, project):
    pid = project["id"]
    bad = [
        {"title": "", "latitude": 0, "longitude": 0},
        {"title": "x", "latitude": 90.1, "longitude": 0},
        {"title": "x", "latitude": 0, "longitude": -180.5},
        {"title": "x", "latitude": 0, "longitude": 0, "stay_minutes": -1},
        {"title": "x", "latitude": 0, "longitude": 0, "reference_url": "javascript:alert(1)"},
        {"title": "x", "latitude": 0, "longitude": 0, "arrival_time": "25:00"},
    ]
    for body in bad:
        r = api.post(f"/projects/{pid}/stops", body)
        assert r.status_code == 422, body
        assert r.json()["error"]["fields"], r.json()
    r = api.post(f"/projects/{pid}/stops", {"title": "x", "latitude": 0, "longitude": 0, "reference_url": "javascript:x"})
    assert "reference_url" in r.json()["error"]["fields"]


def test_new_stop_defaults_to_unscheduled_and_persists(api, project):
    pid = project["id"]
    r = api.post(f"/projects/{pid}/stops", {"title": "東京車站", "latitude": 35.681236, "longitude": 139.767125})
    s = r.json()
    assert s["day_id"] is None
    got = api.get(f"/projects/{pid}/stops").json()
    assert got[0]["latitude"] == 35.681236


def test_drag_updates_coordinates(api, day_abc):
    pid, day, stops = day_abc
    r = api.patch(f"/stops/{stops['A']['id']}", {"latitude": 35.5, "longitude": 139.5})
    assert r.status_code == 200
    a = next(s for s in api.get(f"/projects/{pid}/stops").json() if s["id"] == stops["A"]["id"])
    assert (a["latitude"], a["longitude"]) == (35.5, 139.5)
    assert api.patch(f"/stops/{stops['A']['id']}", {"latitude": None}).status_code == 422


def test_legs_auto_created(api, day_abc):
    pid, day, stops = day_abc
    legs = legs_by_pair(api, day["id"], stops)
    assert set(legs) == {"AB", "BC"}
    assert all(l["transport_mode"] is None for l in legs.values())


def test_ac03_record_transport_does_not_touch_other_leg(api, day_abc):
    pid, day, stops = day_abc
    legs = legs_by_pair(api, day["id"], stops)
    r = api.patch(
        f"/legs/{legs['AB']['id']}",
        {"transport_mode": "train", "route_name": "JR 山手線", "duration_minutes": 18, "cost_amount": 210, "currency": "jpy", "description": "避開尖峰"},
    )
    assert r.status_code == 200, r.text
    legs = legs_by_pair(api, day["id"], stops)
    assert legs["AB"]["transport_mode"] == "train"
    assert legs["AB"]["currency"] == "JPY"
    assert float(legs["AB"]["cost_amount"]) == 210
    assert legs["BC"]["transport_mode"] is None


def test_leg_validation(api, day_abc):
    pid, day, stops = day_abc
    lid = legs_by_pair(api, day["id"], stops)["AB"]["id"]
    for body in ({"transport_mode": "rocket"}, {"cost_amount": -1}, {"duration_minutes": -5}, {"currency": "YENX"}, {"reference_url": "ftp://x"}):
        assert api.patch(f"/legs/{lid}", body).status_code == 422, body


def test_ac04_reorder_does_not_cross_wire(api, day_abc):
    pid, day, stops = day_abc
    legs = legs_by_pair(api, day["id"], stops)
    api.patch(f"/legs/{legs['AB']['id']}", {"transport_mode": "walk"})
    api.patch(f"/legs/{legs['BC']['id']}", {"transport_mode": "train"})

    r = api.put(f"/days/{day['id']}/stop-order", {"stop_ids": [stops[k]["id"] for k in "ACB"]})
    assert r.status_code == 200, r.text
    assert [s["title"] for s in r.json()] == ["A", "C", "B"]
    legs = legs_by_pair(api, day["id"], stops)
    assert set(legs) == {"AC", "CB"}
    assert legs["AC"]["transport_mode"] is None
    assert legs["CB"]["transport_mode"] is None

    # restoring the original order brings the recorded data back
    api.put(f"/days/{day['id']}/stop-order", {"stop_ids": [stops[k]["id"] for k in "ABC"]})
    legs = legs_by_pair(api, day["id"], stops)
    assert legs["AB"]["transport_mode"] == "walk"
    assert legs["BC"]["transport_mode"] == "train"


def test_reorder_requires_all_day_stops(api, day_abc):
    pid, day, stops = day_abc
    r = api.put(f"/days/{day['id']}/stop-order", {"stop_ids": [stops["A"]["id"], stops["B"]["id"]]})
    assert r.status_code == 422
    r = api.put(f"/days/{day['id']}/stop-order", {"stop_ids": [stops["A"]["id"]] * 2 + [stops["B"]["id"], stops["C"]["id"]]})
    assert r.status_code == 422


def test_ac05_delete_middle_stop(api, day_abc):
    pid, day, stops = day_abc
    legs = legs_by_pair(api, day["id"], stops)
    api.patch(f"/legs/{legs['AB']['id']}", {"transport_mode": "walk"})
    assert api.delete(f"/stops/{stops['B']['id']}").status_code == 204
    all_legs = api.get(f"/days/{day['id']}/legs?include_inactive=true").json()
    ids = {stops["A"]["id"], stops["C"]["id"]}
    assert len(all_legs) == 1
    assert {all_legs[0]["from_stop_id"], all_legs[0]["to_stop_id"]} == ids
    assert all_legs[0]["transport_mode"] is None
    remaining = api.get(f"/projects/{pid}/stops").json()
    assert [s["sort_order"] for s in remaining] == [0, 1]


def test_move_stop_to_other_day_and_unscheduled(api, day_abc):
    pid, day, stops = day_abc
    day2 = api.post(f"/projects/{pid}/days", {"date": "2026-11-06"}).json()
    d2stop = api.post(f"/projects/{pid}/stops", {"title": "D", "latitude": 1, "longitude": 1, "day_id": day2["id"]}).json()
    stops["D"] = d2stop

    r = api.patch(f"/stops/{stops['B']['id']}", {"day_id": day2["id"]})
    assert r.json()["day_id"] == day2["id"] and r.json()["sort_order"] == 1
    assert set(legs_by_pair(api, day["id"], stops)) == {"AC"}
    assert set(legs_by_pair(api, day2["id"], stops)) == {"DB"}

    api.patch(f"/stops/{stops['B']['id']}", {"day_id": None})
    assert legs_by_pair(api, day2["id"], stops, include_inactive=True) == {}
    b = next(s for s in api.get(f"/projects/{pid}/stops").json() if s["id"] == stops["B"]["id"])
    assert b["day_id"] is None


def test_stop_order_can_pull_in_stops_from_elsewhere(api, day_abc):
    pid, day, stops = day_abc
    u = api.post(f"/projects/{pid}/stops", {"title": "U", "latitude": 1, "longitude": 1}).json()
    stops["U"] = u
    ids = [stops[k]["id"] for k in "AUBC"]
    r = api.put(f"/days/{day['id']}/stop-order", {"stop_ids": ids})
    assert r.status_code == 200
    assert set(legs_by_pair(api, day["id"], stops)) == {"AU", "UB", "BC"}


def test_upsert_leg_requires_adjacent(api, day_abc):
    pid, day, stops = day_abc
    r = api.post(f"/days/{day['id']}/legs", {"from_stop_id": stops["A"]["id"], "to_stop_id": stops["C"]["id"]})
    assert r.status_code == 422
    r = api.post(f"/days/{day['id']}/legs", {"from_stop_id": stops["A"]["id"], "to_stop_id": stops["B"]["id"], "transport_mode": "bus"})
    assert r.status_code == 200 and r.json()["transport_mode"] == "bus"
    assert len(api.get(f"/days/{day['id']}/legs").json()) == 2


def test_unscheduled_reorder(api, project):
    pid = project["id"]
    a = api.post(f"/projects/{pid}/stops", {"title": "a", "latitude": 1, "longitude": 1}).json()
    b = api.post(f"/projects/{pid}/stops", {"title": "b", "latitude": 1, "longitude": 1}).json()
    r = api.put(f"/projects/{pid}/unscheduled-order", {"stop_ids": [b["id"], a["id"]]})
    assert [s["title"] for s in r.json()] == ["b", "a"]
