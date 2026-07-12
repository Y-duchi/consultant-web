from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException

from app.services import real_workspace
from app.services.auth import PartnerPrincipal
from app.services.chime_meetings import ChimeMeetingsService
from app.settings import Settings, get_settings


SUPPORTED_LANGUAGE_CODES = {"ko-KR", "en-US"}
JOINABLE_BOOKING_STATUSES = {"confirmed", "scheduled", "in_progress"}


async def get_call_state(booking_id: str, principal: PartnerPrincipal, settings: Settings | None = None) -> dict[str, Any]:
  settings = settings or get_settings()
  await real_workspace.get_partner_booking(booking_id, principal)
  return _session_payload(await _call_session(booking_id), settings, booking_id)


async def join_call(
  booking_id: str,
  principal: PartnerPrincipal,
  language_code: str | None,
  settings: Settings | None = None,
) -> dict[str, Any]:
  settings = settings or get_settings()
  booking = await real_workspace.get_partner_booking(booking_id, principal)
  _validate_booking_joinable(booking, settings)

  normalized_language_code = _normalize_language_code(language_code)
  meeting, session = await _meeting_for_booking(booking, settings)
  session = await _update_partner_language(str(session["id"]), normalized_language_code) or session
  attendee = await ChimeMeetingsService(settings).create_attendee(
    meeting_id=str(meeting["MeetingId"]),
    external_user_id=f"partner:{principal.account_id}",
  )
  return {
    "call_session_id": str(session["id"]),
    "booking_id": booking_id,
    "participant_type": "expert",
    "participant_language_code": normalized_language_code,
    "supported_language_codes": sorted(SUPPORTED_LANGUAGE_CODES),
    "participant": {
      "id": principal.account_id,
      "type": "partner",
      "language_code": normalized_language_code,
    },
    "meeting": meeting,
    "attendee": attendee,
    "transcription": _transcription_payload(session, settings),
    "transcription_status": _transcription_payload(session, settings)["status"],
    "transcription_mode": _transcription_mode(session),
  }


async def end_call(
  booking_id: str,
  principal: PartnerPrincipal,
  settings: Settings | None = None,
  *,
  transcript: str | None = None,
) -> dict[str, Any]:
  settings = settings or get_settings()
  booking = await real_workspace.get_partner_booking(booking_id, principal)
  session = await _call_session(booking_id)
  updated = session
  if session is not None:
    provider_meeting_id = session.get("provider_meeting_id")
    if settings.chime_enabled and provider_meeting_id and session.get("status") != "ended":
      await ChimeMeetingsService(settings).delete_meeting(meeting_id=str(provider_meeting_id))

    conn = await real_workspace._connect()
    try:
      await _ensure_call_tables(conn)
      updated = await conn.fetchrow(
        """
        update consulting_call_sessions
        set status = 'ended',
            transcription_status = case
              when transcription_status = 'disabled' then 'disabled'
              else 'stopped'
            end,
            ended_at = coalesce(ended_at, now()),
            updated_at = now()
        where booking_id::text = $1
        returning *
        """,
        booking_id,
      )
    finally:
      await conn.close()

  clean_transcript = (transcript or "").strip()
  if not clean_transcript:
    clean_transcript = "화상 상담이 정상적으로 완료되었습니다. 상담 내용을 기준으로 후속 안내를 제공합니다."

  summary_status = "succeeded"
  try:
    existing_summary = await real_workspace.get_summary_for_booking(booking_id, principal)
    if existing_summary is None:
      await real_workspace.generate_summary(
        booking_id,
        {
          "transcript": clean_transcript,
          "visible_to_customer": True,
        },
        principal,
      )
  except Exception:
    summary_status = "failed"
    conn = await real_workspace._connect()
    try:
      await conn.execute(
        "update consulting_bookings set status = 'completed', updated_at = now() where id::text = $1",
        booking["id"],
      )
    finally:
      await conn.close()

  result = _session_payload(updated or session, settings, booking_id)
  result["summary_status"] = summary_status
  return result


