"""FastAPI entry point. Run from backend with python -m uvicorn app.main:app."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .api import router
from .config import Settings
from .schedule_api import router as schedule_router

settings = Settings()

app = FastAPI(title=settings.app_name, version="0.1.0")

@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    """Keep the prototype's 400/error contract with extra field-level details."""
    details = [{"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]}
               for item in error.errors()]
    return JSONResponse(status_code=400, content={
        "error": "; ".join(item["msg"] for item in details), "details": details,
    })


@app.exception_handler(HTTPException)
async def http_error(request: Request, error: HTTPException):
    return JSONResponse(status_code=error.status_code, content={"error": error.detail}, headers=error.headers)


@app.middleware("http")
async def validate_plan_body(request: Request, call_next):
    if request.method == "POST" and request.url.path in ("/api/plan", "/schedule"):
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            return JSONResponse(status_code=415, content={"error": "Content-Type must be application/json"})
        body = await request.body()
        if not 0 < len(body) <= 1_000_000:
            return JSONResponse(status_code=400, content={"error": "Request body must be between 1 and 1000000 bytes"})
    return await call_next(request)


app.include_router(router)
app.include_router(schedule_router)

# Register last so browser CORS headers also cover early validation responses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health", tags=["Health"])
def health() -> dict[str, str]:
    """Confirm that the API process is running."""
    return {"status": "ok"}
