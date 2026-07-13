from __future__ import annotations

import asyncio
from calendar import monthrange
from collections import defaultdict
from datetime import date
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from html import escape
import json
import logging
import secrets
from typing import Any
from uuid import uuid4

import asyncpg
from fastapi import HTTPException

from app.services.auth import PartnerPrincipal, validate_partner_principal
from app.services.email import send_email
from app.services.s3 import create_presigned_download, create_presigned_view
from app.settings import get_settings


_cached_dsn: str | None = None
_profile_columns_ready = False
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
_PARTNER_PASSWORD_HASH_ITERATIONS = 600_000
_PARTNER_SESSION_TTL_DAYS = 14
_CATEGORY_ID_ALIASES = {
  "퍼스널컬러": "personalColor",
  "퍼스널컬러 진단": "personalColor",
  "personalcolor": "personalColor",
  "메이크업": "makeupClinic",
  "메이크업 클리닉": "makeupClinic",
  "makeup": "makeupClinic",
  "헤어": "hairStyle",
  "헤어스타일": "hairStyle",
  "hair": "hairStyle",
  "립": "lipColor",
  "립컬러": "lipColor",
  "lip": "lipColor",
}
logger = logging.getLogger(__name__)


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


def _password_hash(password: str, salt: str) -> str:
  digest = hashlib.pbkdf2_hmac(
    "sha256",
    password.encode("utf-8"),
    salt.encode("utf-8"),
    _PARTNER_PASSWORD_HASH_ITERATIONS,
  )
  return f"pbkdf2_sha256${_PARTNER_PASSWORD_HASH_ITERATIONS}${digest.hex()}"


def _verify_password(password: str, salt: str, expected_hash: str) -> bool:
  try:
    scheme, iterations_text, expected_digest = expected_hash.split("$", 2)
    iterations = int(iterations_text)
  except (AttributeError, TypeError, ValueError):
    return False
  if scheme != "pbkdf2_sha256" or iterations < 100_000 or iterations > 2_000_000:
    return False
  actual_digest = hashlib.pbkdf2_hmac(
    "sha256",
    password.encode("utf-8"),
    salt.encode("utf-8"),
    iterations,
  ).hex()
  return secrets.compare_digest(actual_digest, expected_digest)


def _clean_text_list(values: list[str] | None) -> list[str]:
  return [value for value in dict.fromkeys(str(item).strip() for item in values or [] if item is not None) if value]


def _category_ids(values: list[str] | None) -> list[str]:
  known_ids = set(_CATEGORY_ID_ALIASES.values())
  result: list[str] = []
  for value in values or []:
    normalized = str(value).strip()
    category_id = _CATEGORY_ID_ALIASES.get(normalized.lower(), _CATEGORY_ID_ALIASES.get(normalized, normalized))
    if category_id in known_ids and category_id not in result:
      result.append(category_id)
  return result or ["personalColor"]


def _normalized_email(value: str) -> str:
  email = value.strip().lower()
  local, separator, domain = email.partition("@")
  if not separator or not local or "." not in domain or any(character.isspace() for character in email):
    raise HTTPException(status_code=422, detail="올바른 이메일 주소를 입력해 주세요.")
  return email


def _email_verification_digest(value: str) -> str:
  secret = get_settings().email_verification_secret
  if not secret:
    raise HTTPException(status_code=503, detail="이메일 인증 설정이 완료되지 않았습니다.")
  return hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def _email_html(title: str, paragraphs: list[str], *, code: str | None = None) -> str:
  content = "".join(f'<p style="margin:0 0 12px;line-height:1.65;color:#34403e">{escape(text)}</p>' for text in paragraphs)
  code_block = (
    f'<div style="margin:22px 0;padding:18px;text-align:center;background:#f1f7f5;border:1px solid #c9ded8;'
    f'font-size:30px;font-weight:700;letter-spacing:8px;color:#176c5f">{escape(code)}</div>'
    if code else ""
  )
  return (
    '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px">'
    f'<h1 style="font-size:22px;margin:0 0 20px;color:#17201f">{escape(title)}</h1>'
    f'{content}{code_block}'
    '<p style="margin:24px 0 0;color:#71807d;font-size:12px">AURA 파트너팀</p></div>'
  )


def _approval_email_html(*, name: str, email: str, temporary_password: str, login_url: str) -> str:
  safe_name = escape(name)
  safe_email = escape(email)
  safe_password = escape(temporary_password)
  safe_login_url = escape(login_url, quote=True)
  return f"""
  <!doctype html>
  <html lang="ko">
    <body style="margin:0;padding:0;background:#f3f6f5;font-family:Arial,'Noto Sans KR',sans-serif;color:#17201f">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f5;padding:32px 16px">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dce5e2;border-radius:8px;overflow:hidden">
            <tr><td style="padding:24px 32px;background:#176c5f;color:#ffffff;font-size:20px;font-weight:700">AURA</td></tr>
            <tr>
              <td style="padding:36px 32px">
                <div style="display:inline-block;margin-bottom:16px;padding:6px 10px;background:#eaf4f1;color:#176c5f;border-radius:4px;font-size:12px;font-weight:700">입점 승인 완료</div>
                <h1 style="margin:0 0 14px;font-size:26px;line-height:1.35;color:#17201f">파트너 계정이 생성되었습니다</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#4f5f5c">{safe_name}님, AURA 입점 심사가 승인되었습니다. 아래 계정으로 로그인해 파트너 운영을 시작해 주세요.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;background:#f7f9f8;border:1px solid #dce5e2;border-radius:6px">
                  <tr><td style="padding:18px 20px 8px;color:#71807d;font-size:12px">로그인 이메일</td></tr>
                  <tr><td style="padding:0 20px 18px;color:#17201f;font-size:16px;font-weight:700;word-break:break-all">{safe_email}</td></tr>
                  <tr><td style="padding:18px 20px 8px;border-top:1px solid #dce5e2;color:#71807d;font-size:12px">임시 비밀번호</td></tr>
                  <tr><td style="padding:0 20px 18px;color:#17201f;font-family:Consolas,monospace;font-size:18px;font-weight:700;word-break:break-all">{safe_password}</td></tr>
                </table>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px">
                  <tr><td style="border-radius:6px;background:#176c5f"><a href="{safe_login_url}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">파트너 페이지 로그인</a></td></tr>
                </table>
                <div style="padding:14px 16px;background:#fff8e8;border-left:3px solid #d99a22;color:#625233;font-size:13px;line-height:1.6">보안을 위해 첫 로그인 후 반드시 새 비밀번호로 변경해 주세요. 임시 비밀번호는 다른 사람에게 전달하지 마세요.</div>
                <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#71807d">버튼이 열리지 않으면 아래 주소를 브라우저에 입력해 주세요.<br><a href="{safe_login_url}" style="color:#176c5f;word-break:break-all">{safe_login_url}</a></p>
              </td>
            </tr>
            <tr><td style="padding:20px 32px;background:#f7f9f8;border-top:1px solid #dce5e2;color:#71807d;font-size:12px;line-height:1.6">문의가 필요하면 이 메일에 회신해 주세요.<br>AURA 파트너팀</td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>
  """


