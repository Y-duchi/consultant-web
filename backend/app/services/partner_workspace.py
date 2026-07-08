from __future__ import annotations

import asyncio
import copy
import json
from datetime import datetime, timezone

from fastapi import HTTPException

from app.services.auth import PartnerPrincipal, get_partner_principal, validate_partner_principal


def _now() -> str:
  return datetime.now(timezone.utc).isoformat()


_experts = [
  {"id": "exp-1", "business_id": "biz-1", "name": "김세아", "email": "seah.kim@example.com"},
  {"id": "exp-2", "business_id": "biz-1", "name": "정도아", "email": "doa.jung@example.com"},
  {"id": "exp-4", "business_id": "biz-2", "name": "한유리", "email": "yuri.han@example.com"},
]

_businesses = [
  {"id": "biz-1", "name": "AURA 성수 메이크업 스튜디오", "verification_status": "submitted", "exposure_status": "pending_review"},
  {"id": "biz-2", "name": "비비드 브로우 랩", "verification_status": "approved", "exposure_status": "public"},
]

_users = [
  {"id": "cus-1", "name": "지은", "phone": "010-3188-4921", "email": "jieun@example.com"},
  {"id": "cus-2", "name": "수민", "phone": "010-7402-6619", "email": "sumin@example.com"},
  {"id": "cus-6", "name": "서연", "phone": "010-4419-2201", "email": "seoyeon@example.com"},
]

_bookings = [
  {
    "id": "book-1",
    "expert_id": "exp-1",
    "customer_id": "cus-1",
    "status": "scheduled",
    "starts_at": "2026-07-08T19:00:00+09:00",
    "type": "퍼스널컬러 · 화상 30분",
  },
  {
    "id": "book-2",
    "expert_id": "exp-1",
    "customer_id": "cus-2",
    "status": "in_progress",
    "starts_at": "2026-07-08T10:30:00+09:00",
    "type": "메이크업 피드백 심화",
  },
  {
    "id": "book-9",
    "expert_id": "exp-4",
    "customer_id": "cus-6",
    "status": "scheduled",
    "starts_at": "2026-07-08T16:00:00+09:00",
    "type": "브로우 이미지 · 전화 30분",
  },
]

_summaries: list[dict] = []
_summary_jobs: list[dict] = [
  {
    "id": "summary-job-1",
    "booking_id": "book-6",
    "business_id": "biz-1",
    "expert_id": "exp-1",
    "requested_by": "account-1",
    "status": "succeeded",
    "source": "phone_transcript",
    "ai_model": "OPENAI_SUMMARY_MODEL",
    "created_at": _now(),
    "updated_at": _now(),
  }
]
_partner_events: list[dict] = []


def snapshot_partner_registry() -> dict[str, list[dict]]:
  return {
    "businesses": copy.deepcopy(_businesses),
    "experts": copy.deepcopy(_experts),
  }


def restore_partner_registry(snapshot: dict[str, list[dict]]) -> None:
  _businesses[:] = copy.deepcopy(snapshot["businesses"])
  _experts[:] = copy.deepcopy(snapshot["experts"])


def list_businesses() -> list[dict]:
  return _businesses


def list_experts() -> list[dict]:
  return _experts


def list_all_bookings() -> list[dict]:
  return sorted((_hydrate_booking(booking) for booking in _bookings), key=lambda booking: booking["starts_at"], reverse=True)


def list_summary_jobs() -> list[dict]:
  return sorted(_summary_jobs, key=lambda job: job["updated_at"], reverse=True)


def list_partner_events(principal: PartnerPrincipal, after_id: str | None = None) -> list[dict]:
  principal = validate_partner_principal(principal)
  scoped_events = [event for event in _partner_events if _can_receive_event(event, principal)]
  if after_id:
    try:
      after_index = next(index for index, event in enumerate(scoped_events) if event["id"] == after_id)
      scoped_events = scoped_events[after_index + 1:]
    except StopIteration:
      scoped_events = []
  return scoped_events


