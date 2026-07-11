from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.partner_applications import (
  PartnerApplication,
  PartnerApplicationApprovalRequest,
  PartnerApplicationApprovalResult,
  PartnerApplicationCreate,
)
from app.services import real_workspace


def application_row(**overrides):
  row = {
    "id": "11111111-1111-1111-1111-111111111111",
    "email": "artist@example.com",
    "name": "김아티스트",
    "title": "퍼스널컬러 전문가",
    "studio_name": "아티스트 스튜디오",
    "phone": "010-1234-5678",
    "message": "입점 신청",
    "partner_type": "freelancer",
    "business_registration_number": None,
    "specialties": ["퍼스널컬러"],
    "categories": ["퍼스널컬러"],
    "category_ids": ["personalColor"],
    "introduction": "AI 리포트 기반 상담",
    "consulting_modes": ["online"],
    "price_30_min": 19000,
    "price_60_min": 34000,
    "online_price_30_min": 19000,
    "online_price_60_min": 34000,
    "offline_price_30_min": None,
    "offline_price_60_min": None,
    "offline_address": None,
    "offline_detail_address": None,
    "offline_location_note": None,
    "business_registration_file_name": "사업자등록증.pdf",
    "business_registration_storage_key": "business-verifications/business.pdf",
    "beauty_license_file_name": "미용사면허증.pdf",
    "beauty_license_storage_key": "credentials/license.pdf",
    "additional_certificate_file_names": [],
    "additional_certificate_storage_keys": [],
    "status": "submitted",
    "expert_id": None,
    "rejection_reason": None,
    "review_memo": None,
    "reviewer_name": None,
    "reviewed_by_subject": None,
    "reviewed_at": None,
    "generated_account_id": None,
    "created_at": datetime.now(timezone.utc),
    "updated_at": datetime.now(timezone.utc),
  }
  row.update(overrides)
  return row


class FakeConnection:
  def __init__(self):
    self.application = application_row()
    self.execute_calls: list[tuple[str, tuple]] = []
    self.fetchrow_calls: list[tuple[str, tuple]] = []

  @asynccontextmanager
  async def transaction(self):
    yield

  async def execute(self, query: str, *args):
    self.execute_calls.append((query, args))
    return "OK"

  async def fetchval(self, query: str, *args):
    return 3

  async def fetchrow(self, query: str, *args):
    self.fetchrow_calls.append((query, args))
    normalized = " ".join(query.lower().split())
    if "insert into consulting_partner_applications" in normalized:
      return self.application
    if "select * from consulting_partner_applications where id::text" in normalized:
      return self.application
    if "from consulting_partner_applications" in normalized and "for update" in normalized:
      return self.application
    if "insert into consulting_partner_accounts" in normalized:
      return {
        "id": "22222222-2222-2222-2222-222222222222",
        "expert_id": args[0],
        "email": args[1],
        "role": args[4],
        "workspace_scope": args[5],
        "status": "invited",
        "password_change_required": True,
        "created_at": datetime.now(timezone.utc),
      }
    if "update consulting_partner_applications" in normalized:
      self.application = application_row(
        status="approved",
        expert_id=args[1],
        generated_account_id=args[2],
        review_memo=args[3],
        reviewer_name=args[4],
        reviewed_at=datetime.now(timezone.utc),
      )
      return self.application
    raise AssertionError(f"Unexpected query: {query}")

  async def close(self):
    return None


class CredentialReissueConnection:
  def __init__(self):
    self.application = application_row(
      status="approved",
      expert_id="exp-approved",
      generated_account_id="22222222-2222-2222-2222-222222222222",
      reviewed_at=datetime.now(timezone.utc),
    )
    self.execute_calls: list[tuple[str, tuple]] = []
    self.fetchrow_calls: list[tuple[str, tuple]] = []

  @asynccontextmanager
  async def transaction(self):
    yield

  async def execute(self, query: str, *args):
    self.execute_calls.append((query, args))
    return "OK"

  async def fetchrow(self, query: str, *args):
    self.fetchrow_calls.append((query, args))
    normalized = " ".join(query.lower().split())
    if "from consulting_partner_applications" in normalized and "status = 'approved'" in normalized:
      return self.application
    if "update consulting_partner_accounts" in normalized:
      return {
        "id": "22222222-2222-2222-2222-222222222222",
        "expert_id": "exp-approved",
        "email": "approved@example.com",
        "role": "expert",
        "workspace_scope": "expert_personal",
        "status": "invited",
        "password_change_required": True,
        "created_at": datetime.now(timezone.utc),
      }
    raise AssertionError(f"Unexpected query: {query}")

  async def close(self):
    return None


