from dataclasses import asdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..deps import current_user
from ..errors import bad_request
from ..models import User
from ..services import gmaps

router = APIRouter(prefix="/places", tags=["places"])


class ResolveIn(BaseModel):
    url: str = Field(min_length=1, max_length=4000)


class PlaceOut(BaseModel):
    name: str | None
    latitude: float | None
    longitude: float | None
    precise: bool
    address: str | None
    phone: str | None
    website: str | None
    opening_hours: list[str]
    rating: float | None
    google_maps_url: str | None
    source: str
    warnings: list[str]


@router.post("/resolve-google-link", response_model=PlaceOut)
def resolve_google_link(body: ResolveIn, _: User = Depends(current_user)):
    """Parse a Google Maps share link (full or maps.app.goo.gl short link)."""
    try:
        place = gmaps.resolve(body.url)
    except gmaps.LinkError as e:
        raise bad_request(str(e), {"url": str(e)}) from None
    return PlaceOut(**{k: v for k, v in asdict(place).items() if k in PlaceOut.model_fields})
