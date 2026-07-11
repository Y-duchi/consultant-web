from fastapi import APIRouter

from app.settings import get_settings


router = APIRouter()


@router.get("/status")
async def manager_status():
  settings = get_settings()
  return {
    "status": "ok",
    "service": "consultant-manager-api",
    "message": "Manager API is ready for real RDS-backed endpoints.",
    "chime": {
      "enabled": settings.chime_enabled,
      "region": settings.effective_chime_region,
      "transcriptionEnabled": settings.effective_consulting_call_transcription_enabled,
      "translationEnabled": settings.effective_consulting_call_translation_enabled,
    },
  }
