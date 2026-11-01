def test_project_crud(api):
    r = api.post("/projects", {"title": "  台灣咖啡地圖 ", "description": "desc"})
    p = r.json()
    assert p["title"] == "台灣咖啡地圖" and p["timezone"] == "Asia/Taipei"
    assert len(api.get("/projects").json()) == 1

    r = api.patch(f"/projects/{p['id']}", {"title": "新名稱", "map_center_lat": 25.03, "map_center_lon": 121.56, "map_zoom": 13})
    assert r.status_code == 200
    got = api.get(f"/projects/{p['id']}").json()
    assert (got["title"], got["map_zoom"]) == ("新名稱", 13)

    assert api.patch(f"/projects/{p['id']}", {"title": None}).status_code == 422
    assert api.patch(f"/projects/{p['id']}", {"map_center_lat": 91}).status_code == 422
    assert api.patch(f"/projects/{p['id']}", {"timezone": "Mars/Base"}).status_code == 422

    assert api.delete(f"/projects/{p['id']}").status_code == 204
    assert api.get(f"/projects/{p['id']}").status_code == 404


def test_project_delete_cascades(api, day_abc):
    pid, day, stops = day_abc
    assert api.delete(f"/projects/{pid}").status_code == 204
    from app.db import SessionLocal
    from app.models import Day, Leg, Stop

    with SessionLocal() as db:
        assert db.query(Stop).count() == db.query(Leg).count() == db.query(Day).count() == 0


def test_other_users_project_is_hidden(api, project):
    from app.db import SessionLocal
    from app.models import Project, User
    from app.security import hash_password

    with SessionLocal() as db:
        other = User(username="other", password_hash=hash_password("x" * 10))
        db.add(other)
        db.flush()
        foreign = Project(owner_id=other.id, title="secret")
        db.add(foreign)
        db.commit()
        fid = foreign.id
    assert api.get(f"/projects/{fid}").status_code == 404
    assert api.patch(f"/projects/{fid}", {"title": "pwn"}).status_code == 404
    assert api.post(f"/projects/{fid}/stops", {"title": "x", "latitude": 0, "longitude": 0}).status_code == 404
    assert [p["title"] for p in api.get("/projects").json()] == ["東京五日遊"]


def test_bundle(api, day_abc):
    pid, day, stops = day_abc
    b = api.get(f"/projects/{pid}/bundle").json()
    assert len(b["days"]) == 1 and len(b["stops"]) == 3 and len(b["legs"]) == 2


def test_day_crud_and_delete_moves_stops_to_unscheduled(api, day_abc):
    pid, day, stops = day_abc
    assert api.patch(f"/days/{day['id']}", {"title": "Day 1"}).json()["title"] == "Day 1"
    api.post(f"/projects/{pid}/stops", {"title": "U", "latitude": 1, "longitude": 1})
    assert api.delete(f"/days/{day['id']}").status_code == 204
    s = api.get(f"/projects/{pid}/stops").json()
    assert all(x["day_id"] is None for x in s)
    assert sorted(x["sort_order"] for x in s) == [0, 1, 2, 3]
    assert api.get(f"/projects/{pid}/legs").json() == []
