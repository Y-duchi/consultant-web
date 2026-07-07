from fastapi import APIRouter


router = APIRouter()


@router.get("/status")
async def manager_status():
  return {
    "status": "ok",
    "service": "consultant-manager-api",
    "message": "Manager API is ready for real RDS-backed endpoints.",
  }