async def start_transcription(
  booking_id: str,
  principal: PartnerPrincipal,
  language_code: str | None,
  transcription_consent_accepted: bool = False,
  settings: Settings | None = None,
) -> dict[str, Any]:
  settings = settings or get_settings()
  await real_workspace.get_partner_booking(booking_id, principal)
  if not transcription_consent_accepted:
    raise ValueError("TRANSCRIPTION_CONSENT_REQUIRED")
  session = await _require_started_session(booking_id)
  normalized_language_code = _normalize_language_code(language_code)
  session = await _update_partner_language(str(session["id"]), normalized_language_code) or session
  await _update_transcription_state(booking_id, "starting", None, settings)
  transcription_mode, transcription_language_code = await ChimeMeetingsService(settings).start_transcription(
    meeting_id=str(session["provider_meeting_id"]),
    participant_languages={
      "customer": str(session.get("customer_language_code") or "ko-KR"),
      "partner": str(session.get("expert_language_code") or normalized_language_code),
    },
  )
  return await _update_transcription_state(
    booking_id,
    "active",
    transcription_language_code,
    settings,
    transcription_mode=transcription_mode,
  )


async def stop_transcription(booking_id: str, principal: PartnerPrincipal, settings: Settings | None = None) -> dict[str, Any]:
  settings = settings or get_settings()
  await real_workspace.get_partner_booking(booking_id, principal)
  session = await _require_started_session(booking_id)
  await _update_transcription_state(booking_id, "stopping", None, settings)
  await ChimeMeetingsService(settings).stop_transcription(meeting_id=str(session["provider_meeting_id"]))
  return await _update_transcription_state(booking_id, "stopped", None, settings)


async def translate_caption(
  booking_id: str,
  principal: PartnerPrincipal,
  *,
  result_id: str,
  source_language_code: str,
  content: str,
  settings: Settings | None = None,
) -> dict[str, Any]:
  settings = settings or get_settings()
  await real_workspace.get_partner_booking(booking_id, principal)
  result_id = result_id.strip()
  content = content.strip()
  if not result_id or not content:
    raise HTTPException(status_code=400, detail="번역할 확정 자막 식별자와 내용이 필요합니다.")

  session = await _call_session(booking_id)
  if session is None:
    raise HTTPException(status_code=409, detail="화상상담 입장 후 확정 자막을 번역할 수 있습니다.")

  normalized_language_code = _normalize_language_code(source_language_code)
  conn = await real_workspace._connect()
  try:
    await _ensure_call_tables(conn)
    existing = await conn.fetchrow(
      """
      select result_id, source_language_code, target_language_code, translated_content
      from consulting_transcript_segments
      where call_session_id = $1 and result_id = $2 and is_partial = false
      """,
      session["id"],
      result_id,
    )
    if existing and existing.get("translated_content"):
      return {
        "result_id": str(existing["result_id"]),
        "source_language_code": str(existing["source_language_code"]),
        "target_language_code": str(existing["target_language_code"]),
        "translated_content": str(existing["translated_content"]),
      }

    translated = await ChimeMeetingsService(settings).translate_final_caption(
      source_language_code=normalized_language_code,
      content=content,
    )
    stored = await conn.fetchrow(
      """
      insert into consulting_transcript_segments (
        call_session_id, booking_id, participant_type, participant_id,
        language_code, source_text, translated_text, is_partial,
        result_id, speaker_type, source_language_code, content,
        target_language_code, translated_content
      )
      values (
        $1, $2::uuid, 'partner', $3,
        $4, $5, $6, false,
        $7, 'unknown', $4, $5,
        $8, $6
      )
      on conflict (call_session_id, result_id) where result_id is not null do update set
        translated_text = excluded.translated_text,
        translated_content = excluded.translated_content
      returning result_id, source_language_code, target_language_code, translated_content
      """,
      session["id"],
      booking_id,
      principal.account_id,
      normalized_language_code,
      content,
      translated["translated_content"],
      result_id,
      translated["target_language_code"],
    )
  finally:
    await conn.close()

  row = stored or {
    "result_id": result_id,
    "source_language_code": normalized_language_code,
    "target_language_code": translated["target_language_code"],
    "translated_content": translated["translated_content"],
  }
  return {
    "result_id": str(row["result_id"]),
    "source_language_code": str(row["source_language_code"]),
    "target_language_code": str(row["target_language_code"]),
    "translated_content": str(row["translated_content"]),
  }