async def _ensure_partner_onboarding_schema(conn: asyncpg.Connection) -> None:
  await conn.execute("create extension if not exists pgcrypto")
  await conn.execute("create extension if not exists citext")
  await conn.execute(
    """
    create table if not exists consulting_partner_accounts (
      id uuid primary key default gen_random_uuid(),
      expert_id text not null,
      email citext not null unique,
      password_hash text not null,
      password_salt text not null,
      role text not null default 'expert',
      workspace_scope text not null default 'expert_personal',
      status text not null default 'active',
      password_change_required boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
    """
  )
  await conn.execute(
    """
    create table if not exists consulting_partner_sessions (
      token_hash text primary key,
      account_id uuid not null references consulting_partner_accounts(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz
    )
    """
  )
  await conn.execute(
    """
    create table if not exists consulting_partner_applications (
      id uuid primary key default gen_random_uuid(),
      email citext not null,
      name text not null,
      title text not null,
      studio_name text,
      phone text,
      message text,
      status text not null default 'submitted',
      expert_id text,
      rejection_reason text,
      reviewed_by_subject text,
      reviewed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
    """
  )
  await conn.execute(
    """
    create table if not exists consulting_partner_email_verifications (
      id uuid primary key,
      email citext not null,
      code_hash text not null,
      attempt_count integer not null default 0,
      expires_at timestamptz not null,
      verified_at timestamptz,
      verification_token_hash text,
      token_expires_at timestamptz,
      consumed_at timestamptz,
      created_at timestamptz not null default now(),
      last_sent_at timestamptz not null default now()
    )
    """
  )
  await conn.execute(
    """
    create index if not exists ix_partner_email_verifications_email_created
    on consulting_partner_email_verifications (email, created_at desc)
    """
  )
  definitions = (
    "add column if not exists partner_type text not null default 'freelancer'",
    "add column if not exists business_registration_number text",
    "add column if not exists specialties text[] not null default '{}'",
    "add column if not exists categories text[] not null default '{}'",
    "add column if not exists category_ids text[] not null default '{personalColor}'",
    "add column if not exists introduction text not null default ''",
    "add column if not exists consulting_modes text[] not null default '{online}'",
    "add column if not exists price_30_min integer not null default 0",
    "add column if not exists price_60_min integer not null default 0",
    "add column if not exists online_price_30_min integer",
    "add column if not exists online_price_60_min integer",
    "add column if not exists offline_price_30_min integer",
    "add column if not exists offline_price_60_min integer",
    "add column if not exists offline_address text",
    "add column if not exists offline_detail_address text",
    "add column if not exists offline_location_note text",
    "add column if not exists profile_image_file_name text",
    "add column if not exists profile_image_storage_key text",
    "add column if not exists profile_image_content_type text",
    "add column if not exists business_registration_file_name text",
    "add column if not exists business_registration_storage_key text",
    "add column if not exists beauty_license_file_name text",
    "add column if not exists beauty_license_storage_key text",
    "add column if not exists additional_certificate_file_names text[] not null default '{}'",
    "add column if not exists additional_certificate_storage_keys text[] not null default '{}'",
    "add column if not exists review_memo text",
    "add column if not exists reviewer_name text",
    "add column if not exists generated_account_id uuid",
    "add column if not exists last_email_notification_type text",
    "add column if not exists last_email_notification_status text",
    "add column if not exists last_email_notification_error text",
    "add column if not exists last_email_notification_sent_at timestamptz",
  )
  for definition in definitions:
    await conn.execute(f"alter table consulting_partner_applications {definition}")
  await _ensure_partner_profile_columns(conn)
  await conn.execute(
    """
    create unique index if not exists uq_consulting_partner_applications_pending_email
    on consulting_partner_applications (email)
    where status in ('submitted', 'needs_update')
    """
  )


async def _ensure_partner_profile_columns(conn: asyncpg.Connection) -> None:
  global _profile_columns_ready
  if _profile_columns_ready:
    return
  for definition in (
    "add column if not exists partner_type text not null default 'freelancer'",
    "add column if not exists business_registration_number text",
    "add column if not exists business_owner_name text",
    "add column if not exists business_description text",
    "add column if not exists phone text",
    "add column if not exists business_address text",
  ):
    await conn.execute(f"alter table consulting_experts {definition}")
  _profile_columns_ready = True


async def _ensure_expert_schedule_columns(conn: asyncpg.Connection) -> None:
  await conn.execute("alter table consulting_experts add column if not exists operating_hours jsonb")
  await conn.execute("alter table consulting_experts add column if not exists holiday_dates jsonb")
  await conn.execute("alter table consulting_experts add column if not exists temporary_booking_blocks jsonb")
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


def _normalize_temporary_booking_blocks(value: Any) -> list[dict[str, str]]:
  """Validate date-bound closures without turning them into weekly operating hours."""
  blocks: list[dict[str, str]] = []
  seen: set[tuple[str, str, str]] = set()
  for raw_block in _list(value):
    if not isinstance(raw_block, dict):
      continue
    raw_date = str(_payload_get(raw_block, "date") or "").strip()
    try:
      block_date = datetime.fromisoformat(raw_date).date().isoformat()
    except ValueError as exc:
      raise HTTPException(status_code=422, detail="일회성 예약 차단일은 YYYY-MM-DD 형식이어야 합니다.") from exc

    starts_at = str(_payload_get(raw_block, "starts_at", "startsAt") or "").strip()
    ends_at = str(_payload_get(raw_block, "ends_at", "endsAt") or "").strip()
    if _time_to_minutes(starts_at, field_name="temporary block starts_at") >= _time_to_minutes(ends_at, field_name="temporary block ends_at"):
      raise HTTPException(status_code=422, detail="일회성 예약 차단 종료 시간은 시작 시간 이후여야 합니다.")

    key = (block_date, starts_at, ends_at)
    if key in seen:
      continue
    seen.add(key)
    block_id = str(_payload_get(raw_block, "id") or "").strip() or str(uuid4())
    reason = str(_payload_get(raw_block, "reason") or "").strip()
    blocks.append({
      "id": block_id,
      "date": block_date,
      "starts_at": starts_at,
      "ends_at": ends_at,
      "reason": reason,
    })
  return sorted(blocks, key=lambda block: (block["date"], block["starts_at"], block["ends_at"]))


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


async def login_partner(email: str, password: str) -> dict[str, Any]:
  normalized_email = email.strip().lower()
  conn = await _connect()
  try:
    await _ensure_partner_onboarding_schema(conn)
    account = await conn.fetchrow(
      """
      select account.id::text id, account.expert_id, account.email::text email,
             account.password_hash, account.password_salt, account.role,
             account.workspace_scope, account.status, account.password_change_required,
             expert.name as expert_name,
             application.id::text as application_id,
             application.status as application_status,
             application.partner_type
      from consulting_partner_accounts account
      join consulting_experts expert on expert.id = account.expert_id
      left join consulting_partner_applications application on application.expert_id = account.expert_id
      where lower(account.email::text) = $1
        and account.status in ('invited', 'active')
      order by application.updated_at desc nulls last
      limit 1
      """,
      normalized_email,
    )
    if account is None or not _verify_password(password, account["password_salt"], account["password_hash"]):
      raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")

    token = secrets.token_urlsafe(48)
    await conn.execute(
      """
      insert into consulting_partner_sessions (token_hash, account_id, expires_at, last_seen_at)
      values ($1, $2::uuid, now() + ($3 * interval '1 day'), now())
      """,
      hashlib.sha256(token.encode("utf-8")).hexdigest(),
      account["id"],
      _PARTNER_SESSION_TTL_DAYS,
    )
    return {
      "token": token,
      "user": {
        "id": account["id"],
        "name": account["expert_name"],
        "email": account["email"],
        "role": account["role"],
        "expert_id": account["expert_id"],
        "business_id": _business_id_for_expert(account["expert_id"]),
        "workspace_scope": account["workspace_scope"],
        "partner_type": account.get("partner_type") or "freelancer",
        "application_id": account.get("application_id"),
        "application_status": account.get("application_status") or "approved",
        "account_id": account["id"],
        "password_change_required": bool(account["password_change_required"]),
      },
    }
  finally:
    await conn.close()


