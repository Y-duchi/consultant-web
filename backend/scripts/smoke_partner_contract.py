from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path


class DummyHTTPException(Exception):
  def __init__(self, status_code: int, detail: str):
    super().__init__(detail)
    self.status_code = status_code
    self.detail = detail


def install_fastapi_stub() -> None:
  if "fastapi" in sys.modules:
    return

  fastapi = types.ModuleType("fastapi")
  fastapi.HTTPException = DummyHTTPException
  fastapi.Header = lambda default=None, **_: default
  fastapi.Query = lambda default=None, **_: default
  sys.modules["fastapi"] = fastapi


def assert_raises_not_found(callback) -> None:
  try:
    callback()
  except DummyHTTPException as error:
    assert error.status_code == 404, error.status_code
    return
  raise AssertionError("Expected 404 HTTPException")


def assert_raises_status(callback, status_code: int) -> None:
  try:
    callback()
  except DummyHTTPException as error:
    assert error.status_code == status_code, error.status_code
    return
  raise AssertionError(f"Expected {status_code} HTTPException")


def assert_raises_runtime(callback, expected_fragment: str) -> None:
  try:
    callback()
  except RuntimeError as error:
    assert expected_fragment in str(error), str(error)
    return
  raise AssertionError("Expected RuntimeError")


async def read_first_stream_chunk(stream) -> str:
  try:
    return await anext(stream)
  finally:
    await stream.aclose()


