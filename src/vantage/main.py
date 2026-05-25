import asyncio
import contextlib
import json
import logging
import os
from collections.abc import Callable, Coroutine
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from vantage.routers import api, socket
from vantage.services.perf import VERSION_STRING, PerfMiddleware
from vantage.services.watcher import watch_multi_repo, watch_repo
from vantage.settings import settings

logger = logging.getLogger(__name__)

# Cache the injected index.html so we only do string replacement once.


@asynccontextmanager
async def lifespan(_app: FastAPI):
    import time as _time

    t_start = _time.monotonic()
    logger.info("Vantage %s starting up", VERSION_STRING)

    def _phase(name: str, t0: float) -> float:
        now = _time.monotonic()
        logger.info("[startup] %s done (%.0fms)", name, (now - t0) * 1000)
        return now

    # Warm the repo activity cache BEFORE accepting requests so that
    # the very first /api/repos call returns instantly.
    if settings.multi_repo:
        from vantage.routers.api import warm_repo_cache

        t0 = _time.monotonic()
        await warm_repo_cache()
        t0 = _phase("warm_repo_cache", t0)

    # Start file watcher
    t0 = _time.monotonic()
    if settings.multi_repo:
        watcher_task = asyncio.create_task(watch_multi_repo())
    else:
        watcher_task = asyncio.create_task(watch_repo())
    t0 = _phase("file_watcher", t0)

    # Start background cache refresh (multi-repo only)
    refresh_task = None
    if settings.multi_repo:
        from vantage.routers.api import refresh_repo_cache_loop

        refresh_task = asyncio.create_task(refresh_repo_cache_loop())
        t0 = _phase("refresh_loop", t0)

    logger.info("[startup] ready (total %.0fms)", (_time.monotonic() - t_start) * 1000)
    yield

    # Shutdown
    watcher_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await watcher_task
    if refresh_task:
        refresh_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await refresh_task


app = FastAPI(title="Vantage", lifespan=lifespan)
app.add_middleware(PerfMiddleware)


@app.middleware("http")
async def security_headers(
    request: Request, call_next: Callable[[Request], Coroutine[Any, Any, Response]]
):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


app.include_router(api.router, prefix="/api")
app.include_router(socket.router, prefix="/api")

# Mount frontend static files
# Try multiple locations:
# 1. Bundled in package (for installed package)
# 2. Development location (for dev mode)
frontend_dist = None
possible_paths = [
    # Bundled in package
    os.path.join(os.path.dirname(__file__), "frontend_dist"),
    # Development location
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend", "dist"),
]

for path in possible_paths:
    if os.path.isdir(path):
        frontend_dist = path
        break


def _get_frontend_config() -> dict[str, object]:
    """Build the frontend config dict from current settings."""
    return {
        "disableWhatsNew": settings.disable_whats_new,
    }


def _get_index_html(frontend_dir: str) -> str:
    """Read index.html and inject __VANTAGE_CONFIG__.

    Re-reads from disk every time so that frontend rebuilds (which
    produce new content-hashed JS filenames) take effect without a
    daemon restart.  The file is <2 KB — disk read is negligible.
    """
    index_path = os.path.join(frontend_dir, "index.html")
    with open(index_path) as f:
        html = f.read()

    config_json = json.dumps(_get_frontend_config(), separators=(",", ":"))
    config_script = f"<script>window.__VANTAGE_CONFIG__={config_json}</script>"
    html = html.replace("<head>", f"<head>{config_script}", 1)
    return html


if frontend_dist:
    app.mount(
        "/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets"
    )

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Allow API routes to pass through
        if full_path.startswith("api"):
            return {"error": "Not found"}

        # Check for static files first (favicon, etc.)
        assert frontend_dist is not None
        static_path = os.path.join(frontend_dist, full_path)
        if full_path and os.path.isfile(static_path):
            return FileResponse(static_path)

        # SPA routing — serve index.html with injected config
        assert frontend_dist is not None
        return HTMLResponse(_get_index_html(frontend_dist))
else:

    @app.get("/")
    async def root():
        return {
            "message": "Vantage API is running. Frontend not found. Run 'npm run build' in frontend/ directory to serve UI."
        }
