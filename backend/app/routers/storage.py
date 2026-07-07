from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException

from app.services.s3 import create_presigned_upload
from app.settings import get_settings


router = APIRouter()


class PresignedUploadRequest(BaseModel):
  folder: str = Field(pattern="^(business-verifications|credentials|expert-profiles|chat-attachments|user-reports)$")
  filename: str
  content_type: str


@router.post("/presigned-upload")
async def presigned_upload(payload: PresignedUploadRequest):
  settings = get_settings()

  if not settings.s3_configured:
    raise HTTPException(status_code=503, detail="S3_BUCKET_NAME is not configured.")

  return create_presigned_upload(settings, payload.folder, payload.filename, payload.content_type)
