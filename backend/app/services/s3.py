from pathlib import PurePosixPath
from uuid import uuid4

import boto3
from botocore.config import Config

from app.settings import Settings


PREFIX_BY_FOLDER = {
  "business-verifications": "s3_business_verifications_prefix",
  "credentials": "s3_credentials_prefix",
  "expert-profiles": "s3_expert_profiles_prefix",
  "chat-attachments": "s3_chat_attachments_prefix",
  "user-reports": "s3_user_reports_prefix",
}


def create_s3_client(settings: Settings):
  client_kwargs = {
    "region_name": settings.aws_region,
    "config": Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
  }

  if settings.aws_profile_name:
    return boto3.Session(profile_name=settings.aws_profile_name).client("s3", **client_kwargs)

  if settings.aws_access_key_id and settings.aws_secret_access_key and not settings.aws_use_iam_role:
    client_kwargs.update(
      {
        "aws_access_key_id": settings.aws_access_key_id,
        "aws_secret_access_key": settings.aws_secret_access_key,
        "aws_session_token": settings.aws_session_token,
      },
    )

  return boto3.client("s3", **client_kwargs)


def create_presigned_upload(settings: Settings, folder: str, filename: str, content_type: str):
  extension = ""

  if "." in filename:
    extension = "." + filename.rsplit(".", 1)[1].lower()

  prefix_attr = PREFIX_BY_FOLDER[folder]
  prefix = getattr(settings, prefix_attr).strip("/")
  object_key = str(PurePosixPath(prefix) / f"{uuid4()}{extension}")

  upload_url = create_s3_client(settings).generate_presigned_url(
    "put_object",
    Params={
      "Bucket": settings.s3_bucket_name,
      "Key": object_key,
      "ContentType": content_type,
    },
    ExpiresIn=900,
  )

  return {
    "bucket": settings.s3_bucket_name,
    "objectKey": object_key,
    "uploadUrl": upload_url,
    "method": "PUT",
    "expiresIn": 900,
    "contentType": content_type,
  }
