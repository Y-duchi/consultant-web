from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

from app.services.chime_meetings import ChimeMeetingsService
from app.services import partner_call, real_workspace
from app.services.auth import PartnerPrincipal
from app.settings import Settings


class FakeChimeMeetingsService:
  def __init__(self, settings: Settings) -> None:
    self.settings = settings

  async def create_meeting(self, *, external_meeting_id: str) -> dict[str, str]:
    return {
      "MeetingId": "meeting-1",
      "ExternalMeetingId": external_meeting_id,
      "MediaRegion": self.settings.effective_chime_media_region,
    }

  async def get_meeting(self, *, meeting_id: str) -> dict[str, str]:
    return {
      "MeetingId": meeting_id,
      "ExternalMeetingId": "consulting-booking-1",
      "MediaRegion": self.settings.effective_chime_media_region,
    }

  async def create_attendee(self, *, meeting_id: str, external_user_id: str) -> dict[str, str]:
    return {
      "AttendeeId": f"attendee-{external_user_id}",
      "ExternalUserId": external_user_id,
      "JoinToken": f"token-{meeting_id}",
    }

  async def delete_meeting(self, *, meeting_id: str) -> None:
    return None

  async def start_transcription(self, *, meeting_id: str, participant_languages: dict[str, str]) -> tuple[str, str | None]:
    if participant_languages.get("customer") == participant_languages.get("partner"):
      return "fixed", participant_languages.get("customer")
    return "identify", None

  async def stop_transcription(self, *, meeting_id: str) -> None:
    return None

  async def translate_final_caption(self, *, source_language_code: str, content: str) -> dict[str, str]:
    return {
      "source_language_code": source_language_code,
      "target_language_code": "en" if source_language_code == "ko-KR" else "ko",
      "translated_content": f"translated:{content}",
    }


class FakeConnection:
  def __init__(self, state: dict[str, Any]) -> None:
    self.state = state
    self.insert_transcript_query = ""

  async def execute(self, query: str, *args: Any) -> None:
    return None

  async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
    normalized = " ".join(query.lower().split())
    if "from consulting_call_sessions" in normalized and normalized.startswith("select"):
      return self.state.get("session")

    if normalized.startswith("insert into consulting_call_sessions"):
      self.state["session"] = {
        "id": "call-1",
        "booking_id": args[0],
        "user_id": args[1],
        "expert_id": args[2],
        "provider": "chime",
        "provider_meeting_id": args[3],
        "provider_external_meeting_id": args[4],
        "media_region": args[5],
        "status": "active",
        "transcription_status": args[6],
        "transcription_language_code": None,
        "customer_language_code": "ko-KR",
        "expert_language_code": "ko-KR",
        "transcription_mode": "fixed",
        "started_at": datetime.now(timezone.utc),
        "ended_at": None,
        "expires_at": args[7],
      }
      return self.state["session"]

    if normalized.startswith("update consulting_call_sessions"):
      session = self.state.get("session")
      if session is None:
        return None
      if "set expert_language_code = $2" in normalized:
        session["expert_language_code"] = args[1]
      if "set status = 'ended'" in normalized:
        session["status"] = "ended"
        session["ended_at"] = datetime.now(timezone.utc)
      return session

    if "from consulting_transcript_segments" in normalized:
      return self.state.get("translated_caption")

    if normalized.startswith("insert into consulting_transcript_segments"):
      self.insert_transcript_query = normalized
      self.state["insert_transcript_query"] = normalized
      self.state["translated_caption"] = {
        "result_id": args[6],
        "source_language_code": args[3],
        "target_language_code": args[7],
        "translated_content": args[5],
      }
      return self.state["translated_caption"]

    raise AssertionError(f"unexpected query: {query}")

  async def close(self) -> None:
    return None


def make_booking(**overrides: Any) -> dict[str, Any]:
  booking = {
    "id": "00000000-0000-0000-0000-000000000001",
    "customer_id": "00000000-0000-0000-0000-000000000002",
    "expert_id": "exp_sea",
    "status": "scheduled",
    "channel": "video",
    "starts_at": datetime.now(timezone.utc) + timedelta(minutes=5),
    "duration_minutes": 30,
  }
  booking.update(overrides)
  return booking


