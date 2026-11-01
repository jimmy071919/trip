import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["SECRET_KEY"] = "test-secret"
os.environ.pop("ADMIN_USERNAME", None)
os.environ.pop("ADMIN_PASSWORD", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.security import login_throttle  # noqa: E402

H = {"X-Requested-With": "fetch"}


@pytest.fixture(autouse=True)
def _fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    login_throttle._failures.clear()
    yield


class Api:
    def __init__(self, client: TestClient):
        self.c = client

    def get(self, url, **kw):
        return self.c.get("/api/v1" + url, **kw)

    def post(self, url, json=None, **kw):
        return self.c.post("/api/v1" + url, json=json, headers=H, **kw)

    def patch(self, url, json=None):
        return self.c.patch("/api/v1" + url, json=json, headers=H)

    def put(self, url, json=None):
        return self.c.put("/api/v1" + url, json=json, headers=H)

    def delete(self, url):
        return self.c.delete("/api/v1" + url, headers=H)


@pytest.fixture
def anon():
    with TestClient(app) as c:
        yield Api(c)


@pytest.fixture
def api(anon):
    r = anon.post("/auth/setup", {"username": "admin", "password": "password123"})
    assert r.status_code == 201, r.text
    return anon


@pytest.fixture
def project(api):
    r = api.post("/projects", {"title": "東京五日遊"})
    assert r.status_code == 201
    return r.json()


@pytest.fixture
def day_abc(api, project):
    """A day with stops A, B, C in order."""
    pid = project["id"]
    day = api.post(f"/projects/{pid}/days", {"date": "2026-11-05"}).json()
    stops = {}
    for i, name in enumerate("ABC"):
        r = api.post(f"/projects/{pid}/stops", {"title": name, "latitude": 35 + i / 100, "longitude": 139.7, "day_id": day["id"]})
        assert r.status_code == 201, r.text
        stops[name] = r.json()
    return pid, day, stops


def legs_by_pair(api, day_id, stops, include_inactive=False):
    name = {s["id"]: k for k, s in stops.items()}
    q = "?include_inactive=true" if include_inactive else ""
    return {
        name[l["from_stop_id"]] + name[l["to_stop_id"]]: l for l in api.get(f"/days/{day_id}/legs{q}").json()
    }
