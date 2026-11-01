"""Uniform error envelope: {"error": {"code", "message", "fields"}}."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, fields: dict[str, str] | None = None):
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields or {}


def not_found(what: str = "資源") -> ApiError:
    return ApiError(404, "not_found", f"找不到{what}")


def bad_request(message: str, fields: dict[str, str] | None = None, code: str = "invalid") -> ApiError:
    return ApiError(422, code, message, fields)


def _body(code: str, message: str, fields: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "fields": fields or {}}}


def _loc_to_field(loc: tuple) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path")]
    return ".".join(parts) or "_"


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(_body(exc.code, exc.message, exc.fields), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        fields: dict[str, str] = {}
        for err in exc.errors():
            msg = err.get("msg", "格式錯誤")
            if msg.startswith("Value error, "):
                msg = msg[len("Value error, "):]
            fields.setdefault(_loc_to_field(tuple(err.get("loc", ()))), msg)
        return JSONResponse(_body("validation_error", "輸入資料有誤", fields), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}.get(
            exc.status_code, "http_error"
        )
        return JSONResponse(_body(code, str(exc.detail)), status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):  # pragma: no cover
        import logging

        logging.getLogger("app").exception("Unhandled error", exc_info=exc)
        return JSONResponse(_body("server_error", "伺服器發生錯誤，請稍後再試"), status_code=500)