def create_booking_from_app(payload: dict) -> dict:
  if payload.get("business_id"):
    raise HTTPException(status_code=422, detail="business_id is derived from consulting_experts and cannot be supplied.")

  expert_id = (payload.get("expert_id") or "").strip()
  customer_id = (payload.get("customer_id") or "").strip()
  expert = _find_expert(expert_id)
  user = _find_user(customer_id)

  if expert is None:
    raise HTTPException(status_code=404, detail="Consulting expert not found.")
  if user is None:
    raise HTTPException(status_code=404, detail="User not found.")

  booking = {
    "id": payload.get("id") or f"book-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
    "expert_id": expert_id,
    "customer_id": customer_id,
    "status": payload.get("status") or "scheduled",
    "starts_at": payload.get("starts_at") or _now(),
    "type": payload.get("type") or "전화상담 30분",
  }
  _bookings.append(booking)
  hydrated = _hydrate_booking(booking)
  _record_partner_event(
    "booking.created",
    hydrated["business_id"],
    hydrated["expert_id"],
    booking_id=hydrated["id"],
    customer_id=hydrated["customer_id"],
    payload={"status": hydrated["status"], "starts_at": hydrated["starts_at"], "type": hydrated["type"]},
  )
  return hydrated


def update_booking_from_app(booking_id: str, patch: dict) -> dict:
  booking = next((item for item in _bookings if item["id"] == booking_id), None)
  if booking is None:
    raise HTTPException(status_code=404, detail="Booking not found.")

  for field in ("status", "starts_at", "type"):
    if field in patch:
      booking[field] = patch[field]

  hydrated = _hydrate_booking(booking)
  _record_partner_event(
    "booking.updated",
    hydrated["business_id"],
    hydrated["expert_id"],
    booking_id=hydrated["id"],
    customer_id=hydrated["customer_id"],
    payload={"status": hydrated["status"], "starts_at": hydrated["starts_at"], "type": hydrated["type"]},
  )
  return hydrated


def register_approved_partner(application: object, business_id: str) -> dict:
  business = next((item for item in _businesses if item["id"] == business_id), None)
  if business is None:
    business = {
      "id": business_id,
      "name": getattr(application, "business_name"),
      "owner_name": getattr(application, "owner_name"),
      "partner_type": getattr(application, "partner_type"),
      "verification_status": "approved",
      "exposure_status": "pending_review",
    }
    _businesses.insert(0, business)

  expert = next((item for item in _experts if item["business_id"] == business_id and item["email"] == getattr(application, "email")), None)
  if expert is None:
    expert = {
      "id": f"exp-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
      "business_id": business_id,
      "name": getattr(application, "owner_name"),
      "email": getattr(application, "email"),
      "phone": getattr(application, "phone"),
      "specialties": list(getattr(application, "specialties", [])),
      "categories": list(getattr(application, "categories", [])),
      "price_30_min": getattr(application, "price_30_min"),
      "price_60_min": getattr(application, "price_60_min"),
      "exposure_status": "pending_review",
    }
    _experts.insert(0, expert)

  return {"business": business, "expert": expert}


def admin_dashboard() -> dict:
  return {
    "pending_application_count": 1,
    "approved_business_count": 1,
    "today_booking_count": len(_bookings),
    "failed_summary_job_count": len([job for job in _summary_jobs if job["status"] == "failed"]),
    "summary_jobs": list_summary_jobs()[:5],
  }


def partner_me(principal: PartnerPrincipal) -> dict:
  principal = validate_partner_principal(principal)
  return {
    "account_id": principal.account_id,
    "role": principal.role,
    "business_id": principal.business_id,
    "expert_id": principal.expert_id,
    "workspace_scope": principal.workspace_scope,
  }


def partner_dashboard(principal: PartnerPrincipal) -> dict:
  principal = validate_partner_principal(principal)
  scoped_bookings = list_partner_bookings(principal)
  return {
    "business_id": principal.business_id,
    "today_booking_count": len(scoped_bookings),
    "pending_summary_count": len([booking for booking in scoped_bookings if booking["status"] in {"scheduled", "in_progress"}]),
    "unread_message_count": 0,
  }


def list_partner_bookings(principal: PartnerPrincipal) -> list[dict]:
  principal = validate_partner_principal(principal)
  return [_hydrate_booking(booking) for booking in _bookings if _can_access_booking(booking, principal)]


def list_partner_customers(principal: PartnerPrincipal) -> list[dict]:
  principal = validate_partner_principal(principal)
  customer_ids = {booking["customer_id"] for booking in list_partner_bookings(principal)}
  return [user for user in _users if user["id"] in customer_ids]


