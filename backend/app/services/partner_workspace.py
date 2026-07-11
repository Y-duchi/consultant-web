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
  {
    "id": "exp-1",
    "business_id": "biz-1",
    "name": "김세아",
    "role_label": "대표 메이크업 컨설턴트",
    "tagline": "AI 얼굴 리포트 기반 퍼스널컬러와 메이크업 처방",
    "email": "seah.kim@example.com",
    "phone": "010-2241-1900",
    "avatar_url": "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80",
    "specialties": ["메이크업", "퍼스널컬러", "웨딩"],
    "categories": ["퍼스널컬러", "메이크업"],
    "introduction": "앱 AI 리포트와 실제 화상 상담을 연결해 바로 따라 할 수 있는 메이크업 처방을 제공합니다.",
    "years_of_experience": 8,
    "credentials": [],
    "price_30_min": 19000,
    "price_60_min": 34000,
    "exposure_status": "public",
    "rating": 4.9,
    "review_count": 148,
    "consultation_count": 620,
    "rebooking_rate": 87,
    "response_within_minutes": 14,
  },
  {
    "id": "exp-2",
    "business_id": "biz-1",
    "name": "정도아",
    "role_label": "컬러 이미지 컨설턴트",
    "tagline": "사계절 세분 톤과 립/팔레트 추천",
    "email": "doa.jung@example.com",
    "phone": "010-7712-2200",
    "avatar_url": "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80",
    "specialties": ["퍼스널컬러", "컬러 코디", "립 추천"],
    "categories": ["퍼스널컬러", "컬러 코디"],
    "introduction": "조명과 카메라 조건을 함께 보고 고객에게 흔들리지 않는 컬러 기준을 정리합니다.",
    "years_of_experience": 6,
    "credentials": [],
    "price_30_min": 22000,
    "price_60_min": 39000,
    "exposure_status": "pending_review",
    "rating": 4.8,
    "review_count": 91,
    "consultation_count": 410,
    "rebooking_rate": 81,
    "response_within_minutes": 22,
  },
  {
    "id": "exp-4",
    "business_id": "biz-2",
    "name": "한유리",
    "role_label": "브로우 이미지 컨설턴트",
    "tagline": "눈썹과 헤어라인 중심 첫인상 상담",
    "email": "yuri.han@example.com",
    "phone": "010-5551-8821",
    "avatar_url": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80",
    "specialties": ["브로우", "헤어라인", "이미지 컨설팅"],
    "categories": ["메이크업", "헤어"],
    "introduction": "면접과 데일리 이미지에 맞는 브로우 밸런스와 헤어라인 정리 방향을 제안합니다.",
    "years_of_experience": 7,
    "credentials": [],
    "price_30_min": 21000,
    "price_60_min": 36000,
    "exposure_status": "public",
    "rating": 4.7,
    "review_count": 77,
    "consultation_count": 355,
    "rebooking_rate": 76,
    "response_within_minutes": 18,
  },
]

_businesses = [
  {
    "id": "biz-1",
    "partner_type": "business",
    "name": "AURA 성수 메이크업 스튜디오",
    "owner_name": "김세아",
    "business_registration_number": "123-45-67890",
    "phone": "02-468-1900",
    "address": "서울 성동구 연무장길 30 3층",
    "website": "https://example.com/aura-seongsu",
    "description": "퍼스널컬러, 메이크업 피드백, 패션/이미지 상담을 앱 AI 리포트와 함께 진행하는 뷰티 컨설팅 파트너입니다.",
    "photos": [],
    "exposure_status": "pending_review",
    "verification_status": "submitted",
    "verification_documents": [],
    "settlement_account_status": "reviewing",
    "default_operating_hours": [],
    "cancellation_policy": "예약 시작 24시간 전까지 무료 취소 가능하며 이후 취소는 파트너 확인 후 처리됩니다.",
    "refund_policy": "상담 미진행 또는 플랫폼 귀책 시 전액 환불됩니다.",
  },
  {
    "id": "biz-2",
    "partner_type": "business",
    "name": "비비드 브로우 랩",
    "owner_name": "한유리",
    "business_registration_number": "404-87-62014",
    "phone": "02-555-8821",
    "address": "서울 강남구 봉은사로 112 5층",
    "website": "https://example.com/vivid-brow",
    "description": "눈썹, 헤어라인, 데일리 이미지 방향을 전화 상담과 앱 리포트로 정리하는 파트너입니다.",
    "photos": [],
    "exposure_status": "public",
    "verification_status": "approved",
    "verification_documents": [],
    "settlement_account_status": "approved",
    "default_operating_hours": [],
    "cancellation_policy": "예약 시작 24시간 전까지 무료 취소 가능하며 이후 취소는 업체 확인 후 처리됩니다.",
    "refund_policy": "상담 미진행 또는 플랫폼 귀책 시 전액 환불됩니다.",
  },
]

