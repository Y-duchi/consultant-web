from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from html import escape
import json
import logging
from typing import Any

from fastapi import HTTPException

from app.schemas.profile_changes import ProfileChangeDecision
from app.services import real_workspace
from app.services.auth import PartnerPrincipal, validate_partner_principal
from app.services.email import send_email
from app.services.s3 import create_presigned_upload, create_presigned_view, inspect_uploaded_object
from app.settings import get_settings


logger = logging.getLogger(__name__)
_schema_ready = False

_ALLOWED_FIELDS = {
  "business": {
    "name",
    "partnerType",
    "ownerName",
    "businessRegistrationNumber",
    "phone",
    "address",
    "description",
    "exposureStatus",
  },
  "expert": {
    "name",
    "roleLabel",
    "tagline",
    "price30Min",
    "price60Min",
    "yearsOfExperience",
    "exposureStatus",
    "specialties",
    "categories",
    "introduction",
  },
}

_FIELD_ALIASES = {
  "partner_type": "partnerType",
  "owner_name": "ownerName",
  "business_registration_number": "businessRegistrationNumber",
  "exposure_status": "exposureStatus",
  "role_label": "roleLabel",
  "price_30_min": "price30Min",
  "price_60_min": "price60Min",
  "years_of_experience": "yearsOfExperience",
}

_FIELD_LABELS = {
  "name": "이름",
  "partnerType": "운영 형태",
  "ownerName": "대표자",
  "businessRegistrationNumber": "사업자등록번호",
  "phone": "전화번호",
  "address": "주소",
  "description": "업체 소개",
  "exposureStatus": "노출 상태",
  "roleLabel": "직함",
  "tagline": "한 줄 소개",
  "price30Min": "30분 가격",
  "price60Min": "60분 가격",
  "yearsOfExperience": "경력",
  "specialties": "전문 분야",
  "categories": "상담 카테고리",
  "introduction": "전문가 소개",
}


async def ensure_schema(conn) -> None:
  global _schema_ready
  if _schema_ready:
    return
  await real_workspace._ensure_partner_profile_columns(conn)

  await conn.execute(
    """
    create table if not exists consulting_partner_profile_change_requests (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null references consulting_partner_accounts(id) on delete cascade,
      expert_id text not null references consulting_experts(id) on delete cascade,
      requester_email text not null,
      target_type text not null check (target_type in ('business', 'expert')),
      current_snapshot jsonb not null,
      proposed_changes jsonb not null,
      avatar_bucket text,
      avatar_object_key text,
      avatar_file_name text,
      avatar_content_type text,
      status text not null default 'submitted'
        check (status in ('submitted', 'needs_update', 'approved', 'rejected')),
      review_memo text,
      reviewer_name text,
      reviewed_at timestamptz,
      last_email_notification_type text,
      last_email_notification_status text,
      last_email_notification_error text,
      last_email_notification_sent_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
    """
  )
  await conn.execute(
    """
    create unique index if not exists uq_partner_profile_change_active_target
    on consulting_partner_profile_change_requests (account_id, expert_id, target_type)
    where status in ('submitted', 'needs_update')
    """
  )
  await conn.execute(
    """
    create index if not exists ix_partner_profile_change_status_updated
    on consulting_partner_profile_change_requests (status, updated_at desc)
    """
  )
  _schema_ready = True


def create_avatar_upload(file_name: str, content_type: str) -> dict[str, Any]:
  settings = get_settings()
  if not settings.s3_configured:
    raise HTTPException(status_code=503, detail="프로필 사진 저장소가 설정되지 않았습니다.")
  return create_presigned_upload(settings, "expert-profiles", file_name, content_type)


