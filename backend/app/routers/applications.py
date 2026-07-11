from __future__ import annotations

from typing import Optional, Union

from fastapi import APIRouter, Depends, Query

from app.schemas.partner_applications import (
  PartnerApplication,
  PartnerApplicationApprovalRequest,
  PartnerApplicationApprovalResult,
  PartnerApplicationCreate,
  PartnerApplicationDecision,
  PartnerApplicationDetail,
  PartnerApplicationStatus,
  PartnerApplicationStatusResult,
  PartnerDocumentAccessResult,
)
from app.services import partner_applications, real_workspace
from app.services.auth import get_admin_principal


router = APIRouter()


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
  return partner_applications.create_document_access(document_id)


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