def get_partner_customer(customer_id: str, principal: PartnerPrincipal) -> dict:
  principal = validate_partner_principal(principal)
  bookings = [booking for booking in list_partner_bookings(principal) if booking["customer_id"] == customer_id]
  if not bookings:
    raise HTTPException(status_code=404, detail="Customer not found in this partner scope.")
  customer = next((item for item in _users if item["id"] == customer_id), None)
  if customer is None:
    raise HTTPException(status_code=404, detail="Customer not found.")
  return {"customer": customer, "bookings": bookings}


def list_partner_chats(principal: PartnerPrincipal) -> list[dict]:
  principal = validate_partner_principal(principal)
  return [
    {
      "id": f"thread-{booking['id']}",
      "booking_id": booking["id"],
      "business_id": booking["business_id"],
      "expert_id": booking["expert_id"],
      "customer_id": booking["customer_id"],
      "unread_count": 0,
    }
    for booking in list_partner_bookings(principal)
  ]


def get_summary_for_booking(booking_id: str, principal: PartnerPrincipal) -> dict:
  principal = validate_partner_principal(principal)
  booking = _get_scoped_booking(booking_id, principal)
  summary = next((item for item in _summaries if item["booking_id"] == booking["id"]), None)
  if summary is None:
    raise HTTPException(status_code=404, detail="Summary not found for this booking.")
  return summary


def get_customer_visible_summary(booking_id: str) -> dict:
  raw_booking = next((item for item in _bookings if item["id"] == booking_id), None)
  booking = _hydrate_booking(raw_booking) if raw_booking else None
  if booking is None:
    raise HTTPException(status_code=404, detail="Booking not found.")
  if booking["status"] != "completed":
    raise HTTPException(status_code=404, detail="Customer-visible summary is only available for completed bookings.")

  summary = next(
    (item for item in _summaries if item["booking_id"] == booking_id and item.get("visible_to_customer")),
    None,
  )
  if summary is None:
    raise HTTPException(status_code=404, detail="Customer-visible summary not found.")

  return {
    "id": summary["id"],
    "booking_id": summary["booking_id"],
    "customer_id": summary["customer_id"],
    "source": summary["source"],
    "ai_status": summary["ai_status"],
    "customer_summary": summary["customer_summary"],
    "recommendations": summary["recommendations"],
    "created_at": summary["created_at"],
  }


def generate_summary(booking_id: str, payload: dict, principal: PartnerPrincipal) -> dict:
  principal = validate_partner_principal(principal)
  booking = _get_scoped_booking(booking_id, principal)
  transcript = (payload.get("transcript") or "").strip()
  internal_memo = (payload.get("internal_memo") or "").strip()
  if not transcript and not internal_memo:
    raise HTTPException(status_code=422, detail="transcript or internal_memo is required.")

  source_text = f"{transcript}\n{internal_memo}".lower()
  job = {
    "id": f"summary-job-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
    "booking_id": booking["id"],
    "business_id": booking["business_id"],
    "expert_id": booking["expert_id"],
    "requested_by": principal.account_id,
    "status": "processing",
    "source": "phone_transcript" if transcript else "manual_memo",
    "ai_model": "OPENAI_SUMMARY_MODEL",
    "created_at": _now(),
    "updated_at": _now(),
  }
  _summary_jobs.insert(0, job)

  if "fail" in source_text or "실패" in source_text:
    job["status"] = "failed"
    job["error_message"] = "OpenAI summary mock failed. Retry by calling generate again with corrected transcript or memo."
    job["updated_at"] = _now()
    _record_partner_event(
      "summary.failed",
      booking["business_id"],
      booking["expert_id"],
      booking_id=booking["id"],
      customer_id=booking["customer_id"],
      payload={"job_id": job["id"], "status": job["status"], "error_message": job["error_message"]},
    )
    raise HTTPException(status_code=502, detail=job["error_message"])

  job["status"] = "succeeded"
  job["updated_at"] = _now()
  _set_booking_status(booking["id"], "completed")
  booking["status"] = "completed"
  summary = {
    "id": f"summary-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
    "booking_id": booking["id"],
    "business_id": booking["business_id"],
    "expert_id": booking["expert_id"],
    "customer_id": booking["customer_id"],
    "source": "phone_ai",
    "ai_status": "succeeded",
    "ai_model": job["ai_model"],
    "transcript": transcript,
    "internal_memo": internal_memo,
    "customer_summary": "OpenAI 요약 결과가 저장되었습니다. 실제 환경에서는 Responses API 결과로 교체합니다.",
    "recommendations": "고객 공개 여부와 내부 메모를 분리해 앱/웹이 같은 저장 결과를 읽습니다.",
    "visible_to_customer": bool(payload.get("visible_to_customer", True)),
    "created_at": _now(),
  }
  _summaries[:] = [item for item in _summaries if item["booking_id"] != booking["id"]]
  _summaries.insert(0, summary)
  _record_partner_event(
    "summary.created",
    booking["business_id"],
    booking["expert_id"],
    booking_id=booking["id"],
    customer_id=booking["customer_id"],
    payload={"job_id": job["id"], "summary_id": summary["id"], "visible_to_customer": summary["visible_to_customer"]},
  )
  return {"job": job, "summary": summary}


