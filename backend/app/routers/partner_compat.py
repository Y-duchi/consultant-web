from __future__ import annotations

import asyncio
from enum import Enum
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel

from app.services import real_workspace
from app.services.auth import PartnerPrincipal


router = APIRouter()


def ok(data: Any) -> dict[str, Any]:
  return {"data": _camelize(data), "error": None}


async def get_compat_principal(authorization: str | None = Header(default=None, alias="Authorization")) -> PartnerPrincipal:
  token = (authorization or "").replace("Bearer", "", 1).strip()
  if not token.startswith("partner:"):
    raise HTTPException(status_code=401, detail="Partner session token is required.")
  return await real_workspace.principal_from_token(token)


@router.post("/login")
async def login_partner(payload: dict):
  email = str(payload.get("email") or "").strip()
  return ok(await real_workspace.login_partner(email))


@router.get("/dashboard")
async def dashboard(principal: PartnerPrincipal = Depends(get_compat_principal)):
  return ok({"summary": await real_workspace.partner_dashboard(principal)})


@router.get("/experts")
async def experts(principal: PartnerPrincipal = Depends(get_compat_principal)):
  return ok({"experts": await real_workspace.list_experts(principal)})


@router.get("/business-profile")
async def business_profile(principal: PartnerPrincipal = Depends(get_compat_principal)):
  business = next((item for item in await real_workspace.list_businesses() if item["id"] == principal.business_id), None)
  if business is None:
    raise HTTPException(status_code=404, detail="Business not found.")
  return ok({"business": business})


@router.get("/bookings")
async def bookings(
  status: str | None = Query(default=None),
  query: str | None = Query(default=None),
  date_from: str | None = Query(default=None, alias="dateFrom"),
  date_to: str | None = Query(default=None, alias="dateTo"),
  expert_id: str | None = Query(default=None, alias="expertId"),
  principal: PartnerPrincipal = Depends(get_compat_principal),
):
  return ok({
    "bookings": await real_workspace.list_partner_bookings(
      principal,
      {"status": status, "query": query, "dateFrom": date_from, "dateTo": date_to, "expertId": expert_id},
    )
  })


@router.get("/bookings/{booking_id}")
async def booking_detail(booking_id: str, principal: PartnerPrincipal = Depends(get_compat_principal)):
  booking = await real_workspace.get_partner_booking(booking_id, principal)
  customer_detail = await real_workspace.get_partner_customer(booking["customer_id"], principal)
  expert = await real_workspace.get_expert(booking["expert_id"])
  reports = [
    report for report in await real_workspace.list_shared_reports(principal, booking["customer_id"])
    if report.get("booking_id") == booking["id"] or report["id"] in booking.get("shared_report_ids", [])
  ]
  summary = await real_workspace.get_summary_for_booking(booking["id"], principal)
  return ok({"detail": {"booking": booking, "customer": customer_detail["customer"], "expert": expert, "shared_reports": reports, "consultation_summary": summary}})


@router.patch("/bookings/{booking_id}")
async def save_booking_changes(booking_id: str, payload: dict, principal: PartnerPrincipal = Depends(get_compat_principal)):
  booking = await real_workspace.save_partner_booking_changes(booking_id, payload, principal)
  return ok({"booking": booking})


@router.patch("/bookings/{booking_id}/status")
async def update_booking_status(booking_id: str, payload: dict, principal: PartnerPrincipal = Depends(get_compat_principal)):
  booking = await real_workspace.update_partner_booking_status(booking_id, str(payload.get("status") or ""), principal)
  return ok({"booking": booking})


@router.post("/bookings/{booking_id}/payment")
async def mark_booking_payment(booking_id: str, principal: PartnerPrincipal = Depends(get_compat_principal)):
  booking = await real_workspace.mark_partner_booking_payment_paid(booking_id, principal)
  return ok({"booking": booking})


@router.get("/customers")
async def customers(
  query: str | None = Query(default=None),
  tag: str | None = Query(default=None),
  principal: PartnerPrincipal = Depends(get_compat_principal),
):
  return ok({"customers": await real_workspace.list_partner_customers(principal, {"query": query, "tag": tag})})


@router.get("/customers/{customer_id}")
async def customer_detail(customer_id: str, principal: PartnerPrincipal = Depends(get_compat_principal)):
  return ok({"detail": await real_workspace.get_partner_customer(customer_id, principal)})