async def submit_profile_change(payload: dict[str, Any], principal: PartnerPrincipal) -> dict[str, Any]:
  principal = validate_partner_principal(principal)
  target_type = str(payload.get("targetType") or payload.get("target_type") or "").strip()
  expert_id = str(payload.get("expertId") or payload.get("expert_id") or principal.expert_id or "").strip()
  if target_type not in _ALLOWED_FIELDS:
    raise HTTPException(status_code=422, detail="변경 요청 대상을 확인해 주세요.")
  if not expert_id:
    raise HTTPException(status_code=422, detail="변경할 전문가를 선택해 주세요.")

  raw_changes = payload.get("proposedChanges") or payload.get("proposed_changes") or {}
  proposed_changes = _sanitize_changes(target_type, raw_changes)
  avatar_upload = payload.get("avatarUpload") or payload.get("avatar_upload")
  if avatar_upload and target_type != "expert":
    raise HTTPException(status_code=422, detail="프로필 사진은 전문가 변경 요청에만 포함할 수 있습니다.")

  conn = await real_workspace._connect()
  try:
    await real_workspace._ensure_partner_onboarding_schema(conn)
    await ensure_schema(conn)
    context = await _profile_context(conn, principal.account_id, expert_id)
    current_snapshot = _snapshot(context, target_type)
    changed_values = {
      key: value
      for key, value in proposed_changes.items()
      if current_snapshot.get(key) != value
    }

    avatar = None
    if avatar_upload:
      avatar = _validate_avatar_upload(avatar_upload)
      settings = get_settings()
      try:
        metadata = await asyncio.to_thread(
          inspect_uploaded_object,
          settings,
          avatar["bucket"],
          avatar["object_key"],
        )
      except Exception as exc:
        logger.warning("Unable to verify profile avatar upload %s: %s", avatar["object_key"], exc)
        raise HTTPException(status_code=422, detail="업로드된 프로필 사진을 확인하지 못했습니다. 다시 선택해 주세요.") from exc
      content_length = int(metadata.get("ContentLength") or 0)
      if content_length <= 0 or content_length > 10 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="10MB 이하의 프로필 사진을 선택해 주세요.")
      if str(metadata.get("ContentType") or "") != avatar["content_type"]:
        raise HTTPException(status_code=422, detail="프로필 사진 형식이 업로드 정보와 일치하지 않습니다.")

    if not changed_values and not avatar:
      raise HTTPException(status_code=422, detail="현재 프로필과 다른 변경 내용을 입력해 주세요.")

    row = await conn.fetchrow(
      """
      insert into consulting_partner_profile_change_requests (
        account_id, expert_id, requester_email, target_type,
        current_snapshot, proposed_changes,
        avatar_bucket, avatar_object_key, avatar_file_name, avatar_content_type
      ) values (
        $1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb,
        $7, $8, $9, $10
      )
      on conflict (account_id, expert_id, target_type)
        where status in ('submitted', 'needs_update')
      do update set
        current_snapshot = excluded.current_snapshot,
        proposed_changes = excluded.proposed_changes,
        avatar_bucket = excluded.avatar_bucket,
        avatar_object_key = excluded.avatar_object_key,
        avatar_file_name = excluded.avatar_file_name,
        avatar_content_type = excluded.avatar_content_type,
        status = 'submitted',
        review_memo = null,
        reviewer_name = null,
        reviewed_at = null,
        updated_at = now()
      returning *
      """,
      principal.account_id,
      expert_id,
      str(context["requester_email"]),
      target_type,
      json.dumps(current_snapshot, ensure_ascii=False),
      json.dumps(changed_values, ensure_ascii=False),
      avatar["bucket"] if avatar else None,
      avatar["object_key"] if avatar else None,
      avatar["file_name"] if avatar else None,
      avatar["content_type"] if avatar else None,
    )
    recipient = get_settings().effective_profile_change_admin_email
    change_summary = _change_summary_lines(changed_values, include_previous=False)
    if avatar:
      change_summary.append("프로필 사진: 새 사진 첨부")
    row = await _deliver_email(
      conn,
      row,
      notification_type="submitted",
      recipient=recipient,
      subject=f"[AURA] {context['name']} 프로필 변경 심사 요청",
      paragraphs=[
        f"{context['name']} 파트너가 {'업체 정보' if target_type == 'business' else '전문가 프로필'} 변경 심사를 요청했습니다.",
        *change_summary,
        f"관리자 화면: {get_settings().frontend_origin.rstrip('/')}/admin/profile-changes",
      ],
    )
    return _request_from_row(row)
  finally:
    await conn.close()


