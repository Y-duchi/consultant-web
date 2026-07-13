from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.schemas.profile_changes import ProfileChangeDecision, ProfileChangeRequest
from app.services import profile_changes
from app.services.auth import PartnerPrincipal


ACCOUNT_ID = "11111111-1111-1111-1111-111111111111"
REQUEST_ID = "22222222-2222-2222-2222-222222222222"
EXPERT_ID = "exp-profile"


def expert_context():
  return {
    "id": EXPERT_ID,
    "requester_email": "partner@example.com",
    "name": "김아티스트",
    "title": "메이크업 전문가",
    "signature_line": "차분한 상담",
    "availability_note": "",
    "studio_name": "기존 스튜디오",
    "partner_type": "freelancer",
    "business_registration_number": "123-45-67890",
    "business_owner_name": "김아티스트",
    "business_description": "기존 소개",
    "phone": "010-1234-5678",
    "business_address": "서울 성동구",
    "intro": "기존 소개",
    "career_years": 5,
    "is_active": True,
    "tags": ["메이크업"],
    "category_labels": ["메이크업"],
    "price_30_min": 19000,
    "price_60_min": 34000,
  }


def request_row(**overrides):
  now = datetime.now(timezone.utc)
  row = {
    "id": REQUEST_ID,
    "account_id": ACCOUNT_ID,
    "expert_id": EXPERT_ID,
    "requester_email": "partner@example.com",
    "target_type": "business",
    "current_snapshot": {
      "name": "기존 스튜디오",
      "partnerType": "freelancer",
      "ownerName": "김아티스트",
      "businessRegistrationNumber": "123-45-67890",
      "phone": "010-1234-5678",
      "address": "서울 성동구",
      "description": "기존 소개",
      "exposureStatus": "public",
    },
    "proposed_changes": {"name": "새 스튜디오"},
    "avatar_bucket": None,
    "avatar_object_key": None,
    "avatar_file_name": None,
    "avatar_content_type": None,
    "status": "submitted",
    "review_memo": None,
    "reviewer_name": None,
    "reviewed_at": None,
    "last_email_notification_type": None,
    "last_email_notification_status": None,
    "last_email_notification_error": None,
    "last_email_notification_sent_at": None,
    "created_at": now,
    "updated_at": now,
  }
  row.update(overrides)
  return row


class ProfileChangeConnection:
  def __init__(self):
    self.request = request_row()
    self.execute_calls: list[tuple[str, tuple]] = []

  @asynccontextmanager
  async def transaction(self):
    yield

  async def execute(self, query: str, *args):
    self.execute_calls.append((query, args))
    return "OK"

  async def fetchrow(self, query: str, *args):
    normalized = " ".join(query.lower().split())
    if "from consulting_partner_accounts a" in normalized:
      return expert_context()
    if "insert into consulting_partner_profile_change_requests" in normalized:
      return self.request
    if "from consulting_partner_profile_change_requests" in normalized and "for update" in normalized:
      return self.request
    if "update consulting_partner_profile_change_requests" in normalized:
      if len(args) >= 4 and args[1] in {"approved", "needs_update", "rejected"}:
        self.request = request_row(
          status=args[1],
          review_memo=args[2],
          reviewer_name=args[3],
          reviewed_at=datetime.now(timezone.utc),
        )
      elif len(args) >= 4:
        self.request = {**self.request, "last_email_notification_type": args[1], "last_email_notification_status": args[2]}
      return self.request
    raise AssertionError(f"Unexpected query: {query}")

  async def fetch(self, query: str, *args):
    return [self.request]

  async def close(self):
    return None


def settings():
  return SimpleNamespace(
    s3_configured=True,
    s3_bucket_name="aura-media",
    s3_expert_profiles_prefix="uploads/expert-profiles/",
    effective_profile_change_admin_email="ops@example.com",
    email_from_address=None,
    frontend_origin="https://partner.example.com",
    cdn_base_url="https://cdn.example.com",
  )


def principal():
  return PartnerPrincipal(
    account_id=ACCOUNT_ID,
    role="expert",
    business_id=f"freelancer:{EXPERT_ID}",
    expert_id=EXPERT_ID,
    workspace_scope="expert_personal",
  )


@pytest.mark.asyncio
async def test_submission_does_not_mutate_public_profile(monkeypatch: pytest.MonkeyPatch) -> None:
  connection = ProfileChangeConnection()

  async def connect():
    return connection

  monkeypatch.setattr(profile_changes.real_workspace, "_connect", connect)
  monkeypatch.setattr(profile_changes, "get_settings", settings)

  result = await profile_changes.submit_profile_change(
    {
      "targetType": "business",
      "expertId": EXPERT_ID,
      "proposedChanges": {"name": "새 스튜디오", "phone": "010-1234-5678"},
    },
    principal(),
  )

  assert result["status"] == "submitted"
  assert result["proposed_changes"] == {"name": "새 스튜디오"}
  assert not any("update consulting_experts set" in query.lower() for query, _ in connection.execute_calls)
  ProfileChangeRequest.model_validate(result)


@pytest.mark.asyncio
async def test_approval_applies_requested_fields(monkeypatch: pytest.MonkeyPatch) -> None:
  connection = ProfileChangeConnection()

  async def connect():
    return connection

  monkeypatch.setattr(profile_changes.real_workspace, "_connect", connect)
  monkeypatch.setattr(profile_changes, "get_settings", settings)

  result = await profile_changes.decide_profile_change(
    REQUEST_ID,
    "approved",
    ProfileChangeDecision(review_memo="업체명 확인 완료", reviewer_name="관리자"),
  )

  assert result["status"] == "approved"
  profile_updates = [call for call in connection.execute_calls if "update consulting_experts set" in call[0].lower()]
  assert len(profile_updates) == 1
  assert "새 스튜디오" in profile_updates[0][1][1]
