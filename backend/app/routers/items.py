"""Endpoints addressed by day / stop / leg id."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, get_day, get_leg, get_stop
from ..errors import bad_request
from ..models import Day, Leg, Stop, User
from ..schemas import DayOut, DayUpdate, LegCreate, LegOut, LegUpdate, StopOrderIn, StopOut, StopUpdate
from ..services.legs import ordered_day_stops, ordered_unscheduled_stops, sync_day_legs, sync_unscheduled

router = APIRouter(tags=["items"])


def _require_not_null(data: dict, keys: tuple[str, ...]) -> None:
    for k in keys:
        if k in data and data[k] is None:
            raise bad_request("欄位不可為空", {k: "此欄位為必填"})


# ---------- days ----------
@router.patch("/days/{day_id}", response_model=DayOut)
def update_day(day_id: uuid.UUID, body: DayUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    d = get_day(day_id, db, user)
    data = body.model_dump(exclude_unset=True)
    _require_not_null(data, ("sort_order",))
    for k, v in data.items():
        setattr(d, k, v)
    db.commit()
    return d


@router.delete("/days/{day_id}", status_code=204)
def delete_day(day_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Delete a day. Its stops become unscheduled; its legs are removed."""
    d = get_day(day_id, db, user)
    project_id = d.project_id
    start = len(ordered_unscheduled_stops(db, project_id))
    for i, s in enumerate(ordered_day_stops(db, d.id)):
        s.day_id = None
        s.sort_order = start + i
    db.query(Leg).filter(Leg.day_id == d.id).delete(synchronize_session=False)
    db.flush()
    db.delete(d)
    sync_unscheduled(db, project_id)
    db.commit()


@router.put("/days/{day_id}/stop-order", response_model=list[StopOut])
def set_stop_order(
    day_id: uuid.UUID, body: StopOrderIn, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    """Atomically set the stop order of a day and rebuild its legs.

    The list must contain every stop currently in the day; it may also contain
    stops from elsewhere in the project, which are moved into this day.
    """
    d = get_day(day_id, db, user)
    current = {s.id: s for s in ordered_day_stops(db, d.id)}
    missing = set(current) - set(body.stop_ids)
    if missing:
        raise bad_request("排序清單缺少此日期中的地點", {"stop_ids": "清單與目前地點不一致，請重新整理"})

    touched_days: set[uuid.UUID] = set()
    touched_unscheduled = False
    for idx, sid in enumerate(body.stop_ids):
        s = current.get(sid) or db.get(Stop, sid)
        if not s or s.project_id != d.project_id:
            raise bad_request("排序清單含有無效地點", {"stop_ids": f"地點 {sid} 不屬於此專案"})
        if s.day_id != d.id:
            if s.day_id:
                touched_days.add(s.day_id)
            else:
                touched_unscheduled = True
            s.day_id = d.id
        s.sort_order = idx
    db.flush()
    for other in touched_days:
        sync_day_legs(db, d.project_id, other)
    if touched_unscheduled:
        sync_unscheduled(db, d.project_id)
    sync_day_legs(db, d.project_id, d.id)
    db.commit()
    return ordered_day_stops(db, d.id)


# ---------- stops ----------
@router.patch("/stops/{stop_id}", response_model=StopOut)
def update_stop(stop_id: uuid.UUID, body: StopUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = get_stop(stop_id, db, user)
    data = body.model_dump(exclude_unset=True)
    _require_not_null(data, ("title", "latitude", "longitude"))

    old_day = s.day_id
    if "day_id" in data and data["day_id"] != old_day:
        new_day = data["day_id"]
        if new_day is not None:
            day = db.get(Day, new_day)
            if not day or day.project_id != s.project_id:
                raise bad_request("日期不屬於此專案", {"day_id": "無效的日期"})
            filt = Stop.day_id == new_day
        else:
            filt = Stop.day_id.is_(None)
        s.sort_order = (
            db.scalar(select(func.coalesce(func.max(Stop.sort_order), -1)).where(Stop.project_id == s.project_id, filt))
        ) + 1
    for k, v in data.items():
        setattr(s, k, v)
    db.flush()
    if s.day_id != old_day:
        if old_day:
            sync_day_legs(db, s.project_id, old_day)
        else:
            sync_unscheduled(db, s.project_id)
        if s.day_id:
            sync_day_legs(db, s.project_id, s.day_id)
        else:
            sync_unscheduled(db, s.project_id)
    db.commit()
    return s


@router.delete("/stops/{stop_id}", status_code=204)
def delete_stop(stop_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Delete a stop; legs touching it are removed and the day's legs rebuilt (A→B→C minus B ⇒ A→C)."""
    s = get_stop(stop_id, db, user)
    project_id, day_id = s.project_id, s.day_id
    db.query(Leg).filter((Leg.from_stop_id == s.id) | (Leg.to_stop_id == s.id)).delete(synchronize_session=False)
    db.delete(s)
    db.flush()
    if day_id:
        sync_day_legs(db, project_id, day_id)
    else:
        sync_unscheduled(db, project_id)
    db.commit()


# ---------- legs ----------
@router.get("/days/{day_id}/legs", response_model=list[LegOut])
def list_day_legs(
    day_id: uuid.UUID, include_inactive: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    d = get_day(day_id, db, user)
    q = select(Leg).where(Leg.day_id == d.id)
    if not include_inactive:
        q = q.where(Leg.is_active.is_(True))
    return db.scalars(q).all()


@router.post("/days/{day_id}/legs", response_model=LegOut)
def upsert_day_leg(
    day_id: uuid.UUID, body: LegCreate, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    """Record transport for an adjacent pair. Legs are managed by stop order, so
    the pair must currently be adjacent; the existing leg is updated."""
    d = get_day(day_id, db, user)
    stops = ordered_day_stops(db, d.id)
    pairs = {(a.id, b.id) for a, b in zip(stops, stops[1:])}
    if (body.from_stop_id, body.to_stop_id) not in pairs:
        raise bad_request(
            "路段由地點順序自動產生；此起訖點目前不相鄰", {"to_stop_id": "起訖地點必須為同一日期內相鄰的地點"}
        )
    sync_day_legs(db, d.project_id, d.id)
    leg = db.scalar(
        select(Leg).where(Leg.day_id == d.id, Leg.from_stop_id == body.from_stop_id, Leg.to_stop_id == body.to_stop_id)
    )
    for k, v in body.model_dump(exclude={"from_stop_id", "to_stop_id"}, exclude_unset=True).items():
        setattr(leg, k, v)
    db.commit()
    return leg


@router.get("/legs/{leg_id}", response_model=LegOut)
def read_leg(leg_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return get_leg(leg_id, db, user)


@router.patch("/legs/{leg_id}", response_model=LegOut)
def update_leg(leg_id: uuid.UUID, body: LegUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    leg = get_leg(leg_id, db, user)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(leg, k, v)
    db.commit()
    return leg
