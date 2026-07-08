from __future__ import annotations

from typing import Optional, Union

from fastapi import APIRouter, Depends, Query

from app.schemas.partner_applications import (
  PartnerApplication,
  PartnerApplicationApprovalRequest,
  PartnerApplicationApprovalResult,
  PartnerApplicationDecision,
  PartnerApplicationStatus,
  PartnerDocumentAccessResult,
)
from app.services import partner_applications, partner_workspace
from app.services.auth import get_admin_principal


router = APIRouter(dependencies=[Depends(get_admin_principal)])


@router.get("/dashboard")
async def get_admin_dashboard():
  return partner_workspace.admin_dashboard()


@router.get("/partner-applications", response_model=list[PartnerApplication])
async def list_admin_partner_applications(
  status: Union[PartnerApplicationStatus, str] = Query(default="all"),
  query: Optional[str] = None,
):
  return partner_applications.list_applications(status=status, query=query)


@router.post("/partner-applications/{application_id}/approve", response_model=PartnerApplicationApprovalResult)
async def approve_admin_partner_application(application_id: str, payload: PartnerApplicationApprovalRequest):
  return partner_applications.approve_application(application_id, payload)


@router.post("/partner-applications/{application_id}/needs-update", response_model=PartnerApplication)
async def request_admin_partner_application_update(application_id: str, payload: PartnerApplicationDecision):
  return partner_applications.request_update(application_id, payload)


@router.post("/partner-applications/{application_id}/reject", response_model=PartnerApplication)
async def reject_admin_partner_application(application_id: str, payload: PartnerApplicationDecision):
  return partner_applications.reject_application(application_id, payload)


@router.post("/partner-applications/documents/{document_id}/access", response_model=PartnerDocumentAccessResult)
async def create_admin_partner_application_document_access(document_id: str):
  return partner_applications.create_document_access(document_id)


@router.get("/businesses")
async def list_admin_businesses():
  return partner_workspace.list_businesses()


@router.get("/experts")
async def list_admin_experts():
  return partner_workspace.list_experts()


@router.get("/bookings")
async def list_admin_bookings():
  return partner_workspace.list_all_bookings()


@router.get("/summary-jobs")
async def list_admin_summary_jobs():
  return partner_workspace.list_summary_jobs()
