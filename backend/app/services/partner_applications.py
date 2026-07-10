from __future__ import annotations

import copy
from datetime import datetime, timezone

from fastapi import HTTPException

from app.schemas.partner_applications import (
  ApplicationReviewLog,
  BusinessMember,
  PartnerAccount,
  PartnerApplication,
  PartnerApplicationApprovalRequest,
  PartnerApplicationApprovalResult,
  PartnerApplicationCreate,
  PartnerApplicationDecision,
  PartnerApplicationDetail,
  PartnerApplicationDocument,
  PartnerApplicationDocumentReviewStatus,
  PartnerApplicationDocumentType,
  PartnerApplicationStatus,
  PartnerApplicationStatusResult,
  PartnerPasswordChangeResult,
  PartnerType,
  WorkspaceScope,
  PartnerDocumentAccessResult,
)
from app.services import partner_workspace
from app.services.auth import PartnerPrincipal, validate_partner_principal


def _now() -> str:
  return datetime.now(timezone.utc).isoformat()


def _make_id(prefix: str) -> str:
  return f"{prefix}-{int(datetime.now(timezone.utc).timestamp() * 1000)}"


_applications: list[PartnerApplication] = [
  PartnerApplication(
    id="app-sample-1",
    partner_type="business",
    business_name="AURA 성수 메이크업 스튜디오",
    owner_name="김세아",
    business_registration_number="123-45-67890",
    phone="02-468-1900",
    email="pending@aura.example",
    specialties=["메이크업", "퍼스널컬러"],
    categories=["퍼스널컬러", "메이크업"],
    introduction="앱 AI 리포트를 함께 보며 바로 따라 할 수 있는 메이크업 처방을 제공합니다.",
    price_30_min=19000,
    price_60_min=34000,
    status=PartnerApplicationStatus.submitted,
    submitted_at=_now(),
    updated_at=_now(),
    documents=[
      PartnerApplicationDocument(
        id="doc-sample-1",
        application_id="app-sample-1",
        type=PartnerApplicationDocumentType.business_registration,
        file_name="AURA성수_사업자등록증.pdf",
        size_label="842KB",
        storage_key="business-verifications/app-sample-1/business-registration.pdf",
        uploaded_at=_now(),
        review_status=PartnerApplicationDocumentReviewStatus.pending,
      ),
      PartnerApplicationDocument(
        id="doc-sample-2",
        application_id="app-sample-1",
        type=PartnerApplicationDocumentType.beauty_license,
        file_name="김세아_국가미용사면허증.pdf",
        size_label="1.1MB",
        storage_key="credentials/app-sample-1/beauty-license.pdf",
        uploaded_at=_now(),
        review_status=PartnerApplicationDocumentReviewStatus.pending,
      ),
    ],
  )
]

_accounts: list[PartnerAccount] = []
_business_members: list[BusinessMember] = []
_review_logs: list[ApplicationReviewLog] = [
  ApplicationReviewLog(
    id="log-sample-1",
    application_id="app-sample-1",
    actor_name="신청자",
    action="submitted",
    memo="입점 신청서와 필수 PDF 서류를 제출했습니다.",
    created_at=_now(),
  )
]