async def partner_event_stream(principal: PartnerPrincipal, after_id: str | None = None):
  principal = validate_partner_principal(principal)
  last_event_id: str | None = after_id
  while True:
    events = list_partner_events(principal, after_id=last_event_id)
    for event in events:
      last_event_id = event["id"]
      yield f"id: {event['id']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"

    heartbeat = {
      "id": f"heartbeat-{int(datetime.now(timezone.utc).timestamp())}",
      "type": "heartbeat",
      "business_id": principal.business_id,
      "expert_id": principal.expert_id,
      "created_at": _now(),
    }
    yield f"data: {json.dumps(heartbeat, ensure_ascii=False)}\n\n"
    await asyncio.sleep(30)


def _get_scoped_booking(booking_id: str, principal: PartnerPrincipal) -> dict:
  booking = next((item for item in _bookings if item["id"] == booking_id), None)
  if booking is None or not _can_access_booking(booking, principal):
    raise HTTPException(status_code=404, detail="Booking not found in this partner scope.")
  return _hydrate_booking(booking)


def _can_access_booking(booking: dict, principal: PartnerPrincipal) -> bool:
  business_id = _business_id_for_booking(booking)
  if business_id != principal.business_id:
    return False
  if principal.workspace_scope == "expert_personal" and principal.expert_id:
    return booking["expert_id"] == principal.expert_id
  return True


def _hydrate_booking(booking: dict) -> dict:
  expert = _find_expert(booking["expert_id"])
  if expert is None:
    raise HTTPException(status_code=500, detail="Booking expert relationship is missing.")
  return {**booking, "business_id": expert["business_id"]}


def _business_id_for_booking(booking: dict) -> str | None:
  expert = _find_expert(booking["expert_id"])
  return expert["business_id"] if expert else None


def _find_expert(expert_id: str) -> dict | None:
  return next((item for item in _experts if item["id"] == expert_id), None)


def _find_user(user_id: str) -> dict | None:
  return next((item for item in _users if item["id"] == user_id), None)


def _set_booking_status(booking_id: str, status: str) -> None:
  booking = next((item for item in _bookings if item["id"] == booking_id), None)
  if booking is not None:
    booking["status"] = status


def _record_partner_event(
  event_type: str,
  business_id: str,
  expert_id: str | None = None,
  *,
  booking_id: str | None = None,
  customer_id: str | None = None,
  payload: dict | None = None,
) -> dict:
  sequence = len(_partner_events) + 1
  event = {
    "id": f"event-{int(datetime.now(timezone.utc).timestamp() * 1000)}-{len(_partner_events)}",
    "sequence": sequence,
    "type": event_type,
    "business_id": business_id,
    "expert_id": expert_id,
    "booking_id": booking_id,
    "customer_id": customer_id,
    "payload": payload or {},
    "created_at": _now(),
  }
  _partner_events.append(event)
  return event


def _can_receive_event(event: dict, principal: PartnerPrincipal) -> bool:
  if event["business_id"] != principal.business_id:
    return False
  if principal.workspace_scope == "expert_personal":
    return bool(principal.expert_id and event.get("expert_id") == principal.expert_id)
  return True
