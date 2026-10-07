from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.auth.router import router as auth_router
from app.categories.router import router as categories_router
from app.dashboard.router import router as dashboard_router
from app.projects.router import router as projects_router
from app.statuses.router import router as status_router
from app.statuses.router import stages_router as status_stages_router
from app.statuses.router import statuses_router as statuses_top_router
from app.tasks.router import router as tasks_router
from app.users.router import router as users_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.db import init_db

    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="NRG Projects", lifespan=lifespan)
    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(categories_router)
    app.include_router(projects_router)
    app.include_router(dashboard_router)
    app.include_router(status_router)
    app.include_router(status_stages_router)
    app.include_router(statuses_top_router)
    app.include_router(tasks_router)

    @app.get("/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