def _seed_partner_identity() -> None:
  if _accounts:
    return
  now = _now()
  _accounts.extend(
    [
      PartnerAccount(
        id="account-1",
        application_id="seed-biz-1",
        business_id="biz-1",
        email="partner@aura.example",
        temporary_password="AuraTemp!2026",
        role="business_manager",
        workspace_scope=WorkspaceScope.business_operations,
        status="active",
        password_change_required=False,
        created_at=now,
        delivered_by="manual",
      ),
      PartnerAccount(
        id="account-2",
        application_id="seed-biz-2",
        business_id="biz-2",
        email="partner-b@aura.example",
        temporary_password="AuraTemp!2026",
        role="business_manager",
        workspace_scope=WorkspaceScope.business_operations,
        status="active",
        password_change_required=False,
        created_at=now,
        delivered_by="manual",
      ),
      PartnerAccount(
        id="account-exp-1",
        application_id="seed-exp-1",
        business_id="biz-1",
        expert_id="exp-1",
        email="expert.seah@aura.example",
        temporary_password="AuraTemp!2026",
        role="expert",
        workspace_scope=WorkspaceScope.expert_personal,
        status="active",
        password_change_required=False,
        created_at=now,
        delivered_by="manual",
      ),
      PartnerAccount(
        id="account-exp-4",
        application_id="seed-exp-4",
        business_id="biz-2",
        expert_id="exp-4",
        email="expert.yuri@aura.example",
        temporary_password="AuraTemp!2026",
        role="expert",
        workspace_scope=WorkspaceScope.expert_personal,
        status="active",
        password_change_required=False,
        created_at=now,
        delivered_by="manual",
      ),
      PartnerAccount(
        id="account-exp-2",
        application_id="seed-exp-2",
        business_id="biz-1",
        expert_id="exp-2",
        email="expert.doa@aura.example",
        temporary_password="AuraTemp!2026",
        role="expert",
        workspace_scope=WorkspaceScope.expert_personal,
        status="active",
        password_change_required=False,
        created_at=now,
        delivered_by="manual",
      ),
    ]
  )
  _business_members.extend(
    [
      BusinessMember(id="member-1", business_id="biz-1", account_id="account-1", role="owner", workspace_scope=WorkspaceScope.business_operations, status="active", created_at=now, updated_at=now),
      BusinessMember(id="member-2", business_id="biz-2", account_id="account-2", role="owner", workspace_scope=WorkspaceScope.business_operations, status="active", created_at=now, updated_at=now),
      BusinessMember(id="member-exp-1", business_id="biz-1", account_id="account-exp-1", expert_id="exp-1", role="expert", workspace_scope=WorkspaceScope.expert_personal, status="active", created_at=now, updated_at=now),
      BusinessMember(id="member-exp-4", business_id="biz-2", account_id="account-exp-4", expert_id="exp-4", role="expert", workspace_scope=WorkspaceScope.expert_personal, status="active", created_at=now, updated_at=now),
      BusinessMember(id="member-exp-2", business_id="biz-1", account_id="account-exp-2", expert_id="exp-2", role="expert", workspace_scope=WorkspaceScope.expert_personal, status="active", created_at=now, updated_at=now),
    ]
  )


_seed_partner_identity()


def list_applications(status: PartnerApplicationStatus | str = "all", query: str | None = None) -> list[PartnerApplication]:
  result = _applications
  if status != "all":
    result = [application for application in result if application.status == status]
  if query:
    normalized = query.lower()
    result = [
      application
      for application in result
      if normalized
      in " ".join(
        [
          application.business_name,
          application.owner_name,
          application.email,
          application.phone,
          application.business_registration_number or "",
          " ".join(application.specialties),
          " ".join(application.categories),
        ]
      ).lower()
    ]
  return sorted(result, key=lambda application: application.updated_at, reverse=True)


def create_application(payload: PartnerApplicationCreate) -> PartnerApplication:
  application_id = _make_id("app")
  now = _now()
  application = PartnerApplication(
    id=application_id,
    partner_type=payload.partner_type,
    business_name=payload.business_name,
    owner_name=payload.owner_name,
    business_registration_number=payload.business_registration_number,
    phone=payload.phone,
    email=payload.email,
    specialties=payload.specialties,
    categories=payload.categories,
    introduction=payload.introduction,
    price_30_min=payload.price_30_min,
    price_60_min=payload.price_60_min,
    status=PartnerApplicationStatus.submitted,
    submitted_at=now,
    updated_at=now,
    documents=_build_documents(application_id, payload),
  )
  _applications.insert(0, application)
  _add_log(application.id, "신청자", "submitted", "입점 신청서와 필수 PDF 서류를 제출했습니다.")
  return application


def get_application_detail(application_id: str) -> PartnerApplicationDetail:
  application = _find_application(application_id)
  account = next((account for account in _accounts if account.application_id == application_id), None)
  return PartnerApplicationDetail(
    application=application,
    review_logs=sorted(
      [log for log in _review_logs if log.application_id == application_id],
      key=lambda log: log.created_at,
      reverse=True,
    ),
    account=account,
    member=next((member for member in _business_members if account and member.account_id == account.id), None),
  )