async def principal_from_token(token: str, *, allow_password_change_required: bool = False) -> PartnerPrincipal:
  token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
  conn = await _connect()
  try:
    row = await conn.fetchrow(
      """
      update consulting_partner_sessions session
      set last_seen_at = now()
      from consulting_partner_accounts account
      where session.token_hash = $1
        and session.account_id = account.id
        and session.expires_at > now()
      returning account.id::text id, account.expert_id, account.role,
                account.workspace_scope, account.status, account.password_change_required
      """,
      token_hash,
    )
  finally:
    await conn.close()
  if row is None:
    raise HTTPException(status_code=401, detail="Partner session token is invalid or expired.")
  return await validate_partner_account_scope(
    PartnerPrincipal(
      account_id=row["id"],
      role=row["role"],
      business_id=_business_id_for_expert(row["expert_id"]),
      expert_id=row["expert_id"],
      workspace_scope=row["workspace_scope"],
    ),
    allow_password_change_required=allow_password_change_required,
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
  invited_password_change = account["status"] == "invited" and account["password_change_required"]
  if account["status"] != "active" and not (allow_password_change_required and invited_password_change):
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


async def change_partner_password(account_id: str, new_password: str) -> dict[str, Any]:
  if len(new_password) < 8:
    raise HTTPException(status_code=422, detail="새 비밀번호는 8자 이상이어야 합니다.")
  salt = secrets.token_hex(16)
  conn = await _connect()
  try:
    row = await conn.fetchrow(
      """
      update consulting_partner_accounts
      set password_hash = $2, password_salt = $3,
          status = 'active', password_change_required = false, updated_at = now()
      where id::text = $1 and status = 'invited' and password_change_required = true
      returning id::text id, status, password_change_required
      """,
      account_id,
      _password_hash(new_password, salt),
      salt,
    )
    if row is None:
      raise HTTPException(status_code=409, detail="비밀번호 변경이 필요한 파트너 계정을 찾을 수 없습니다.")
    return {
      "account_id": row["id"],
      "status": row["status"],
      "password_change_required": bool(row["password_change_required"]),
    }
  finally:
    await conn.close()


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
      "temporary_booking_blocks": [],
      "booking_open_months": _DEFAULT_BOOKING_OPEN_MONTHS,
    }
  stored_hours = _json(row["operating_hours"], [])
  stored_holidays = _json(row["holiday_dates"], [])
  stored_temporary_blocks = _json(row["temporary_booking_blocks"], [])
  return {
    "operating_hours": _normalize_operating_hours(stored_hours) if stored_hours else _default_operating_hours(),
    "holidays": _normalize_holidays(stored_holidays),
    "temporary_booking_blocks": _normalize_temporary_booking_blocks(stored_temporary_blocks),
    "booking_open_months": _normalize_booking_open_months(row["booking_open_months"]),
  }


