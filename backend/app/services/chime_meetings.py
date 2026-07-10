from __future__ import annotations

import asyncio
import hashlib
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException

from app.settings import Settings


class ChimeMeetingsService:
  def __init__(self, settings: Settings) -> None:
    self.settings = settings

  def _client(self):
    region = self.settings.effective_chime_region
    client_kwargs = {
      "config": Config(retries={"max_attempts": 3, "mode": "standard"}),
      "endpoint_url": f"https://meetings-chime.{region}.amazonaws.com",
      "region_name": region,
    }

    if self.settings.aws_profile_name and not self.settings.aws_use_iam_role:
      return boto3.Session(profile_name=self.settings.aws_profile_name).client("chime-sdk-meetings", **client_kwargs)

    if self.settings.aws_access_key_id and self.settings.aws_secret_access_key and not self.settings.aws_use_iam_role:
      client_kwargs.update(
        {
          "aws_access_key_id": self.settings.aws_access_key_id,
          "aws_secret_access_key": self.settings.aws_secret_access_key,
          "aws_session_token": self.settings.aws_session_token,
        },
      )

    return boto3.client("chime-sdk-meetings", **client_kwargs)

  def _translate_client(self):
    client_kwargs = {"region_name": self.settings.effective_chime_region}

    if self.settings.aws_profile_name and not self.settings.aws_use_iam_role:
      return boto3.Session(profile_name=self.settings.aws_profile_name).client("translate", **client_kwargs)

    if self.settings.aws_access_key_id and self.settings.aws_secret_access_key and not self.settings.aws_use_iam_role:
      client_kwargs.update(
        {
          "aws_access_key_id": self.settings.aws_access_key_id,
          "aws_secret_access_key": self.settings.aws_secret_access_key,
          "aws_session_token": self.settings.aws_session_token,
        },
      )

    return boto3.client("translate", **client_kwargs)

  async def _call_aws(self, operation, *args, error_message: str, **kwargs):
    try:
      return await asyncio.to_thread(operation, *args, **kwargs)
    except (BotoCoreError, ClientError) as error:
      raise HTTPException(status_code=502, detail=error_message) from error

  @staticmethod
  def _client_request_token(external_meeting_id: str) -> str:
    digest = hashlib.sha256(external_meeting_id.encode("utf-8")).hexdigest()
    return f"consulting-{digest}"[:64]

  async def create_meeting(self, *, external_meeting_id: str) -> dict:
    if not self.settings.chime_enabled:
      raise HTTPException(status_code=503, detail="Chime 화상상담 서버 설정이 아직 켜져 있지 않습니다.")

    response = await self._call_aws(
      self._client().create_meeting,
      ClientRequestToken=self._client_request_token(external_meeting_id),
      ExternalMeetingId=external_meeting_id[:64],
      MediaRegion=self.settings.effective_chime_media_region,
      error_message="Chime 미팅 생성에 실패했습니다.",
    )
    return response["Meeting"]

  async def get_meeting(self, *, meeting_id: str) -> dict:
    response = await self._call_aws(
      self._client().get_meeting,
      MeetingId=meeting_id,
      error_message="Chime 미팅 정보를 가져오지 못했습니다.",
    )
    return response["Meeting"]

  async def create_attendee(self, *, meeting_id: str, external_user_id: str) -> dict:
    response = await self._call_aws(
      self._client().create_attendee,
      MeetingId=meeting_id,
      ExternalUserId=external_user_id[:64],
      error_message="Chime 참가자 생성에 실패했습니다.",
    )
    return response["Attendee"]

  async def delete_meeting(self, *, meeting_id: str) -> None:
    await self._call_aws(
      self._client().delete_meeting,
      MeetingId=meeting_id,
      error_message="Chime 미팅 종료에 실패했습니다.",
    )

  def _transcription_configuration(self, participant_languages: dict[str, str]) -> tuple[dict[str, Any], str, str | None]:
    customer_language = participant_languages.get("customer") or self.settings.effective_chime_transcribe_default_language
    expert_language = participant_languages.get("partner") or self.settings.effective_chime_transcribe_default_language
    supported_languages = self.settings.effective_chime_transcribe_languages

    if customer_language not in supported_languages:
      customer_language = self.settings.effective_chime_transcribe_default_language
    if expert_language not in supported_languages:
      expert_language = self.settings.effective_chime_transcribe_default_language

    base_settings: dict[str, Any] = {
      "EnablePartialResultsStabilization": True,
      "PartialResultsStability": "medium",
      "Region": self.settings.effective_chime_region,
    }

    if customer_language == expert_language:
      return (
        {"EngineTranscribeSettings": {**base_settings, "LanguageCode": customer_language}},
        "fixed",
        customer_language,
      )

    return (
      {
        "EngineTranscribeSettings": {
          **base_settings,
          "IdentifyLanguage": True,
          "LanguageOptions": ",".join(supported_languages),
          "PreferredLanguage": self.settings.effective_chime_transcribe_preferred_language,
        },
      },
      "identify",
      None,
    )

  async def start_transcription(self, *, meeting_id: str, participant_languages: dict[str, str]) -> tuple[str, str | None]:
    if not self.settings.effective_consulting_call_transcription_enabled:
      raise HTTPException(status_code=503, detail="실시간 자막 설정이 아직 켜져 있지 않습니다.")

    transcription_configuration, mode, language_code = self._transcription_configuration(participant_languages)
    await self._call_aws(
      self._client().start_meeting_transcription,
      MeetingId=meeting_id,
      TranscriptionConfiguration=transcription_configuration,
      error_message="실시간 자막 시작에 실패했습니다.",
    )
    return mode, language_code

  async def stop_transcription(self, *, meeting_id: str) -> None:
    await self._call_aws(
      self._client().stop_meeting_transcription,
      MeetingId=meeting_id,
      error_message="실시간 자막 중지에 실패했습니다.",
    )

  async def translate_final_caption(self, *, source_language_code: str, content: str) -> dict[str, str]:
    if not self.settings.effective_consulting_call_translation_enabled:
      raise HTTPException(status_code=503, detail="실시간 번역 설정이 아직 켜져 있지 않습니다.")

    if source_language_code == "ko-KR":
      source_code, target_code = "ko", "en"
    elif source_language_code == "en-US":
      source_code, target_code = "en", "ko"
    else:
      raise HTTPException(status_code=400, detail="번역은 ko-KR 또는 en-US 자막만 지원합니다.")

    response = await self._call_aws(
      self._translate_client().translate_text,
      Text=content,
      SourceLanguageCode=source_code,
      TargetLanguageCode=target_code,
      error_message="실시간 자막 번역에 실패했습니다.",
    )
    return {
      "source_language_code": source_language_code,
      "target_language_code": target_code,
      "translated_content": str(response.get("TranslatedText") or ""),
    }
