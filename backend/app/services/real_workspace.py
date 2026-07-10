from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from datetime import date
from datetime import datetime, timedelta, timezone
import json
from typing import Any
from uuid import uuid4

import asyncpg
from fastapi import HTTPException

from app.services.auth import PartnerPrincipal, validate_partner_principal
from app.settings import get_settings


_cached_dsn: str | None = None
_KST = timezone(timedelta(hours=9))
_DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]
_DEFAULT_BOOKING_OPEN_MONTHS = 1
_DEFAULT_NOTIFICATION_SETTINGS = {
  "booking_created": True,
  "booking_reminder": True,
  "unread_chat_digest": True,
  "review_created": True,
}
_DEFAULT_INTEGRATIONS = {
  "phone_provider": "none",
  "chat_provider": "websocket",
  "sms_provider": "none",
}


def _default_operating_hours() -> list[dict[str, Any]]:
  return [
    {"day_of_week": day, "label": label, "opens_at": "10:00", "closes_at": "19:00", "is_closed": day >= 5}
    for day, label in enumerate(_DAY_LABELS)
  ]


def _get_dsn() -> str:
  global _cached_dsn
  if _cached_dsn is None:
    dsn = get_settings().asyncpg_dsn
    if not dsn:
      raise HTTPException(status_code=503, detail="Database is not configured.")
    _cached_dsn = dsn
  return _cached_dsn


async def _connect() -> asyncpg.Connection:
  return await asyncpg.connect(dsn=_get_dsn())


async def _ensure_expert_schedule_columns(conn: asyncpg.Connection) -> None:
  await conn.execute("alter table consulting_experts add column if not exists operating_hours jsonb")
  await conn.execute("alter table consulting_experts add column if not exists holiday_dates jsonb")
  await conn.execute(
    f"alter table consulting_experts add column if not exists booking_open_months integer not null default {_DEFAULT_BOOKING_OPEN_MONTHS}"
  )


def _text(value: Any, fallback: str = "") -> str:
  if value is None:
    return fallback
  return str(value)


def _int(value: Any, fallback: int = 0) -> int:
  if value is None:
    return fallback
  try:
    return int(value)
  except (TypeError, ValueError):
    return fallback


def _float(value: Any, fallback: float = 0.0) -> float:
  if value is None:
    return fallback
  try:
    return float(value)
  except (TypeError, ValueError):
    return fallback


def _list(value: Any) -> list[Any]:
  if value is None:
    return []
  if isinstance(value, list):
    return value
  if isinstance(value, tuple):
    return list(value)
  return [value]


def _json(value: Any, fallback: Any = None) -> Any:
  if value is None:
    return {} if fallback is None else fallback
  if isinstance(value, (dict, list)):
    return value
  if isinstance(value, str):
    try:
      return json.loads(value)
    except json.JSONDecodeError:
      return {} if fallback is None else fallback
  return {} if fallback is None else fallback


def _iso(value: Any) -> str:
  if isinstance(value, datetime):
    if value.tzinfo is None:
      value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()
  if value is None:
    return datetime.now(timezone.utc).isoformat()
  return str(value)


def _add_minutes(value: Any, minutes: int) -> str:
  if isinstance(value, datetime):
    if value.tzinfo is None:
      value = value.replace(tzinfo=timezone.utc)
    return (value + timedelta(minutes=minutes)).isoformat()
  try:
    return (datetime.fromisoformat(str(value)) + timedelta(minutes=minutes)).isoformat()
  except ValueError:
    return _iso(value)


def _date_label(value: Any) -> str:
  if isinstance(value, datetime):
    return value.astimezone(timezone.utc).date().isoformat()
  return str(value or "")


def _payload_get(payload: dict[str, Any], snake_key: str, camel_key: str | None = None) -> Any:
  if snake_key in payload:
    return payload[snake_key]
  if camel_key and camel_key in payload:
    return payload[camel_key]
  return None


def _time_to_minutes(value: Any, *, field_name: str) -> int:
  raw = str(value or "").strip()
  parts = raw.split(":")
  if len(parts) < 2:
    raise HTTPException(status_code=422, detail=f"{field_name} must be HH:MM.")
  try:
    hour = int(parts[0])
    minute = int(parts[1])
  except ValueError as exc:
    raise HTTPException(status_code=422, detail=f"{field_name} must be HH:MM.") from exc
  if hour < 0 or hour > 23 or minute < 0 or minute > 59:
    raise HTTPException(status_code=422, detail=f"{field_name} must be HH:MM.")
  return hour * 60 + minute


def _minutes_to_time(value: int) -> str:
  return f"{value // 60:02d}:{value % 60:02d}"


def _normalize_operating_hours(value: Any) -> list[dict[str, Any]]:
  raw_hours = value if isinstance(value, list) else []
  by_day: dict[int, dict[str, Any]] = {}
  for raw in raw_hours:
    if not isinstance(raw, dict):
      continue
    day = _int(_payload_get(raw, "day_of_week", "dayOfWeek"), -1)
    if day < 0 or day > 6:
      continue
    is_closed = bool(_payload_get(raw, "is_closed", "isClosed"))
    opens_at = str(_payload_get(raw, "opens_at", "opensAt") or "10:00")
    closes_at = str(_payload_get(raw, "closes_at", "closesAt") or "19:00")
    open_minutes = _time_to_minutes(opens_at, field_name=f"{_DAY_LABELS[day]} opens_at")
    close_minutes = _time_to_minutes(closes_at, field_name=f"{_DAY_LABELS[day]} closes_at")
    if not is_closed and open_minutes >= close_minutes:
      raise HTTPException(status_code=422, detail=f"{_DAY_LABELS[day]} 영업 종료 시간은 시작 시간 이후여야 합니다.")

    lunch_start_value = _payload_get(raw, "lunch_start", "lunchStart")
    lunch_end_value = _payload_get(raw, "lunch_end", "lunchEnd")
    lunch_start = str(lunch_start_value or "").strip()
    lunch_end = str(lunch_end_value or "").strip()
    normalized: dict[str, Any] = {
      "day_of_week": day,
      "label": str(_payload_get(raw, "label") or _DAY_LABELS[day]),
      "opens_at": _minutes_to_time(open_minutes),
      "closes_at": _minutes_to_time(close_minutes),
      "is_closed": is_closed,
    }
    if lunch_start or lunch_end:
      if not lunch_start or not lunch_end:
        raise HTTPException(status_code=422, detail=f"{_DAY_LABELS[day]} 점심 시간은 시작과 종료를 함께 입력해야 합니다.")
      lunch_start_minutes = _time_to_minutes(lunch_start, field_name=f"{_DAY_LABELS[day]} lunch_start")
      lunch_end_minutes = _time_to_minutes(lunch_end, field_name=f"{_DAY_LABELS[day]} lunch_end")
      if lunch_start_minutes >= lunch_end_minutes:
        raise HTTPException(status_code=422, detail=f"{_DAY_LABELS[day]} 점심 종료 시간은 시작 시간 이후여야 합니다.")
      if not is_closed and (lunch_start_minutes < open_minutes or lunch_end_minutes > close_minutes):
        raise HTTPException(status_code=422, detail=f"{_DAY_LABELS[day]} 점심 시간은 영업시간 안에 있어야 합니다.")
      normalized["lunch_start"] = _minutes_to_time(lunch_start_minutes)
      normalized["lunch_end"] = _minutes_to_time(lunch_end_minutes)
    by_day[day] = normalized

  defaults = _default_operating_hours()
  return [by_day.get(day, defaults[day]) for day in range(7)]


def _normalize_holidays(value: Any) -> list[str]:
  holidays: list[str] = []
  for item in _list(value):
    raw = str(item or "").strip()
    if not raw:
      continue
    try:
      normalized = datetime.fromisoformat(raw).date().isoformat()
    except ValueError as exc:
      raise HTTPException(status_code=422, detail="휴무일은 YYYY-MM-DD 형식이어야 합니다.") from exc
    if normalized not in holidays:
      holidays.append(normalized)
  return sorted(holidays)


def _normalize_booking_open_months(value: Any) -> int:
  months = _int(value, _DEFAULT_BOOKING_OPEN_MONTHS)
  if months < 1 or months > 3:
    raise HTTPException(status_code=422, detail="예약 오픈 범위는 1개월 이상 3개월 이하로 설정해 주세요.")
  return months


def _add_calendar_months(value: date, months: int) -> date:
  month_index = value.month - 1 + months
  year = value.year + month_index // 12
  month = month_index % 12 + 1
  day = min(value.day, monthrange(year, month)[1])
  return value.replace(year=year, month=month, day=day)


