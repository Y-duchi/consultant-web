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
from app.services import partner_applications
from app.services.auth import get_admin_principal


router = APIRouter()


@router.get("", response_model=list[PartnerApplication])
async def list_partner_applications(
  status: Union[PartnerApplicationStatus, str] = Query(default="all"),
  query: Optional[str] = None,
  _admin=Depends(get_admin_principal),
):
  return partner_applications.list_applications(status=status, query=query)


@router.post("", response_model=PartnerApplication)
async def create_partner_application(payload: PartnerApplicationCreate):
  return partner_applications.create_application(payload)


@router.post("/documents/{document_id}/access", response_model=PartnerDocumentAccessResult)
async def create_partner_application_document_access(document_id: str, _admin=Depends(get_admin_principal)):
  return partner_applications.create_document_access(document_id)


@router.get("/{application_id}/status", response_model=PartnerApplicationStatusResult)
async def get_partner_application_status(application_id: str):
  return partner_applications.get_application_status(application_id)


@router.get("/{application_id}", response_model=PartnerApplicationDetail)
async def get_partner_application(application_id: str, _admin=Depends(get_admin_principal)):
  return partner_applications.get_application_detail(application_id)


@router.post("/{application_id}/needs-update", response_model=PartnerApplication)
async def request_partner_application_update(application_id: str, payload: PartnerApplicationDecision, _admin=Depends(get_admin_principal)):
  return partner_applications.request_update(application_id, payload)


@router.post("/{application_id}/reject", response_model=PartnerApplication)
async def reject_partner_application(application_id: str, payload: PartnerApplicationDecision, _admin=Depends(get_admin_principal)):
  return partner_applications.reject_application(application_id, payload)


@router.post("/{application_id}/approve", response_model=PartnerApplicationApprovalResult)
async def approve_partner_application(application_id: str, payload: PartnerApplicationApprovalRequest, _admin=Depends(get_admin_principal)):
  return partner_applications.approve_application(application_id, payload)
