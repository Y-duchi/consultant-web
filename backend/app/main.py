from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health, manager, storage
from app.settings import get_settings


settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
  CORSMiddleware,
  allow_origins=settings.cors_origins,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(manager.router, prefix="/api/manager", tags=["manager"])
app.include_router(storage.router, prefix="/api/storage", tags=["storage"])