@pytest.mark.asyncio
async def test_public_application_is_saved_to_rds(monkeypatch: pytest.MonkeyPatch) -> None:
  connection = FakeConnection()

  async def connect():
    return connection

  monkeypatch.setattr(real_workspace, "_connect", connect)
  payload = PartnerApplicationCreate(
    partner_type="freelancer",
    business_name="아티스트 스튜디오",
    owner_name="김아티스트",
    phone="010-1234-5678",
    email="artist@example.com",
    specialties=["퍼스널컬러"],
    categories=["퍼스널컬러"],
    price_30_min=19000,
    price_60_min=34000,
    business_registration_file_name="사업자등록증.pdf",
    business_registration_storage_key="business-verifications/business.pdf",
  )

  application = await real_workspace.create_partner_application(payload)

  assert application["status"] == "submitted"
  assert application["documents"][0]["file_name"] == "사업자등록증.pdf"
  assert application["documents"][0]["storage_key"] == "business-verifications/business.pdf"
  PartnerApplication.model_validate(application)
  query, args = connection.fetchrow_calls[0]
  assert "insert into consulting_partner_applications" in query
  assert args[10] == ["personalColor"]


def test_application_requires_only_business_registration_document() -> None:
  common_payload = {
    "partner_type": "freelancer",
    "business_name": "아티스트 스튜디오",
    "owner_name": "김아티스트",
    "phone": "010-1234-5678",
    "email": "artist@example.com",
    "price_30_min": 19000,
    "price_60_min": 34000,
  }

  application = PartnerApplicationCreate(
    **common_payload,
    business_registration_file_name="사업자등록증.pdf",
    business_registration_storage_key="business-verifications/business.pdf",
  )
  assert application.business_registration_file_name == "사업자등록증.pdf"
  assert application.business_registration_storage_key == "business-verifications/business.pdf"
  assert application.beauty_license_file_name is None
  assert application.additional_certificate_file_names == []

  with pytest.raises(ValidationError, match="사업자등록증 PDF는 필수입니다"):
    PartnerApplicationCreate(**common_payload)

  with pytest.raises(ValidationError, match="사업자등록증 파일 업로드를 완료해 주세요"):
    PartnerApplicationCreate(**common_payload, business_registration_file_name="사업자등록증.pdf")


@pytest.mark.asyncio
async def test_document_access_uses_rds_storage_key(monkeypatch: pytest.MonkeyPatch) -> None:
  connection = FakeConnection()

  async def connect():
    return connection

  monkeypatch.setattr(real_workspace, "_connect", connect)
  monkeypatch.setattr(real_workspace, "get_settings", lambda: SimpleNamespace(s3_configured=True))
  monkeypatch.setattr(
    real_workspace,
    "create_presigned_download",
    lambda settings, storage_key, file_name: {
      "access_url": f"https://signed.example/{storage_key}",
      "expires_in_minutes": 10,
    },
  )
  result = await real_workspace.create_partner_application_document_access(
    "11111111-1111-1111-1111-111111111111:business_registration:0",
  )

  assert result["file_name"] == "사업자등록증.pdf"
  assert result["access_url"] == "https://signed.example/business-verifications/business.pdf"
  assert result["expires_in_minutes"] == 10


@pytest.mark.asyncio
async def test_approval_creates_expert_account_and_temporary_password(monkeypatch: pytest.MonkeyPatch) -> None:
  connection = FakeConnection()

  async def connect():
    return connection

  monkeypatch.setattr(real_workspace, "_connect", connect)
  result = await real_workspace.approve_partner_application(
    "11111111-1111-1111-1111-111111111111",
    PartnerApplicationApprovalRequest(
      review_memo="서류 확인 완료",
      reviewer_name="플랫폼 관리자",
      account_email="approved@example.com",
    ),
  )

  assert result["application"]["status"] == "approved"
  assert result["application"]["business_id"].startswith("freelancer:exp_")
  assert result["account"]["email"] == "approved@example.com"
  assert result["account"]["password_change_required"] is True
  assert result["member"]["expert_id"] == result["account"]["expert_id"]
  PartnerApplicationApprovalResult.model_validate(result)

  account_query, account_args = next(
    (query, args)
    for query, args in connection.fetchrow_calls
    if "insert into consulting_partner_accounts" in query
  )
  assert "password_hash" in account_query
  assert real_workspace._verify_password(
    result["account"]["temporary_password"],
    account_args[3],
    account_args[2],
  )
  assert any("insert into consulting_experts" in query for query, _ in connection.execute_calls)
  assert any("insert into consulting_expert_durations" in query for query, _ in connection.execute_calls)


@pytest.mark.asyncio
async def test_reissue_partner_credentials_replaces_password_and_revokes_sessions(monkeypatch: pytest.MonkeyPatch) -> None:
  connection = CredentialReissueConnection()

  async def connect():
    return connection

  monkeypatch.setattr(real_workspace, "_connect", connect)
  result = await real_workspace.reissue_partner_credentials("11111111-1111-1111-1111-111111111111")

  assert result["application"]["status"] == "approved"
  assert result["account"]["status"] == "invited"
  assert result["account"]["password_change_required"] is True
  assert result["account"]["delivered_by"] == "manual"
  PartnerApplicationApprovalResult.model_validate(result)

  account_query, account_args = next(
    (query, args)
    for query, args in connection.fetchrow_calls
    if "update consulting_partner_accounts" in query
  )
  assert "password_change_required = true" in account_query
  assert real_workspace._verify_password(
    result["account"]["temporary_password"],
    account_args[2],
    account_args[1],
  )
  assert any("delete from consulting_partner_sessions" in query for query, _ in connection.execute_calls)