async def list_partner_profile_changes(principal: PartnerPrincipal) -> list[dict[str, Any]]:
  principal = validate_partner_principal(principal)
  conn = await real_workspace._connect()
  try:
    await real_workspace._ensure_partner_onboarding_schema(conn)
    await ensure_schema(conn)
    rows = await conn.fetch(
      """
      select * from consulting_partner_profile_change_requests
      where account_id::text = $1
      order by updated_at desc
      """,
      principal.account_id,
    )
    return [_request_from_row(row) for row in rows]
  finally:
    await conn.close()


async def list_admin_profile_changes(*, status: str = "all", query: str | None = None) -> list[dict[str, Any]]:
  conn = await real_workspace._connect()
  try:
    await real_workspace._ensure_partner_onboarding_schema(conn)
    await ensure_schema(conn)
    args: list[Any] = []
    where = ["true"]
    if status and status != "all":
      args.append(status)
      where.append(f"r.status = ${len(args)}")
    if query:
      args.append(f"%{query.strip().lower()}%")
      where.append(
        f"(lower(r.requester_email) like ${len(args)} or lower(e.name) like ${len(args)} or lower(coalesce(e.studio_name, '')) like ${len(args)})"
      )
    rows = await conn.fetch(
      f"""
      select r.*
      from consulting_partner_profile_change_requests r
      join consulting_experts e on e.id = r.expert_id
      where {' and '.join(where)}
      order by r.updated_at desc
      """,
      *args,
    )
    return [_request_from_row(row) for row in rows]
  finally:
    await conn.close()


async def get_admin_profile_change(request_id: str) -> dict[str, Any]:
  conn = await real_workspace._connect()
  try:
    await real_workspace._ensure_partner_onboarding_schema(conn)
    await ensure_schema(conn)
    row = await conn.fetchrow(
      "select * from consulting_partner_profile_change_requests where id::text = $1",
      request_id,
    )
    if row is None:
      raise HTTPException(status_code=404, detail="프로필 변경 요청을 찾을 수 없습니다.")
    return _request_from_row(row)
  finally:
    await conn.close()


async def get_admin_avatar_access(request_id: str) -> dict[str, Any]:
  conn = await real_workspace._connect()
  try:
    await real_workspace._ensure_partner_onboarding_schema(conn)
    await ensure_schema(conn)
    row = await conn.fetchrow(
      """
      select avatar_object_key, avatar_file_name, avatar_content_type
      from consulting_partner_profile_change_requests
      where id::text = $1
      """,
      request_id,
    )
    if row is None or not row.get("avatar_object_key"):
      raise HTTPException(status_code=404, detail="요청에 포함된 프로필 사진이 없습니다.")
    settings = get_settings()
    if not settings.s3_configured:
      raise HTTPException(status_code=503, detail="프로필 사진 저장소가 설정되지 않았습니다.")
    access = create_presigned_view(
      settings,
      str(row["avatar_object_key"]),
      str(row.get("avatar_content_type") or "image/jpeg"),
    )
    return {"file_name": str(row.get("avatar_file_name") or "profile-image"), **access}
  finally:
    await conn.close()