class PartnerCallTests(unittest.IsolatedAsyncioTestCase):
  def setUp(self) -> None:
    self.original_chime = partner_call.ChimeMeetingsService
    self.original_get_partner_booking = real_workspace.get_partner_booking
    self.original_connect = real_workspace._connect
    self.original_generate_summary = real_workspace.generate_summary
    self.original_get_summary_for_booking = real_workspace.get_summary_for_booking
    self.state: dict[str, Any] = {}
    self.summary_payloads: list[dict[str, Any]] = []
    self.booking = make_booking()
    self.principal = PartnerPrincipal(
      account_id="partner-1",
      role="expert",
      business_id="exp_sea",
      expert_id="exp_sea",
      workspace_scope="expert_personal",
    )

    async def fake_get_partner_booking(booking_id: str, principal: PartnerPrincipal) -> dict[str, Any]:
      self.assertEqual(booking_id, self.booking["id"])
      return self.booking

    async def fake_connect() -> FakeConnection:
      return FakeConnection(self.state)

    async def fake_generate_summary(
      booking_id: str,
      payload: dict[str, Any],
      principal: PartnerPrincipal,
    ) -> dict[str, Any]:
      self.assertEqual(booking_id, self.booking["id"])
      self.assertEqual(principal, self.principal)
      self.summary_payloads.append(payload)
      return {"job": {"status": "succeeded"}, "summary": {"booking_id": booking_id}}

    async def fake_get_summary_for_booking(booking_id: str, principal: PartnerPrincipal) -> None:
      return None

    partner_call.ChimeMeetingsService = FakeChimeMeetingsService
    real_workspace.get_partner_booking = fake_get_partner_booking
    real_workspace._connect = fake_connect
    real_workspace.generate_summary = fake_generate_summary
    real_workspace.get_summary_for_booking = fake_get_summary_for_booking

  def tearDown(self) -> None:
    partner_call.ChimeMeetingsService = self.original_chime
    real_workspace.get_partner_booking = self.original_get_partner_booking
    real_workspace._connect = self.original_connect
    real_workspace.generate_summary = self.original_generate_summary
    real_workspace.get_summary_for_booking = self.original_get_summary_for_booking

  async def test_scheduled_booking_can_join_chime_call(self) -> None:
    result = await partner_call.join_call(
      self.booking["id"],
      self.principal,
      "en-US",
      Settings(chime_enabled=True, consulting_call_transcription_enabled=True),
    )

    self.assertEqual(result["call_session_id"], "call-1")
    self.assertEqual(result["meeting"]["MeetingId"], "meeting-1")
    self.assertEqual(result["attendee"]["JoinToken"], "token-meeting-1")
    self.assertEqual(result["participant_language_code"], "en-US")
    self.assertEqual(self.state["session"]["expert_language_code"], "en-US")

  async def test_early_join_window_can_be_disabled(self) -> None:
    self.booking = make_booking(
      starts_at=datetime.now(timezone.utc) + timedelta(days=7),
    )

    result = await partner_call.join_call(
      self.booking["id"],
      self.principal,
      "ko-KR",
      Settings(
        chime_enabled=True,
        consulting_call_enforce_early_window=False,
      ),
    )

    self.assertEqual(result["meeting"]["MeetingId"], "meeting-1")

  async def test_in_progress_booking_can_rejoin_chime_call(self) -> None:
    self.booking = make_booking(status="in_progress")

    result = await partner_call.join_call(
      self.booking["id"],
      self.principal,
      "ko-KR",
      Settings(chime_enabled=True),
    )

    self.assertEqual(result["status"] if "status" in result else self.state["session"]["status"], "active")

  async def test_end_call_does_not_require_caption_payload(self) -> None:
    self.state["session"] = {
      "id": "call-1",
      "provider": "chime",
      "provider_meeting_id": "meeting-1",
      "media_region": "ap-northeast-2",
      "status": "active",
      "started_at": datetime.now(timezone.utc),
      "ended_at": None,
      "transcription_status": "stopped",
      "transcription_language_code": None,
      "transcription_mode": "fixed",
      "customer_language_code": "ko-KR",
      "expert_language_code": "ko-KR",
    }

    result = await partner_call.end_call(
      self.booking["id"],
      self.principal,
      Settings(chime_enabled=True),
      transcript="고객에게 로즈 톤을 추천했습니다.",
    )

    self.assertEqual(result["status"], "ended")
    self.assertEqual(result["summary_status"], "succeeded")
    self.assertEqual(self.summary_payloads[0]["transcript"], "고객에게 로즈 톤을 추천했습니다.")

  async def test_start_transcription_requires_explicit_consent(self) -> None:
    with self.assertRaises(ValueError) as context:
      await partner_call.start_transcription(
        self.booking["id"],
        self.principal,
        "ko-KR",
        settings=Settings(chime_enabled=True, consulting_call_transcription_enabled=True),
      )

    self.assertEqual(str(context.exception), "TRANSCRIPTION_CONSENT_REQUIRED")

  async def test_translate_caption_uses_partial_index_conflict_clause(self) -> None:
    self.state["session"] = {
      "id": "call-1",
      "provider": "chime",
      "provider_meeting_id": "meeting-1",
      "media_region": "ap-northeast-2",
      "status": "active",
      "started_at": datetime.now(timezone.utc),
      "ended_at": None,
      "transcription_status": "active",
      "transcription_language_code": "ko-KR",
      "transcription_mode": "fixed",
      "customer_language_code": "ko-KR",
      "expert_language_code": "ko-KR",
    }

    result = await partner_call.translate_caption(
      self.booking["id"],
      self.principal,
      result_id="caption-1",
      source_language_code="ko-KR",
      content="좋은 색상이에요.",
      settings=Settings(consulting_call_translation_enabled=True),
    )

    self.assertEqual(result["translated_content"], "translated:좋은 색상이에요.")
    self.assertIn(
      "on conflict (call_session_id, result_id) where result_id is not null",
      self.state["insert_transcript_query"],
    )


class ChimeMeetingsServiceTests(unittest.TestCase):
  def test_translate_client_uses_settings_credentials(self) -> None:
    calls: dict[str, object] = {}

    def fake_client(service_name: str, **kwargs: object) -> object:
      calls["service_name"] = service_name
      calls["kwargs"] = kwargs
      return object()

    with patch("app.services.chime_meetings.boto3.client", fake_client):
      service = ChimeMeetingsService(
        Settings(
          aws_access_key_id="test-access-key",
          aws_secret_access_key="test-secret-key",
          aws_session_token="test-session-token",
          aws_use_iam_role=False,
          chime_region="ap-northeast-2",
        ),
      )
      service._translate_client()

    self.assertEqual(calls["service_name"], "translate")
    self.assertEqual(
      calls["kwargs"],
      {
        "region_name": "ap-northeast-2",
        "aws_access_key_id": "test-access-key",
        "aws_secret_access_key": "test-secret-key",
        "aws_session_token": "test-session-token",
      },
    )


if __name__ == "__main__":
  unittest.main()