def get_application_status(application_id: str) -> PartnerApplicationStatusResult:
  application = _find_application(application_id)
  return PartnerApplicationStatusResult(
    id=application.id,
    status=application.status,
    business_name=application.business_name,
    owner_name=application.owner_name,
    submitted_at=application.submitted_at,
    updated_at=application.updated_at,
    reviewed_at=application.reviewed_at,
    reviewer_name=application.reviewer_name,
    review_memo=application.review_memo,
  )


def request_update(application_id: str, payload: PartnerApplicationDecision) -> PartnerApplication:
  _require_review_memo(payload)
  return _set_status(application_id, PartnerApplicationStatus.needs_update, payload)


def reject_application(application_id: str, payload: PartnerApplicationDecision) -> PartnerApplication:
  _require_review_memo(payload)
  return _set_status(application_id, PartnerApplicationStatus.rejected, payload)


def approve_application(
  application_id: str,
  payload: PartnerApplicationApprovalRequest,
  *,
  simulate_failure_at: str | None = None,
) -> PartnerApplicationApprovalResult:
  application = _find_application(application_id)
  _ensure_application_reviewable(application)
  snapshot = _snapshot_approval_state()

  try:
    now = _now()
    business_id = application.business_id or _make_id("biz")
    registration = partner_workspace.register_approved_partner(application, business_id)
    _raise_if_simulated_failure(simulate_failure_at, "after_partner_registration")

    account_role = "expert" if application.partner_type == PartnerType.freelancer else "business_manager"
    workspace_scope = WorkspaceScope.expert_personal if account_role == "expert" else payload.workspace_scope
    account = next((item for item in _accounts if item.application_id == application_id), None)
    if account is None:
      account = PartnerAccount(
        id=_make_id("account"),
        application_id=application_id,
        business_id=business_id,
        expert_id=registration["expert"]["id"] if application.partner_type == "freelancer" else None,
        email=payload.account_email or application.email,
        temporary_password=_temporary_password(application.business_name),
        role=account_role,
        workspace_scope=workspace_scope,
        status="invited",
        password_change_required=True,
        created_at=now,
        delivered_by="manual",
      )
      _accounts.insert(0, account)
    _raise_if_simulated_failure(simulate_failure_at, "after_account")

    member = _ensure_business_member(account, registration["expert"]["id"], now)
    _raise_if_simulated_failure(simulate_failure_at, "after_member")

    application.status = PartnerApplicationStatus.approved
    application.business_id = business_id
    application.generated_account_id = account.id
    application.review_memo = payload.review_memo
    application.reviewer_name = payload.reviewer_name
    application.reviewed_at = now
    application.updated_at = now
    application.documents = [
      document.model_copy(update={"review_status": PartnerApplicationDocumentReviewStatus.verified})
      for document in application.documents
    ]
    _raise_if_simulated_failure(simulate_failure_at, "after_document_verification")

    _add_log(application.id, payload.reviewer_name, "approved", payload.review_memo)
    _raise_if_simulated_failure(simulate_failure_at, "after_approved_log")

    _add_log(
      application.id,
      payload.reviewer_name,
      "account_created",
      f"{registration['business']['name']} 업체, {registration['expert']['name']} 전문가, {account.email} 계정과 {member.role} 멤버십을 수동 전달용으로 생성했습니다.",
    )
    return PartnerApplicationApprovalResult(application=application, account=account, member=member)
  except Exception:
    _restore_approval_state(snapshot)
    raise


def create_document_access(document_id: str) -> PartnerDocumentAccessResult:
  document = _find_document(document_id)
  return PartnerDocumentAccessResult(
    document_id=document.id,
    file_name=document.file_name,
    access_url=f"mock-presigned-url://{document.storage_key}",
    expires_in_minutes=10,
  )