async def decide_profile_change(
  request_id: str,
  action: str,
  decision: ProfileChangeDecision,
) -> dict[str, Any]:
  if action not in {"approved", "needs_update", "rejected"}:
    raise HTTPException(status_code=422, detail="지원하지 않는 심사 처리입니다.")
  conn = await real_workspace._connect()
  try:
    await real_workspace._ensure_partner_onboarding_schema(conn)
    await ensure_schema(conn)
    async with conn.transaction():
      row = await conn.fetchrow(
        """
        select * from consulting_partner_profile_change_requests
        where id::text = $1 and status in ('submitted', 'needs_update')
        for update
        """,
        request_id,
      )
      if row is None:
        raise HTTPException(status_code=409, detail="이미 처리되었거나 검토할 수 없는 요청입니다.")

      if action == "approved":
        context = await _profile_context(conn, str(row["account_id"]), str(row["expert_id"]))
        current_snapshot = _snapshot(context, str(row["target_type"]))
        submitted_snapshot = _json_object(row["current_snapshot"])
        proposed = _json_object(row["proposed_changes"])
        conflicted = [key for key in proposed if current_snapshot.get(key) != submitted_snapshot.get(key)]
        if conflicted:
          raise HTTPException(
            status_code=409,
            detail="요청 이후 공개 프로필이 변경되었습니다. 파트너에게 최신 정보로 다시 제출하도록 요청해 주세요.",
          )
        await _apply_approved_change(conn, row, proposed)

      updated = await conn.fetchrow(
        """
        update consulting_partner_profile_change_requests
        set status = $2, review_memo = $3, reviewer_name = $4,
            reviewed_at = now(), updated_at = now()
        where id::text = $1
        returning *
        """,
        request_id,
        action,
        decision.review_memo.strip(),
        decision.reviewer_name.strip(),
      )

    notification = {
      "approved": ("[AURA] 프로필 변경이 승인되었습니다", "요청한 프로필 정보가 검토 후 공개 프로필에 반영되었습니다."),
      "needs_update": ("[AURA] 프로필 변경 요청 보완 안내", "프로필 변경 요청에 보완이 필요합니다."),
      "rejected": ("[AURA] 프로필 변경 요청 심사 결과", "프로필 변경 요청이 반려되어 기존 공개 정보가 유지됩니다."),
    }[action]
    updated = await _deliver_email(
      conn,
      updated,
      notification_type=action,
      recipient=str(updated["requester_email"]),
      subject=notification[0],
      paragraphs=[notification[1], f"검토 의견: {decision.review_memo.strip()}", "파트너 페이지에서 처리 상태를 확인해 주세요."],
    )
    return _request_from_row(updated)
  finally:
    await conn.close()


async def _profile_context(conn, account_id: str, expert_id: str):
  row = await conn.fetchrow(
    """
    select e.*,
      a.email::text as requester_email,
      coalesce((select min(price) from consulting_expert_durations d where d.expert_id = e.id and d.minutes <= 30), 0)::int as price_30_min,
      coalesce((select min(price) from consulting_expert_durations d where d.expert_id = e.id and d.minutes >= 60), 0)::int as price_60_min,
      coalesce((
        select array_agg(c.title order by c.title)
        from consulting_expert_categories ec
        join consulting_categories c on c.id = ec.category_id
        where ec.expert_id = e.id
      ), '{}'::text[]) as category_labels
    from consulting_partner_accounts a
    join consulting_experts e on e.id = a.expert_id
    where a.id::text = $1 and e.id = $2 and a.status in ('active', 'invited')
    """,
    account_id,
    expert_id,
  )
  if row is None:
    raise HTTPException(status_code=403, detail="이 프로필의 변경을 요청할 권한이 없습니다.")
  return row