_users = [
  {
    "id": "cus-1",
    "name": "지은",
    "phone": "010-3188-4921",
    "email": "jieun@example.com",
    "joined_at": "2026-06-10T10:20:00+09:00",
    "last_active_at": "2026-07-08T09:12:00+09:00",
    "tags": ["퍼스널컬러", "AI 얼굴 리포트"],
    "memo": "퍼스널컬러가 계속 애매하다고 느끼며 화상 30분 상담 예약. 고객 앱에서 리포트 3개 선택.",
    "profile_image_url": "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=400&q=80",
    "total_bookings": 2,
    "completed_bookings": 1,
    "total_paid_amount": 34200,
    "risk_flags": [],
    "preferred_channel": "chat",
    "attachments": [],
  },
  {
    "id": "cus-2",
    "name": "수민",
    "phone": "010-7402-6619",
    "email": "sumin@example.com",
    "joined_at": "2026-06-28T12:00:00+09:00",
    "last_active_at": "2026-07-08T09:48:00+09:00",
    "tags": ["재촬영 필요", "메이크업 피드백"],
    "memo": "AI 분석 결과 재촬영 필요 안내를 받고 상담 전 문의 중.",
    "profile_image_url": "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80",
    "total_bookings": 1,
    "completed_bookings": 0,
    "total_paid_amount": 19000,
    "risk_flags": [],
    "preferred_channel": "chat",
    "attachments": [],
  },
  {
    "id": "cus-6",
    "name": "서연",
    "phone": "010-4419-2201",
    "email": "seoyeon@example.com",
    "joined_at": "2026-07-01T10:00:00+09:00",
    "last_active_at": "2026-07-08T11:32:00+09:00",
    "tags": ["브로우", "면접 이미지"],
    "memo": "전화 상담 후 요약 리포트 앱 확인을 원함.",
    "profile_image_url": "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=400&q=80",
    "total_bookings": 1,
    "completed_bookings": 0,
    "total_paid_amount": 21000,
    "risk_flags": [],
    "preferred_channel": "chat",
    "attachments": [],
  },
]