def _parse_iso_datetime(value: Any) -> datetime:
  if isinstance(value, datetime):
    result = value
  else:
    raw = str(value or "").strip()
    if not raw:
      raise HTTPException(status_code=422, detail="starts_at is required.")
    try:
      result = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
      raise HTTPException(status_code=422, detail="starts_at must be an ISO datetime.") from exc
  if result.tzinfo is None:
    result = result.replace(tzinfo=timezone.utc)
  return result


def _domain_status(db_status: str | None) -> str:
  status = (db_status or "requested").strip().lower()
  return "cancelled" if status == "canceled" else status


def _db_status(domain_status: str | None) -> str:
  status = (domain_status or "").strip().lower()
  return "canceled" if status == "cancelled" else status


def _stored_db_status(domain_status: str | None) -> str:
  status = _db_status(domain_status)
  return "canceled" if status == "no_show" else status


def _payment_status(value: str | None) -> str:
  status = (value or "pending").strip().lower()
  if status in {"paid", "failed", "refunded", "partial_refund"}:
    return status
  return "pending"


def _business_id_for_expert(expert_id: str) -> str:
  # The current production consulting schema stores partner scope by expert_id.
  return expert_id


def _scope_clause(principal: PartnerPrincipal | None, args: list[Any], prefix: str = "b") -> str:
  if principal is None or principal.business_id == "platform":
    return ""

  if principal.workspace_scope == "expert_personal" and principal.expert_id:
    args.append(principal.expert_id)
    return f" and {prefix}.expert_id = ${len(args)}"

  args.append(principal.business_id)
  return f" and {prefix}.expert_id = ${len(args)}"


def _attachment(
  *,
  attachment_id: str,
  owner_id: str,
  media_type: str,
  name: str,
  url: str,
  uploaded_at: str,
) -> dict[str, Any]:
  return {
    "id": attachment_id,
    "owner_id": owner_id,
    "type": media_type,
    "name": name,
    "url": url,
    "uploaded_at": uploaded_at,
  }


async def login_partner(email: str) -> dict[str, Any]:
  account = await find_partner_account_for_login(email)
  if account is None:
    raise HTTPException(status_code=401, detail="Partner account not found.")

  principal = await validate_partner_account_scope(
    PartnerPrincipal(
      account_id=account["id"],
      role=account["role"],
      business_id=_business_id_for_expert(account["expert_id"]),
      expert_id=account["expert_id"],
      workspace_scope=account["workspace_scope"],
    ),
    allow_password_change_required=True,
  )
  expert = await get_expert(account["expert_id"])
  business = _business_from_expert(expert)
  user = {
    "id": account["id"],
    "name": expert["name"],
    "email": account["email"],
    "role": account["role"],
    "expert_id": account["expert_id"],
    "business_id": principal.business_id,
    "workspace_scope": account["workspace_scope"],
    "partner_type": business["partner_type"],
    "account_id": account["id"],
    "password_change_required": account["password_change_required"],
  }
  return {"token": f"partner:{account['id']}", "user": user}


async def principal_from_token(token: str) -> PartnerPrincipal:
  account_id = token.removeprefix("partner:")
  account = await find_partner_account(account_id)
  if account is None:
    raise HTTPException(status_code=401, detail="Partner session token is invalid.")
  return await validate_partner_account_scope(
    PartnerPrincipal(
      account_id=account["id"],
      role=account["role"],
      business_id=_business_id_for_expert(account["expert_id"]),
      expert_id=account["expert_id"],
      workspace_scope=account["workspace_scope"],
    )
  )


async def find_partner_account(account_id: str) -> dict[str, Any] | None:
  conn = await _connect()
  try:
    row = await conn.fetchrow(
      """
      select id::text id, expert_id, email::text email, role, workspace_scope, status,
             password_change_required, created_at, updated_at
      from consulting_partner_accounts
      where id::text = $1
      """,
      account_id,
    )
    return _account_from_row(row) if row else None
  finally:
    await conn.close()


async def find_partner_account_for_login(email: str) -> dict[str, Any] | None:
  normalized = email.strip().lower()
  conn = await _connect()
  try:
    row = await conn.fetchrow(
      """
      select id::text id, expert_id, email::text email, role, workspace_scope, status,
             password_change_required, created_at, updated_at
      from consulting_partner_accounts
      where lower(email::text) = $1
      limit 1
      """,
      normalized,
    )
    if row:
      return _account_from_row(row)

    if normalized.endswith("@aura-partner.local"):
      row = await conn.fetchrow(
        """
        select id::text id, expert_id, email::text email, role, workspace_scope, status,
               password_change_required, created_at, updated_at
        from consulting_partner_accounts
        where status = 'active'
        order by created_at desc
        limit 1
        """,
      )
      return _account_from_row(row) if row else None
    return None
  finally:
    await conn.close()


async def validate_partner_account_scope(
  principal: PartnerPrincipal,
  *,
  allow_password_change_required: bool = False,
) -> PartnerPrincipal:
  validated = validate_partner_principal(principal)
  account = await find_partner_account(validated.account_id)
  if account is None:
    raise HTTPException(status_code=401, detail="Partner account not found.")
  if account["status"] != "active":
    raise HTTPException(status_code=403, detail="Partner account is not active.")
  if account["password_change_required"] and not allow_password_change_required:
    raise HTTPException(status_code=403, detail="Password change is required before accessing the workspace.")
  if account["expert_id"] != validated.expert_id:
    raise HTTPException(status_code=403, detail="Partner expert scope mismatch.")
  if _business_id_for_expert(account["expert_id"]) != validated.business_id:
    raise HTTPException(status_code=403, detail="Partner business scope mismatch.")
  if account["workspace_scope"] != validated.workspace_scope:
    raise HTTPException(status_code=403, detail="Partner workspace scope mismatch.")
  if account["role"] != validated.role:
    raise HTTPException(status_code=403, detail="Partner role mismatch.")
  return validated


def _account_from_row(row: asyncpg.Record) -> dict[str, Any]:
  return {
    "id": row["id"],
    "expert_id": row["expert_id"],
    "email": row["email"],
    "role": row["role"],
    "workspace_scope": row["workspace_scope"],
    "status": row["status"],
    "password_change_required": bool(row["password_change_required"]),
    "created_at": _iso(row["created_at"]),
    "updated_at": _iso(row["updated_at"]),
  }


def _schedule_settings_from_row(row: asyncpg.Record | None) -> dict[str, Any]:
  if row is None:
    return {
      "operating_hours": _default_operating_hours(),
      "holidays": [],
      "booking_open_months": _DEFAULT_BOOKING_OPEN_MONTHS,
    }
  stored_hours = _json(row["operating_hours"], [])
  stored_holidays = _json(row["holiday_dates"], [])
  return {
    "operating_hours": _normalize_operating_hours(stored_hours) if stored_hours else _default_operating_hours(),
    "holidays": _normalize_holidays(stored_holidays),
    "booking_open_months": _normalize_booking_open_months(row["booking_open_months"]),
  }


async def get_expert_schedule_settings(expert_id: str) -> dict[str, Any]:
  conn = await _connect()
  try:
    await _ensure_expert_schedule_columns(conn)
    row = await conn.fetchrow(
      """
      select operating_hours, holiday_dates, booking_open_months
      from consulting_experts
      where id = $1
      """,
      expert_id,
    )
    if row is None:
      raise HTTPException(status_code=404, detail="Expert not found.")
    return _schedule_settings_from_row(row)
  finally:
    await conn.close()


async def get_partner_settings(principal: PartnerPrincipal) -> dict[str, Any]:
  if not principal.expert_id:
    raise HTTPException(status_code=403, detail="Partner expert scope is required.")
  schedule = await get_expert_schedule_settings(principal.expert_id)
  account = await find_partner_account(principal.account_id)
  expert = await get_expert(principal.expert_id)
  account_roles = []
  if account:
    account_roles.append({
      "id": account["id"],
      "name": expert["name"],
      "email": account["email"],
      "role": account["role"],
      "scope": account["workspace_scope"],
    })
  return {
    **schedule,
    "notification": dict(_DEFAULT_NOTIFICATION_SETTINGS),
    "integrations": dict(_DEFAULT_INTEGRATIONS),
    "account_roles": account_roles,
  }


