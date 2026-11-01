import time
import uuid
from collections import defaultdict, deque

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import get_settings

SESSION_COOKIE = "mtp_session"
CSRF_HEADER = "X-Requested-With"

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().secret_key, salt="mtp-session")


def make_session_token(user_id: uuid.UUID, password_hash: str) -> str:
    # The hash fingerprint invalidates sessions when the password changes.
    return _serializer().dumps({"uid": str(user_id), "ph": password_hash[-16:]})


def read_session_token(token: str) -> tuple[uuid.UUID, str] | None:
    try:
        data = _serializer().loads(token, max_age=get_settings().session_max_age_seconds)
        return uuid.UUID(data["uid"]), data["ph"]
    except (BadSignature, SignatureExpired, KeyError, ValueError, TypeError):
        return None


class LoginThrottle:
    """Very small in-memory brute force guard: N failures per window per key."""

    def __init__(self, max_failures: int = 10, window_seconds: int = 300):
        self.max_failures = max_failures
        self.window = window_seconds
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str) -> deque[float]:
        q = self._failures[key]
        cutoff = time.monotonic() - self.window
        while q and q[0] < cutoff:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        return len(self._prune(key)) >= self.max_failures

    def fail(self, key: str) -> None:
        self._prune(key).append(time.monotonic())

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)


login_throttle = LoginThrottle()
