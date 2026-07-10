from __future__ import annotations

import unittest

from app.routers import consulting


class ConsultingRealtimePayloadTests(unittest.TestCase):
  def test_caption_translation_payload_becomes_realtime_event(self) -> None:
    event = consulting._event_from_payload(
      "booking-1",
      {
        "type": "caption.translation",
        "resultId": "caption-1",
        "sourceLanguageCode": "ko-KR",
        "targetLanguageCode": "en",
        "translatedContent": "This color suits you.",
      },
      "expert",
    )

    self.assertEqual(
      event,
      {
        "type": "caption.translation",
        "bookingId": "booking-1",
        "resultId": "caption-1",
        "sourceLanguageCode": "ko-KR",
        "targetLanguageCode": "en",
        "translatedContent": "This color suits you.",
      },
    )

  def test_caption_translation_rejects_invalid_language(self) -> None:
    event = consulting._event_from_payload(
      "booking-1",
      {
        "type": "caption.translation",
        "resultId": "caption-1",
        "sourceLanguageCode": "ja-JP",
        "targetLanguageCode": "en",
        "translatedContent": "This color suits you.",
      },
      "expert",
    )

    self.assertIsNone(event)

  def test_message_payload_still_becomes_chat_message(self) -> None:
    event = consulting._event_from_payload(
      "booking-1",
      {
        "type": "message.send",
        "body": "상담 시작하겠습니다.",
        "clientMessageId": "client-1",
      },
      "expert",
    )

    self.assertIsNotNone(event)
    assert event is not None
    self.assertEqual(event["type"], "message.new")
    self.assertEqual(event["bookingId"], "booking-1")
    self.assertEqual(event["clientMessageId"], "client-1")


if __name__ == "__main__":
  unittest.main()