_bookings = [
  {
    "id": "book-1",
    "expert_id": "exp-1",
    "customer_id": "cus-1",
    "status": "scheduled",
    "starts_at": "2026-07-08T19:00:00+09:00",
    "ends_at": "2026-07-08T19:30:00+09:00",
    "duration_minutes": 30,
    "type": "퍼스널컬러 · 화상 30분",
    "payment_status": "paid",
    "paid_amount": 15200,
    "discount_amount": 3800,
    "channel": "video",
    "requested_at": "2026-07-07T22:15:00+09:00",
    "request_memo": "퍼스널컬러가 헷갈려요. 선택한 리포트 3개를 같이 보고 지금 화장에서 바꿀 점을 알고 싶어요.",
    "selected_concern_tags": ["퍼스널컬러가 헷갈려요", "메이크업 피드백 심화"],
    "internal_memo": "선결제 확인 완료. 전문가가 상담 확정 후 예약 시간에 화상통화를 진행합니다.",
    "shared_report_ids": ["report-1", "report-2", "report-3"],
    "review_request_status": "not_ready",
  },
  {
    "id": "book-2",
    "expert_id": "exp-1",
    "customer_id": "cus-2",
    "status": "in_progress",
    "starts_at": "2026-07-08T10:30:00+09:00",
    "ends_at": "2026-07-08T11:00:00+09:00",
    "duration_minutes": 30,
    "type": "메이크업 피드백 심화",
    "payment_status": "paid",
    "paid_amount": 19000,
    "discount_amount": 0,
    "channel": "video",
    "requested_at": "2026-07-05T09:45:00+09:00",
    "request_memo": "AI 분석에서 재촬영 필요가 나왔는데 상담으로 보완 가능한지 확인하고 싶어요.",
    "selected_concern_tags": ["메이크업 피드백 심화", "재촬영 필요"],
    "internal_memo": "상담 중. 통화 종료 후 transcript 기반 AI 요약 생성 예정.",
    "shared_report_ids": ["report-4"],
    "review_request_status": "not_ready",
  },
  {
    "id": "book-9",
    "expert_id": "exp-4",
    "customer_id": "cus-6",
    "status": "requested",
    "starts_at": "2026-07-08T16:00:00+09:00",
    "ends_at": "2026-07-08T16:30:00+09:00",
    "duration_minutes": 30,
    "type": "브로우 이미지 · 전화 30분",
    "payment_status": "pending",
    "paid_amount": 21000,
    "discount_amount": 0,
    "channel": "chat",
    "requested_at": "2026-07-07T13:10:00+09:00",
    "request_memo": "면접 전에 눈썹 산과 헤어라인을 어떻게 정리할지 전화로 상담받고 싶어요.",
    "selected_concern_tags": ["브로우 밸런스", "면접 이미지"],
    "internal_memo": "예약 신청 접수. 채팅방에서 예약금 입금 확인 후 전문가 확정 필요.",
    "shared_report_ids": [],
    "review_request_status": "not_ready",
  },
]

_shared_reports = [
  {
    "id": "report-1",
    "customer_id": "cus-1",
    "booking_id": "book-1",
    "title": "룩톡 Bedrock 추천 QA",
    "category": "추천 로직 QA",
    "created_at": "2026-07-04T22:10:00+09:00",
    "source": "customer_app",
    "summary": "글로우 코랄 데일리 룩 추천 결과와 고객의 선호 답변이 포함되어 있습니다.",
    "attachment_ids": [],
  },
  {
    "id": "report-2",
    "customer_id": "cus-1",
    "booking_id": "book-1",
    "title": "AI 맞춤 메이크업 분석",
    "category": "메이크업 피드백",
    "created_at": "2026-07-06T21:35:00+09:00",
    "source": "customer_app",
    "summary": "얼굴 프레임, 블러셔 위치, 립 채도 기준으로 보완 포인트가 표시됩니다.",
    "attachment_ids": [],
  },
  {
    "id": "report-3",
    "customer_id": "cus-1",
    "booking_id": "book-1",
    "title": "퍼스널컬러 진단 결과",
    "category": "톤 진단",
    "created_at": "2026-07-06T21:36:00+09:00",
    "source": "customer_app",
    "summary": "여름 쿨 계열 후보와 데일리 팔레트 추천이 포함되어 있습니다.",
    "attachment_ids": [],
  },
  {
    "id": "report-4",
    "customer_id": "cus-2",
    "booking_id": "book-2",
    "title": "AI 맞춤 메이크업 분석",
    "category": "재촬영 필요",
    "created_at": "2026-07-07T18:20:00+09:00",
    "source": "customer_app",
    "summary": "얼굴이 프레임 안에 들어오지 않아 퍼스널 컬러 및 메이크업 일부 결과 신뢰도가 낮습니다.",
    "attachment_ids": [],
  },
]

