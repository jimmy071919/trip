import json
import uuid

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import current_user, get_project
from ..errors import bad_request
from ..models import Day, Leg, Project, Stop, User
from ..schemas import (
    DayCreate,
    DayOut,
    LegOut,
    ProjectBundle,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    StopCreate,
    StopOrderIn,
    StopOut,
)
from ..services.backup import export_project, import_project
from ..services.legs import ordered_unscheduled_stops, sync_day_legs, sync_unscheduled

router = APIRouter(tags=["projects"])

MAX_IMPORT_BYTES = 20 * 1024 * 1024


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.scalars(select(Project).where(Project.owner_id == user.id).order_by(Project.updated_at.desc())).all()


@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    data = body.model_dump()
    if "timezone" not in body.model_fields_set:
        data["timezone"] = get_settings().default_timezone
    p = Project(owner_id=user.id, **data)
    db.add(p)
    db.commit()
    return p


@router.get("/projects/{project_id}", response_model=ProjectOut)
def read_project(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return get_project(project_id, db, user)


@router.get("/projects/{project_id}/bundle", response_model=ProjectBundle)
def read_bundle(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Everything the map editor needs in one request."""
    p = get_project(project_id, db, user)
    return ProjectBundle(
        project=ProjectOut.model_validate(p),
        days=db.scalars(select(Day).where(Day.project_id == p.id).order_by(Day.sort_order, Day.created_at)).all(),
        stops=db.scalars(select(Stop).where(Stop.project_id == p.id).order_by(Stop.sort_order, Stop.created_at)).all(),
        legs=db.scalars(select(Leg).where(Leg.project_id == p.id, Leg.is_active.is_(True))).all(),
    )


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: uuid.UUID, body: ProjectUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    p = get_project(project_id, db, user)
    data = body.model_dump(exclude_unset=True)
    for required in ("title", "timezone"):
        if required in data and data[required] is None:
            raise bad_request("欄位不可為空", {required: "此欄位為必填"})
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    return p


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_project(project_id, db, user)
    # Delete children explicitly (portable across DBs regardless of FK cascade support).
    db.query(Leg).filter(Leg.project_id == p.id).delete(synchronize_session=False)
    db.query(Stop).filter(Stop.project_id == p.id).delete(synchronize_session=False)
    db.query(Day).filter(Day.project_id == p.id).delete(synchronize_session=False)
    db.delete(p)
    db.commit()


# ---------- days ----------
@router.get("/projects/{project_id}/days", response_model=list[DayOut])
def list_days(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_project(project_id, db, user)
    return db.scalars(select(Day).where(Day.project_id == p.id).order_by(Day.sort_order, Day.created_at)).all()


@router.post("/projects/{project_id}/days", response_model=DayOut, status_code=201)
def create_day(
    project_id: uuid.UUID, body: DayCreate, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    p = get_project(project_id, db, user)
    next_order = db.scalar(select(func.coalesce(func.max(Day.sort_order), -1)).where(Day.project_id == p.id)) + 1
    d = Day(project_id=p.id, date=body.date, title=body.title, sort_order=next_order)
    db.add(d)
    db.commit()
    return d


# ---------- stops ----------
@router.get("/projects/{project_id}/stops", response_model=list[StopOut])
def list_stops(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_project(project_id, db, user)
    return db.scalars(select(Stop).where(Stop.project_id == p.id).order_by(Stop.sort_order, Stop.created_at)).all()


@router.post("/projects/{project_id}/stops", response_model=StopOut, status_code=201)
def create_stop(
    project_id: uuid.UUID, body: StopCreate, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    p = get_project(project_id, db, user)
    if body.day_id is not None:
        day = db.get(Day, body.day_id)
        if not day or day.project_id != p.id:
            raise bad_request("日期不屬於此專案", {"day_id": "無效的日期"})
    order_filter = Stop.day_id == body.day_id if body.day_id else Stop.day_id.is_(None)
    next_order = (
        db.scalar(select(func.coalesce(func.max(Stop.sort_order), -1)).where(Stop.project_id == p.id, order_filter))
    ) + 1
    s = Stop(project_id=p.id, sort_order=next_order, **body.model_dump())
    db.add(s)
    db.flush()
    if s.day_id:
        sync_day_legs(db, p.id, s.day_id)
    db.commit()
    return s


@router.put("/projects/{project_id}/unscheduled-order", response_model=list[StopOut])
def reorder_unscheduled(
    project_id: uuid.UUID, body: StopOrderIn, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    p = get_project(project_id, db, user)
    current = ordered_unscheduled_stops(db, p.id)
    if {s.id for s in current} != set(body.stop_ids):
        raise bad_request("排序清單必須剛好包含所有未排程地點", {"stop_ids": "清單與目前地點不一致，請重新整理"})
    pos = {sid: i for i, sid in enumerate(body.stop_ids)}
    for s in current:
        s.sort_order = pos[s.id]
    sync_unscheduled(db, p.id)
    db.commit()
    return sorted(current, key=lambda s: s.sort_order)


# ---------- legs (project-wide convenience) ----------
@router.get("/projects/{project_id}/legs", response_model=list[LegOut])
def list_project_legs(
    project_id: uuid.UUID,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    p = get_project(project_id, db, user)
    q = select(Leg).where(Leg.project_id == p.id)
    if not include_inactive:
        q = q.where(Leg.is_active.is_(True))
    return db.scalars(q).all()


# ---------- backup ----------
@router.get("/projects/{project_id}/export")
def export(project_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = get_project(project_id, db, user)
    data = export_project(db, p)
    safe = "".join(c for c in p.title if c.isalnum() or c in "-_") or "project"
    return JSONResponse(
        data,
        headers={
            "Content-Disposition": f"attachment; filename=\"trip-{p.id}.json\"; filename*=UTF-8''{_quote(safe)}.json"
        },
    )


def _quote(s: str) -> str:
    from urllib.parse import quote

    return quote(s)


@router.post("/projects/import", response_model=ProjectOut, status_code=201)
async def import_(
    file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(current_user)
):
    raw = await file.read(MAX_IMPORT_BYTES + 1)
    if len(raw) > MAX_IMPORT_BYTES:
        raise bad_request("備份檔過大（上限 20MB）", {"file": "檔案過大"})
    try:
        payload = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise bad_request("無法解析 JSON 檔案", {"file": "不是有效的 JSON"}) from None
    p = import_project(db, user, payload)
    db.commit()
    return p
