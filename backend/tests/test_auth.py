from .conftest import H


def test_setup_then_login_flow(anon):
    st = anon.get("/auth/status").json()
    assert st == {"user": None, "setup_required": True}
    assert anon.post("/auth/setup", {"username": "admin", "password": "password123"}).status_code == 201
    # second setup forbidden
    assert anon.post("/auth/setup", {"username": "xyz", "password": "password123"}).status_code == 409
    assert anon.get("/auth/me").json()["username"] == "admin"

    assert anon.post("/auth/logout").status_code == 204
    assert anon.get("/auth/me").status_code == 401
    assert anon.post("/auth/login", {"username": "admin", "password": "wrong"}).status_code == 401
    r = anon.post("/auth/login", {"username": "admin", "password": "password123"})
    assert r.status_code == 200
    assert anon.get("/auth/status").json()["setup_required"] is False


def test_password_is_hashed(api):
    from app.db import SessionLocal
    from app.models import User

    with SessionLocal() as db:
        u = db.query(User).one()
        assert u.password_hash != "password123"
        assert u.password_hash.startswith("$argon2")


def test_unauthenticated_cannot_mutate(anon):
    anon.post("/auth/setup", {"username": "admin", "password": "password123"})
    anon.post("/auth/logout")
    assert anon.post("/projects", {"title": "x"}).status_code == 401
    assert anon.get("/projects").status_code == 401
    r = anon.patch("/stops/550e8400-e29b-41d4-a716-446655440000", {"title": "x"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_csrf_header_required(api):
    r = api.c.post("/api/v1/projects", json={"title": "x"})  # no header
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "csrf"
    assert api.c.post("/api/v1/projects", json={"title": "x"}, headers=H).status_code == 201


def test_tampered_cookie_rejected(api):
    api.c.cookies.set("mtp_session", "garbage")
    assert api.get("/auth/me").status_code == 401


def test_login_throttle(anon):
    anon.post("/auth/setup", {"username": "admin", "password": "password123"})
    for _ in range(10):
        anon.post("/auth/login", {"username": "admin", "password": "bad"})
    assert anon.post("/auth/login", {"username": "admin", "password": "password123"}).status_code == 429


def test_health_and_config(anon):
    assert anon.get("/health").json() == {"status": "ok"}
    cfg = anon.get("/config").json()
    assert "{z}" in cfg["tile_url"] and "train" in cfg["transport_modes"]