async def get_expert_schedule_settings(expert_id: str) -> dict[str, Any]:
  conn = await _connect()
  try:
    await _ensure_expert_schedule_columns(conn)
    row = await conn.fetchrow(
      """
      select operating_hours, holiday_dates, temporary_booking_blocks, booking_open_months
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
  raw_temporary_blocks = _payload_get(payload, "temporary_booking_blocks", "temporaryBookingBlocks")
  raw_open_months = _payload_get(payload, "booking_open_months", "bookingOpenMonths")

  operating_hours = _normalize_operating_hours(raw_hours) if raw_hours is not None else current["operating_hours"]
  holidays = _normalize_holidays(raw_holidays) if raw_holidays is not None else current["holidays"]
  temporary_booking_blocks = _normalize_temporary_booking_blocks(raw_temporary_blocks) if raw_temporary_blocks is not None else current["temporary_booking_blocks"]
  booking_open_months = _normalize_booking_open_months(raw_open_months) if raw_open_months is not None else current["booking_open_months"]

  conn = await _connect()
  try:
    await _ensure_expert_schedule_columns(conn)
    await conn.execute(
      """
      update consulting_experts
      set operating_hours = $2::jsonb,
          holiday_dates = $3::jsonb,
          temporary_booking_blocks = $4::jsonb,
          booking_open_months = $5,
          updated_at = now()
      where id = $1
      """,
      principal.expert_id,
      json.dumps(operating_hours, ensure_ascii=False),
      json.dumps(holidays, ensure_ascii=False),
      json.dumps(temporary_booking_blocks, ensure_ascii=False),
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
  for block in settings.get("temporary_booking_blocks", []):
    if block["date"] != local_date.isoformat():
      continue
    block_start = _time_to_minutes(block["starts_at"], field_name="temporary block starts_at")
    block_end = _time_to_minutes(block["ends_at"], field_name="temporary block ends_at")
    if start_minutes < block_end and end_minutes > block_start:
      detail = f" ({block['reason']})" if block.get("reason") else ""
      raise HTTPException(status_code=422, detail=f"설정된 일회성 예약 차단 시간({block['starts_at']}-{block['ends_at']})에는 예약을 열 수 없습니다.{detail}")
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


async def request_partner_email_verification(email_value: str) -> dict[str, Any]:
  settings = get_settings()
  if not settings.email_configured:
    raise HTTPException(status_code=503, detail="이메일 인증 설정이 완료되지 않았습니다.")

  email = _normalized_email(email_value)
  conn = await _connect()
  try:
    await _ensure_partner_onboarding_schema(conn)
    existing = await conn.fetchrow(
      """
      select case
        when exists (
          select 1 from consulting_partner_accounts where email = $1
        ) then 'approved'
        else (
          select status from consulting_partner_applications
          where email = $1 and status in ('submitted', 'needs_update', 'approved')
          order by updated_at desc limit 1
        )
      end as status
      """,
      email,
    )
    existing_status = str(existing["status"]) if existing and existing.get("status") else ""
    conflict_messages = {
      "approved": "이미 입점 심사가 완료된 계정입니다.",
      "submitted": "이미 입점 신청이 접수되어 심사 중인 계정입니다.",
      "needs_update": "이미 보완 요청된 입점 신청이 있습니다.",
    }
    if existing_status in conflict_messages:
      raise HTTPException(status_code=409, detail=conflict_messages[existing_status])

    verification_id = str(uuid4())
    code = f"{secrets.randbelow(1_000_000):06d}"
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.email_verification_code_ttl_minutes)
    sent_count = await conn.fetchval(
      """
      select count(*) from consulting_partner_email_verifications
      where email = $1 and created_at > now() - interval '1 hour'
      """,
      email,
    )
    if _int(sent_count) >= 5:
      raise HTTPException(status_code=429, detail="인증 메일 요청 횟수를 초과했습니다. 1시간 후 다시 시도해 주세요.")

    latest = await conn.fetchrow(
      """
      select last_sent_at from consulting_partner_email_verifications
      where email = $1 order by created_at desc limit 1
      """,
      email,
    )
    if latest and latest.get("last_sent_at") and latest["last_sent_at"] > now - timedelta(seconds=60):
      raise HTTPException(status_code=429, detail="인증 메일은 60초 후 다시 요청할 수 있습니다.")

    await conn.execute(
      """
      insert into consulting_partner_email_verifications (id, email, code_hash, expires_at)
      values ($1::uuid, $2, $3, $4)
      """,
      verification_id,
      email,
      _email_verification_digest(f"{verification_id}:{code}"),
      expires_at,
    )
    try:
      await asyncio.to_thread(
        send_email,
        settings,
        recipient=email,
        subject="[AURA] 입점 신청 이메일 인증 코드",
        text_body=f"AURA 입점 신청 이메일 인증 코드는 {code}입니다. {settings.email_verification_code_ttl_minutes}분 안에 입력해 주세요.",
        html_body=_email_html(
          "입점 신청 이메일 인증",
          [f"아래 인증 코드를 {settings.email_verification_code_ttl_minutes}분 안에 입력해 주세요.", "본인이 요청하지 않았다면 이 메일을 무시해 주세요."],
          code=code,
        ),
      )
    except Exception as exc:
      await conn.execute("delete from consulting_partner_email_verifications where id = $1::uuid", verification_id)
      logger.exception("Failed to send partner email verification to %s", email)
      raise HTTPException(status_code=503, detail="인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.") from exc

    return {
      "expires_in_minutes": settings.email_verification_code_ttl_minutes,
      "resend_after_seconds": 60,
    }
  finally:
    await conn.close()


async def confirm_partner_email_verification(email_value: str, code: str) -> dict[str, Any]:
  settings = get_settings()
  email = _normalized_email(email_value)
  conn = await _connect()
  try:
    await _ensure_partner_onboarding_schema(conn)
    async with conn.transaction():
      verification = await conn.fetchrow(
        """
        select * from consulting_partner_email_verifications
        where email = $1 and consumed_at is null
        order by created_at desc limit 1 for update
        """,
        email,
      )
      now = datetime.now(timezone.utc)
      if verification is None or verification["expires_at"] <= now:
        raise HTTPException(status_code=422, detail="인증 코드가 만료되었습니다. 새 코드를 요청해 주세요.")
      if _int(verification.get("attempt_count")) >= 5:
        raise HTTPException(status_code=429, detail="인증 코드 입력 횟수를 초과했습니다. 새 코드를 요청해 주세요.")

      expected = _email_verification_digest(f"{verification['id']}:{code}")
      if not secrets.compare_digest(expected, verification["code_hash"]):
        await conn.execute(
          "update consulting_partner_email_verifications set attempt_count = attempt_count + 1 where id = $1",
          verification["id"],
        )
        raise HTTPException(status_code=422, detail="인증 코드가 올바르지 않습니다.")

      token = secrets.token_urlsafe(32)
      token_expires_at = now + timedelta(minutes=settings.email_verification_token_ttl_minutes)
      await conn.execute(
        """
        update consulting_partner_email_verifications
        set verified_at = $2, verification_token_hash = $3, token_expires_at = $4
        where id = $1
        """,
        verification["id"],
        now,
        _email_verification_digest(token),
        token_expires_at,
      )
    return {
      "verification_token": token,
      "expires_in_minutes": settings.email_verification_token_ttl_minutes,
    }
  finally:
    await conn.close()


async def _deliver_application_email(
  conn: asyncpg.Connection,
  application: Any,
  *,
  notification_type: str,
  recipient: str,
  subject: str,
  paragraphs: list[str],
  html_body: str | None = None,
) -> Any:
  settings = get_settings()
  if not settings.email_from_address:
    return application

  status = "sent"
  error_message = None
  try:
    await asyncio.to_thread(
      send_email,
      settings,
      recipient=recipient,
      subject=subject,
      text_body="\n\n".join(paragraphs),
      html_body=html_body or _email_html(subject, paragraphs),
    )
  except Exception:
    status = "failed"
    error_message = "메일 발송에 실패했습니다. ECS 로그에서 SES 권한과 발송 제한을 확인해 주세요."
    logger.exception("Failed to send %s email for application %s", notification_type, application["id"])

  updated = await conn.fetchrow(
    """
    update consulting_partner_applications
    set last_email_notification_type = $2,
        last_email_notification_status = $3,
        last_email_notification_error = $4,
        last_email_notification_sent_at = case when $3 = 'sent' then now() else null end,
        updated_at = now()
    where id = $1
    returning *
    """,
    application["id"],
    notification_type,
    status,
    error_message,
  )
  return updated or application


async def create_partner_application(payload: Any) -> dict[str, Any]:
  conn = await _connect()
  try:
    await _ensure_partner_onboarding_schema(conn)
    email = _normalized_email(payload.email)
    verification = await conn.fetchrow(
      """
      update consulting_partner_email_verifications
      set consumed_at = now()
      where id = (
        select id from consulting_partner_email_verifications
        where email = $1 and verification_token_hash = $2
          and verified_at is not null and token_expires_at > now() and consumed_at is null
        order by created_at desc limit 1
        for update skip locked
      )
      returning id
      """,
      email,
      _email_verification_digest(payload.email_verification_token),
    )
    if verification is None:
      raise HTTPException(status_code=422, detail="이메일 인증이 만료되었거나 유효하지 않습니다. 다시 인증해 주세요.")
    categories = _clean_text_list(payload.categories)
    specialties = _clean_text_list(payload.specialties)
    consulting_modes = [
      mode.value if hasattr(mode, "value") else str(mode)
      for mode in payload.consulting_modes
      if (mode.value if hasattr(mode, "value") else str(mode)) in {"online", "offline"}
    ] or ["online"]
    row = await conn.fetchrow(
      """
      insert into consulting_partner_applications (
        email, name, title, studio_name, phone, message, partner_type,
        business_registration_number, specialties, categories, category_ids,
        introduction, consulting_modes, price_30_min, price_60_min,
        online_price_30_min, online_price_60_min, offline_price_30_min,
        offline_price_60_min, offline_address, offline_detail_address,
        offline_location_note, profile_image_file_name, profile_image_storage_key,
        profile_image_content_type, business_registration_file_name,
        business_registration_storage_key, beauty_license_file_name,
        beauty_license_storage_key, additional_certificate_file_names,
        additional_certificate_storage_keys
      )
      select $1, $2, $3, $4, $5, $6, $7,
        $8, $9::text[], $10::text[], $11::text[],
        $12, $13::text[], $14, $15,
        $16, $17, $18,
        $19, $20, $21,
        $22, $23, $24,
        $25, $26,
        $27, $28,
        $29, $30::text[],
        $31::text[]
      where not exists (
        select 1 from consulting_partner_accounts where email = $1
      )
      on conflict (email) where status in ('submitted', 'needs_update')
      do update set
        name = excluded.name,
        title = excluded.title,
        studio_name = excluded.studio_name,
        phone = excluded.phone,
        message = excluded.message,
        partner_type = excluded.partner_type,
        business_registration_number = excluded.business_registration_number,
        specialties = excluded.specialties,
        categories = excluded.categories,
        category_ids = excluded.category_ids,
        introduction = excluded.introduction,
        consulting_modes = excluded.consulting_modes,
        price_30_min = excluded.price_30_min,
        price_60_min = excluded.price_60_min,
        online_price_30_min = excluded.online_price_30_min,
        online_price_60_min = excluded.online_price_60_min,
        offline_price_30_min = excluded.offline_price_30_min,
        offline_price_60_min = excluded.offline_price_60_min,
        offline_address = excluded.offline_address,
        offline_detail_address = excluded.offline_detail_address,
        offline_location_note = excluded.offline_location_note,
        profile_image_file_name = excluded.profile_image_file_name,
        profile_image_storage_key = excluded.profile_image_storage_key,
        profile_image_content_type = excluded.profile_image_content_type,
        business_registration_file_name = excluded.business_registration_file_name,
        business_registration_storage_key = excluded.business_registration_storage_key,
        beauty_license_file_name = excluded.beauty_license_file_name,
        beauty_license_storage_key = excluded.beauty_license_storage_key,
        additional_certificate_file_names = excluded.additional_certificate_file_names,
        additional_certificate_storage_keys = excluded.additional_certificate_storage_keys,
        status = 'submitted',
        rejection_reason = null,
        review_memo = null,
        updated_at = now()
      returning *
      """,
      email,
      payload.owner_name.strip(),
      (payload.specialties[0] if payload.specialties else "뷰티 상담 전문가").strip(),
      payload.business_name.strip(),
      payload.phone.strip(),
      payload.introduction.strip(),
      payload.partner_type.value if hasattr(payload.partner_type, "value") else str(payload.partner_type),
      (payload.business_registration_number or "").strip() or None,
      specialties,
      categories,
      _category_ids(categories),
      payload.introduction.strip(),
      consulting_modes,
      payload.price_30_min,
      payload.price_60_min,
      payload.online_price_30_min,
      payload.online_price_60_min,
      payload.offline_price_30_min,
      payload.offline_price_60_min,
      (payload.offline_address or "").strip() or None,
      (payload.offline_detail_address or "").strip() or None,
      (payload.offline_location_note or "").strip() or None,
      payload.profile_image_file_name.strip(),
      payload.profile_image_storage_key.strip(),
      payload.profile_image_content_type.strip(),
      (payload.business_registration_file_name or "").strip() or None,
      (payload.business_registration_storage_key or "").strip() or None,
      (payload.beauty_license_file_name or "").strip() or None,
      (payload.beauty_license_storage_key or "").strip() or None,
      [str(value).strip() for value in payload.additional_certificate_file_names],
      [str(value).strip() for value in payload.additional_certificate_storage_keys],
    )
    if row is None:
      raise HTTPException(status_code=409, detail="이미 파트너 계정이 발급된 이메일입니다.")
    row = await _deliver_application_email(
      conn,
      row,
      notification_type="submitted",
      recipient=email,
      subject="[AURA] 입점 신청이 접수되었습니다",
      paragraphs=[
        f"{payload.owner_name.strip()}님, {payload.business_name.strip()} 입점 신청이 정상적으로 접수되었습니다.",
        "관리자 검토 후 보완 요청, 반려 또는 승인 결과를 이 이메일로 안내해 드립니다.",
      ],
    )
    return _application_from_row(row)
  finally:
    await conn.close()


async def list_partner_applications(*, status: str = "all", query: str | None = None) -> list[dict[str, Any]]:
  conn = await _connect()
  try:
    await _ensure_partner_onboarding_schema(conn)
    args: list[Any] = []
    where = ["true"]
    if status and status != "all":
      args.append(status)
      where.append(f"status = ${len(args)}")
    if query:
      args.append(f"%{query.lower()}%")
      where.append(
        f"(lower(coalesce(studio_name, '')) like ${len(args)} or lower(name) like ${len(args)} or lower(email::text) like ${len(args)})"
      )
    rows = await conn.fetch(
      f"""
      select *
      from consulting_partner_applications
      where {' and '.join(where)}
      order by updated_at desc
      """,
      *args,
    )
    return [_application_from_row(row) for row in rows]
  finally:
    await conn.close()


async def get_partner_application_detail(application_id: str) -> dict[str, Any]:
  conn = await _connect()
  try:
    await _ensure_partner_onboarding_schema(conn)
    row = await conn.fetchrow(
      "select * from consulting_partner_applications where id::text = $1",
      application_id,
    )
    if row is None:
      raise HTTPException(status_code=404, detail="Partner application not found.")
    account = None
    member = None
    if row.get("generated_account_id"):
      account_row = await conn.fetchrow(
        """
        select id::text id, expert_id, email::text email, role, workspace_scope,
               status, password_change_required, created_at
        from consulting_partner_accounts where id = $1
        """,
        row["generated_account_id"],
      )
      if account_row:
        business_id = _business_id_for_expert(account_row["expert_id"])
        account = {
          **dict(account_row),
          "application_id": application_id,
          "business_id": business_id,
          "temporary_password": "",
          "created_at": _iso(account_row["created_at"]),
          "delivered_by": "manual",
        }
        member = _member_payload(account, business_id)
    return {"application": _application_from_row(row), "review_logs": [], "account": account, "member": member}
  finally:
    await conn.close()


def _member_payload(account: dict[str, Any], business_id: str) -> dict[str, Any]:
  created_at = account.get("created_at") or _iso(datetime.now(timezone.utc))
  return {
    "id": f"member:{account['id']}",
    "business_id": business_id,
    "account_id": account["id"],
    "expert_id": account.get("expert_id"),
    "role": "expert" if account.get("role") == "expert" else "owner",
    "workspace_scope": account.get("workspace_scope") or "expert_personal",
    "status": "active" if account.get("status") == "active" else "invited",
    "created_at": created_at,
    "updated_at": created_at,
  }


async def approve_partner_application(application_id: str, payload: Any) -> dict[str, Any]:
  conn = await _connect()
  temporary_password = secrets.token_urlsafe(24)
  salt = secrets.token_hex(16)
  try:
    await _ensure_partner_onboarding_schema(conn)
    async with conn.transaction():
      application = await conn.fetchrow(
        """
        select * from consulting_partner_applications
        where id::text = $1 and status in ('submitted', 'needs_update')
        for update
        """,
        application_id,
      )
      if application is None:
        raise HTTPException(status_code=409, detail="검토 가능한 입점 신청을 찾을 수 없습니다.")

      expert_id = application.get("expert_id") or f"exp_{uuid4().hex[:12]}"
      sort_order = await conn.fetchval("select coalesce(max(sort_order) + 1, 0) from consulting_experts")
      compact_name = "".join(str(application["name"]).split())
      initials = compact_name[-2:] if len(compact_name) >= 2 else compact_name or "A"
      certifications = _clean_text_list([
        application.get("beauty_license_file_name"),
        *_list(application.get("additional_certificate_file_names")),
      ])
      await conn.execute(
        """
        insert into consulting_experts (
          id, name, title, signature_line, initials, avatar_tone, studio_name,
          career_years, rating, review_count, session_count, rebook_rate,
          response_minutes, intro, availability_note, tags, certifications,
          sort_order, is_active, image_url, partner_type,
          business_registration_number, business_owner_name, business_description,
          phone, business_address
        ) values (
          $1, $2, $3, $4, $5, 'rose', $6,
          0, 0, 0, 0, 0,
          30, $7, '', $8::text[], $9::text[], $10, true, $11, $12,
          $13, $14, $15, $16, $17
        )
        """,
        expert_id,
        application["name"],
        application["title"],
        application.get("introduction") or application["title"],
        initials,
        application.get("studio_name"),
        application.get("introduction") or "",
        _list(application.get("specialties")),
        certifications,
        sort_order or 0,
        (
          f"{get_settings().cdn_base_url.rstrip('/')}/{str(application.get('profile_image_storage_key')).lstrip('/')}"
          if application.get("profile_image_storage_key") else None
        ),
        application.get("partner_type") or "freelancer",
        application.get("business_registration_number"),
        application.get("name"),
        application.get("introduction") or "",
        application.get("phone"),
        " ".join(
          value for value in (
            str(application.get("offline_address") or "").strip(),
            str(application.get("offline_detail_address") or "").strip(),
          ) if value
        ),
      )
      for category_id in _list(application.get("category_ids")) or ["personalColor"]:
        await conn.execute(
          """
          insert into consulting_expert_categories (expert_id, category_id)
          select $1, $2 where exists (select 1 from consulting_categories where id = $2)
          on conflict (expert_id, category_id) do nothing
          """,
          expert_id,
          category_id,
        )
      for index, (code, label, minutes, price, recommended) in enumerate((
        ("d30", "30분", 30, _int(application.get("price_30_min")), False),
        ("d60", "60분", 60, _int(application.get("price_60_min")), True),
      )):
        await conn.execute(
          """
          insert into consulting_expert_durations (
            expert_id, code, label, minutes, price, description, recommended, sort_order
          ) values ($1, $2, $3, $4, $5, $6, $7, $8)
          on conflict (expert_id, code) do update set
            label = excluded.label, minutes = excluded.minutes, price = excluded.price,
            description = excluded.description, recommended = excluded.recommended,
            sort_order = excluded.sort_order
          """,
          expert_id,
          code,
          label,
          minutes,
          price,
          f"{label} {'온라인' if 'online' in _list(application.get('consulting_modes')) else '오프라인'} 상담",
          recommended,
          index,
        )

      account_email = str(application["email"]).strip().lower()
      role = "expert" if application.get("partner_type") == "freelancer" else "business_manager"
      workspace_scope = "expert_personal" if role == "expert" else "business_operations"
      account = await conn.fetchrow(
        """
        insert into consulting_partner_accounts (
          expert_id, email, password_hash, password_salt, role,
          workspace_scope, status, password_change_required
        ) values ($1, $2, $3, $4, $5, $6, 'invited', true)
        on conflict (email) do update set
          expert_id = excluded.expert_id,
          password_hash = excluded.password_hash,
          password_salt = excluded.password_salt,
          role = excluded.role,
          workspace_scope = excluded.workspace_scope,
          status = 'invited',
          password_change_required = true,
          updated_at = now()
        where consulting_partner_accounts.expert_id = excluded.expert_id
        returning id::text id, expert_id, email::text email, role, workspace_scope,
                  status, password_change_required, created_at
        """,
        expert_id,
        account_email,
        _password_hash(temporary_password, salt),
        salt,
        role,
        workspace_scope,
      )
      if account is None:
        raise HTTPException(status_code=409, detail="다른 전문가가 이미 사용 중인 로그인 이메일입니다.")
      await conn.execute("delete from consulting_partner_sessions where account_id::text = $1", account["id"])
      application = await conn.fetchrow(
        """
        update consulting_partner_applications
        set status = 'approved', expert_id = $2, generated_account_id = $3::uuid,
            rejection_reason = null, review_memo = $4, reviewer_name = $5,
            reviewed_by_subject = $5, reviewed_at = now(), updated_at = now()
        where id::text = $1
        returning *
        """,
        application_id,
        expert_id,
        account["id"],
        payload.review_memo.strip(),
        payload.reviewer_name.strip(),
      )

    login_url = f"{get_settings().frontend_origin.rstrip('/')}/login"
    application = await _deliver_application_email(
      conn,
      application,
      notification_type="approved",
      recipient=str(application["email"]),
      subject="[AURA] 입점 승인 및 파트너 계정 안내",
      paragraphs=[
        f"{application['name']}님, 입점 심사가 승인되어 파트너 계정이 생성되었습니다.",
        f"로그인 이메일: {account['email']}",
        f"임시 비밀번호: {temporary_password}",
        f"로그인: {login_url}",
        "보안을 위해 첫 로그인 직후 새 비밀번호로 변경해 주세요.",
      ],
      html_body=_approval_email_html(
        name=str(application["name"]),
        email=str(account["email"]),
        temporary_password=temporary_password,
        login_url=login_url,
      ),
    )
    business_id = _business_id_for_expert(expert_id)
    account_payload = {
      **dict(account),
      "application_id": application_id,
      "business_id": business_id,
      "temporary_password": temporary_password,
      "created_at": _iso(account["created_at"]),
      "delivered_by": "email" if application.get("last_email_notification_status") == "sent" else "manual",
    }
    return {
      "application": _application_from_row(application),
      "account": account_payload,
      "member": _member_payload(account_payload, business_id),
    }
  finally:
    await conn.close()


async def reissue_partner_credentials(application_id: str) -> dict[str, Any]:
  conn = await _connect()
  temporary_password = secrets.token_urlsafe(24)
  salt = secrets.token_hex(16)
  try:
    await _ensure_partner_onboarding_schema(conn)
    async with conn.transaction():
      application = await conn.fetchrow(
        """
        select * from consulting_partner_applications
        where id::text = $1 and status = 'approved' and generated_account_id is not null
        for update
        """,
        application_id,
      )
      if application is None:
        raise HTTPException(status_code=409, detail="재발급 가능한 승인 계정을 찾을 수 없습니다.")

      account = await conn.fetchrow(
        """
        update consulting_partner_accounts
        set password_hash = $2, password_salt = $3,
            status = 'invited', password_change_required = true, updated_at = now()
        where id = $1::uuid
        returning id::text id, expert_id, email::text email, role, workspace_scope,
                  status, password_change_required, created_at
        """,
        application["generated_account_id"],
        _password_hash(temporary_password, salt),
        salt,
      )
      if account is None:
        raise HTTPException(status_code=409, detail="재발급할 파트너 계정을 찾을 수 없습니다.")

      await conn.execute("delete from consulting_partner_sessions where account_id::text = $1", account["id"])

    login_url = f"{get_settings().frontend_origin.rstrip('/')}/login"
    application = await _deliver_application_email(
      conn,
      application,
      notification_type="credentials_reissued",
      recipient=account["email"],
      subject="[AURA] 파트너 임시 비밀번호 재발급 안내",
      paragraphs=[
        "AURA 파트너 계정의 임시 비밀번호가 재발급되었습니다.",
        f"로그인 이메일: {account['email']}",
        f"임시 비밀번호: {temporary_password}",
        f"로그인: {login_url}",
        "기존 임시 비밀번호와 로그인 세션은 더 이상 사용할 수 없습니다.",
      ],
    )
    business_id = _business_id_for_expert(account["expert_id"])
    account_payload = {
      **dict(account),
      "application_id": application_id,
      "business_id": business_id,
      "temporary_password": temporary_password,
      "created_at": _iso(account["created_at"]),
      "delivered_by": "email" if application.get("last_email_notification_status") == "sent" else "manual",
    }
    return {
      "application": _application_from_row(application),
      "account": account_payload,
      "member": _member_payload(account_payload, business_id),
    }
  finally:
    await conn.close()


async def decide_partner_application(application_id: str, status: str, payload: Any) -> dict[str, Any]:
  if status not in {"needs_update", "rejected"}:
    raise HTTPException(status_code=422, detail="지원하지 않는 입점 심사 상태입니다.")
  conn = await _connect()
  try:
    await _ensure_partner_onboarding_schema(conn)
    row = await conn.fetchrow(
      """
      update consulting_partner_applications
      set status = $2, rejection_reason = $3, review_memo = $3,
          reviewer_name = $4, reviewed_by_subject = $4,
          reviewed_at = now(), updated_at = now()
      where id::text = $1 and status in ('submitted', 'needs_update')
      returning *
      """,
      application_id,
      status,
      payload.review_memo.strip(),
      payload.reviewer_name.strip(),
    )
    if row is None:
      raise HTTPException(status_code=409, detail="검토 가능한 입점 신청을 찾을 수 없습니다.")
    is_update_request = status == "needs_update"
    row = await _deliver_application_email(
      conn,
      row,
      notification_type=status,
      recipient=str(row["email"]),
      subject="[AURA] 입점 신청 보완 요청" if is_update_request else "[AURA] 입점 심사 결과 안내",
      paragraphs=[
        f"{row['name']}님, 입점 신청에 대한 {'보완이 필요합니다.' if is_update_request else '심사 결과 신청이 반려되었습니다.'}",
        f"관리자 안내: {payload.review_memo.strip()}",
        "보완 요청인 경우 신청 페이지에서 동일한 이메일을 인증한 뒤 내용을 수정해 다시 제출해 주세요."
        if is_update_request else
        "문의가 필요하면 이 메일에 회신해 주세요.",
      ],
    )
    return _application_from_row(row)
  finally:
    await conn.close()


async def list_businesses() -> list[dict[str, Any]]:
  experts = await list_experts()
  return [_business_from_expert(expert) for expert in experts]


async def list_experts(principal: PartnerPrincipal | None = None) -> list[dict[str, Any]]:
  conn = await _connect()
  try:
    await _ensure_partner_profile_columns(conn)
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
             e.created_at, e.updated_at, e.image_url, e.studio_name, e.partner_type,
             e.business_registration_number, e.business_owner_name, e.business_description,
             e.phone, e.business_address,
             coalesce((
               select array_agg(c.title order by c.title)
               from consulting_expert_categories ec
               join consulting_categories c on c.id = ec.category_id
               where ec.expert_id = e.id
             ), '{{}}'::text[]) as category_labels,
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
             b.conversation_id::text conversation_id, b.customer_left_at, b.expert_left_at,
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
  conversations: dict[str, list[dict[str, Any]]] = {}
  for booking in bookings:
    if booking.get("expert_left_at"):
      continue
    conversations.setdefault(booking.get("conversation_id") or booking["id"], []).append(booking)
  return [
    await _thread_from_booking(_latest_conversation_booking(conversation_bookings))
    for conversation_bookings in conversations.values()
  ]


def _latest_conversation_booking(bookings: list[dict[str, Any]]) -> dict[str, Any]:
  if not bookings:
    raise ValueError("A conversation must contain at least one booking.")
  return max(
    bookings,
    key=lambda booking: (_parse_iso_datetime(booking.get("requested_at")), str(booking.get("id") or "")),
  )


async def _conversation_bookings(booking: dict[str, Any], principal: PartnerPrincipal) -> list[dict[str, Any]]:
  customer_bookings = await list_partner_bookings(principal, {"customerId": booking["customer_id"]})
  conversation_id = booking.get("conversation_id") or booking["id"]
  return [
    item
    for item in customer_bookings
    if (item.get("conversation_id") or item["id"]) == conversation_id
  ]


async def get_chat_thread_detail(thread_id: str, principal: PartnerPrincipal) -> dict[str, Any]:
  booking_id = thread_id.removeprefix("thread-")
  booking = await get_partner_booking(booking_id, principal)
  conversation_bookings = await _conversation_bookings(booking, principal)
  if conversation_bookings:
    booking = _latest_conversation_booking(conversation_bookings)
    thread_id = f"thread-{booking['id']}"
  conversation_booking_ids = [item["id"] for item in conversation_bookings]
  messages_by_booking = await list_chat_messages_for_bookings(conversation_booking_ids)
  messages = sorted(
    [message for item in conversation_bookings for message in messages_by_booking.get(item["id"], [])],
    key=lambda message: message["sent_at"],
  )
  for message in messages:
    message["thread_id"] = thread_id
  customer_detail = await get_partner_customer(booking["customer_id"], principal)
  expert = await get_expert(booking["expert_id"])
  reports = await list_shared_reports(principal, booking["customer_id"])
  return {
    "thread": await _thread_from_booking(booking, conversation_booking_ids),
    "customer": customer_detail["customer"],
    "booking": booking,
    "expert": expert,
    "shared_reports": reports,
    "messages": messages,
  }


async def mark_chat_thread_read(thread_id: str, principal: PartnerPrincipal) -> dict[str, Any]:
  booking_id = thread_id.removeprefix("thread-")
  booking = await get_partner_booking(booking_id, principal)
  conversation_booking_ids = [item["id"] for item in await _conversation_bookings(booking, principal)]
  conn = await _connect()
  try:
    await conn.execute(
      """
      update consulting_bookings
      set expert_read_at = now(), updated_at = now()
      where id::text = any($1::text[]) and expert_id = $2
      """,
      conversation_booking_ids,
      principal.expert_id,
    )
  finally:
    await conn.close()
  return await get_chat_thread_detail(thread_id, principal)


async def send_chat_message(
  thread_id: str,
  body: str,
  client_message_id: str,
  principal: PartnerPrincipal,
) -> dict[str, Any]:
  booking_id = thread_id.removeprefix("thread-")
  detail = await get_chat_thread_detail(thread_id, principal)
  booking = detail["booking"]
  booking_id = booking["id"]
  if booking.get("customer_left_at") or booking.get("expert_left_at"):
    raise HTTPException(status_code=409, detail="나간 대화방에는 새 메시지를 보낼 수 없습니다.")
  clean_body = body.strip()
  if not clean_body:
    raise HTTPException(status_code=422, detail="메시지 내용을 입력해 주세요.")
  if len(clean_body) > 1000:
    raise HTTPException(status_code=422, detail="메시지는 1,000자 이내로 입력해 주세요.")

  expert = await get_expert(booking["expert_id"])
  conn = await _connect()
  try:
    row = await conn.fetchrow(
      """
      insert into consulting_messages (
        booking_id, client_message_id, sender_type, sender_name, body
      )
      values ($1::uuid, $2, 'expert', $3, $4)
      on conflict (booking_id, sender_type, client_message_id)
      do update set client_message_id = consulting_messages.client_message_id
      returning id::text id, booking_id::text booking_id, client_message_id,
                sender_type, sender_name, body, created_at
      """,
      booking_id,
      client_message_id,
      expert["name"],
      clean_body,
    )
  finally:
    await conn.close()

  return {
    "id": row["id"],
    "booking_id": row["booking_id"],
    "client_message_id": row["client_message_id"],
    "sender_type": row["sender_type"],
    "sender_name": row["sender_name"],
    "body": row["body"],
    "sent_at": _iso(row["created_at"]),
  }


async def leave_chat_thread(thread_id: str, principal: PartnerPrincipal) -> dict[str, Any]:
  booking_id = thread_id.removeprefix("thread-")
  booking = await get_partner_booking(booking_id, principal)
  conversation_id = booking.get("conversation_id") or booking["id"]
  conn = await _connect()
  try:
    await conn.execute(
      """
      update consulting_bookings
      set expert_left_at = coalesce(expert_left_at, now()), updated_at = now()
      where conversation_id::text = $1 and expert_id = $2
      """,
      conversation_id,
      booking["expert_id"],
    )
  finally:
    await conn.close()
  return {"conversation_id": conversation_id, "left": True}


async def _thread_from_booking(booking: dict[str, Any], booking_ids: list[str] | None = None) -> dict[str, Any]:
  conversation_booking_ids = booking_ids or [booking["id"]]
  conn = await _connect()
  try:
    last_message_at, unread_count = await conn.fetchrow(
      """
      select
        max(created_at) as last_message_at,
        count(*) filter (
          where m.sender_type = 'user'
            and ($2::timestamptz is null or m.created_at > $2::timestamptz)
        )::int as unread_count
      from consulting_messages m
      where m.booking_id::text = any($1::text[]) and m.deleted_at is null
      """,
      conversation_booking_ids,
      _parse_iso_datetime(booking["expert_read_at"]) if booking.get("expert_read_at") else None,
    )
  finally:
    await conn.close()
  status = "waiting" if booking["status"] in {"requested", "contacting"} else "open"
  if booking["status"] in {"cancelled", "no_show", "refund_requested"} or booking.get("customer_left_at") or booking.get("expert_left_at"):
    status = "closed"
  return {
    "id": f"thread-{booking['id']}",
    "customer_id": booking["customer_id"],
    "booking_id": booking["id"],
    "assigned_expert_id": booking["expert_id"],
    "last_message_at": _iso(last_message_at) if last_message_at else booking["requested_at"],
    "unread_count": int(unread_count or 0),
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
    "phone": row.get("phone") or "",
    "avatar_url": row["image_url"] or "",
    "initials": row["initials"] or ("".join(str(row["name"]).split())[-2:] or "A"),
    "avatar_tone": row["avatar_tone"] or "rose",
    "specialties": tags,
    "categories": [str(item) for item in _list(row.get("category_labels"))],
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
    "partner_type": row.get("partner_type") or "freelancer",
    "business_registration_number": row.get("business_registration_number"),
    "business_owner_name": row.get("business_owner_name") or row["name"],
    "business_description": row.get("business_description") or row["intro"] or "",
    "business_address": row.get("business_address") or "",
  }


def _business_from_expert(expert: dict[str, Any]) -> dict[str, Any]:
  return {
    "id": expert["business_id"],
    "partner_type": expert.get("partner_type") or "freelancer",
    "name": expert.get("studio_name") or f"{expert['name']} 상담실",
    "owner_name": expert.get("business_owner_name") or expert["name"],
    "business_registration_number": expert.get("business_registration_number"),
    "phone": expert.get("phone") or "",
    "address": expert.get("business_address") or "",
    "website": None,
    "description": expert.get("business_description") or expert.get("introduction") or expert.get("tagline") or "",
    "photos": [
      _attachment(
        attachment_id=f"profile-{expert['id']}",
        owner_id=expert["id"],
        media_type="photo",
        name="프로필 사진",
        url=expert.get("avatar_url") or "",
        uploaded_at=datetime.now(timezone.utc).isoformat(),
      )
    ] if expert.get("avatar_url") else [],
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
    "conversation_id": row["conversation_id"] or row["id"],
    "customer_left_at": _iso(row["customer_left_at"]) if row["customer_left_at"] else None,
    "expert_left_at": _iso(row["expert_left_at"]) if row["expert_left_at"] else None,
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
    "expert_read_at": _iso(row["expert_read_at"]) if row["expert_read_at"] else None,
    "request_memo": row["question"] or row["concern_label"] or "",
    "selected_concern_tags": [row["concern_label"]] if row["concern_label"] else [],
    "internal_memo": operator_note,
    "customer_notice": _customer_notice(status),
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


def _customer_notice(status: str | None) -> str:
  normalized = str(status or "requested").strip().lower()
  if normalized in {"confirmed", "scheduled"}:
    return "예약이 완료되었습니다. 예약일에 전문가가 먼저 전화드리니 연락을 기다려 주세요."
  if normalized == "in_progress":
    return "상담이 진행 중입니다."
  if normalized == "completed":
    return "상담이 완료되었습니다. 전문가가 정리한 상담 내용을 확인해 주세요."
  if normalized in {"cancelled", "canceled", "no_show", "refund_requested"}:
    return "예약 상태가 변경되었습니다. 채팅방에서 상세 내용을 확인해 주세요."
  if normalized == "contacting":
    return "입금 확인 중입니다. 전문가가 확인 후 예약을 확정합니다."
  return "예약 신청이 접수되었습니다. 채팅방에서 입금 안내를 확인해 주세요."


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
  notes = _normalize_summary_notes(row["notes"])
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


def _normalize_summary_notes(value: Any) -> dict[str, Any]:
  parsed = _json(value)
  if isinstance(parsed, dict):
    return parsed
  if not isinstance(parsed, list):
    return {}

  notes: dict[str, Any] = {}
  legacy_text: list[str] = []
  for item in parsed:
    if isinstance(item, dict):
      notes.update(item)
    elif str(item or "").strip():
      legacy_text.append(str(item).strip())
  if legacy_text and not any(key in notes for key in ("customerSummary", "customer_summary", "summary")):
    notes["customerSummary"] = "\n".join(legacy_text)
  return notes


def _application_from_row(row: asyncpg.Record) -> dict[str, Any]:
  application_id = str(row["id"])
  submitted_at = row.get("created_at") or row.get("submitted_at")
  documents = []
  document_specs = [
    (
      "business_registration",
      row.get("business_registration_file_name"),
      row.get("business_registration_storage_key"),
    ),
    (
      "beauty_license",
      row.get("beauty_license_file_name"),
      row.get("beauty_license_storage_key"),
    ),
  ]
  additional_storage_keys = _list(row.get("additional_certificate_storage_keys"))
  document_specs.extend(
    (
      "additional_certificate",
      file_name,
      additional_storage_keys[index] if index < len(additional_storage_keys) else None,
    )
    for index, file_name in enumerate(_list(row.get("additional_certificate_file_names")))
  )
  for index, (document_type, file_name, storage_key) in enumerate(document_specs):
    if not file_name:
      continue
    documents.append({
      "id": f"{application_id}:{document_type}:{index}",
      "application_id": application_id,
      "type": document_type,
      "file_name": str(file_name),
      "mime_type": "application/pdf",
      "size_label": "제출됨",
      "storage_key": str(storage_key or ""),
      "uploaded_at": _iso(submitted_at),
      "review_status": "verified" if row.get("status") == "approved" else "pending",
    })
  return {
    "id": application_id,
    "partner_type": row.get("partner_type") or "freelancer",
    "business_name": row.get("studio_name") or row.get("name") or "",
    "owner_name": row.get("name") or "",
    "business_registration_number": row.get("business_registration_number"),
    "phone": row.get("phone") or "",
    "email": str(row.get("email") or ""),
    "specialties": _list(row.get("specialties")),
    "categories": _list(row.get("categories")),
    "introduction": row.get("introduction") or "",
    "consulting_modes": _list(row.get("consulting_modes")) or ["online"],
    "price_30_min": _int(row.get("price_30_min")),
    "price_60_min": _int(row.get("price_60_min")),
    "online_price_30_min": row.get("online_price_30_min"),
    "online_price_60_min": row.get("online_price_60_min"),
    "offline_price_30_min": row.get("offline_price_30_min"),
    "offline_price_60_min": row.get("offline_price_60_min"),
    "offline_address": row.get("offline_address"),
    "offline_detail_address": row.get("offline_detail_address"),
    "offline_location_note": row.get("offline_location_note"),
    "profile_image_file_name": row.get("profile_image_file_name"),
    "profile_image_storage_key": row.get("profile_image_storage_key"),
    "profile_image_content_type": row.get("profile_image_content_type"),
    "status": row["status"],
    "submitted_at": _iso(submitted_at),
    "updated_at": _iso(row["updated_at"]),
    "reviewed_at": _iso(row["reviewed_at"]) if row.get("reviewed_at") else None,
    "reviewer_name": row.get("reviewer_name"),
    "review_memo": row.get("review_memo") or row.get("rejection_reason"),
    "business_id": f"freelancer:{row['expert_id']}" if row.get("expert_id") else None,
    "generated_account_id": str(row["generated_account_id"]) if row.get("generated_account_id") else None,
    "last_email_notification_type": row.get("last_email_notification_type"),
    "last_email_notification_status": row.get("last_email_notification_status"),
    "last_email_notification_error": row.get("last_email_notification_error"),
    "last_email_notification_sent_at": _iso(row["last_email_notification_sent_at"])
    if row.get("last_email_notification_sent_at") else None,
    "documents": documents,
  }


async def create_partner_application_document_access(document_id: str) -> dict[str, Any]:
  application_id, separator, _ = document_id.partition(":")
  if not separator:
    raise HTTPException(status_code=404, detail="제출 서류를 찾을 수 없습니다.")
  conn = await _connect()
  try:
    await _ensure_partner_onboarding_schema(conn)
    row = await conn.fetchrow(
      "select * from consulting_partner_applications where id::text = $1",
      application_id,
    )
    if row is None:
      raise HTTPException(status_code=404, detail="제출 서류를 찾을 수 없습니다.")
    document = next(
      (item for item in _application_from_row(row)["documents"] if item["id"] == document_id),
      None,
    )
    if document is None:
      raise HTTPException(status_code=404, detail="제출 서류를 찾을 수 없습니다.")
    if not document["storage_key"]:
      raise HTTPException(status_code=409, detail="이 신청에는 실제 PDF 파일이 업로드되지 않았습니다.")
    settings = get_settings()
    if not settings.s3_configured:
      raise HTTPException(status_code=503, detail="S3_BUCKET_NAME is not configured.")
    access = create_presigned_download(settings, document["storage_key"], document["file_name"])
    return {
      "document_id": document["id"],
      "file_name": document["file_name"],
      **access,
    }
  finally:
    await conn.close()


async def create_partner_application_profile_image_access(application_id: str) -> dict[str, Any]:
  conn = await _connect()
  try:
    await _ensure_partner_onboarding_schema(conn)
    row = await conn.fetchrow(
      """
      select profile_image_file_name, profile_image_storage_key, profile_image_content_type
      from consulting_partner_applications where id::text = $1
      """,
      application_id,
    )
    if row is None or not row.get("profile_image_storage_key"):
      raise HTTPException(status_code=404, detail="제출된 프로필 사진을 찾을 수 없습니다.")
    settings = get_settings()
    if not settings.s3_configured:
      raise HTTPException(status_code=503, detail="S3_BUCKET_NAME is not configured.")
    access = create_presigned_view(
      settings,
      str(row["profile_image_storage_key"]),
      str(row.get("profile_image_content_type") or "image/jpeg"),
    )
    return {
      "file_name": str(row.get("profile_image_file_name") or "profile-image"),
      **access,
    }
  finally:
    await conn.close()