def _snapshot(row, target_type: str) -> dict[str, Any]:
  exposure_status = "public" if row.get("is_active") else "private"
  if target_type == "business":
    return {
      "name": row.get("studio_name") or f"{row['name']} 상담실",
      "partnerType": row.get("partner_type") or "freelancer",
      "ownerName": row.get("business_owner_name") or row["name"],
      "businessRegistrationNumber": row.get("business_registration_number") or "",
      "phone": row.get("phone") or "",
      "address": row.get("business_address") or "",
      "description": row.get("business_description") or row.get("intro") or "",
      "exposureStatus": exposure_status,
    }
  return {
    "name": row["name"],
    "roleLabel": row.get("title") or "뷰티 상담 전문가",
    "tagline": row.get("signature_line") or row.get("availability_note") or "",
    "price30Min": int(row.get("price_30_min") or 0),
    "price60Min": int(row.get("price_60_min") or 0),
    "yearsOfExperience": int(row.get("career_years") or 0),
    "exposureStatus": exposure_status,
    "specialties": [str(item) for item in row.get("tags") or []],
    "categories": [str(item) for item in row.get("category_labels") or []],
    "introduction": row.get("intro") or "",
  }


def _sanitize_changes(target_type: str, raw_changes: Any) -> dict[str, Any]:
  if not isinstance(raw_changes, dict):
    raise HTTPException(status_code=422, detail="변경할 프로필 정보를 확인해 주세요.")
  result: dict[str, Any] = {}
  for raw_key, raw_value in raw_changes.items():
    key = _FIELD_ALIASES.get(str(raw_key), str(raw_key))
    if key not in _ALLOWED_FIELDS[target_type]:
      continue
    if key in {"price30Min", "price60Min", "yearsOfExperience"}:
      try:
        value = int(raw_value)
      except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{_FIELD_LABELS[key]} 값을 확인해 주세요.") from exc
      if value < 0 or value > 100_000_000:
        raise HTTPException(status_code=422, detail=f"{_FIELD_LABELS[key]} 값을 확인해 주세요.")
      result[key] = value
      continue
    if key in {"specialties", "categories"}:
      if not isinstance(raw_value, list):
        raise HTTPException(status_code=422, detail=f"{_FIELD_LABELS[key]} 값을 확인해 주세요.")
      result[key] = real_workspace._clean_text_list([str(value)[:80] for value in raw_value])[:20]
      continue
    value = str(raw_value or "").strip()
    if key == "exposureStatus" and value not in {"public", "private"}:
      raise HTTPException(status_code=422, detail="노출 상태를 확인해 주세요.")
    if key == "partnerType" and value not in {"business", "freelancer"}:
      raise HTTPException(status_code=422, detail="운영 형태를 확인해 주세요.")
    if key in {"name", "ownerName"} and not value:
      raise HTTPException(status_code=422, detail=f"{_FIELD_LABELS[key]}은 비워둘 수 없습니다.")
    result[key] = value[:2000] if key in {"description", "introduction"} else value[:255]
  return result


def _validate_avatar_upload(value: Any) -> dict[str, str]:
  if not isinstance(value, dict):
    raise HTTPException(status_code=422, detail="프로필 사진 업로드 정보를 확인해 주세요.")
  settings = get_settings()
  bucket = str(value.get("bucket") or "").strip()
  object_key = str(value.get("objectKey") or value.get("object_key") or "").strip()
  file_name = str(value.get("fileName") or value.get("file_name") or "profile-image").strip()
  content_type = str(value.get("contentType") or value.get("content_type") or "").strip()
  expected_prefix = settings.s3_expert_profiles_prefix.strip("/") + "/"
  if bucket != settings.s3_bucket_name or not object_key.startswith(expected_prefix):
    raise HTTPException(status_code=422, detail="허용되지 않은 프로필 사진 경로입니다.")
  if content_type not in {"image/jpeg", "image/png", "image/webp"}:
    raise HTTPException(status_code=422, detail="JPG, PNG 또는 WebP 사진을 선택해 주세요.")
  return {
    "bucket": bucket,
    "object_key": object_key,
    "file_name": file_name[:255],
    "content_type": content_type,
  }


