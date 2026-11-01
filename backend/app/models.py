import uuid
import datetime as dt
from datetime import datetime, time, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

TRANSPORT_MODES = (
    "walk",
    "bicycle",
    "scooter",
    "car",
    "bus",
    "metro",
    "train",
    "taxi",
    "ferry",
    "flight",
    "other",
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("map_center_lat IS NULL OR (map_center_lat >= -90 AND map_center_lat <= 90)", name="ck_projects_lat"),
        CheckConstraint("map_center_lon IS NULL OR (map_center_lon >= -180 AND map_center_lon <= 180)", name="ck_projects_lon"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(Text, nullable=False, default="Asia/Taipei")
    map_center_lat: Mapped[float | None] = mapped_column(Float)
    map_center_lon: Mapped[float | None] = mapped_column(Float)
    map_zoom: Mapped[int | None] = mapped_column(Integer)

    days: Mapped[list["Day"]] = relationship(back_populates="project", cascade="all, delete-orphan", passive_deletes=True)
    stops: Mapped[list["Stop"]] = relationship(back_populates="project", cascade="all, delete-orphan", passive_deletes=True)
    legs: Mapped[list["Leg"]] = relationship(back_populates="project", cascade="all, delete-orphan", passive_deletes=True)


class Day(TimestampMixin, Base):
    __tablename__ = "days"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    title: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    project: Mapped[Project] = relationship(back_populates="days")


class Stop(TimestampMixin, Base):
    __tablename__ = "stops"
    __table_args__ = (
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_stops_lat"),
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_stops_lon"),
        CheckConstraint("stay_minutes IS NULL OR stay_minutes >= 0", name="ck_stops_stay"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    # NULL day_id = unscheduled
    day_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("days.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    address: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    reference_url: Mapped[str | None] = mapped_column(Text)
    arrival_time: Mapped[time | None] = mapped_column(Time)
    stay_minutes: Mapped[int | None] = mapped_column(Integer)
    sort_order: Mapped[int | None] = mapped_column(Integer)

    project: Mapped[Project] = relationship(back_populates="stops")


class Leg(TimestampMixin, Base):
    """Transport record between two consecutive stops of the same day.

    Legs are identified by (day_id, from_stop_id, to_stop_id). When stops are
    re-ordered, a leg whose pair is no longer adjacent becomes inactive
    (is_active = False) instead of being re-attached to a different pair; if
    the pair becomes adjacent again later the recorded data is revived.
    """

    __tablename__ = "legs"
    __table_args__ = (
        UniqueConstraint("day_id", "from_stop_id", "to_stop_id", name="uq_legs_day_pair"),
        CheckConstraint("from_stop_id <> to_stop_id", name="ck_legs_distinct"),
        CheckConstraint("duration_minutes IS NULL OR duration_minutes >= 0", name="ck_legs_duration"),
        CheckConstraint("cost_amount IS NULL OR cost_amount >= 0", name="ck_legs_cost"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    day_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("days.id", ondelete="CASCADE"), nullable=False, index=True)
    from_stop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stops.id", ondelete="CASCADE"), nullable=False)
    to_stop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stops.id", ondelete="CASCADE"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    transport_mode: Mapped[str | None] = mapped_column(String(20))
    route_name: Mapped[str | None] = mapped_column(Text)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    cost_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    description: Mapped[str | None] = mapped_column(Text)
    reference_url: Mapped[str | None] = mapped_column(Text)

    project: Mapped[Project] = relationship(back_populates="legs")

    def has_content(self) -> bool:
        return any(
            v not in (None, "")
            for v in (
                self.transport_mode,
                self.route_name,
                self.duration_minutes,
                self.cost_amount,
                self.currency,
                self.description,
                self.reference_url,
            )
        )
