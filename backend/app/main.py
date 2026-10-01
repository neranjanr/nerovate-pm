from fastapi import FastAPI

from app.auth.router import router as auth_router
from app.projects.router import router as projects_router
from app.statuses.router import router as status_router
from app.users.router import router as users_router


def create_app() -> FastAPI:
    app = FastAPI(title="NRG Projects")
    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(projects_router)
    app.include_router(status_router)

    @app.get("/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
