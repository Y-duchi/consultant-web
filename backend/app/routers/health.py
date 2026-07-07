from fastapi import APIRouter

from app.db import check_database
from app.settings import get_settings


router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
  return {"status": "ok"}


@router.get("/api/health/config")
async def health_config():
  return get_settings().public_status()


@router.get("/api/health/db")
async def health_db():
  settings = get_settings()

  if not settings.db_configured:
    return {"status": "missing", "message": "Database environment is not configured."}

  try:
    return await check_database(settings)
  except Exception as error:
    return {"status": "error", "errorType": error.__class__.__name__}
