from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class PartnerType(str, Enum):
  business = "business"
  freelancer = "freelancer"


class PartnerApplicationStatus(str, Enum):
  submitted = "submitted"
  needs_update = "needs_update"
  approved = "approved"
  rejected = "rejected"


class PartnerApplicationDocumentType(str, Enum):
  business_registration = "business_registration"
  beauty_license = "beauty_license"
  additional_certificate = "additional_certificate"


class PartnerApplicationDocumentReviewStatus(str, Enum):
  pending = "pending"
  verified = "verified"
  rejected = "rejected"


class ConsultingMode(str, Enum):
  online = "online"
  offline = "offline"


class WorkspaceScope(str, Enum):
  expert_personal = "expert_personal"
  business_operations = "business_operations"


class PartnerApplicationDocument(BaseModel):
  id: str
  application_id: str
  type: PartnerApplicationDocumentType
  file_name: str
  mime_type: str = "application/pdf"
  size_label: str
  storage_key: str
  uploaded_at: str
  review_status: PartnerApplicationDocumentReviewStatus
  note: Optional[str] = None


class PartnerApplication(BaseModel):
  id: str
  partner_type: PartnerType
  business_name: str
  owner_name: str
  business_registration_number: Optional[str] = None
  phone: str
  email: str
  specialties: list[str]
  categories: list[str]
  introduction: str
  consulting_modes: list[ConsultingMode] = Field(default_factory=lambda: [ConsultingMode.online])
  price_30_min: int
  price_60_min: int
  online_price_30_min: Optional[int] = Field(default=None, ge=0)
  online_price_60_min: Optional[int] = Field(default=None, ge=0)
  offline_price_30_min: Optional[int] = Field(default=None, ge=0)
  offline_price_60_min: Optional[int] = Field(default=None, ge=0)
  offline_address: Optional[str] = None
  offline_detail_address: Optional[str] = None
  offline_location_note: Optional[str] = None
  status: PartnerApplicationStatus
  submitted_at: str
  updated_at: str
  reviewed_at: Optional[str] = None
  reviewer_name: Optional[str] = None
  review_memo: Optional[str] = None
  business_id: Optional[str] = None
  generated_account_id: Optional[str] = None
  documents: list[PartnerApplicationDocument]


class PartnerApplicationCreate(BaseModel):
  partner_type: PartnerType
  business_name: str = Field(min_length=1)
  owner_name: str = Field(min_length=1)
  business_registration_number: Optional[str] = None
  phone: str = Field(min_length=1)
  email: str
  specialties: list[str] = []
  categories: list[str] = []
  introduction: str = ""
  consulting_modes: list[ConsultingMode] = Field(default_factory=lambda: [ConsultingMode.online])
  price_30_min: int = Field(ge=0)
  price_60_min: int = Field(ge=0)
  online_price_30_min: Optional[int] = Field(default=None, ge=0)
  online_price_60_min: Optional[int] = Field(default=None, ge=0)
  offline_price_30_min: Optional[int] = Field(default=None, ge=0)
  offline_price_60_min: Optional[int] = Field(default=None, ge=0)
  offline_address: Optional[str] = None
  offline_detail_address: Optional[str] = None
  offline_location_note: Optional[str] = None
  business_registration_file_name: Optional[str] = Field(default=None, validate_default=True)
  business_registration_storage_key: Optional[str] = None
  beauty_license_file_name: Optional[str] = None
  beauty_license_storage_key: Optional[str] = None
  additional_certificate_file_names: list[str] = []
  additional_certificate_storage_keys: list[str] = []

  @field_validator("business_registration_file_name", mode="before")
  @classmethod
  def require_business_registration_document(cls, value):
    normalized = str(value or "").strip()
    if not normalized:
      raise ValueError("사업자등록증 PDF는 필수입니다.")
    return normalized

  @model_validator(mode="after")
  def validate_document_storage_keys(self):
    if not (self.business_registration_storage_key or "").strip():
      raise ValueError("사업자등록증 파일 업로드를 완료해 주세요.")
    if bool((self.beauty_license_file_name or "").strip()) != bool((self.beauty_license_storage_key or "").strip()):
      raise ValueError("국가 미용사 면허증 파일 정보가 일치하지 않습니다.")
    if (
      len(self.additional_certificate_file_names) != len(self.additional_certificate_storage_keys)
      or any(not str(value).strip() for value in self.additional_certificate_file_names)
      or any(not str(value).strip() for value in self.additional_certificate_storage_keys)
    ):
      raise ValueError("추가 자격증 파일 정보가 일치하지 않습니다.")
    return self


class PartnerDocumentUploadRequest(BaseModel):
  document_type: PartnerApplicationDocumentType
  file_name: str = Field(min_length=1)
  content_type: str = Field(pattern="^application/pdf$")
  size_bytes: int = Field(gt=0, le=10 * 1024 * 1024)


class PartnerApplicationDecision(BaseModel):
  review_memo: str
  reviewer_name: str = "플랫폼 관리자"


class PartnerApplicationApprovalRequest(PartnerApplicationDecision):
  account_email: Optional[str] = None
  workspace_scope: WorkspaceScope = WorkspaceScope.business_operations


class PartnerAccount(BaseModel):
  id: str
  application_id: str
  business_id: str
  expert_id: Optional[str] = None
  email: str
  temporary_password: str
  role: str
  workspace_scope: WorkspaceScope
  status: str
  password_change_required: bool
  created_at: str
  delivered_by: str


class BusinessMember(BaseModel):
  id: str
  business_id: str
  account_id: str
  expert_id: Optional[str] = None
  role: str
  workspace_scope: WorkspaceScope
  status: str = "active"
  created_at: str
  updated_at: str


class ApplicationReviewLog(BaseModel):
  id: str
  application_id: str
  actor_name: str
  action: str
  memo: str
  created_at: str


class PartnerApplicationDetail(BaseModel):
  application: PartnerApplication
  review_logs: list[ApplicationReviewLog]
  account: Optional[PartnerAccount] = None
  member: Optional[BusinessMember] = None


class PartnerApplicationApprovalResult(BaseModel):
  application: PartnerApplication
  account: PartnerAccount
  member: BusinessMember


class PartnerApplicationStatusResult(BaseModel):
  id: str
  status: PartnerApplicationStatus
  business_name: str
  owner_name: str
  submitted_at: str
  updated_at: str
  reviewed_at: Optional[str] = None
  reviewer_name: Optional[str] = None
  review_memo: Optional[str] = None


class PartnerPasswordChangeRequest(BaseModel):
  new_password: str = Field(min_length=8)


class PartnerPasswordChangeResult(BaseModel):
  account_id: str
  status: str
  password_change_required: bool


class PartnerDocumentAccessResult(BaseModel):
  document_id: str
  file_name: str
  access_url: str
  expires_in_minutes: int