@router.get("/chat/threads")
async def chat_threads(principal: PartnerPrincipal = Depends(get_compat_principal)):
  bookings, customer_records, expert_records = await asyncio.gather(
    real_workspace.list_partner_bookings(principal),
    real_workspace.list_partner_customers(principal),
    real_workspace.list_experts(principal),
  )
  customers = {item["id"]: item for item in customer_records}
  experts = {item["id"]: item for item in expert_records}
  reports_by_customer, messages_by_booking = await asyncio.gather(
    real_workspace.list_shared_reports_for_bookings(bookings),
    real_workspace.list_chat_messages_for_bookings([booking["id"] for booking in bookings]),
  )
  threads = []
  for booking in bookings:
    customer = customers.get(booking["customer_id"])
    expert = experts.get(booking["expert_id"])
    if customer is None or expert is None:
      continue
    reports = reports_by_customer.get(customer["id"], [])
    messages = messages_by_booking.get(booking["id"], [])
    threads.append({
      "thread": _thread_from_booking(booking, messages),
      "customer": customer,
      "booking": booking,
      "expert": expert,
      "shared_reports": reports,
      "messages": messages,
    })
  return ok({"threads": threads})


@router.get("/chat/threads/{thread_id}")
async def chat_thread_detail(thread_id: str, principal: PartnerPrincipal = Depends(get_compat_principal)):
  return ok({"detail": await real_workspace.get_chat_thread_detail(thread_id, principal)})


@router.post("/chat/threads/{thread_id}/read")
async def mark_chat_thread_read(thread_id: str, principal: PartnerPrincipal = Depends(get_compat_principal)):
  return ok({"detail": await real_workspace.get_chat_thread_detail(thread_id, principal)})


@router.get("/shared-reports")
async def shared_reports(customerId: str | None = Query(default=None), principal: PartnerPrincipal = Depends(get_compat_principal)):
  return ok({"reports": await real_workspace.list_shared_reports(principal, customerId)})


@router.get("/reports/{report_id}")
async def report_detail(report_id: str, principal: PartnerPrincipal = Depends(get_compat_principal)):
  report = await real_workspace.get_shared_report(report_id, principal)
  detail = dict(report.pop("detail", {}))
  kind = str(report.pop("kind", "analysis"))
  return ok({"report": report, "kind": kind, "detail": detail})


@router.get("/summaries/{booking_id}")
async def summary_for_booking(booking_id: str, principal: PartnerPrincipal = Depends(get_compat_principal)):
  return ok({"summary": await real_workspace.get_summary_for_booking(booking_id, principal)})


@router.post("/summaries/{booking_id}/generate")
async def generate_summary(booking_id: str, payload: dict, principal: PartnerPrincipal = Depends(get_compat_principal)):
  result = await real_workspace.generate_summary(
    booking_id,
    {
      "transcript": payload.get("transcript"),
      "internal_memo": payload.get("expert_comment") or payload.get("internal_memo"),
      "visible_to_customer": payload.get("visible_to_customer", True),
    },
    principal,
  )
  return ok(result)


@router.post("/summaries/{booking_id}/complete")
async def complete_summary(booking_id: str, payload: dict, principal: PartnerPrincipal = Depends(get_compat_principal)):
  result = await real_workspace.generate_summary(
    booking_id,
    {
      "transcript": payload.get("transcript"),
      "internal_memo": payload.get("expert_comment") or payload.get("internal_memo"),
      "visible_to_customer": payload.get("visible_to_customer", True),
    },
    principal,
  )
  return ok({"summary": result["summary"]})


def _camelize(value: Any) -> Any:
  if isinstance(value, BaseModel):
    return _camelize(value.model_dump(mode="json"))
  if isinstance(value, Enum):
    return value.value
  if isinstance(value, list):
    return [_camelize(item) for item in value]
  if isinstance(value, dict):
    return {_snake_to_camel(str(key)): _camelize(item) for key, item in value.items()}
  return value


def _thread_from_booking(booking: dict[str, Any], messages: list[dict[str, Any]]) -> dict[str, Any]:
  status = "waiting" if booking["status"] in {"requested", "contacting"} else "open"
  if booking["status"] in {"completed", "cancelled", "no_show"}:
    status = "closed"
  return {
    "id": f"thread-{booking['id']}",
    "customer_id": booking["customer_id"],
    "booking_id": booking["id"],
    "assigned_expert_id": booking["expert_id"],
    "last_message_at": messages[-1]["sent_at"] if messages else booking["requested_at"],
    "unread_count": 0,
    "status": status,
    "channel": "app_chat",
  }


def _snake_to_camel(key: str) -> str:
  parts = key.split("_")
  return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])
