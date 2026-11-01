"""Project JSON export / import (SRS SYS-03, AC-07)."""

import uuid
import datetime as dt
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..errors import bad_request
from ..models import Day, Leg, Project, Stop, User
from .legs import sync_day_legs, sync_unscheduled

FORMAT = "map-trip-planner"
VERSION = 1


class _ProjectIn(BaseModel):
    title: schemas.Title
    description: schemas.OptStr = None
    timezone: str = "Asia/Taipei"
    map_center_lat: schemas.Lat | None = None
    map_center_lon: schemas.Lon | None = None
    map_zoom: schemas.Zoom | None = None


class _DayIn(BaseModel):
    id: uuid.UUID
    date: dt.date | None = None
    title: schemas.OptStr = None
    sort_order: int = 0


class _StopIn(schemas.StopFields):
    id: uuid.UUID
    day_id: uuid.UUID | None = None
    title: schemas.Title
    latitude: schemas.Lat
    longitude: schemas.Lon
    sort_order: int | None = None


class _LegIn(schemas.LegFields):
    id: uuid.UUID | None = None
    day_id: uuid.UUID
    from_stop_id: uuid.UUID
    to_stop_id: uuid.UUID
    is_active: bool = True


class BackupIn(BaseModel):
    format: Literal["map-trip-planner"]
    version: int = Field(ge=1)
    project: _ProjectIn
    days: list[_DayIn] = []
    stops: list[_StopIn] = []
    legs: list[_LegIn] = []


def _jsonable(v):
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    return v


def export_project(db: Session, project: Project) -> dict:
    days = db.scalars(select(Day).where(Day.project_id == project.id).order_by(Day.sort_order, Day.created_at)).all()
    stops = db.scalars(
        select(Stop).where(Stop.project_id == project.id).order_by(Stop.day_id, Stop.sort_order, Stop.created_at)
    ).all()
    legs = db.scalars(select(Leg).where(Leg.project_id == project.id).order_by(Leg.created_at)).all()

    def pick(obj, keys):
        return {k: _jsonable(getattr(obj, k)) for k in keys}

    return {
        "format": FORMAT,
        "version": VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "project": pick(project, ["title", "description", "timezone", "map_center_lat", "map_center_lon", "map_zoom"]),
        "days": [pick(d, ["id", "date", "title", "sort_order"]) for d in days],
        "stops": [
            pick(
                s,
                [
                    "id", "day_id", "title", "latitude", "longitude", "address", "description",
                    "reference_url", "arrival_time", "stay_minutes", "sort_order",
                ],
            )
            for s in stops
        ],
        "legs": [
            pick(
                leg,
                [
                    "id", "day_id", "from_stop_id", "to_stop_id", "is_active", "transport_mode", "route_name",
                    "duration_minutes", "cost_amount", "currency", "description", "reference_url",
                ],
            )
            for leg in legs
        ],
    }


def _validate(payload: dict) -> BackupIn:
    if not isinstance(payload, dict):
        raise bad_request("備份檔格式錯誤：根節點必須是物件")
    if payload.get("format") != FORMAT:
        raise bad_request("這不是 Map Trip Planner 的備份檔", {"format": "格式識別不符"})
    version = payload.get("version")
    if not isinstance(version, int) or version > VERSION:
        raise bad_request(f"不支援的備份版本：{version}", {"version": f"目前僅支援版本 1～{VERSION}"})
    try:
        data = BackupIn.model_validate(payload)
    except ValidationError as e:
        fields = {}
        for err in e.errors():
            loc = ".".join(str(p) for p in err["loc"])
            msg = err["msg"].removeprefix("Value error, ")
            fields.setdefault(loc, msg)
        raise bad_request("備份檔內容驗證失敗", fields) from None

    errors: dict[str, str] = {}
    day_ids = [d.id for d in data.days]
    if len(set(day_ids)) != len(day_ids):
        errors["days"] = "日期 id 重複"
    stop_ids = [s.id for s in data.stops]
    if len(set(stop_ids)) != len(stop_ids):
        errors["stops"] = "地點 id 重複"
    day_set = set(day_ids)
    stop_day = {s.id: s.day_id for s in data.stops}
    for i, s in enumerate(data.stops):
        if s.day_id is not None and s.day_id not in day_set:
            errors[f"stops.{i}.day_id"] = "參照不存在的日期"
    pairs = set()
    for i, leg in enumerate(data.legs):
        key = f"legs.{i}"
        if leg.day_id not in day_set:
            errors[f"{key}.day_id"] = "參照不存在的日期"
        if leg.from_stop_id not in stop_day or leg.to_stop_id not in stop_day:
            errors[key] = "參照不存在的地點"
            continue
        if leg.from_stop_id == leg.to_stop_id:
            errors[key] = "起訖地點不可相同"
        if stop_day[leg.from_stop_id] != leg.day_id or stop_day[leg.to_stop_id] != leg.day_id:
            errors[key] = "路段起訖地點必須屬於同一日期"
        pair = (leg.day_id, leg.from_stop_id, leg.to_stop_id)
        if pair in pairs:
            errors[key] = "重複的路段"
        pairs.add(pair)
    if errors:
        raise bad_request("備份檔參照完整性驗證失敗", errors)
    return data


def import_project(db: Session, user: User, payload: dict) -> Project:
    data = _validate(payload)
    try:
        schemas._check_tz(data.project.timezone)
        tz = data.project.timezone
    except ValueError:
        tz = "Asia/Taipei"

    project = Project(owner_id=user.id, **data.project.model_dump(exclude={"timezone"}), timezone=tz)
    db.add(project)
    db.flush()

    day_map: dict[uuid.UUID, uuid.UUID] = {}
    for d in data.days:
        new = Day(project_id=project.id, date=d.date, title=d.title, sort_order=d.sort_order)
        db.add(new)
        db.flush()
        day_map[d.id] = new.id

    stop_map: dict[uuid.UUID, uuid.UUID] = {}
    for s in data.stops:
        fields = s.model_dump(exclude={"id", "day_id"})
        new = Stop(project_id=project.id, day_id=day_map.get(s.day_id) if s.day_id else None, **fields)
        db.add(new)
        db.flush()
        stop_map[s.id] = new.id

    for leg in data.legs:
        fields = leg.model_dump(exclude={"id", "day_id", "from_stop_id", "to_stop_id"})
        db.add(
            Leg(
                project_id=project.id,
                day_id=day_map[leg.day_id],
                from_stop_id=stop_map[leg.from_stop_id],
                to_stop_id=stop_map[leg.to_stop_id],
                **fields,
            )
        )
    db.flush()

    # Reconcile so imported state always obeys the adjacency rules.
    for new_day_id in day_map.values():
        sync_day_legs(db, project.id, new_day_id)
    sync_unscheduled(db, project.id)
    return project