async def _meeting_for_booking(booking: dict[str, Any], settings: Settings) -> tuple[dict[str, Any], dict[str, Any]]:
  if not settings.chime_enabled:
    raise HTTPException(status_code=503, detail="Chime 화상상담 서버 설정이 아직 켜져 있지 않습니다.")

  chime = ChimeMeetingsService(settings)
  row = await _call_session(str(booking["id"]))
  if row and row.get("status") == "ended":
    raise HTTPException(status_code=409, detail="이미 종료된 화상상담입니다.")
  if row and row.get("provider_meeting_id"):
    meeting = await chime.get_meeting(meeting_id=str(row["provider_meeting_id"]))
    return meeting, await _activate_existing_session(row)

  meeting = await chime.create_meeting(external_meeting_id=f"consulting-{booking['id']}")
  session = await _create_call_session(booking, meeting, settings)
  return meeting, session


async def _call_session(booking_id: str) -> dict[str, Any] | None:
  conn = await real_workspace._connect()
  try:
    await _ensure_call_tables(conn)
    return await conn.fetchrow(
      """
      select *
      from consulting_call_sessions
      where booking_id::text = $1
      """,
      booking_id,
    )
  finally:
    await conn.close()


async def _create_call_session(booking: dict[str, Any], meeting: dict[str, Any], settings: Settings) -> dict[str, Any]:
  conn = await real_workspace._connect()
  try:
    await _ensure_call_tables(conn)
    return await conn.fetchrow(
      """
      insert into consulting_call_sessions (
        booking_id, user_id, expert_id, provider, provider_meeting_id,
        provider_external_meeting_id, media_region, status, transcription_status,
        transcription_mode, started_at, expires_at
      )
      values (
        $1::uuid, $2::uuid, $3, 'chime', $4,
        $5, $6, 'active', $7, 'fixed', now(), $8
      )
      on conflict (booking_id) do update set
        provider_meeting_id = excluded.provider_meeting_id,
        provider_external_meeting_id = excluded.provider_external_meeting_id,
        media_region = excluded.media_region,
        status = 'active',
        transcription_status = excluded.transcription_status,
        transcription_mode = excluded.transcription_mode,
        started_at = coalesce(consulting_call_sessions.started_at, now()),
        ended_at = null,
        updated_at = now()
      returning *
      """,
      booking["id"],
      booking["customer_id"],
      booking["expert_id"],
      str(meeting["MeetingId"]),
      str(meeting.get("ExternalMeetingId") or f"consulting-{booking['id']}"),
      settings.effective_chime_media_region,
      "stopped" if settings.effective_consulting_call_transcription_enabled else "disabled",
      _parse_datetime(booking["starts_at"]) + timedelta(minutes=int(booking.get("duration_minutes") or 30) + 60),
    )
  finally:
    await conn.close()


async def _update_partner_language(session_id: str, language_code: str) -> dict[str, Any] | None:
  conn = await real_workspace._connect()
  try:
    await _ensure_call_tables(conn)
    return await conn.fetchrow(
      """
      update consulting_call_sessions
      set expert_language_code = $2,
          updated_at = now()
      where id::text = $1
      returning *
      """,
      session_id,
      language_code,
    )
  finally:
    await conn.close()


