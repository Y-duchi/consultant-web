from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import admin, applications, consulting, health, manager, partner, storage
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
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(partner.router, prefix="/api/partner", tags=["partner"])
app.include_router(consulting.router, prefix="/api/consulting", tags=["consulting-app"])
app.include_router(manager.router, prefix="/api/manager", tags=["manager"])
app.include_router(applications.router, prefix="/api/partner-applications", tags=["partner-applications"])
app.include_router(storage.router, prefix="/api/storage", tags=["storage"])