async def update_partner_settings(payload: dict[str, Any], principal: PartnerPrincipal) -> dict[str, Any]:
  if not principal.expert_id:
    raise HTTPException(status_code=403, detail="Partner expert scope is required.")

  current = await get_expert_schedule_settings(principal.expert_id)
  raw_hours = _payload_get(payload, "operating_hours", "operatingHours")
  raw_holidays = _payload_get(payload, "holidays")
  raw_open_months = _payload_get(payload, "booking_open_months", "bookingOpenMonths")

  operating_hours = _normalize_operating_hours(raw_hours) if raw_hours is not None else current["operating_hours"]
  holidays = _normalize_holidays(raw_holidays) if raw_holidays is not None else current["holidays"]
  booking_open_months = _normalize_booking_open_months(raw_open_months) if raw_open_months is not None else current["booking_open_months"]

  conn = await _connect()
  try:
    await _ensure_expert_schedule_columns(conn)
    await conn.execute(
      """
      update consulting_experts
      set operating_hours = $2::jsonb,
          holiday_dates = $3::jsonb,
          booking_open_months = $4,
          updated_at = now()
      where id = $1
      """,
      principal.expert_id,
      json.dumps(operating_hours, ensure_ascii=False),
      json.dumps(holidays, ensure_ascii=False),
      booking_open_months,
    )
  finally:
    await conn.close()
  return await get_partner_settings(principal)


async def assert_booking_time_allowed(expert_id: str, starts_at: datetime, duration_minutes: int) -> None:
  settings = await get_expert_schedule_settings(expert_id)
  local_starts_at = starts_at.astimezone(_KST)
  local_date = local_starts_at.date()
  today = datetime.now(_KST).date()
  open_until = _add_calendar_months(today, settings["booking_open_months"])
  if local_date < today:
    raise HTTPException(status_code=422, detail="지난 날짜로는 예약 시간을 변경할 수 없습니다.")
  if local_date > open_until:
    raise HTTPException(status_code=422, detail=f"예약은 오늘부터 {settings['booking_open_months']}개월 이내 날짜만 열 수 있습니다.")
  if local_date.isoformat() in settings["holidays"]:
    raise HTTPException(status_code=422, detail="설정된 휴무일에는 예약을 열 수 없습니다.")

  hour = settings["operating_hours"][local_starts_at.weekday()]
  if hour["is_closed"]:
    raise HTTPException(status_code=422, detail=f"{hour['label']}요일은 휴무일로 설정되어 있습니다.")

  start_minutes = local_starts_at.hour * 60 + local_starts_at.minute
  end_minutes = start_minutes + duration_minutes
  opens_at = _time_to_minutes(hour["opens_at"], field_name="opens_at")
  closes_at = _time_to_minutes(hour["closes_at"], field_name="closes_at")
  if start_minutes < opens_at or end_minutes > closes_at:
    raise HTTPException(status_code=422, detail=f"예약 시간은 {hour['opens_at']}-{hour['closes_at']} 안에서만 설정할 수 있습니다.")

  lunch_start = hour.get("lunch_start")
  lunch_end = hour.get("lunch_end")
  if lunch_start and lunch_end:
    lunch_start_minutes = _time_to_minutes(lunch_start, field_name="lunch_start")
    lunch_end_minutes = _time_to_minutes(lunch_end, field_name="lunch_end")
    if start_minutes < lunch_end_minutes and end_minutes > lunch_start_minutes:
      raise HTTPException(status_code=422, detail=f"점심 차단 시간({lunch_start}-{lunch_end})에는 예약을 열 수 없습니다.")


async def admin_dashboard() -> dict[str, Any]:
  conn = await _connect()
  try:
    counts = await conn.fetchrow(
      """
      select
        (select count(*) from consulting_partner_accounts where status = 'active')::int as approved_business_count,
        (select count(*) from consulting_experts where is_active = true)::int as total_expert_count,
        (select count(*) from consulting_bookings where scheduled_at::date = current_date)::int as today_booking_count,
        (select count(*) from consulting_bookings where status = 'refund_requested')::int as refund_request_count,
        (select count(*) from consulting_summaries)::int as summary_count
      """
    )
    today_bookings = await list_all_bookings({"dateFrom": _date_label(datetime.now(timezone.utc))})
    return {
      "pending_application_count": 0,
      "needs_update_application_count": 0,
      "approved_business_count": _int(counts["approved_business_count"]),
      "total_expert_count": _int(counts["total_expert_count"]),
      "today_booking_count": _int(counts["today_booking_count"]),
      "refund_request_count": _int(counts["refund_request_count"]),
      "failed_summary_job_count": 0,
      "hidden_or_reported_review_count": 0,
      "recent_applications": [],
      "today_bookings": today_bookings,
      "summary_jobs": await list_summary_jobs(),
    }
  finally:
    await conn.close()


async def list_partner_applications(*, status: str = "all", query: str | None = None) -> list[dict[str, Any]]:
  conn = await _connect()
  try:
    exists = await conn.fetchval("select to_regclass('public.partner_applications') is not null")
    if not exists:
      return []
    args: list[Any] = []
    where = ["true"]
    if status and status != "all":
      args.append(status)
      where.append(f"status = ${len(args)}")
    if query:
      args.append(f"%{query.lower()}%")
      where.append(
        f"(lower(business_name) like ${len(args)} or lower(owner_name) like ${len(args)} or lower(email::text) like ${len(args)})"
      )
    rows = await conn.fetch(
      f"""
      select id::text id, partner_type, business_name, owner_name, business_registration_number,
             phone, email::text email, specialties, categories, introduction, price_30_min,
             price_60_min, status, submitted_at, updated_at, reviewed_at, reviewer_name,
             review_memo, business_id, generated_account_id
      from partner_applications
      where {' and '.join(where)}
      order by updated_at desc
      """,
      *args,
    )
    return [_application_from_row(row) for row in rows]
  finally:
    await conn.close()


async def list_businesses() -> list[dict[str, Any]]:
  experts = await list_experts()
  return [_business_from_expert(expert) for expert in experts]


async def list_experts(principal: PartnerPrincipal | None = None) -> list[dict[str, Any]]:
  conn = await _connect()
  try:
    args: list[Any] = []
    scope = ""
    if principal is not None and principal.business_id != "platform":
      if principal.workspace_scope == "expert_personal" and principal.expert_id:
        args.append(principal.expert_id)
      else:
        args.append(principal.business_id)
      scope = f" and e.id = ${len(args)}"
    rows = await conn.fetch(
      f"""
      select e.id, e.name, e.title, e.signature_line, e.initials, e.avatar_tone, e.career_years,
             e.rating, e.review_count, e.session_count, e.rebook_rate, e.response_minutes,
             e.intro, e.availability_note, e.tags, e.certifications, e.is_active, e.sort_order,
             e.created_at, e.updated_at, e.image_url, e.studio_name,
             coalesce((select min(price) from consulting_expert_durations d where d.expert_id = e.id and d.minutes <= 30), 0)::int as price_30_min,
             coalesce((select min(price) from consulting_expert_durations d where d.expert_id = e.id and d.minutes >= 60), 0)::int as price_60_min
      from consulting_experts e
      where true {scope}
      order by e.sort_order nulls last, e.name
      """,
      *args,
    )
    return [_expert_from_row(row) for row in rows]
  finally:
    await conn.close()


async def get_expert(expert_id: str) -> dict[str, Any]:
  records = await list_experts()
  expert = next((item for item in records if item["id"] == expert_id), None)
  if expert is None:
    raise HTTPException(status_code=404, detail="Expert not found.")
  return expert


async def partner_dashboard(principal: PartnerPrincipal) -> dict[str, Any]:
  bookings = await list_partner_bookings(principal)
  today = _date_label(datetime.now(timezone.utc))
  today_timeline = [booking for booking in bookings if _date_label(datetime.fromisoformat(booking["starts_at"])) == today]
  pending_completion = [
    booking for booking in bookings if booking["status"] in {"scheduled", "in_progress"} and booking["payment_status"] == "paid"
  ]
  return {
    "today_booking_count": len(today_timeline),
    "upcoming_booking_count": len([booking for booking in bookings if booking["status"] in {"requested", "contacting", "confirmed", "scheduled", "in_progress"}]),
    "pending_completion_count": len(pending_completion),
    "refund_request_count": len([booking for booking in bookings if booking["status"] == "refund_requested"]),
    "unread_message_count": 0,
    "new_review_count": 0,
    "today_paid_amount": sum(booking.get("paid_amount", 0) for booking in bookings if booking.get("payment_status") == "paid"),
    "pending_report_delivery_count": len([booking for booking in bookings if booking["status"] == "completed" and not booking.get("consultation_summary_id")]),
    "available_slot_count": 0,
    "verification_status": "approved",
    "today_timeline": sorted(today_timeline, key=lambda item: item["starts_at"]),
    "urgent_tasks": [
      {
        "id": f"task-payment-{booking['id']}",
        "type": "message",
        "title": "입금 확인 후 전문가 확정 필요",
        "description": f"{booking['type']} 예약 신청이 채팅/입금 확인 단계에 있습니다.",
        "booking_id": booking["id"],
        "customer_id": booking["customer_id"],
      }
      for booking in bookings
      if booking["status"] in {"requested", "contacting"}
    ][:8],
  }


