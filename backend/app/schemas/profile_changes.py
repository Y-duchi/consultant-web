from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class ProfileChangeTarget(str, Enum):
  business = "business"
  expert = "expert"


class ProfileChangeStatus(str, Enum):
  submitted = "submitted"
  needs_update = "needs_update"
  approved = "approved"
  rejected = "rejected"


class ProfileAvatarUploadRequest(BaseModel):
  file_name: str = Field(min_length=1, max_length=255)
  content_type: str = Field(pattern=r"^image/(jpeg|png|webp)$")
  size_bytes: int = Field(gt=0, le=10 * 1024 * 1024)


class ProfileChangeDecision(BaseModel):
  review_memo: str = Field(min_length=1, max_length=2000)
  reviewer_name: str = Field(default="플랫폼 관리자", min_length=1, max_length=100)


class ProfileChangeRequest(BaseModel):
  id: str
  account_id: str
  expert_id: str
  requester_email: str
  target_type: ProfileChangeTarget
  status: ProfileChangeStatus
  current_snapshot: dict[str, Any]
  proposed_changes: dict[str, Any]
  avatar_file_name: str | None = None
  avatar_content_type: str | None = None
  review_memo: str | None = None
  reviewer_name: str | None = None
  submitted_at: str
  updated_at: str
  reviewed_at: str | None = None
  last_email_notification_type: str | None = None
  last_email_notification_status: str | None = None
  last_email_notification_error: str | None = None
  last_email_notification_sent_at: str | None = None


class ProfileImageAccessResult(BaseModel):
  file_name: str
  access_url: str
  expires_in_minutes: int
