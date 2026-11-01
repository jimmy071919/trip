import uuid
import datetime as dt
from datetime import date, datetime, time
from decimal import Decimal
from typing import Annotated, Literal
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, field_validator

from .models import TRANSPORT_MODES

TransportMode = Literal[
    "walk", "bicycle", "scooter", "car", "bus", "metro", "train", "taxi", "ferry", "flight", "other"
]
assert set(TransportMode.__args__) == set(TRANSPORT_MODES)  # type: ignore[attr-defined]


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def _check_url(v: str | None) -> str | None:
    if v is None:
        return v
    parsed = urlparse(v)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("網址必須以 http:// 或 https:// 開頭")
    if len(v) > 2000:
        raise ValueError("網址過長")
    return v


def _check_currency(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.upper()
    if len(v) != 3 or not v.isalpha():
        raise ValueError("幣別須為 3 碼 ISO 4217 代碼，例如 TWD、JPY")
    return v


def _check_tz(v: str) -> str:
    try:
        ZoneInfo(v)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("無效的時區名稱") from None
    return v


OptStr = Annotated[str | None, BeforeValidator(_blank_to_none)]
Url = Annotated[str | None, BeforeValidator(_blank_to_none), AfterValidator(_check_url)]
Currency = Annotated[str | None, BeforeValidator(_blank_to_none), AfterValidator(_check_currency)]
Title = Annotated[str, BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v), Field(min_length=1, max_length=200)]
Lat = Annotated[float, Field(ge=-90, le=90)]
Lon = Annotated[float, Field(ge=-180, le=180)]
Zoom = Annotated[int, Field(ge=0, le=22)]
NonNegInt = Annotated[int, Field(ge=0, le=100000)]
Cost = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth ----------
class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=1, max_length=256)


class SetupIn(BaseModel):
    username: str = Field(min_length=3, max_length=150, pattern=r"^[A-Za-z0-9_.@-]+$")
    password: str = Field(min_length=8, max_length=256)


class UserOut(ORM):
    id: uuid.UUID
    username: str


class AuthStatus(BaseModel):
    user: UserOut | None
    setup_required: bool


# ---------- projects ----------
class ProjectCreate(BaseModel):
    title: Title
    description: OptStr = None
    timezone: Annotated[str, AfterValidator(_check_tz)] = "Asia/Taipei"
    map_center_lat: Lat | None = None
    map_center_lon: Lon | None = None
    map_zoom: Zoom | None = None


class ProjectUpdate(BaseModel):
    title: Title | None = None
    description: OptStr = None
    timezone: Annotated[str, AfterValidator(_check_tz)] | None = None
    map_center_lat: Lat | None = None
    map_center_lon: Lon | None = None
    map_zoom: Zoom | None = None


class ProjectOut(ORM):
    id: uuid.UUID
    title: str
    description: str | None
    timezone: str
    map_center_lat: float | None
    map_center_lon: float | None
    map_zoom: int | None
    created_at: datetime
    updated_at: datetime


# ---------- days ----------
class DayCreate(BaseModel):
    date: dt.date | None = None
    title: OptStr = None


class DayUpdate(BaseModel):
    date: dt.date | None = None
    title: OptStr = None
    sort_order: int | None = None


class DayOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    date: dt.date | None
    title: str | None
    sort_order: int


# ---------- stops ----------
class StopFields(BaseModel):
    address: OptStr = None
    description: OptStr = None
    reference_url: Url = None
    arrival_time: time | None = None
    stay_minutes: NonNegInt | None = None


class StopCreate(StopFields):
    title: Title
    latitude: Lat
    longitude: Lon
    day_id: uuid.UUID | None = None


class StopUpdate(StopFields):
    title: Title | None = None
    latitude: Lat | None = None
    longitude: Lon | None = None
    day_id: uuid.UUID | None = None


class StopOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    day_id: uuid.UUID | None
    title: str
    latitude: float
    longitude: float
    address: str | None
    description: str | None
    reference_url: str | None
    arrival_time: time | None
    stay_minutes: int | None
    sort_order: int | None
    updated_at: datetime


class StopOrderIn(BaseModel):
    stop_ids: list[uuid.UUID]

    @field_validator("stop_ids")
    @classmethod
    def _unique(cls, v):
        if len(set(v)) != len(v):
            raise ValueError("stop_ids 不可重複")
        return v


# ---------- legs ----------
class LegFields(BaseModel):
    transport_mode: TransportMode | None = None
    route_name: OptStr = None
    duration_minutes: NonNegInt | None = None
    cost_amount: Cost | None = None
    currency: Currency = None
    description: OptStr = None
    reference_url: Url = None


class LegCreate(LegFields):
    from_stop_id: uuid.UUID
    to_stop_id: uuid.UUID


class LegUpdate(LegFields):
    pass


class LegOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    day_id: uuid.UUID
    from_stop_id: uuid.UUID
    to_stop_id: uuid.UUID
    is_active: bool
    transport_mode: str | None
    route_name: str | None
    duration_minutes: int | None
    cost_amount: Decimal | None
    currency: str | None
    description: str | None
    reference_url: str | None
    updated_at: datetime


class ProjectBundle(BaseModel):
    project: ProjectOut
    days: list[DayOut]
    stops: list[StopOut]
    legs: list[LegOut]


class PublicConfig(BaseModel):
    tile_url: str
    tile_attribution: str
    tile_max_zoom: int
    default_timezone: str
    transport_modes: list[str]
    google_places_enabled: bool = False