async def _activate_existing_session(row: dict[str, Any]) -> dict[str, Any]:
  conn = await real_workspace._connect()
  try:
    await _ensure_call_tables(conn)
    updated = await conn.fetchrow(
      """
      update consulting_call_sessions
      set status = 'active',
          started_at = coalesce(started_at, now()),
          ended_at = null,
          updated_at = now()
      where id = $1
      returning *
      """,
      row["id"],
    )
    return updated or row
  finally:
    await conn.close()


async def _require_started_session(booking_id: str) -> dict[str, Any]:
  session = await _call_session(booking_id)
  if session is None or not session.get("provider_meeting_id"):
    raise HTTPException(status_code=409, detail="화상상담 입장 후 실시간 자막을 제어할 수 있습니다.")
  return session


async def _update_transcription_state(
  booking_id: str,
  status: str,
  language_code: str | None,
  settings: Settings,
  *,
  transcription_mode: str | None = None,
) -> dict[str, Any]:
  conn = await real_workspace._connect()
  try:
    await _ensure_call_tables(conn)
    row = await conn.fetchrow(
      """
      update consulting_call_sessions
      set transcription_status = $2,
          transcription_language_code = coalesce($3, transcription_language_code),
          transcription_mode = coalesce($4, transcription_mode),
          updated_at = now()
      where booking_id::text = $1
      returning *
      """,
      booking_id,
      status,
      language_code,
      transcription_mode,
    )
  finally:
    await conn.close()
  return _session_payload(row, settings, booking_id)


async def _ensure_call_tables(conn) -> None:
  await conn.execute(
    """
    create table if not exists consulting_call_sessions (
      id uuid primary key default gen_random_uuid(),
      booking_id uuid not null unique,
      user_id uuid not null,
      expert_id text not null,
      provider text not null default 'chime',
      provider_meeting_id text,
      provider_external_meeting_id text,
      media_region text,
      status text not null default 'created',
      transcription_status text not null default 'disabled',
      transcription_language_code text,
      customer_language_code text not null default 'ko-KR',
      expert_language_code text not null default 'ko-KR',
      transcription_mode text not null default 'fixed',
      started_at timestamptz,
      ended_at timestamptz,
      expires_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
    """,
  )
  await conn.execute("alter table consulting_call_sessions add column if not exists customer_language_code text not null default 'ko-KR'")
  await conn.execute("alter table consulting_call_sessions add column if not exists expert_language_code text not null default 'ko-KR'")
  await conn.execute("alter table consulting_call_sessions add column if not exists transcription_mode text not null default 'fixed'")
  await conn.execute("create index if not exists idx_consulting_call_sessions_booking on consulting_call_sessions (booking_id)")
  await conn.execute(
    """
    create table if not exists consulting_transcript_segments (
      id uuid primary key default gen_random_uuid(),
      call_session_id uuid not null references consulting_call_sessions(id) on delete cascade,
      booking_id uuid not null,
      participant_type text not null,
      participant_id text,
      language_code text not null,
      source_text text not null,
      translated_text text,
      is_partial boolean not null default false,
      result_id text,
      speaker_type text,
      source_language_code text,
      content text,
      target_language_code text,
      translated_content text,
      created_at timestamptz not null default now()
    )
    """,
  )
  await conn.execute("alter table consulting_transcript_segments add column if not exists result_id text")
  await conn.execute("alter table consulting_transcript_segments add column if not exists speaker_type text")
  await conn.execute("alter table consulting_transcript_segments add column if not exists source_language_code text")
  await conn.execute("alter table consulting_transcript_segments add column if not exists content text")
  await conn.execute("alter table consulting_transcript_segments add column if not exists target_language_code text")
  await conn.execute("alter table consulting_transcript_segments add column if not exists translated_content text")
  await conn.execute(
    "create unique index if not exists idx_consulting_transcript_segments_result on consulting_transcript_segments (call_session_id, result_id) where result_id is not null",
  )


