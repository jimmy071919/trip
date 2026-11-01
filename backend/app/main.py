import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from sqlalchemy import func, select, text

from . import errors
from .config import get_settings
from .db import SessionLocal
from .models import TRANSPORT_MODES, User
from .routers import auth, items, places, projects
from .schemas import PublicConfig
from .security import hash_password

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


def bootstrap_admin() -> None:
    """Create the initial admin from env vars if there are no users yet."""
    s = get_settings()
    if not (s.admin_username and s.admin_password):
        return
    with SessionLocal() as db:
        if (db.scalar(select(func.count()).select_from(User)) or 0) == 0:
            db.add(User(username=s.admin_username, password_hash=hash_password(s.admin_password)))
            db.commit()
            log.info("Initial admin user %r created from environment", s.admin_username)


def create_app() -> FastAPI:
    s = get_settings()
    if s.secret_key.startswith("dev-insecure"):
        log.warning("SECRET_KEY is not set; using an insecure development key")
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        bootstrap_admin()
        yield

    app = FastAPI(
        lifespan=lifespan,
        title="Map Trip Planner API",
        version="1.0.0",
        docs_url="/api/v1/docs" if s.enable_docs else None,
        redoc_url=None,
        openapi_url="/api/v1/openapi.json" if s.enable_docs else None,
    )
    errors.install(app)

    api = APIRouter(prefix="/api/v1")

    @api.get("/health", tags=["system"])
    def health():
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ok"}

    @api.get("/config", response_model=PublicConfig, tags=["system"])
    def public_config():
        return PublicConfig(
            tile_url=s.tile_url,
            tile_attribution=s.tile_attribution,
            tile_max_zoom=s.tile_max_zoom,
            default_timezone=s.default_timezone,
            transport_modes=list(TRANSPORT_MODES),
            google_places_enabled=bool(s.google_maps_api_key),
        )

    api.include_router(auth.router)
    api.include_router(projects.router)
    api.include_router(items.router)
    api.include_router(places.router)
    app.include_router(api)

    return app


app = create_app()
