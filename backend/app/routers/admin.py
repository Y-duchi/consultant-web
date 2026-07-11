from __future__ import annotations

from typing import Optional, Union

from fastapi import APIRouter, Depends, Query

from app.schemas.partner_applications import (
  PartnerApplication,
  PartnerApplicationApprovalRequest,
  PartnerApplicationApprovalResult,
  PartnerApplicationDecision,
  PartnerApplicationDetail,
  PartnerApplicationStatus,
  PartnerDocumentAccessResult,
)
from app.services import partner_applications, real_workspace
from app.services.auth import get_admin_principal


router = APIRouter(dependencies=[Depends(get_admin_principal)])


@router.get("/dashboard")
async def get_admin_dashboard():
  summary = await real_workspace.admin_dashboard()
  applications = await real_workspace.list_partner_applications(status="all")
  summary["pending_application_count"] = len([application for application in applications if _application_status(application) == "submitted"])
  summary["needs_update_application_count"] = len([application for application in applications if _application_status(application) == "needs_update"])
  summary["recent_applications"] = applications[:5]
  return summary


@router.get("/partner-applications", response_model=list[PartnerApplication])
async def list_admin_partner_applications(
  status: Union[PartnerApplicationStatus, str] = Query(default="all"),
  query: Optional[str] = None,
):
  status_value = status.value if isinstance(status, PartnerApplicationStatus) else str(status)
  return await real_workspace.list_partner_applications(status=status_value, query=query)


@router.get("/partner-applications/{application_id}", response_model=PartnerApplicationDetail)
async def get_admin_partner_application(application_id: str):
  return await real_workspace.get_partner_application_detail(application_id)


@router.post("/partner-applications/{application_id}/approve", response_model=PartnerApplicationApprovalResult)
async def approve_admin_partner_application(application_id: str, payload: PartnerApplicationApprovalRequest):
  return await real_workspace.approve_partner_application(application_id, payload)


@router.post("/partner-applications/{application_id}/reissue-credentials", response_model=PartnerApplicationApprovalResult)
async def reissue_admin_partner_credentials(application_id: str):
  return await real_workspace.reissue_partner_credentials(application_id)


@router.post("/partner-applications/{application_id}/needs-update", response_model=PartnerApplication)
async def request_admin_partner_application_update(application_id: str, payload: PartnerApplicationDecision):
  return await real_workspace.decide_partner_application(application_id, "needs_update", payload)


@router.post("/partner-applications/{application_id}/reject", response_model=PartnerApplication)
async def reject_admin_partner_application(application_id: str, payload: PartnerApplicationDecision):
  return await real_workspace.decide_partner_application(application_id, "rejected", payload)


@router.post("/partner-applications/documents/{document_id}/access", response_model=PartnerDocumentAccessResult)
async def create_admin_partner_application_document_access(document_id: str):
  return partner_applications.create_document_access(document_id)


def _application_status(application: object) -> str:
  if isinstance(application, dict):
    return str(application.get("status") or "")
  status = getattr(application, "status", "")
  return str(getattr(status, "value", status))


@router.get("/businesses")
async def list_admin_businesses():
  return await real_workspace.list_businesses()


@router.get("/experts")
async def list_admin_experts():
  return await real_workspace.list_experts()


@router.get("/bookings")
async def list_admin_bookings(
  status: str | None = Query(default=None),
  query: str | None = Query(default=None),
  date_from: str | None = Query(default=None, alias="dateFrom"),
  date_to: str | None = Query(default=None, alias="dateTo"),
  expert_id: str | None = Query(default=None, alias="expertId"),
):
  return await real_workspace.list_all_bookings(
    {"status": status, "query": query, "dateFrom": date_from, "dateTo": date_to, "expertId": expert_id}
  )


@router.get("/summary-jobs")
async def list_admin_summary_jobs():
  return await real_workspace.list_summary_jobs()
