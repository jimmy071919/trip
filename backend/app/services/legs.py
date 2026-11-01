"""Leg (route segment) maintenance.

Rule set (SRS LEG-01, LEG-06, AC-04, AC-05):
* Within a day, every pair of adjacent stops (by sort_order) has exactly one
  *active* leg, identified by (day_id, from_stop_id, to_stop_id).
* A leg is never re-pointed to a different pair. When a pair stops being
  adjacent, its leg is kept as inactive if it carries user-entered data (so the
  data comes back if the order is restored) or deleted if empty.
* Legs whose stops are no longer in the day are deleted.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Leg, Stop


def ordered_day_stops(db: Session, day_id: uuid.UUID) -> list[Stop]:
    return list(
        db.scalars(
            select(Stop)
            .where(Stop.day_id == day_id)
            .order_by(Stop.sort_order.asc().nulls_last(), Stop.created_at, Stop.id)
        )
    )


def ordered_unscheduled_stops(db: Session, project_id: uuid.UUID) -> list[Stop]:
    return list(
        db.scalars(
            select(Stop)
            .where(Stop.project_id == project_id, Stop.day_id.is_(None))
            .order_by(Stop.sort_order.asc().nulls_last(), Stop.created_at, Stop.id)
        )
    )


def renumber(stops: list[Stop]) -> None:
    for i, s in enumerate(stops):
        if s.sort_order != i:
            s.sort_order = i


def sync_day_legs(db: Session, project_id: uuid.UUID, day_id: uuid.UUID) -> None:
    """Re-number stops of the day and reconcile its legs. Caller commits."""
    db.flush()
    stops = ordered_day_stops(db, day_id)
    renumber(stops)
    stop_ids = {s.id for s in stops}
    wanted = [(a.id, b.id) for a, b in zip(stops, stops[1:])]
    wanted_set = set(wanted)

    existing = list(db.scalars(select(Leg).where(Leg.day_id == day_id)))
    seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for leg in existing:
        pair = (leg.from_stop_id, leg.to_stop_id)
        if leg.from_stop_id not in stop_ids or leg.to_stop_id not in stop_ids:
            db.delete(leg)
        elif pair in wanted_set:
            leg.is_active = True
            seen.add(pair)
        elif leg.has_content():
            leg.is_active = False
        else:
            db.delete(leg)

    for from_id, to_id in wanted:
        if (from_id, to_id) not in seen:
            db.add(Leg(project_id=project_id, day_id=day_id, from_stop_id=from_id, to_stop_id=to_id, is_active=True))
    db.flush()


def sync_unscheduled(db: Session, project_id: uuid.UUID) -> None:
    db.flush()
    renumber(ordered_unscheduled_stops(db, project_id))
    db.flush()