def validate_partner_account_scope(
  principal: PartnerPrincipal,
  *,
  allow_password_change_required: bool = False,
) -> PartnerPrincipal:
  principal = validate_partner_principal(principal)
  account = next((item for item in _accounts if item.id == principal.account_id), None)
  if account is None:
    raise HTTPException(status_code=403, detail="Partner account is not approved for workspace access.")
  if account.status == "suspended":
    raise HTTPException(status_code=403, detail="Partner account is suspended.")
  if account.role != principal.role:
    raise HTTPException(status_code=403, detail="Partner role does not match the approved account.")
  if account.business_id != principal.business_id:
    raise HTTPException(status_code=403, detail="Partner business scope does not match the approved account.")
  if account.workspace_scope.value != principal.workspace_scope:
    raise HTTPException(status_code=403, detail="Partner workspace scope does not match the approved account.")
  if account.expert_id and account.expert_id != principal.expert_id:
    raise HTTPException(status_code=403, detail="Partner expert scope does not match the approved account.")
  if account.password_change_required and not allow_password_change_required:
    raise HTTPException(status_code=403, detail="Partner password change is required before workspace access.")

  member = next(
    (
      item
      for item in _business_members
      if item.account_id == account.id and item.business_id == principal.business_id and item.status == "active"
    ),
    None,
  )
  if member is None:
    raise HTTPException(status_code=403, detail="Partner account is not attached to an active business member.")
  if member.workspace_scope.value != principal.workspace_scope:
    raise HTTPException(status_code=403, detail="Business member workspace scope does not match the request.")
  if principal.workspace_scope == WorkspaceScope.expert_personal.value and member.expert_id != principal.expert_id:
    raise HTTPException(status_code=403, detail="Business member expert scope does not match the request.")
  return principal


def complete_password_change(principal: PartnerPrincipal, new_password: str) -> PartnerPasswordChangeResult:
  principal = validate_partner_account_scope(principal, allow_password_change_required=True)
  normalized_password = new_password.strip()
  if len(normalized_password) < 8:
    raise HTTPException(status_code=422, detail="New password must be at least 8 characters.")

  account = next((item for item in _accounts if item.id == principal.account_id), None)
  if account is None:
    raise HTTPException(status_code=404, detail="Partner account not found.")
  if account.business_id != principal.business_id:
    raise HTTPException(status_code=403, detail="Partner account does not belong to this business scope.")
  if account.expert_id and account.expert_id != principal.expert_id:
    raise HTTPException(status_code=403, detail="Partner account does not belong to this expert scope.")

  account.temporary_password = ""
  account.status = "active"
  account.password_change_required = False

  return PartnerPasswordChangeResult(
    account_id=account.id,
    status=account.status,
    password_change_required=account.password_change_required,
  )


def find_partner_account_for_login(email: str) -> PartnerAccount | None:
  normalized = email.strip().lower()
  aliases = {
    "seah.kim@aura-partner.local": "expert.seah@aura.example",
    "partner@aura.example": "partner@aura.example",
    "partner-b@aura.example": "partner-b@aura.example",
  }
  target_email = aliases.get(normalized, normalized)
  return next((item for item in _accounts if item.email.lower() == target_email), None)


def find_partner_account(account_id: str) -> PartnerAccount | None:
  return next((item for item in _accounts if item.id == account_id), None)


def _set_status(
  application_id: str,
  status: PartnerApplicationStatus,
  payload: PartnerApplicationDecision,
) -> PartnerApplication:
  application = _find_application(application_id)
  _ensure_application_reviewable(application)
  now = _now()
  application.status = status
  application.review_memo = payload.review_memo
  application.reviewer_name = payload.reviewer_name
  application.reviewed_at = now
  application.updated_at = now
  _add_log(application.id, payload.reviewer_name, status.value, payload.review_memo)
  return application


def _ensure_application_reviewable(application: PartnerApplication) -> None:
  if application.status in {PartnerApplicationStatus.approved, PartnerApplicationStatus.rejected}:
    raise HTTPException(status_code=409, detail="Finalized partner applications cannot be changed.")


def _require_review_memo(payload: PartnerApplicationDecision) -> None:
  if not payload.review_memo.strip():
    raise HTTPException(status_code=422, detail="Review memo is required for this decision.")