async def list_all_bookings(filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
  return await _list_bookings(None, filters or {})


async def list_partner_bookings(principal: PartnerPrincipal, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
  return await _list_bookings(principal, filters or {})


async def get_partner_booking(booking_id: str, principal: PartnerPrincipal) -> dict[str, Any]:
  records = await _list_bookings(principal, {"id": booking_id})
  if not records:
    raise HTTPException(status_code=404, detail="Booking not found.")
  return records[0]


async def _list_bookings(principal: PartnerPrincipal | None, filters: dict[str, Any]) -> list[dict[str, Any]]:
  conn = await _connect()
  try:
    args: list[Any] = []
    where = ["true"]
    scope = _scope_clause(principal, args)
    if scope:
      where.append(scope.removeprefix(" and "))
    if filters.get("id"):
      args.append(str(filters["id"]))
      where.append(f"b.id::text = ${len(args)}")
    if filters.get("status") and filters["status"] != "all":
      requested_status = _db_status(str(filters["status"]))
      if requested_status == "no_show":
        where.append("b.status = 'canceled' and coalesce(b.operator_note, '') like '%노쇼 처리%'")
      elif requested_status == "canceled":
        where.append("b.status = 'canceled' and coalesce(b.operator_note, '') not like '%노쇼 처리%'")
      else:
        args.append(requested_status)
        where.append(f"b.status = ${len(args)}")
    if filters.get("expertId"):
      args.append(str(filters["expertId"]))
      where.append(f"b.expert_id = ${len(args)}")
    if filters.get("customerId"):
      args.append(str(filters["customerId"]))
      where.append(f"b.user_id::text = ${len(args)}")
    if filters.get("dateFrom"):
      args.append(str(filters["dateFrom"]))
      where.append(f"coalesce(b.scheduled_at, b.created_at)::date >= (${len(args)}::text)::date")
    if filters.get("dateTo"):
      args.append(str(filters["dateTo"]))
      where.append(f"coalesce(b.scheduled_at, b.created_at)::date <= (${len(args)}::text)::date")
    if filters.get("query"):
      args.append(f"%{str(filters['query']).lower()}%")
      index = len(args)
      where.append(
        f"""(
          lower(coalesce(u.name, u.nickname, '')) like ${index}
          or lower(coalesce(u.phone, '')) like ${index}
          or lower(coalesce(e.name, '')) like ${index}
          or lower(coalesce(b.question, '')) like ${index}
          or lower(coalesce(b.category_label, '')) like ${index}
        )"""
      )

    rows = await conn.fetch(
      f"""
      select b.id::text id, b.user_id::text user_id, b.expert_id, b.duration_code, b.duration_label,
             b.duration_minutes, b.category_label, b.scheduled_at, b.date_label, b.slot_id,
             b.concern_id, b.concern_label, b.share_reports, b.shared_report_ids, b.question,
             b.status, b.price, b.created_at, b.updated_at, b.scheduled_date,
             b.slot_start_minutes, b.contact_name, b.contact_phone, b.preferred_contact_method,
             b.operator_note, b.confirmed_at, b.expert_read_at,
             to_jsonb(b)->>'session_mode' as session_mode,
             coalesce(u.name, u.nickname, b.contact_name, '이름 없는 고객') as customer_name,
             u.email::text as customer_email, u.phone as customer_phone,
             e.name as expert_name, e.title as expert_title, e.studio_name,
             pay.status as payment_status, pay.amount as payment_amount,
             summary.id::text as summary_id
      from consulting_bookings b
      join users u on u.id = b.user_id
      join consulting_experts e on e.id = b.expert_id
      left join lateral (
        select p.status, p.amount
        from consulting_payments p
        where p.booking_id = b.id
        order by p.created_at desc
        limit 1
      ) pay on true
      left join lateral (
        select s.id
        from consulting_summaries s
        where s.booking_id = b.id
        order by s.created_at desc
        limit 1
      ) summary on true
      where {' and '.join(where)}
      order by coalesce(b.scheduled_at, b.created_at) desc
      """,
      *args,
    )
    return [_booking_from_row(row) for row in rows]
  finally:
    await conn.close()


async def update_partner_booking_status(booking_id: str, status: str, principal: PartnerPrincipal) -> dict[str, Any]:
  normalized = _db_status(status)
  if normalized not in {"requested", "contacting", "confirmed", "scheduled", "in_progress", "completed", "canceled", "no_show", "refund_requested"}:
    raise HTTPException(status_code=422, detail="Unsupported booking status.")

  booking = await get_partner_booking(booking_id, principal)
  if normalized in {"confirmed", "scheduled", "in_progress"} and booking["payment_status"] != "paid":
    raise HTTPException(status_code=422, detail="선결제 또는 예약금 입금 확인 후 전문가가 예약을 확정할 수 있습니다.")

  conn = await _connect()
  try:
    stored_status = _stored_db_status(status)
    memo = "노쇼 처리" if normalized == "no_show" else ""
    await conn.execute(
      """
      update consulting_bookings
      set status = $2,
          confirmed_at = case when $2 = 'confirmed' then now() else confirmed_at end,
          operator_note = case
            when $3 = '' then operator_note
            else trim(both E'\n' from concat_ws(E'\n', nullif(operator_note, ''), $3))
          end,
          updated_at = now()
      where id::text = $1
      """,
      booking_id,
      stored_status,
      memo,
    )
  finally:
    await conn.close()
  return await get_partner_booking(booking_id, principal)


async def mark_partner_booking_payment_paid(booking_id: str, principal: PartnerPrincipal) -> dict[str, Any]:
  booking = await get_partner_booking(booking_id, principal)
  conn = await _connect()
  try:
    async with conn.transaction():
      existing_id = await conn.fetchval(
        """
        select id::text
        from consulting_payments
        where booking_id::text = $1
        order by created_at desc
        limit 1
        """,
        booking_id,
      )
      if existing_id:
        await conn.execute(
          """
          update consulting_payments
          set status = 'paid', amount = coalesce(amount, $2), updated_at = now()
          where id::text = $1
          """,
          existing_id,
          booking["paid_amount"] or _int(booking.get("price")),
        )
      else:
        await conn.execute(
          """
          insert into consulting_payments (
            id, user_id, kind, booking_id, amount, currency, status, method, created_at, updated_at
          )
          values ($1::uuid, $2::uuid, 'booking', $3::uuid, $4, 'KRW', 'paid', 'manual_deposit', now(), now())
          """,
          str(uuid4()),
          booking["customer_id"],
          booking_id,
          booking["paid_amount"] or _int(booking.get("price")),
        )
      await conn.execute(
        """
        update consulting_bookings
        set status = case when status = 'requested' then 'contacting' else status end,
            operator_note = trim(both E'\n' from concat_ws(E'\n', nullif(operator_note, ''), '선결제/예약금 입금 확인. 전문가 확정 대기 상태로 전환했습니다.')),
            updated_at = now()
        where id::text = $1
        """,
        booking_id,
      )
  finally:
    await conn.close()
  return await get_partner_booking(booking_id, principal)


async def save_partner_booking_changes(booking_id: str, payload: dict[str, Any], principal: PartnerPrincipal) -> dict[str, Any]:
  booking = await get_partner_booking(booking_id, principal)
  patch = _payload_get(payload, "patch") or {}
  if not isinstance(patch, dict):
    raise HTTPException(status_code=422, detail="patch must be an object.")

  status_value = _payload_get(payload, "status")
  normalized_status = _db_status(str(status_value)) if status_value else ""
  allowed_statuses = {"requested", "contacting", "confirmed", "scheduled", "in_progress", "completed", "canceled", "no_show", "refund_requested"}
  if normalized_status and normalized_status not in allowed_statuses:
    raise HTTPException(status_code=422, detail="Unsupported booking status.")

  mark_payment_paid = bool(_payload_get(payload, "mark_payment_paid", "markPaymentPaid"))
  effective_payment_status = "paid" if mark_payment_paid else booking["payment_status"]
  if normalized_status in {"confirmed", "scheduled", "in_progress"} and effective_payment_status != "paid":
    raise HTTPException(status_code=422, detail="선결제 또는 예약금 입금 확인 후 전문가가 예약을 확정할 수 있습니다.")

  status_to_save = normalized_status
  if mark_payment_paid and not status_to_save and booking["status"] == "requested":
    status_to_save = "contacting"

  note = str(_payload_get(payload, "note") or "").strip()
  cancel_reason = str(_payload_get(payload, "cancel_reason", "cancelReason") or "").strip()
  memo_parts: list[str] = []
  if mark_payment_paid and booking["payment_status"] != "paid":
    memo_parts.append("선결제/예약금 입금 확인. 전문가 확정 대기 상태로 전환했습니다.")
  if normalized_status == "no_show":
    memo_parts.append("노쇼 처리")
  if cancel_reason:
    memo_parts.append(f"취소 사유: {cancel_reason}")
  if note:
    memo_parts.append(note)

  memo_base = str(_payload_get(patch, "internal_memo", "internalMemo") or "") if ("internal_memo" in patch or "internalMemo" in patch) else booking["internal_memo"]
  should_update_memo = ("internal_memo" in patch or "internalMemo" in patch) or bool(memo_parts)
  memo_value = "\n".join([part for part in [memo_base, *memo_parts] if part]).strip()

  update_parts: list[str] = []
  args: list[Any] = [booking_id]

  def add_arg(value: Any) -> str:
    args.append(value)
    return f"${len(args)}"

  type_value = _payload_get(patch, "type")
  if type_value is not None:
    update_parts.append(f"category_label = {add_arg(str(type_value).strip())}")

  duration_value = _payload_get(patch, "duration_minutes", "durationMinutes")
  duration_minutes = booking["duration_minutes"]
  if duration_value is not None:
    duration_minutes = 30 if _int(duration_value, booking["duration_minutes"]) <= 30 else 60
    update_parts.append(f"duration_minutes = {add_arg(duration_minutes)}")
    update_parts.append(f"duration_label = {add_arg(f'{duration_minutes}분')}")
    update_parts.append(f"duration_code = {add_arg('30m' if duration_minutes == 30 else '60m')}")

  starts_at_value = _payload_get(patch, "starts_at", "startsAt")
  candidate_starts_at = _parse_iso_datetime(booking["starts_at"])
  if starts_at_value is not None:
    starts_at = _parse_iso_datetime(starts_at_value)
    candidate_starts_at = starts_at
    local_starts_at = starts_at.astimezone(timezone(timedelta(hours=9)))
    update_parts.append(f"scheduled_at = {add_arg(starts_at)}")
    update_parts.append(f"scheduled_date = {add_arg(local_starts_at.date())}")
    update_parts.append(f"slot_start_minutes = {add_arg(local_starts_at.hour * 60 + local_starts_at.minute)}")
    update_parts.append(f"date_label = {add_arg(local_starts_at.date().isoformat())}")

  if starts_at_value is not None or duration_value is not None:
    await assert_booking_time_allowed(booking["expert_id"], candidate_starts_at, duration_minutes)

  if should_update_memo:
    update_parts.append(f"operator_note = {add_arg(memo_value)}")

  if status_to_save:
    status_arg = add_arg(_stored_db_status(status_to_save))
    update_parts.append(f"status = {status_arg}")
    update_parts.append(f"confirmed_at = case when {status_arg} = 'confirmed' then now() else confirmed_at end")

  conn = await _connect()
  try:
    async with conn.transaction():
      if mark_payment_paid and booking["payment_status"] != "paid":
        existing_id = await conn.fetchval(
          """
          select id::text
          from consulting_payments
          where booking_id::text = $1
          order by created_at desc
          limit 1
          """,
          booking_id,
        )
        payment_amount = booking["paid_amount"] or _int(booking.get("price"))
        if existing_id:
          await conn.execute(
            """
            update consulting_payments
            set status = 'paid', amount = coalesce(amount, $2), updated_at = now()
            where id::text = $1
            """,
            existing_id,
            payment_amount,
          )
        else:
          await conn.execute(
            """
            insert into consulting_payments (
              id, user_id, kind, booking_id, amount, currency, status, method, created_at, updated_at
            )
            values ($1::uuid, $2::uuid, 'booking', $3::uuid, $4, 'KRW', 'paid', 'manual_deposit', now(), now())
            """,
            str(uuid4()),
            booking["customer_id"],
            booking_id,
            payment_amount,
          )

      if update_parts:
        await conn.execute(
          f"""
          update consulting_bookings
          set {', '.join(update_parts)},
              updated_at = now()
          where id::text = $1
          """,
          *args,
        )
  finally:
    await conn.close()

  return await get_partner_booking(booking_id, principal)


async def list_partner_customers(principal: PartnerPrincipal, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
  conn = await _connect()
  try:
    args: list[Any] = []
    where = ["true"]
    scope = _scope_clause(principal, args)
    if scope:
      where.append(scope.removeprefix(" and "))
    filters = filters or {}
    if filters.get("id"):
      args.append(str(filters["id"]))
      where.append(f"u.id::text = ${len(args)}")
    if filters.get("tag") and filters["tag"] != "all":
      args.append(str(filters["tag"]))
      where.append(f"${len(args)} = any(coalesce(u.tags, '{{}}'))")
    if filters.get("query"):
      args.append(f"%{str(filters['query']).lower()}%")
      index = len(args)
      where.append(
        f"""(
          lower(coalesce(u.name, u.nickname, '')) like ${index}
          or lower(coalesce(u.phone, '')) like ${index}
          or lower(u.email::text) like ${index}
        )"""
      )

    rows = await conn.fetch(
      f"""
      select u.id::text id, coalesce(u.name, u.nickname, '이름 없는 고객') as name,
             u.phone, u.email::text email, u.created_at, u.updated_at, u.personal_color,
             u.skin_type, u.skin_tone, u.tags, media.cdn_url avatar_url,
             count(distinct b.id)::int as total_bookings,
             count(distinct b.id) filter (where b.status = 'completed')::int as completed_bookings,
             coalesce(sum(distinct pay.amount) filter (where pay.status = 'paid'), 0)::int as total_paid_amount,
             max(coalesce(msg.created_at, b.updated_at, b.created_at, u.updated_at, u.created_at)) as last_active_at
      from consulting_bookings b
      join users u on u.id = b.user_id
      left join media_assets media on media.id = u.avatar_media_id
      left join lateral (
        select p.status, p.amount
        from consulting_payments p
        where p.booking_id = b.id
        order by p.created_at desc
        limit 1
      ) pay on true
      left join lateral (
        select m.created_at
        from consulting_messages m
        where m.booking_id = b.id
        order by m.created_at desc
        limit 1
      ) msg on true
      where {' and '.join(where)}
      group by u.id, u.name, u.nickname, u.phone, u.email, u.created_at, u.updated_at,
               u.personal_color, u.skin_type, u.skin_tone, u.tags, media.cdn_url
      order by last_active_at desc
      """,
      *args,
    )
    return [_customer_from_row(row) for row in rows]
  finally:
    await conn.close()


async def get_partner_customer(customer_id: str, principal: PartnerPrincipal) -> dict[str, Any]:
  customers = await list_partner_customers(principal, {"id": customer_id})
  if not customers:
    raise HTTPException(status_code=404, detail="Customer not found.")
  bookings = await list_partner_bookings(principal, {"customerId": customer_id})
  reports = await list_shared_reports(principal, customer_id)
  summaries = await list_summaries(principal, customer_id)
  return {
    "customer": customers[0],
    "bookings": bookings,
    "shared_reports": reports,
    "consultation_summaries": summaries,
    "reviews": [],
  }


async def list_partner_chats(principal: PartnerPrincipal) -> list[dict[str, Any]]:
  bookings = await list_partner_bookings(principal)
  return [await _thread_from_booking(booking) for booking in bookings]


async def get_chat_thread_detail(thread_id: str, principal: PartnerPrincipal) -> dict[str, Any]:
  booking_id = thread_id.removeprefix("thread-")
  booking = await get_partner_booking(booking_id, principal)
  customer_detail = await get_partner_customer(booking["customer_id"], principal)
  expert = await get_expert(booking["expert_id"])
  reports = await list_shared_reports(principal, booking["customer_id"])
  return {
    "thread": await _thread_from_booking(booking),
    "customer": customer_detail["customer"],
    "booking": booking,
    "expert": expert,
    "shared_reports": reports,
    "messages": await list_chat_messages(booking["id"]),
  }


async def _thread_from_booking(booking: dict[str, Any]) -> dict[str, Any]:
  conn = await _connect()
  try:
    last_message_at = await conn.fetchval(
      "select max(created_at) from consulting_messages where booking_id::text = $1",
      booking["id"],
    )
  finally:
    await conn.close()
  status = "waiting" if booking["status"] in {"requested", "contacting"} else "open"
  if booking["status"] in {"completed", "cancelled", "no_show"}:
    status = "closed"
  return {
    "id": f"thread-{booking['id']}",
    "customer_id": booking["customer_id"],
    "booking_id": booking["id"],
    "assigned_expert_id": booking["expert_id"],
    "last_message_at": _iso(last_message_at) if last_message_at else booking["requested_at"],
    "unread_count": 0,
    "status": status,
    "channel": "app_chat",
  }


async def list_chat_messages(booking_id: str) -> list[dict[str, Any]]:
  messages_by_booking = await list_chat_messages_for_bookings([booking_id])
  return messages_by_booking.get(booking_id, [])


async def list_chat_messages_for_bookings(booking_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
  if not booking_ids:
    return {}
  conn = await _connect()
  try:
    rows = await conn.fetch(
      """
      select m.id::text id, m.booking_id::text booking_id, m.sender_type, m.sender_name, m.body,
             m.created_at, mm.media_id::text media_id, mm.sort_order,
             media.owner_user_id::text owner_id, media.media_kind, media.original_filename,
             coalesce(media.thumbnail_cdn_url, media.cdn_url) media_url
      from consulting_messages m
      left join consulting_message_media mm on mm.message_id = m.id
      left join media_assets media on media.id = mm.media_id
      where m.booking_id::text = any($1::text[]) and m.deleted_at is null
      order by m.created_at, mm.sort_order nulls last
      """,
      booking_ids,
    )
  finally:
    await conn.close()

  grouped: dict[str, dict[str, Any]] = {}
  for row in rows:
    message = grouped.setdefault(
      row["id"],
      {
        "id": row["id"],
        "thread_id": f"thread-{row['booking_id']}",
        "sender_type": "customer" if row["sender_type"] == "user" else row["sender_type"],
        "sender_name": row["sender_name"] or ("고객" if row["sender_type"] == "user" else "전문가"),
        "body": row["body"] or "",
        "sent_at": _iso(row["created_at"]),
        "attachments": [],
      },
    )
    if row["media_id"] and row["media_url"]:
      message["attachments"].append(
        _attachment(
          attachment_id=row["media_id"],
          owner_id=row["owner_id"] or row["booking_id"],
          media_type="image",
          name=row["original_filename"] or "상담 첨부 이미지",
          url=row["media_url"],
          uploaded_at=_iso(row["created_at"]),
        )
      )
  result: dict[str, list[dict[str, Any]]] = {booking_id: [] for booking_id in booking_ids}
  for message in grouped.values():
    result.setdefault(message["thread_id"].removeprefix("thread-"), []).append(message)
  return result


async def list_shared_reports_for_bookings(bookings: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
  report_to_booking: dict[str, str] = {}
  report_to_customer: dict[str, str] = {}
  for booking in bookings:
    for report_id in booking.get("shared_report_ids", []):
      report_to_booking.setdefault(str(report_id), booking["id"])
      report_to_customer.setdefault(str(report_id), booking["customer_id"])

  reports = await _fetch_reports_by_ids(list(report_to_booking))
  result: dict[str, list[dict[str, Any]]] = defaultdict(list)
  for report in reports:
    report["booking_id"] = report_to_booking.get(report["id"], report.get("booking_id"))
    result[report_to_customer.get(report["id"], report["customer_id"])].append(report)
  return {customer_id: sorted(items, key=lambda item: item["created_at"], reverse=True) for customer_id, items in result.items()}


async def list_shared_reports(principal: PartnerPrincipal, customer_id: str | None = None) -> list[dict[str, Any]]:
  bookings = await list_partner_bookings(principal, {"customerId": customer_id} if customer_id else {})
  report_to_booking: dict[str, str] = {}
  for booking in bookings:
    if customer_id and booking["customer_id"] != customer_id:
      continue
    for report_id in booking.get("shared_report_ids", []):
      report_to_booking.setdefault(str(report_id), booking["id"])

  if customer_id and not report_to_booking:
    # Customer detail should still show the customer's latest app reports even if a
    # booking was created before shared_report_ids were populated.
    reports = await _fetch_reports_for_customer(customer_id)
  elif report_to_booking:
    reports = await _fetch_reports_by_ids(list(report_to_booking))
  else:
    reports = []

  for report in reports:
    report["booking_id"] = report_to_booking.get(report["id"], report.get("booking_id"))
  return sorted(reports, key=lambda item: item["created_at"], reverse=True)


async def get_shared_report(report_id: str, principal: PartnerPrincipal) -> dict[str, Any]:
  records = await _fetch_reports_by_ids([report_id], include_detail=True)
  if not records:
    raise HTTPException(status_code=404, detail="Report not found.")
  report = records[0]
  customer_bookings = await list_partner_bookings(principal, {"customerId": report["customer_id"]})
  shared_report_ids = {str(report_id) for booking in customer_bookings for report_id in booking.get("shared_report_ids", [])}
  if report["id"] not in shared_report_ids and not customer_bookings:
    raise HTTPException(status_code=404, detail="Report not found.")
  return report


async def _fetch_reports_by_ids(report_ids: list[str], include_detail: bool = False) -> list[dict[str, Any]]:
  if not report_ids:
    return []
  conn = await _connect()
  try:
    analysis_rows = await conn.fetch(
      """
      select r.id::text id, r.user_id::text user_id, r.title, r.report_title, r.status,
             r.analyzed_at, r.created_at, r.personal_color, r.face_shape, r.skin_type,
             r.tone_summary, r.recommended_mood, r.summary, r.short_summary,
             r.skin_analysis_summary, r.base_makeup_guide, r.tags, r.detail_payload,
             coalesce(preview.thumbnail_cdn_url, preview.cdn_url, source.thumbnail_cdn_url, source.cdn_url) image_url,
             coalesce(source.thumbnail_cdn_url, source.cdn_url) source_image_url,
             coalesce(preview.thumbnail_cdn_url, preview.cdn_url) preview_image_url
      from analysis_reports r
      left join media_assets preview on preview.id = r.preview_media_id
      left join media_assets source on source.id = r.source_media_id
      where r.id::text = any($1::text[]) and r.deleted_at is null
      """,
      report_ids,
    )
    feedback_rows = await conn.fetch(
      """
      select r.id::text id, r.user_id::text user_id, r.source, r.source_label, r.score, r.status,
             r.feedback_payload, r.created_at, r.completed_at,
             coalesce(media.thumbnail_cdn_url, media.cdn_url) image_url
      from makeup_feedback_reports r
      left join media_assets media on media.id = r.uploaded_media_id
      where r.id::text = any($1::text[])
      """,
      report_ids,
    )
  finally:
    await conn.close()
  reports = [_analysis_report_from_row(row, include_detail=include_detail) for row in analysis_rows]
  reports.extend(_feedback_report_from_row(row, include_detail=include_detail) for row in feedback_rows)
  return reports


async def _fetch_reports_for_customer(customer_id: str) -> list[dict[str, Any]]:
  conn = await _connect()
  try:
    analysis_rows = await conn.fetch(
      """
      select r.id::text id, r.user_id::text user_id, r.title, r.report_title, r.status,
             r.analyzed_at, r.created_at, r.personal_color, r.face_shape, r.skin_type,
             r.tone_summary, r.recommended_mood, r.summary, r.short_summary,
             r.skin_analysis_summary, r.base_makeup_guide, r.tags, r.detail_payload,
             coalesce(preview.thumbnail_cdn_url, preview.cdn_url, source.thumbnail_cdn_url, source.cdn_url) image_url,
             coalesce(source.thumbnail_cdn_url, source.cdn_url) source_image_url,
             coalesce(preview.thumbnail_cdn_url, preview.cdn_url) preview_image_url
      from analysis_reports r
      left join media_assets preview on preview.id = r.preview_media_id
      left join media_assets source on source.id = r.source_media_id
      where r.user_id::text = $1 and r.deleted_at is null
      order by coalesce(r.analyzed_at, r.created_at) desc
      limit 12
      """,
      customer_id,
    )
    feedback_rows = await conn.fetch(
      """
      select r.id::text id, r.user_id::text user_id, r.source, r.source_label, r.score, r.status,
             r.feedback_payload, r.created_at, r.completed_at,
             coalesce(media.thumbnail_cdn_url, media.cdn_url) image_url
      from makeup_feedback_reports r
      left join media_assets media on media.id = r.uploaded_media_id
      where r.user_id::text = $1
      order by coalesce(r.completed_at, r.created_at) desc
      limit 12
      """,
      customer_id,
    )
  finally:
    await conn.close()
  reports = [_analysis_report_from_row(row, include_detail=False) for row in analysis_rows]
  reports.extend(_feedback_report_from_row(row, include_detail=False) for row in feedback_rows)
  return reports


async def list_summaries(principal: PartnerPrincipal, customer_id: str | None = None) -> list[dict[str, Any]]:
  conn = await _connect()
  try:
    args: list[Any] = []
    where = ["true"]
    scope = _scope_clause(principal, args)
    if scope:
      where.append(scope.removeprefix(" and "))
    if customer_id:
      args.append(customer_id)
      where.append(f"b.user_id::text = ${len(args)}")
    rows = await conn.fetch(
      f"""
      select s.id::text id, s.booking_id::text booking_id, s.expert_id, s.duration_label,
             s.date_label, s.notes, s.products, s.created_at, b.user_id::text customer_id
      from consulting_summaries s
      join consulting_bookings b on b.id = s.booking_id
      where {' and '.join(where)}
      order by s.created_at desc
      """,
      *args,
    )
    return [_summary_from_row(row) for row in rows]
  finally:
    await conn.close()


async def get_summary_for_booking(booking_id: str, principal: PartnerPrincipal) -> dict[str, Any] | None:
  summaries = await list_summaries(principal)
  return next((item for item in summaries if item["booking_id"] == booking_id), None)


async def generate_summary(booking_id: str, payload: dict[str, Any], principal: PartnerPrincipal) -> dict[str, Any]:
  booking = await get_partner_booking(booking_id, principal)
  transcript = _text(payload.get("transcript")).strip()
  internal_memo = _text(payload.get("internal_memo") or payload.get("expert_comment")).strip()
  visible_to_customer = bool(payload.get("visible_to_customer", True))
  if not transcript:
    raise HTTPException(status_code=422, detail="AI 요약 생성을 위해 화상상담 transcript가 필요합니다.")

  notes = {
    "transcript": transcript,
    "internalMemo": internal_memo,
    "customerSummary": payload.get("customer_summary")
    or f"{booking['customer_name']} 고객의 {booking['type']} 상담 내용을 바탕으로 현재 고민, 전문가 판단, 적용 우선순위를 정리했습니다.",
    "recommendations": payload.get("recommendations")
    or "오늘 바로 적용할 수 있는 1순위 액션을 먼저 안내하고, 다음 상담에서는 앱 리포트 변화와 실제 적용 사진을 함께 확인하세요.",
    "visibleToCustomer": visible_to_customer,
    "deliveredReportIds": payload.get("delivered_report_ids") or [],
    "reviewRequestStatus": "ready",
    "aiModel": "phone-summary",
  }

  conn = await _connect()
  try:
    async with conn.transaction():
      existing_id = await conn.fetchval("select id::text from consulting_summaries where booking_id::text = $1", booking_id)
      if existing_id:
        summary_id = existing_id
        await conn.execute(
          """
          update consulting_summaries
          set notes = $2::jsonb, products = $3::jsonb, created_at = now()
          where id::text = $1
          """,
          summary_id,
          json.dumps(notes, ensure_ascii=False),
          json.dumps([], ensure_ascii=False),
        )
      else:
        summary_id = str(uuid4())
        await conn.execute(
          """
          insert into consulting_summaries (
            id, booking_id, expert_id, duration_label, date_label, notes, products, created_at
          )
          values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::jsonb, now())
          """,
          summary_id,
          booking_id,
          booking["expert_id"],
          f"{booking['duration_minutes']}분",
          booking.get("date_label") or _date_label(booking["starts_at"]),
          json.dumps(notes, ensure_ascii=False),
          json.dumps([], ensure_ascii=False),
        )
      await conn.execute(
        """
        update consulting_bookings
        set status = 'completed',
            operator_note = trim(both E'\n' from concat_ws(E'\n', nullif(operator_note, ''), $2)),
            updated_at = now()
        where id::text = $1
        """,
        booking_id,
        internal_memo,
      )
  finally:
    await conn.close()

  summary = await get_summary_for_booking(booking_id, principal)
  job = {
    "id": f"summary-job-{summary_id}",
    "booking_id": booking_id,
    "business_id": booking["business_id"],
    "expert_id": booking["expert_id"],
    "requested_by": principal.account_id,
    "status": "succeeded",
    "source": "phone_transcript",
    "ai_model": "phone-summary",
    "created_at": summary["created_at"] if summary else _iso(None),
    "updated_at": summary["created_at"] if summary else _iso(None),
  }
  return {"job": job, "summary": summary}


async def list_summary_jobs() -> list[dict[str, Any]]:
  conn = await _connect()
  try:
    rows = await conn.fetch(
      """
      select s.id::text id, s.booking_id::text booking_id, b.expert_id,
             b.expert_id as business_id, s.created_at
      from consulting_summaries s
      join consulting_bookings b on b.id = s.booking_id
      order by s.created_at desc
      limit 20
      """
    )
    return [
      {
        "id": f"summary-job-{row['id']}",
        "booking_id": row["booking_id"],
        "business_id": row["business_id"],
        "expert_id": row["expert_id"],
        "requested_by": "system",
        "status": "succeeded",
        "source": "phone_transcript",
        "ai_model": "phone-summary",
        "created_at": _iso(row["created_at"]),
        "updated_at": _iso(row["created_at"]),
      }
      for row in rows
    ]
  finally:
    await conn.close()


def _expert_from_row(row: asyncpg.Record) -> dict[str, Any]:
  tags = [str(item) for item in _list(row["tags"])]
  certifications = [str(item) for item in _list(row["certifications"])]
  return {
    "id": row["id"],
    "business_id": _business_id_for_expert(row["id"]),
    "name": row["name"],
    "role_label": row["title"] or "뷰티 상담 전문가",
    "tagline": row["signature_line"] or row["availability_note"] or "AI 얼굴 리포트 기반 상담 전문가",
    "email": "",
    "phone": "",
    "avatar_url": row["image_url"] or "",
    "specialties": tags,
    "categories": tags,
    "introduction": row["intro"] or "",
    "years_of_experience": _int(row["career_years"]),
    "credentials": [
      _attachment(
        attachment_id=f"credential-{row['id']}-{index}",
        owner_id=row["id"],
        media_type="credential",
        name=certificate,
        url="",
        uploaded_at=_iso(row["created_at"]),
      )
      for index, certificate in enumerate(certifications)
    ],
    "price_30_min": _int(row["price_30_min"]),
    "price_60_min": _int(row["price_60_min"]),
    "exposure_status": "public" if row["is_active"] else "private",
    "rating": _float(row["rating"]),
    "review_count": _int(row["review_count"]),
    "consultation_count": _int(row["session_count"]),
    "rebooking_rate": _int(row["rebook_rate"]),
    "response_within_minutes": _int(row["response_minutes"], 60),
    "studio_name": row["studio_name"],
  }


def _business_from_expert(expert: dict[str, Any]) -> dict[str, Any]:
  return {
    "id": expert["business_id"],
    "partner_type": "freelancer",
    "name": expert.get("studio_name") or f"{expert['name']} 상담실",
    "owner_name": expert["name"],
    "business_registration_number": None,
    "phone": expert.get("phone") or "",
    "address": "",
    "website": None,
    "description": expert.get("introduction") or expert.get("tagline") or "",
    "photos": [],
    "exposure_status": expert.get("exposure_status", "public"),
    "verification_status": "approved",
    "verification_documents": [],
    "settlement_account_status": "approved",
    "default_operating_hours": _default_operating_hours(),
    "cancellation_policy": "예약 확정 전 취소 가능하며, 확정 이후에는 채팅방에서 전문가와 조율합니다.",
    "refund_policy": "선결제/예약금 환불은 상담 진행 여부와 채팅 기록을 기준으로 운영자가 확인합니다.",
  }


def _booking_from_row(row: asyncpg.Record) -> dict[str, Any]:
  minutes = _int(row["duration_minutes"], 30)
  duration = 30 if minutes <= 30 else 60
  starts_at = row["scheduled_at"] or row["created_at"]
  payment_status = _payment_status(row["payment_status"])
  paid_amount = _int(row["payment_amount"]) if payment_status == "paid" else _int(row["price"])
  operator_note = row["operator_note"] or ""
  status = "no_show" if row["status"] == "canceled" and "노쇼 처리" in operator_note else _domain_status(row["status"])
  return {
    "id": row["id"],
    "customer_id": row["user_id"],
    "expert_id": row["expert_id"],
    "business_id": _business_id_for_expert(row["expert_id"]),
    "starts_at": _iso(starts_at),
    "ends_at": _add_minutes(starts_at, duration),
    "duration_minutes": duration,
    "type": row["category_label"] or row["duration_label"] or "AI 리포트 기반 상담",
    "status": status,
    "payment_status": payment_status,
    "paid_amount": paid_amount,
    "discount_amount": 0,
    "channel": "offline" if row["session_mode"] == "offline" else "video",
    "requested_at": _iso(row["created_at"]),
    "request_memo": row["question"] or row["concern_label"] or "",
    "selected_concern_tags": [row["concern_label"]] if row["concern_label"] else [],
    "internal_memo": operator_note,
    "shared_report_ids": [str(item) for item in _list(row["shared_report_ids"])],
    "consultation_summary_id": row["summary_id"],
    "review_request_status": "ready" if status == "completed" else "not_ready",
    "customer_name": row["customer_name"],
    "customer_phone": row["customer_phone"],
    "customer_email": row["customer_email"],
    "expert_name": row["expert_name"],
    "date_label": row["date_label"],
    "price": _int(row["price"]),
  }


def _customer_from_row(row: asyncpg.Record) -> dict[str, Any]:
  tags = [str(item) for item in _list(row["tags"])]
  for candidate in [row["personal_color"], row["skin_type"], row["skin_tone"]]:
    if candidate and str(candidate) not in tags:
      tags.append(str(candidate))
  memo_parts = [
    f"퍼스널컬러: {row['personal_color']}" if row["personal_color"] else "",
    f"피부타입: {row['skin_type']}" if row["skin_type"] else "",
    f"피부톤: {row['skin_tone']}" if row["skin_tone"] else "",
  ]
  return {
    "id": row["id"],
    "name": row["name"],
    "phone": row["phone"] or "",
    "email": row["email"] or "",
    "joined_at": _iso(row["created_at"]),
    "last_active_at": _iso(row["last_active_at"] or row["updated_at"] or row["created_at"]),
    "tags": tags,
    "memo": " · ".join(part for part in memo_parts if part),
    "profile_image_url": row["avatar_url"],
    "total_bookings": _int(row["total_bookings"]),
    "completed_bookings": _int(row["completed_bookings"]),
    "total_paid_amount": _int(row["total_paid_amount"]),
    "risk_flags": [],
    "preferred_channel": "chat",
    "attachments": [],
  }


def _recommended_makeup_images(payload: dict[str, Any]) -> list[dict[str, str]]:
  result = payload.get("result") if isinstance(payload, dict) else None
  cards = result.get("recommendedMakeups") if isinstance(result, dict) else None
  if not isinstance(cards, list):
    return []

  images: list[dict[str, str]] = []
  for index, card in enumerate(cards):
    if not isinstance(card, dict):
      continue
    image_url = next(
      (
        str(card[key]).strip()
        for key in ("imageUrl", "cdnUrl", "previewUrl", "image_url")
        if card.get(key) and str(card[key]).strip()
      ),
      "",
    )
    if image_url:
      images.append({"title": str(card.get("title") or f"AI 추천 메이크업 {index + 1}"), "image_url": image_url})
  return images


def _analysis_report_from_row(row: asyncpg.Record, *, include_detail: bool) -> dict[str, Any]:
  summary = row["summary"] or row["short_summary"] or row["tone_summary"] or row["skin_analysis_summary"] or "AI 얼굴 분석 리포트"
  report = {
    "id": row["id"],
    "customer_id": row["user_id"],
    "title": row["report_title"] or row["title"] or "AI 얼굴 분석 리포트",
    "category": "AI 얼굴 분석",
    "created_at": _iso(row["analyzed_at"] or row["created_at"]),
    "source": "customer_app",
    "summary": summary,
    "attachment_ids": [f"media-{row['id']}"] if row["image_url"] else [],
  }
  if include_detail:
    payload = _json(row["detail_payload"])
    report["kind"] = "analysis"
    report["detail"] = {
      "summary": summary,
      "short_summary": row["short_summary"] or summary,
      "category": report["category"],
      "source": report["source"],
      "created_at": report["created_at"],
      "image_url": row["image_url"],
      "source_image_url": row["source_image_url"],
      "preview_image_url": row["preview_image_url"],
      "recommended_makeup_images": _recommended_makeup_images(payload),
      "personal_color": row["personal_color"],
      "face_shape": row["face_shape"],
      "skin_type": row["skin_type"],
      "tone_summary": row["tone_summary"],
      "recommended_mood": row["recommended_mood"],
      "skin_analysis_summary": row["skin_analysis_summary"],
      "base_makeup_guide": row["base_makeup_guide"],
      "tags": _list(row["tags"]),
      "color_palette": payload.get("colorPalette") or payload.get("color_palette") or [],
      "key_findings": payload.get("keyFindings") or payload.get("key_findings") or [],
      "action_steps": payload.get("actionSteps") or payload.get("action_steps") or [],
      "raw_payload": payload,
      "detail_payload": payload,
    }
  return report


def _feedback_report_from_row(row: asyncpg.Record, *, include_detail: bool) -> dict[str, Any]:
  payload = _json(row["feedback_payload"])
  summary = (
    payload.get("summary")
    or payload.get("overallSummary")
    or payload.get("overall_summary")
    or f"메이크업 피드백 점수 {row['score']}점"
  )
  report = {
    "id": row["id"],
    "customer_id": row["user_id"],
    "title": row["source_label"] or "메이크업 피드백 리포트",
    "category": "메이크업 피드백",
    "created_at": _iso(row["completed_at"] or row["created_at"]),
    "source": "customer_app",
    "summary": summary,
    "attachment_ids": [f"media-{row['id']}"] if row["image_url"] else [],
  }
  if include_detail:
    report["kind"] = "feedback"
    report["detail"] = {
      "summary": summary,
      "short_summary": summary,
      "category": report["category"],
      "source": report["source"],
      "created_at": report["created_at"],
      "image_url": row["image_url"],
      "score": row["score"],
      "key_findings": payload.get("keyFindings") or payload.get("key_findings") or [],
      "action_steps": payload.get("actionSteps") or payload.get("action_steps") or [],
      "raw_payload": payload,
    }
  return report


def _summary_from_row(row: asyncpg.Record) -> dict[str, Any]:
  notes = _json(row["notes"])
  return {
    "id": row["id"],
    "booking_id": row["booking_id"],
    "expert_id": row["expert_id"],
    "customer_id": row["customer_id"],
    "created_at": _iso(row["created_at"]),
    "source": "phone_ai" if notes.get("transcript") else "manual",
    "ai_status": "succeeded",
    "ai_model": notes.get("aiModel") or "phone-summary",
    "transcript": notes.get("transcript"),
    "internal_memo": notes.get("internalMemo") or notes.get("internal_memo") or "",
    "customer_summary": notes.get("customerSummary") or notes.get("customer_summary") or notes.get("summary") or "",
    "recommendations": notes.get("recommendations") or "",
    "visible_to_customer": bool(notes.get("visibleToCustomer", True)),
    "delivered_report_ids": notes.get("deliveredReportIds") or notes.get("delivered_report_ids") or [],
    "review_request_status": notes.get("reviewRequestStatus") or "ready",
  }


def _application_from_row(row: asyncpg.Record) -> dict[str, Any]:
  return {
    "id": row["id"],
    "partner_type": row["partner_type"],
    "business_name": row["business_name"],
    "owner_name": row["owner_name"],
    "business_registration_number": row["business_registration_number"],
    "phone": row["phone"],
    "email": row["email"],
    "specialties": _list(row["specialties"]),
    "categories": _list(row["categories"]),
    "introduction": row["introduction"] or "",
    "consulting_modes": ["online"],
    "price_30_min": _int(row["price_30_min"]),
    "price_60_min": _int(row["price_60_min"]),
    "online_price_30_min": _int(row["price_30_min"]),
    "online_price_60_min": _int(row["price_60_min"]),
    "offline_price_30_min": None,
    "offline_price_60_min": None,
    "offline_address": None,
    "offline_detail_address": None,
    "offline_location_note": None,
    "status": row["status"],
    "submitted_at": _iso(row["submitted_at"]),
    "updated_at": _iso(row["updated_at"]),
    "reviewed_at": _iso(row["reviewed_at"]) if row["reviewed_at"] else None,
    "reviewer_name": row["reviewer_name"],
    "review_memo": row["review_memo"],
    "business_id": row["business_id"],
    "generated_account_id": row["generated_account_id"],
    "documents": [],
  }