async def _apply_approved_change(conn, request_row, proposed: dict[str, Any]) -> None:
  expert_id = str(request_row["expert_id"])
  if request_row["target_type"] == "business":
    await conn.execute(
      """
      update consulting_experts set
        studio_name = case when $2::jsonb ? 'name' then $2::jsonb->>'name' else studio_name end,
        partner_type = case when $2::jsonb ? 'partnerType' then $2::jsonb->>'partnerType' else partner_type end,
        business_owner_name = case when $2::jsonb ? 'ownerName' then $2::jsonb->>'ownerName' else business_owner_name end,
        business_registration_number = case when $2::jsonb ? 'businessRegistrationNumber' then nullif($2::jsonb->>'businessRegistrationNumber', '') else business_registration_number end,
        phone = case when $2::jsonb ? 'phone' then $2::jsonb->>'phone' else phone end,
        business_address = case when $2::jsonb ? 'address' then $2::jsonb->>'address' else business_address end,
        business_description = case when $2::jsonb ? 'description' then $2::jsonb->>'description' else business_description end,
        is_active = case when $2::jsonb ? 'exposureStatus' then $2::jsonb->>'exposureStatus' = 'public' else is_active end,
        updated_at = now()
      where id = $1
      """,
      expert_id,
      json.dumps(proposed, ensure_ascii=False),
    )
    return

  image_url = None
  if request_row.get("avatar_object_key"):
    settings = get_settings()
    image_url = f"{settings.cdn_base_url.rstrip('/')}/{str(request_row['avatar_object_key']).lstrip('/')}"
  await conn.execute(
    """
    update consulting_experts set
      name = case when $2::jsonb ? 'name' then $2::jsonb->>'name' else name end,
      title = case when $2::jsonb ? 'roleLabel' then $2::jsonb->>'roleLabel' else title end,
      signature_line = case when $2::jsonb ? 'tagline' then $2::jsonb->>'tagline' else signature_line end,
      career_years = case when $2::jsonb ? 'yearsOfExperience' then ($2::jsonb->>'yearsOfExperience')::int else career_years end,
      intro = case when $2::jsonb ? 'introduction' then $2::jsonb->>'introduction' else intro end,
      tags = case when $2::jsonb ? 'specialties' then array(select jsonb_array_elements_text($2::jsonb->'specialties')) else tags end,
      is_active = case when $2::jsonb ? 'exposureStatus' then $2::jsonb->>'exposureStatus' = 'public' else is_active end,
      image_url = coalesce($3, image_url),
      updated_at = now()
    where id = $1
    """,
    expert_id,
    json.dumps(proposed, ensure_ascii=False),
    image_url,
  )
  for code, label, minutes, key in (("d30", "30분", 30, "price30Min"), ("d60", "60분", 60, "price60Min")):
    if key not in proposed:
      continue
    await conn.execute(
      """
      insert into consulting_expert_durations (expert_id, code, label, minutes, price, description, recommended, sort_order)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (expert_id, code) do update set price = excluded.price
      """,
      expert_id,
      code,
      label,
      minutes,
      proposed[key],
      f"{label} 온라인 상담",
      minutes == 60,
      1 if minutes == 60 else 0,
    )
  if "categories" in proposed:
    await conn.execute("delete from consulting_expert_categories where expert_id = $1", expert_id)
    for category_id in real_workspace._category_ids(proposed["categories"]):
      await conn.execute(
        """
        insert into consulting_expert_categories (expert_id, category_id)
        select $1, $2 where exists (select 1 from consulting_categories where id = $2)
        on conflict (expert_id, category_id) do nothing
        """,
        expert_id,
        category_id,
      )