def _build_documents(application_id: str, payload: PartnerApplicationCreate) -> list[PartnerApplicationDocument]:
  entries: list[tuple[PartnerApplicationDocumentType, str | None]] = [
    (PartnerApplicationDocumentType.business_registration, payload.business_registration_file_name),
    (PartnerApplicationDocumentType.beauty_license, payload.beauty_license_file_name),
    *[(PartnerApplicationDocumentType.additional_certificate, name) for name in payload.additional_certificate_file_names],
  ]
  documents: list[PartnerApplicationDocument] = []
  for index, (document_type, file_name) in enumerate(entries):
    if not file_name:
      continue
    folder = "business-verifications" if document_type == PartnerApplicationDocumentType.business_registration else "credentials"
    documents.append(
      PartnerApplicationDocument(
        id=_make_id(f"doc{index}"),
        application_id=application_id,
        type=document_type,
        file_name=file_name,
        size_label=f"{max(420, len(file_name) * 28)}KB",
        storage_key=f"{folder}/{application_id}/{document_type.value}-{index}.pdf",
        uploaded_at=_now(),
        review_status=PartnerApplicationDocumentReviewStatus.pending,
      )
    )
  return documents


def _find_application(application_id: str) -> PartnerApplication:
  application = next((item for item in _applications if item.id == application_id), None)
  if application is None:
    raise HTTPException(status_code=404, detail="Partner application not found.")
  return application


def _find_document(document_id: str) -> PartnerApplicationDocument:
  document = next((item for application in _applications for item in application.documents if item.id == document_id), None)
  if document is None:
    raise HTTPException(status_code=404, detail="Partner application document not found.")
  return document


def _add_log(application_id: str, actor_name: str, action: str, memo: str) -> None:
  _review_logs.insert(
    0,
    ApplicationReviewLog(
      id=_make_id("log"),
      application_id=application_id,
      actor_name=actor_name,
      action=action,
      memo=memo,
      created_at=_now(),
    ),
  )


def _ensure_business_member(account: PartnerAccount, expert_id: str, now: str) -> BusinessMember:
  existing = next(
    (member for member in _business_members if member.business_id == account.business_id and member.account_id == account.id),
    None,
  )
  member_role = "expert" if account.workspace_scope == WorkspaceScope.expert_personal else "owner"
  scoped_expert_id = expert_id if account.workspace_scope == WorkspaceScope.expert_personal else None
  if existing:
    existing.expert_id = scoped_expert_id
    existing.role = member_role
    existing.workspace_scope = account.workspace_scope
    existing.status = "active"
    existing.updated_at = now
    return existing

  member = BusinessMember(
    id=_make_id("member"),
    business_id=account.business_id,
    account_id=account.id,
    expert_id=scoped_expert_id,
    role=member_role,
    workspace_scope=account.workspace_scope,
    status="active",
    created_at=now,
    updated_at=now,
  )
  _business_members.insert(0, member)
  return member


def _snapshot_approval_state() -> dict[str, object]:
  return {
    "applications": copy.deepcopy(_applications),
    "accounts": copy.deepcopy(_accounts),
    "business_members": copy.deepcopy(_business_members),
    "review_logs": copy.deepcopy(_review_logs),
    "partner_registry": partner_workspace.snapshot_partner_registry(),
  }


def _restore_approval_state(snapshot: dict[str, object]) -> None:
  _applications[:] = copy.deepcopy(snapshot["applications"])
  _accounts[:] = copy.deepcopy(snapshot["accounts"])
  _business_members[:] = copy.deepcopy(snapshot["business_members"])
  _review_logs[:] = copy.deepcopy(snapshot["review_logs"])
  partner_workspace.restore_partner_registry(snapshot["partner_registry"])


def _raise_if_simulated_failure(actual: str | None, expected: str) -> None:
  if actual == expected:
    raise RuntimeError(f"Simulated approval failure: {expected}")


def _temporary_password(seed: str) -> str:
  clean_seed = "".join(character for character in seed if character.isalnum())[:4] or "Aura"
  return f"{clean_seed}!{str(int(datetime.now(timezone.utc).timestamp()))[-6:]}"