def main() -> None:
  install_fastapi_stub()
  backend_root = Path(__file__).resolve().parents[1]
  sys.path.insert(0, str(backend_root))
  schema_sql = (backend_root / "db" / "partner_applications_schema.sql").read_text()
  for required_schema_fragment in (
    "partner_accounts_role_scope_check",
    "business_members_role_scope_check",
    "partner_accounts_id_business_unique",
    "business_members_account_business_fk",
    "partner_accounts_expert_fk",
    "business_members_expert_fk",
  ):
    assert required_schema_fragment in schema_sql, f"Missing DB contract: {required_schema_fragment}"

  from app.schemas.partner_applications import PartnerApplicationApprovalRequest, PartnerApplicationCreate, PartnerApplicationDecision
  from app.services import partner_applications, partner_workspace
  from app.services.auth import AdminPrincipal, PartnerPrincipal, validate_admin_principal, validate_partner_principal

  admin = validate_admin_principal(AdminPrincipal("admin-1", "ADMIN"))
  assert admin.role == "admin"
  assert validate_admin_principal(AdminPrincipal("operator-1", "operator")).role == "operator"
  assert_raises_status(lambda: validate_admin_principal(AdminPrincipal("", "admin")), 401)
  assert_raises_status(lambda: validate_admin_principal(AdminPrincipal("partner-1", "business_manager")), 403)

  normalized_partner = validate_partner_principal(
    PartnerPrincipal("account-1", "BUSINESS_MANAGER", "biz-1", None, "BUSINESS_OPERATIONS")
  )
  assert normalized_partner.role == "business_manager"
  assert normalized_partner.workspace_scope == "business_operations"
  assert_raises_status(
    lambda: validate_partner_principal(PartnerPrincipal("admin-1", "admin", "biz-1", None, "business_operations")),
    403,
  )
  assert_raises_status(
    lambda: validate_partner_principal(PartnerPrincipal("account-1", "business_manager", "platform", None, "business_operations")),
    403,
  )
  assert_raises_status(
    lambda: validate_partner_principal(PartnerPrincipal("expert-1", "expert", "biz-1", None, "expert_personal")),
    403,
  )
  assert_raises_status(
    lambda: validate_partner_principal(PartnerPrincipal("expert-1", "expert", "biz-1", "exp-1", "business_operations")),
    403,
  )
  assert_raises_status(
    lambda: validate_partner_principal(PartnerPrincipal("manager-1", "business_manager", "biz-1", "exp-1", "expert_personal")),
    403,
  )
  assert_raises_status(
    lambda: partner_workspace.list_partner_bookings(PartnerPrincipal("admin-1", "admin", "biz-1", None, "business_operations")),
    403,
  )

  biz_a = PartnerPrincipal("account-1", "business_manager", "biz-1", None, "business_operations")
  biz_b = PartnerPrincipal("account-2", "business_manager", "biz-2", None, "business_operations")
  expert_a = PartnerPrincipal("account-exp-1", "expert", "biz-1", "exp-1", "expert_personal")
  expert_b = PartnerPrincipal("account-exp-4", "expert", "biz-2", "exp-4", "expert_personal")
  expert_empty = PartnerPrincipal("account-exp-2", "expert", "biz-1", "exp-2", "expert_personal")

  assert partner_applications.validate_partner_account_scope(biz_a).account_id == "account-1"
  assert partner_applications.validate_partner_account_scope(expert_a).expert_id == "exp-1"
  assert_raises_status(
    lambda: partner_applications.validate_partner_account_scope(PartnerPrincipal("missing-account", "business_manager", "biz-1", None, "business_operations")),
    403,
  )
  assert_raises_status(
    lambda: partner_applications.validate_partner_account_scope(PartnerPrincipal("account-1", "business_manager", "biz-2", None, "business_operations")),
    403,
  )
  assert_raises_status(
    lambda: partner_applications.validate_partner_account_scope(PartnerPrincipal("account-exp-1", "expert", "biz-1", "exp-2", "expert_personal")),
    403,
  )

  assert all("business_id" not in booking for booking in partner_workspace._bookings), "booking source rows should not duplicate business_id"
  assert {booking["id"] for booking in partner_workspace.list_partner_bookings(biz_a)} == {"book-1", "book-2"}
  assert {booking["id"] for booking in partner_workspace.list_partner_bookings(biz_b)} == {"book-9"}
  assert {booking["business_id"] for booking in partner_workspace.list_partner_bookings(biz_a)} == {"biz-1"}
  assert {booking["business_id"] for booking in partner_workspace.list_partner_bookings(biz_b)} == {"biz-2"}
  assert {booking["id"] for booking in partner_workspace.list_partner_bookings(expert_a)} == {"book-1", "book-2"}
  assert partner_workspace.list_partner_bookings(expert_empty) == []

  assert {customer["id"] for customer in partner_workspace.list_partner_customers(biz_a)} == {"cus-1", "cus-2"}
  assert {customer["id"] for customer in partner_workspace.list_partner_customers(biz_b)} == {"cus-6"}
  assert_raises_not_found(lambda: partner_workspace.get_partner_customer("cus-6", biz_a))
  assert_raises_not_found(lambda: partner_workspace.generate_summary("book-9", {"internal_memo": "cross tenant"}, biz_a))
  assert_raises_status(
    lambda: partner_workspace.create_booking_from_app(
      {
        "id": "book-invalid-business-injection",
        "business_id": "biz-1",
        "expert_id": "exp-4",
        "customer_id": "cus-1",
      }
    ),
    422,
  )

  biz_b_dashboard_before_booking = partner_workspace.partner_dashboard(biz_b)
  created_booking = partner_workspace.create_booking_from_app(
    {
      "id": "book-app-smoke-1",
      "expert_id": "exp-4",
      "customer_id": "cus-1",
      "starts_at": "2026-07-08T18:00:00+09:00",
      "type": "앱 신규 예약 · 전화 30분",
    }
  )
  assert created_booking["business_id"] == "biz-2"
  assert "business_id" not in next(booking for booking in partner_workspace._bookings if booking["id"] == created_booking["id"])
  assert partner_workspace.partner_dashboard(biz_b)["today_booking_count"] == biz_b_dashboard_before_booking["today_booking_count"] + 1
  assert {customer["id"] for customer in partner_workspace.list_partner_customers(biz_b)} == {"cus-1", "cus-6"}
  booking_created_events = [
    event for event in partner_workspace.list_partner_events(biz_b) if event["type"] == "booking.created" and event["booking_id"] == "book-app-smoke-1"
  ]
  assert booking_created_events, "new app booking should emit booking.created"
  assert booking_created_events[0]["business_id"] == "biz-2"
  assert booking_created_events[0]["expert_id"] == "exp-4"
  assert booking_created_events[0]["sequence"] >= 1
  assert booking_created_events[0]["payload"]["status"] == "scheduled"
  assert booking_created_events[0]["payload"]["type"] == "앱 신규 예약 · 전화 30분"
  assert any(event["booking_id"] == "book-app-smoke-1" for event in partner_workspace.list_partner_events(expert_b))
  assert not any(event["booking_id"] == "book-app-smoke-1" for event in partner_workspace.list_partner_events(biz_a))
  assert not any(event["booking_id"] == "book-app-smoke-1" for event in partner_workspace.list_partner_events(expert_a))

  updated_booking = partner_workspace.update_booking_from_app("book-app-smoke-1", {"status": "cancelled"})
  assert updated_booking["status"] == "cancelled"
  booking_events_after_create = partner_workspace.list_partner_events(biz_b, after_id=booking_created_events[0]["id"])
  assert any(event["type"] == "booking.updated" and event["booking_id"] == "book-app-smoke-1" for event in booking_events_after_create)
  booking_updated_event = next(event for event in booking_events_after_create if event["type"] == "booking.updated")
  assert booking_updated_event["sequence"] > booking_created_events[0]["sequence"]
  assert booking_updated_event["payload"]["status"] == "cancelled"
  assert partner_workspace.list_partner_events(biz_b, after_id=booking_updated_event["id"]) == []
  replay_stream = partner_workspace.partner_event_stream(biz_b, after_id=booking_created_events[0]["id"])
  replay_chunk = asyncio.run(read_first_stream_chunk(replay_stream))
  assert f"id: {booking_updated_event['id']}" in replay_chunk
  assert '"type": "booking.updated"' in replay_chunk

  business_wide_event = partner_workspace._record_partner_event(
    "refund.updated",
    "biz-1",
    payload={"status": "manual_review"},
  )
  assert any(event["id"] == business_wide_event["id"] for event in partner_workspace.list_partner_events(biz_a))
  assert not any(event["id"] == business_wide_event["id"] for event in partner_workspace.list_partner_events(expert_a))

  partner_workspace._summaries.insert(
    0,
    {
      "id": "summary-scheduled-smoke",
      "booking_id": "book-1",
      "business_id": "biz-1",
      "expert_id": "exp-1",
      "customer_id": "cus-1",
      "source": "phone_ai",
      "ai_status": "succeeded",
      "ai_model": "mock",
      "transcript": "Scheduled booking transcript should stay private.",
      "internal_memo": "Scheduled booking memo should stay private.",
      "customer_summary": "This should not be visible before completion.",
      "recommendations": "Complete the booking first.",
      "visible_to_customer": True,
      "created_at": "2026-07-08T10:00:00+09:00",
    },
  )
  assert_raises_not_found(lambda: partner_workspace.get_customer_visible_summary("book-1"))
  partner_workspace._summaries[:] = [item for item in partner_workspace._summaries if item["id"] != "summary-scheduled-smoke"]

  original_job_count = len(partner_workspace.list_summary_jobs())
  assert_raises_status(
    lambda: partner_workspace.generate_summary(
      "book-9",
      {
        "transcript": "Please fail this OpenAI summary mock.",
        "visible_to_customer": True,
      },
      biz_b,
    ),
    502,
  )
  failed_jobs = [job for job in partner_workspace.list_summary_jobs() if job["booking_id"] == "book-9" and job["status"] == "failed"]
  assert failed_jobs, "Failed OpenAI mock job should be recorded"
  assert len(partner_workspace.list_summary_jobs()) == original_job_count + 1
  biz_b_events_after_failure = partner_workspace.list_partner_events(biz_b)
  assert any(event["type"] == "summary.failed" and event["booking_id"] == "book-9" for event in biz_b_events_after_failure)
  assert not any(event["booking_id"] == "book-9" for event in partner_workspace.list_partner_events(biz_a))

  generated = partner_workspace.generate_summary(
    "book-9",
    {
      "transcript": "Customer asked for a brow balance consultation.",
      "visible_to_customer": True,
    },
    biz_b,
  )
  public_summary = partner_workspace.get_customer_visible_summary("book-9")
  assert public_summary["id"] == generated["summary"]["id"]
  assert "internal_memo" not in public_summary
  assert "transcript" not in public_summary
  assert next(booking for booking in partner_workspace._bookings if booking["id"] == "book-9")["status"] == "completed"
  retried_jobs = [job for job in partner_workspace.list_summary_jobs() if job["booking_id"] == "book-9" and job["status"] == "succeeded"]
  assert retried_jobs, "Retry should create a succeeded OpenAI mock job"
  biz_b_events_after_retry = partner_workspace.list_partner_events(biz_b)
  assert any(event["type"] == "summary.created" and event["booking_id"] == "book-9" for event in biz_b_events_after_retry)
  assert not any(event["booking_id"] == "book-9" for event in partner_workspace.list_partner_events(expert_a))

  partner_workspace.generate_summary(
    "book-1",
    {
      "internal_memo": "Internal-only follow-up.",
      "visible_to_customer": False,
    },
    biz_a,
  )
  assert_raises_not_found(lambda: partner_workspace.get_customer_visible_summary("book-1"))
  assert any(event["booking_id"] == "book-1" for event in partner_workspace.list_partner_events(expert_a))
  assert not any(event["booking_id"] == "book-1" for event in partner_workspace.list_partner_events(biz_b))

  rollback_application = partner_applications.create_application(
    PartnerApplicationCreate(
      partner_type="business",
      business_name="롤백 검증 스튜디오",
      owner_name="차유나",
      business_registration_number="555-10-99999",
      phone="02-555-9999",
      email="rollback-smoke@aura.example",
      specialties=["메이크업"],
      categories=["메이크업"],
      introduction="승인 트랜잭션 롤백 검증용 신청입니다.",
      price_30_min=18000,
      price_60_min=33000,
      business_registration_file_name="rollback-business.pdf",
      beauty_license_file_name="rollback-license.pdf",
    )
  )
  business_count_before_rollback = len(partner_workspace.list_businesses())
  expert_count_before_rollback = len(partner_workspace.list_experts())
  member_count_before_rollback = len(partner_applications._business_members)
  assert_raises_runtime(
    lambda: partner_applications.approve_application(
      rollback_application.id,
      PartnerApplicationApprovalRequest(
        review_memo="문서 검증 직후 실패를 시뮬레이션합니다.",
        reviewer_name="플랫폼 관리자",
        account_email="rollback-smoke@aura.example",
      ),
      simulate_failure_at="after_document_verification",
    ),
    "after_document_verification",
  )
  rollback_detail = partner_applications.get_application_detail(rollback_application.id)
  assert rollback_detail.application.status == "submitted"
  assert rollback_detail.application.business_id is None
  assert rollback_detail.application.generated_account_id is None
  assert rollback_detail.account is None
  assert all(document.review_status == "pending" for document in rollback_detail.application.documents)
  assert {log.action for log in rollback_detail.review_logs} == {"submitted"}
  assert len(partner_workspace.list_businesses()) == business_count_before_rollback
  assert len(partner_workspace.list_experts()) == expert_count_before_rollback
  assert len(partner_applications._business_members) == member_count_before_rollback
  assert not any(expert.get("email") == "rollback-smoke@aura.example" for expert in partner_workspace.list_experts())
  rollback_status = partner_applications.get_application_status(rollback_application.id)
  assert rollback_status.id == rollback_application.id
  assert rollback_status.status == "submitted"
  assert not hasattr(rollback_status, "documents")
  assert not hasattr(rollback_status, "account")
  assert not hasattr(rollback_status, "review_logs")

  decision_application = partner_applications.create_application(
    PartnerApplicationCreate(
      partner_type="business",
      business_name="상태 전환 검증 스튜디오",
      owner_name="문리나",
      business_registration_number="410-11-22222",
      phone="02-410-2222",
      email="decision-smoke@aura.example",
      specialties=["헤어"],
      categories=["헤어"],
      introduction="입점 심사 상태 전환 검증용 신청입니다.",
      price_30_min=15000,
      price_60_min=28000,
      business_registration_file_name="decision-business.pdf",
      beauty_license_file_name="decision-license.pdf",
    )
  )
  assert_raises_status(
    lambda: partner_applications.request_update(
      decision_application.id,
      PartnerApplicationDecision(review_memo=" ", reviewer_name="플랫폼 관리자"),
    ),
    422,
  )
  needs_update_application = partner_applications.request_update(
    decision_application.id,
    PartnerApplicationDecision(review_memo="미용사 면허증 식별 정보가 흐릿해 재제출이 필요합니다.", reviewer_name="플랫폼 관리자"),
  )
  assert needs_update_application.status == "needs_update"
  rejected_application = partner_applications.reject_application(
    decision_application.id,
    PartnerApplicationDecision(review_memo="보완 기한 내 필수 서류가 확인되지 않았습니다.", reviewer_name="플랫폼 관리자"),
  )
  assert rejected_application.status == "rejected"
  assert_raises_status(
    lambda: partner_applications.request_update(
      decision_application.id,
      PartnerApplicationDecision(review_memo="최종 상태 재변경 시도", reviewer_name="플랫폼 관리자"),
    ),
    409,
  )
  assert_raises_status(
    lambda: partner_applications.approve_application(
      decision_application.id,
      PartnerApplicationApprovalRequest(
        review_memo="반려된 신청 재승인 시도",
        reviewer_name="플랫폼 관리자",
      ),
    ),
    409,
  )

  application_before = partner_applications.get_application_detail("app-sample-1")
  assert application_before.account is None
  approval = partner_applications.approve_application(
    "app-sample-1",
    PartnerApplicationApprovalRequest(
      review_memo="사업자등록증과 미용사 면허증 확인 완료.",
      reviewer_name="플랫폼 관리자",
      account_email="approved-smoke@aura.example",
    ),
  )
  assert approval.application.status == "approved"
  assert approval.application.business_id
  assert approval.account.business_id == approval.application.business_id
  assert approval.account.email == "approved-smoke@aura.example"
  assert approval.account.password_change_required
  assert approval.member.business_id == approval.application.business_id
  assert approval.member.account_id == approval.account.id
  assert approval.member.expert_id is None
  assert approval.member.role == "owner"
  assert approval.member.workspace_scope == "business_operations"
  assert all(document.review_status == "verified" for document in approval.application.documents)

  detail_after = partner_applications.get_application_detail("app-sample-1")
  assert detail_after.member is not None
  assert detail_after.member.id == approval.member.id
  log_actions = {log.action for log in detail_after.review_logs}
  assert {"approved", "account_created"}.issubset(log_actions)
  assert any(business["id"] == approval.application.business_id for business in partner_workspace.list_businesses())
  assert any(expert["business_id"] == approval.application.business_id for expert in partner_workspace.list_experts())
  approved_principal = PartnerPrincipal(
    approval.account.id,
    approval.account.role,
    approval.account.business_id,
    approval.account.expert_id,
    approval.account.workspace_scope.value,
  )
  assert partner_applications.validate_partner_account_scope(approved_principal, allow_password_change_required=True).account_id == approval.account.id
  assert_raises_status(lambda: partner_applications.validate_partner_account_scope(approved_principal), 403)
  assert_raises_status(lambda: partner_applications.complete_password_change(approved_principal, "short"), 422)
  assert_raises_status(
    lambda: partner_applications.complete_password_change(
      PartnerPrincipal("other-account", approval.account.role, approval.account.business_id, approval.account.expert_id, approval.account.workspace_scope.value),
      "AuraSecure!2026",
    ),
    403,
  )
  assert_raises_status(
    lambda: partner_applications.complete_password_change(
      PartnerPrincipal(approval.account.id, approval.account.role, "biz-2", approval.account.expert_id, approval.account.workspace_scope.value),
      "AuraSecure!2026",
    ),
    403,
  )
  password_change = partner_applications.complete_password_change(approved_principal, "AuraSecure!2026")
  assert password_change.account_id == approval.account.id
  assert password_change.status == "active"
  assert not password_change.password_change_required
  assert partner_applications.validate_partner_account_scope(approved_principal).account_id == approval.account.id
  detail_after_password_change = partner_applications.get_application_detail("app-sample-1")
  assert detail_after_password_change.account is not None
  assert detail_after_password_change.account.status == "active"
  assert not detail_after_password_change.account.password_change_required
  assert detail_after_password_change.account.temporary_password == ""

  freelancer_application = partner_applications.create_application(
    PartnerApplicationCreate(
      partner_type="freelancer",
      business_name="프리랜서 이미지 컨설턴트",
      owner_name="오하린",
      phone="010-5555-1212",
      email="freelancer-smoke@aura.example",
      specialties=["퍼스널컬러"],
      categories=["이미지"],
      introduction="개인 전문가 승인 scope smoke.",
      price_30_min=22000,
      price_60_min=40000,
    )
  )
  freelancer_approval = partner_applications.approve_application(
    freelancer_application.id,
    PartnerApplicationApprovalRequest(
      review_memo="프리랜서 전문가 서류 확인.",
      reviewer_name="플랫폼 관리자",
      workspace_scope="business_operations",
    ),
  )
  assert freelancer_approval.account.role == "expert"
  assert freelancer_approval.account.workspace_scope == "expert_personal"
  assert freelancer_approval.account.expert_id
  assert freelancer_approval.member.role == "expert"
  assert freelancer_approval.member.workspace_scope == "expert_personal"
  assert freelancer_approval.member.expert_id == freelancer_approval.account.expert_id

  print("partner contract smoke checks passed")


if __name__ == "__main__":
  main()
