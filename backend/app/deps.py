import uuid

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from .db import get_db
from .errors import ApiError, not_found
from .models import Day, Leg, Project, Stop, User
from .security import CSRF_HEADER, SESSION_COOKIE, read_session_token

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def check_csrf(request: Request) -> None:
    """Mutating requests must carry a custom header.

    Browsers can't attach custom headers to cross-site form posts or simple
    requests without a CORS preflight (which this API never approves), so this
    together with SameSite cookies blocks CSRF.
    """
    if request.method in UNSAFE_METHODS and request.headers.get(CSRF_HEADER) != "fetch":
        raise ApiError(403, "csrf", "缺少 CSRF 防護標頭")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    check_csrf(request)
    token = request.cookies.get(SESSION_COOKIE)
    parsed = read_session_token(token) if token else None
    if parsed:
        uid, fingerprint = parsed
        user = db.get(User, uid)
        if user and user.password_hash[-16:] == fingerprint:
            return user
    raise ApiError(401, "unauthorized", "請先登入")


def get_project(project_id: uuid.UUID, db: Session, user: User) -> Project:
    p = db.get(Project, project_id)
    if not p or p.owner_id != user.id:
        raise not_found("專案")
    return p


def get_day(day_id: uuid.UUID, db: Session, user: User) -> Day:
    d = db.get(Day, day_id)
    if not d:
        raise not_found("日期")
    get_project(d.project_id, db, user)
    return d


def get_stop(stop_id: uuid.UUID, db: Session, user: User) -> Stop:
    s = db.get(Stop, stop_id)
    if not s:
        raise not_found("地點")
    get_project(s.project_id, db, user)
    return s


def get_leg(leg_id: uuid.UUID, db: Session, user: User) -> Leg:
    leg = db.get(Leg, leg_id)
    if not leg:
        raise not_found("路段")
    get_project(leg.project_id, db, user)
    return leg