_chat_messages = [
  {
    "id": "msg-backend-1",
    "thread_id": "thread-book-1",
    "sender_type": "customer",
    "sender_name": "지은",
    "body": "오늘 상담 전에 제가 선택한 룩톡 추천 QA랑 AI 메이크업 분석도 같이 봐주실 수 있을까요?",
    "sent_at": "2026-07-08T09:05:00+09:00",
    "attachments": [],
  },
  {
    "id": "msg-backend-2",
    "thread_id": "thread-book-9",
    "sender_type": "customer",
    "sender_name": "서연",
    "body": "예약금 입금 후 전문가 확정되면 전화 상담이 진행되는 흐름이 맞나요?",
    "sent_at": "2026-07-08T11:32:00+09:00",
    "attachments": [],
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
    "status": payload.get("status") or "requested",
    "starts_at": payload.get("starts_at") or _now(),
    "ends_at": payload.get("ends_at") or payload.get("starts_at") or _now(),
    "duration_minutes": payload.get("duration_minutes") or 30,
    "type": payload.get("type") or "전화상담 30분",
    "payment_status": payload.get("payment_status") or "pending",
    "paid_amount": payload.get("paid_amount") or expert.get("price_30_min", 0),
    "discount_amount": payload.get("discount_amount") or 0,
    "channel": payload.get("channel") or "video",
    "requested_at": payload.get("requested_at") or _now(),
    "request_memo": payload.get("request_memo") or "앱에서 예약을 신청했습니다. 채팅방에서 입금 확인 후 전문가가 확정합니다.",
    "selected_concern_tags": payload.get("selected_concern_tags") or [],
    "internal_memo": "예약 신청 접수. 채팅방 생성 및 예약금 안내 필요.",
    "shared_report_ids": payload.get("shared_report_ids") or [],
    "review_request_status": "not_ready",
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
      "address": getattr(application, "offline_address", None) or "",
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
      "consulting_modes": [getattr(mode, "value", mode) for mode in getattr(application, "consulting_modes", [])],
      "online_price_30_min": getattr(application, "online_price_30_min", None),
      "online_price_60_min": getattr(application, "online_price_60_min", None),
      "offline_price_30_min": getattr(application, "offline_price_30_min", None),
      "offline_price_60_min": getattr(application, "offline_price_60_min", None),
      "offline_address": getattr(application, "offline_address", None),
      "offline_detail_address": getattr(application, "offline_detail_address", None),
      "offline_location_note": getattr(application, "offline_location_note", None),
      "exposure_status": "pending_review",
    }
    _experts.insert(0, expert)

  return {"business": business, "expert": expert}


def admin_dashboard() -> dict:
  from app.services import partner_applications

  applications = partner_applications.list_applications()
  today = datetime.now(timezone.utc).date().isoformat()
  today_bookings = [
    booking for booking in list_all_bookings() if str(booking.get("starts_at", "")).startswith(today)
  ]
  return {
    "pending_application_count": len([application for application in applications if application.status == "submitted"]),
    "needs_update_application_count": len([application for application in applications if application.status == "needs_update"]),
    "approved_business_count": len([business for business in _businesses if business.get("verification_status") == "approved"]),
    "total_expert_count": len(_experts),
    "today_booking_count": len(today_bookings),
    "refund_request_count": len([booking for booking in _bookings if booking.get("status") == "refund_requested"]),
    "failed_summary_job_count": len([job for job in _summary_jobs if job["status"] == "failed"]),
    "hidden_or_reported_review_count": 0,
    "recent_applications": applications[:5],
    "today_bookings": today_bookings,
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


def get_partner_booking(booking_id: str, principal: PartnerPrincipal) -> dict:
  principal = validate_partner_principal(principal)
  return _get_scoped_booking(booking_id, principal)


def update_partner_booking_status(booking_id: str, status: str, principal: PartnerPrincipal) -> dict:
  principal = validate_partner_principal(principal)
  booking = _get_scoped_booking(booking_id, principal)
  if status in {"confirmed", "scheduled", "in_progress"} and booking.get("payment_status") != "paid":
    raise HTTPException(status_code=422, detail="Payment or deposit must be confirmed before expert confirmation.")
  _set_booking_status(booking_id, status)
  raw = next(item for item in _bookings if item["id"] == booking_id)
  if status == "completed":
    raw["review_request_status"] = "ready"
  if status in {"cancelled", "no_show"}:
    raw["review_request_status"] = "not_ready"
  hydrated = _hydrate_booking(raw)
  _record_partner_event(
    "booking.updated",
    hydrated["business_id"],
    hydrated["expert_id"],
    booking_id=hydrated["id"],
    customer_id=hydrated["customer_id"],
    payload={"status": hydrated["status"]},
  )
  return hydrated


def mark_partner_booking_payment_paid(booking_id: str, principal: PartnerPrincipal) -> dict:
  principal = validate_partner_principal(principal)
  booking = _get_scoped_booking(booking_id, principal)
  raw = next(item for item in _bookings if item["id"] == booking_id)
  raw["payment_status"] = "paid"
  if raw.get("status") == "requested":
    raw["status"] = "contacting"
  raw["internal_memo"] = "\n".join(
    item for item in [raw.get("internal_memo"), "선결제/예약금 입금 확인. 전문가 확정 대기 상태로 전환했습니다."] if item
  )
  hydrated = _hydrate_booking(raw)
  _record_partner_event(
    "booking.updated",
    booking["business_id"],
    booking["expert_id"],
    booking_id=booking["id"],
    customer_id=booking["customer_id"],
    payload={"status": hydrated["status"], "payment_status": "paid"},
  )
  return hydrated


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


def list_shared_reports(principal: PartnerPrincipal, customer_id: str | None = None) -> list[dict]:
  principal = validate_partner_principal(principal)
  scoped_bookings = list_partner_bookings(principal)
  scoped_booking_ids = {booking["id"] for booking in scoped_bookings}
  scoped_customer_ids = {booking["customer_id"] for booking in scoped_bookings}
  return [
    report
    for report in _shared_reports
    if report["customer_id"] in scoped_customer_ids
    and (customer_id is None or report["customer_id"] == customer_id)
    and (not report.get("booking_id") or report["booking_id"] in scoped_booking_ids)
  ]


def get_shared_report(report_id: str, principal: PartnerPrincipal) -> dict:
  report = next((item for item in list_shared_reports(principal) if item["id"] == report_id), None)
  if report is None:
    raise HTTPException(status_code=404, detail="Shared report not found in this partner scope.")
  return report


def list_summaries(principal: PartnerPrincipal, customer_id: str | None = None) -> list[dict]:
  principal = validate_partner_principal(principal)
  scoped_bookings = list_partner_bookings(principal)
  scoped_booking_ids = {booking["id"] for booking in scoped_bookings}
  return [
    summary
    for summary in _summaries
    if summary["booking_id"] in scoped_booking_ids and (customer_id is None or summary["customer_id"] == customer_id)
  ]


def list_chat_messages(thread_id: str) -> list[dict]:
  return [message for message in _chat_messages if message["thread_id"] == thread_id]


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
  starts_at = booking.get("starts_at") or _now()
  return {
    "ends_at": booking.get("ends_at") or starts_at,
    "duration_minutes": booking.get("duration_minutes") or 30,
    "payment_status": booking.get("payment_status") or "pending",
    "paid_amount": booking.get("paid_amount") or 0,
    "discount_amount": booking.get("discount_amount") or 0,
    "channel": booking.get("channel") or "video",
    "requested_at": booking.get("requested_at") or starts_at,
    "request_memo": booking.get("request_memo") or "",
    "selected_concern_tags": booking.get("selected_concern_tags") or [],
    "internal_memo": booking.get("internal_memo") or "",
    "shared_report_ids": booking.get("shared_report_ids") or [],
    "consultation_summary_id": booking.get("consultation_summary_id"),
    "refund_request_id": booking.get("refund_request_id"),
    "review_id": booking.get("review_id"),
    "review_request_status": booking.get("review_request_status") or "not_ready",
    **booking,
    "business_id": expert["business_id"],
  }


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
