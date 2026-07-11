from __future__ import annotations

from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.partner_applications import (
  PartnerApplication,
  PartnerApplicationApprovalRequest,
  PartnerApplicationApprovalResult,
  PartnerApplicationCreate,
  PartnerApplicationDecision,
  PartnerApplicationDetail,
  PartnerApplicationStatus,
  PartnerApplicationStatusResult,
  PartnerEmailVerificationConfirm,
  PartnerEmailVerificationRequest,
  PartnerEmailVerificationRequested,
  PartnerEmailVerificationResult,
  PartnerDocumentAccessResult,
  PartnerDocumentUploadRequest,
)
from app.services import real_workspace
from app.services.auth import get_admin_principal
from app.services.s3 import create_presigned_upload
from app.settings import get_settings


router = APIRouter()


@router.post("/email-verification/request", response_model=PartnerEmailVerificationRequested)
async def request_partner_email_verification(payload: PartnerEmailVerificationRequest):
  return await real_workspace.request_partner_email_verification(payload.email)


@router.post("/email-verification/confirm", response_model=PartnerEmailVerificationResult)
async def confirm_partner_email_verification(payload: PartnerEmailVerificationConfirm):
  return await real_workspace.confirm_partner_email_verification(payload.email, payload.code)


@router.get("", response_model=list[PartnerApplication])
async def list_partner_applications(
  status: Union[PartnerApplicationStatus, str] = Query(default="all"),
  query: Optional[str] = None,
  _admin=Depends(get_admin_principal),
):
  status_value = status.value if isinstance(status, PartnerApplicationStatus) else str(status)
  return await real_workspace.list_partner_applications(status=status_value, query=query)


@router.post("", response_model=PartnerApplication)
async def create_partner_application(payload: PartnerApplicationCreate):
  return await real_workspace.create_partner_application(payload)


@router.post("/documents/{document_id}/access", response_model=PartnerDocumentAccessResult)
async def create_partner_application_document_access(document_id: str, _admin=Depends(get_admin_principal)):
  return await real_workspace.create_partner_application_document_access(document_id)


@router.post("/documents/presigned-upload")
async def create_partner_application_document_upload(payload: PartnerDocumentUploadRequest):
  settings = get_settings()
  if not settings.s3_configured:
    raise HTTPException(status_code=503, detail="S3_BUCKET_NAME is not configured.")
  folder = "business-verifications" if payload.document_type.value == "business_registration" else "credentials"
  return create_presigned_upload(settings, folder, payload.file_name, payload.content_type)


@router.get("/{application_id}/status", response_model=PartnerApplicationStatusResult)
async def get_partner_application_status(application_id: str):
  detail = await real_workspace.get_partner_application_detail(application_id)
  return detail["application"]


@router.get("/{application_id}", response_model=PartnerApplicationDetail)
async def get_partner_application(application_id: str, _admin=Depends(get_admin_principal)):
  return await real_workspace.get_partner_application_detail(application_id)


@router.post("/{application_id}/needs-update", response_model=PartnerApplication)
async def request_partner_application_update(application_id: str, payload: PartnerApplicationDecision, _admin=Depends(get_admin_principal)):
  return await real_workspace.decide_partner_application(application_id, "needs_update", payload)


@router.post("/{application_id}/reject", response_model=PartnerApplication)
async def reject_partner_application(application_id: str, payload: PartnerApplicationDecision, _admin=Depends(get_admin_principal)):
  return await real_workspace.decide_partner_application(application_id, "rejected", payload)


@router.post("/{application_id}/approve", response_model=PartnerApplicationApprovalResult)
async def approve_partner_application(application_id: str, payload: PartnerApplicationApprovalRequest, _admin=Depends(get_admin_principal)):
  return await real_workspace.approve_partner_application(application_id, payload)


@router.post("/{application_id}/reissue-credentials", response_model=PartnerApplicationApprovalResult)
async def reissue_partner_credentials(application_id: str, _admin=Depends(get_admin_principal)):
  return await real_workspace.reissue_partner_credentials(application_id)