def _validate_booking_joinable(booking: dict[str, Any], settings: Settings) -> None:
  if booking.get("channel") != "video":
    raise HTTPException(status_code=409, detail="화상 예약만 Chime 상담방에 입장할 수 있습니다.")
  if booking.get("status") not in JOINABLE_BOOKING_STATUSES:
    raise HTTPException(status_code=409, detail="확정된 예약만 Chime 상담방에 입장할 수 있습니다.")

  starts_at = _parse_datetime(booking.get("starts_at"))
  now = datetime.now(timezone.utc)
  latest_at = starts_at + timedelta(
    minutes=int(booking.get("duration_minutes") or 30) + settings.consulting_call_join_late_minutes,
  )
  if settings.consulting_call_enforce_early_window:
    earliest_at = starts_at - timedelta(minutes=settings.consulting_call_join_early_minutes)
    if now < earliest_at:
      raise HTTPException(status_code=409, detail=f"예약 시작 {settings.consulting_call_join_early_minutes}분 전부터 입장할 수 있습니다.")
  if now > latest_at:
    raise HTTPException(status_code=409, detail="화상상담 입장 가능 시간이 지났습니다.")


def _session_payload(row: dict[str, Any] | None, settings: Settings, booking_id: str) -> dict[str, Any]:
  return {
    "call_session_id": str(row["id"]) if row else None,
    "booking_id": booking_id,
    "provider": row.get("provider") if row else "chime",
    "provider_meeting_id": row.get("provider_meeting_id") if row else None,
    "media_region": row.get("media_region") if row else settings.effective_chime_media_region,
    "status": row.get("status") if row else "not_started",
    "started_at": _iso(row.get("started_at")) if row else None,
    "ended_at": _iso(row.get("ended_at")) if row else None,
    "chime_enabled": settings.chime_enabled,
    "transcription": _transcription_payload(row, settings),
  }


def _transcription_status(settings: Settings, status: str | None = None) -> str:
  if not settings.effective_consulting_call_transcription_enabled:
    return "disabled"
  return status if status in {"stopped", "starting", "active", "stopping", "failed"} else "stopped"


def _transcription_mode(row: dict[str, Any] | None) -> str:
  mode = row.get("transcription_mode") if row else None
  return mode if mode in {"fixed", "identify"} else "fixed"


def _transcription_payload(row: dict[str, Any] | None, settings: Settings) -> dict[str, Any]:
  status = row.get("transcription_status") if row else None
  return {
    "enabled": settings.effective_consulting_call_transcription_enabled,
    "translation_enabled": settings.effective_consulting_call_translation_enabled,
    "status": _transcription_status(settings, status),
    "mode": _transcription_mode(row),
    "language_code": row.get("transcription_language_code") if row else None,
    "customer_language_code": row.get("customer_language_code") if row else "ko-KR",
    "expert_language_code": row.get("expert_language_code") if row else "ko-KR",
  }


def _normalize_language_code(value: str | None) -> str:
  language_code = (value or "ko-KR").strip()
  if language_code not in SUPPORTED_LANGUAGE_CODES:
    raise HTTPException(status_code=400, detail="화상상담 언어는 ko-KR 또는 en-US만 지원합니다.")
  return language_code


def _parse_datetime(value: Any) -> datetime:
  if isinstance(value, datetime):
    result = value
  else:
    try:
      result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as error:
      raise HTTPException(status_code=409, detail="예약 시간이 올바르지 않아 화상상담을 열 수 없습니다.") from error
  if result.tzinfo is None:
    result = result.replace(tzinfo=timezone.utc)
  return result.astimezone(timezone.utc)


def _iso(value: Any) -> str | None:
  if value is None:
    return None
  if isinstance(value, datetime):
    if value.tzinfo is None:
      value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
  return str(value)
