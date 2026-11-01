from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import check_csrf, current_user
from ..errors import ApiError
from ..models import User
from ..schemas import AuthStatus, LoginIn, SetupIn, UserOut
from ..security import SESSION_COOKIE, hash_password, login_throttle, make_session_token, read_session_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session(response: Response, user: User) -> None:
    s = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        make_session_token(user.id, user.password_hash),
        max_age=s.session_max_age_seconds,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )


def _user_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User)) or 0


@router.get("/status", response_model=AuthStatus)
def status(request: Request, db: Session = Depends(get_db)):
    """Public: whether initial setup is needed and who is logged in."""
    user = None
    token = request.cookies.get(SESSION_COOKIE)
    parsed = read_session_token(token) if token else None
    if parsed:
        u = db.get(User, parsed[0])
        if u and u.password_hash[-16:] == parsed[1]:
            user = u
    return AuthStatus(user=UserOut.model_validate(user) if user else None, setup_required=_user_count(db) == 0)


@router.post("/setup", response_model=UserOut, status_code=201)
def setup(body: SetupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Create the single administrator. Only allowed while no user exists."""
    check_csrf(request)
    if _user_count(db) > 0:
        raise ApiError(409, "already_setup", "系統已完成初始設定")
    user = User(username=body.username, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    _set_session(response, user)
    return user


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    check_csrf(request)
    key = request.client.host if request.client else "unknown"
    if login_throttle.blocked(key):
        raise ApiError(429, "too_many_attempts", "登入失敗次數過多，請稍後再試")
    user = db.scalar(select(User).where(User.username == body.username))
    if not user or not verify_password(user.password_hash, body.password):
        login_throttle.fail(key)
        raise ApiError(401, "invalid_credentials", "帳號或密碼錯誤")
    login_throttle.reset(key)
    _set_session(response, user)
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    check_csrf(request)
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.status_code = 204
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user
