from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import StreamingResponse

from app.schemas.partner_applications import PartnerPasswordChangeRequest, PartnerPasswordChangeResult
from app.services import partner_applications, partner_workspace
from app.services.partner_workspace import PartnerPrincipal


router = APIRouter()


async def get_active_partner_principal(
  principal: PartnerPrincipal = Depends(partner_workspace.get_partner_principal),
) -> PartnerPrincipal:
  return partner_applications.validate_partner_account_scope(principal)


async def get_partner_principal_for_password_setup(
  principal: PartnerPrincipal = Depends(partner_workspace.get_partner_principal),
) -> PartnerPrincipal:
  return partner_applications.validate_partner_account_scope(principal, allow_password_change_required=True)


@router.get("/me")
async def get_partner_me(principal: PartnerPrincipal = Depends(get_partner_principal_for_password_setup)):
  return partner_workspace.partner_me(principal)


@router.post("/me/password", response_model=PartnerPasswordChangeResult)
async def complete_partner_password_change(
  payload: PartnerPasswordChangeRequest,
  principal: PartnerPrincipal = Depends(get_partner_principal_for_password_setup),
):
  return partner_applications.complete_password_change(principal, payload.new_password)


@router.get("/dashboard")
async def get_partner_dashboard(principal: PartnerPrincipal = Depends(get_active_partner_principal)):
  return partner_workspace.partner_dashboard(principal)


@router.get("/bookings")
async def list_partner_bookings(principal: PartnerPrincipal = Depends(get_active_partner_principal)):
  return partner_workspace.list_partner_bookings(principal)


@router.get("/customers")
async def list_partner_customers(principal: PartnerPrincipal = Depends(get_active_partner_principal)):
  return partner_workspace.list_partner_customers(principal)


@router.get("/customers/{customer_id}")
async def get_partner_customer(customer_id: str, principal: PartnerPrincipal = Depends(get_active_partner_principal)):
  return partner_workspace.get_partner_customer(customer_id, principal)


@router.get("/chats")
async def list_partner_chats(principal: PartnerPrincipal = Depends(get_active_partner_principal)):
  return partner_workspace.list_partner_chats(principal)


@router.get("/consultations/{booking_id}/summary")
async def get_consultation_summary(booking_id: str, principal: PartnerPrincipal = Depends(get_active_partner_principal)):
  return partner_workspace.get_summary_for_booking(booking_id, principal)


@router.post("/consultations/{booking_id}/summary/generate")
async def generate_consultation_summary(
  booking_id: str,
  payload: dict,
  principal: PartnerPrincipal = Depends(get_active_partner_principal),
):
  return partner_workspace.generate_summary(booking_id, payload, principal)


@router.get("/events")
async def partner_events(
  principal: PartnerPrincipal = Depends(get_active_partner_principal),
  last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
  after_id: str | None = Query(default=None, alias="afterId"),
):
  return StreamingResponse(
    partner_workspace.partner_event_stream(principal, after_id=last_event_id or after_id),
    media_type="text/event-stream",
    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
  )


@router.get("/events/snapshot")
async def partner_event_snapshot(
  principal: PartnerPrincipal = Depends(get_active_partner_principal),
  after_id: str | None = Query(default=None, alias="afterId"),
):
  return partner_workspace.list_partner_events(principal, after_id=after_id)