async def _deliver_email(
  conn,
  row,
  *,
  notification_type: str,
  recipient: str | None,
  subject: str,
  paragraphs: list[str],
):
  settings = get_settings()
  status = "sent"
  error_message = None
  if not settings.email_from_address or not recipient:
    status = "failed"
    error_message = "발신 또는 운영자 수신 이메일이 설정되지 않았습니다."
  else:
    try:
      await asyncio.to_thread(
        send_email,
        settings,
        recipient=recipient,
        subject=subject,
        text_body="\n\n".join(paragraphs),
        html_body=_email_html(subject, paragraphs),
      )
    except Exception:
      status = "failed"
      error_message = "메일 발송에 실패했습니다. SES 권한과 발송 상태를 확인해 주세요."
      logger.exception("Failed to send profile change %s email for %s", notification_type, row["id"])
  updated = await conn.fetchrow(
    """
    update consulting_partner_profile_change_requests
    set last_email_notification_type = $2,
        last_email_notification_status = $3,
        last_email_notification_error = $4,
        last_email_notification_sent_at = case when $3 = 'sent' then now() else null end,
        updated_at = now()
    where id = $1
    returning *
    """,
    row["id"],
    notification_type,
    status,
    error_message,
  )
  return updated or row


def _email_html(title: str, paragraphs: list[str]) -> str:
  content = "".join(
    f'<p style="margin:0 0 12px;line-height:1.7;color:#34403e">{escape(paragraph)}</p>'
    for paragraph in paragraphs
  )
  return (
    '<div style="background:#f3f6f5;padding:32px 16px;font-family:Arial,\'Noto Sans KR\',sans-serif">'
    '<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #dce5e2;border-radius:8px;overflow:hidden">'
    '<div style="padding:22px 28px;background:#176c5f;color:#fff;font-size:20px;font-weight:700">AURA</div>'
    '<div style="padding:32px 28px">'
    f'<h1 style="margin:0 0 20px;font-size:24px;color:#17201f">{escape(title)}</h1>{content}'
    '</div><div style="padding:18px 28px;background:#f7f9f8;color:#71807d;font-size:12px">AURA 파트너팀</div>'
    '</div></div>'
  )


def _change_summary_lines(changes: dict[str, Any], *, include_previous: bool) -> list[str]:
  del include_previous
  lines = []
  for key, value in changes.items():
    display = ", ".join(value) if isinstance(value, list) else str(value)
    lines.append(f"{_FIELD_LABELS.get(key, key)}: {display or '미입력'}")
  return lines


def _request_from_row(row) -> dict[str, Any]:
  return {
    "id": str(row["id"]),
    "account_id": str(row["account_id"]),
    "expert_id": str(row["expert_id"]),
    "requester_email": str(row["requester_email"]),
    "target_type": str(row["target_type"]),
    "status": str(row["status"]),
    "current_snapshot": _json_object(row["current_snapshot"]),
    "proposed_changes": _json_object(row["proposed_changes"]),
    "avatar_file_name": row.get("avatar_file_name"),
    "avatar_content_type": row.get("avatar_content_type"),
    "review_memo": row.get("review_memo"),
    "reviewer_name": row.get("reviewer_name"),
    "submitted_at": _iso(row.get("created_at")),
    "updated_at": _iso(row.get("updated_at")),
    "reviewed_at": _iso(row.get("reviewed_at")) if row.get("reviewed_at") else None,
    "last_email_notification_type": row.get("last_email_notification_type"),
    "last_email_notification_status": row.get("last_email_notification_status"),
    "last_email_notification_error": row.get("last_email_notification_error"),
    "last_email_notification_sent_at": _iso(row.get("last_email_notification_sent_at"))
    if row.get("last_email_notification_sent_at") else None,
  }


def _json_object(value: Any) -> dict[str, Any]:
  if isinstance(value, dict):
    return value
  if isinstance(value, str):
    parsed = json.loads(value)
    return parsed if isinstance(parsed, dict) else {}
  return {}


def _iso(value: Any) -> str:
  if isinstance(value, datetime):
    if value.tzinfo is None:
      value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()
  if value is None:
    return datetime.now(timezone.utc).isoformat()
  return str(value)
