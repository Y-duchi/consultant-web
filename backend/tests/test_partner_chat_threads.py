from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app.routers import partner_compat
from app.services import real_workspace


class PartnerChatThreadTests(unittest.IsolatedAsyncioTestCase):
  def test_legacy_list_summary_notes_are_normalized(self) -> None:
    summary = real_workspace._summary_from_row({
      "id": "summary-1",
      "booking_id": "booking-1",
      "expert_id": "expert-1",
      "customer_id": "customer-1",
      "created_at": datetime(2026, 7, 13, tzinfo=timezone.utc),
      "notes": ["첫 번째 상담 메모", "두 번째 상담 메모"],
    })

    self.assertEqual(summary["source"], "manual")
    self.assertEqual(summary["customer_summary"], "첫 번째 상담 메모\n두 번째 상담 메모")

  async def test_thread_list_returns_only_latest_message_without_reports(self) -> None:
    booking = {
      "id": "booking-1",
      "customer_id": "customer-1",
      "expert_id": "expert-1",
      "status": "confirmed",
      "requested_at": "2026-07-13T08:00:00+00:00",
      "expert_read_at": None,
    }
    messages = [
      {
        "id": "message-1",
        "thread_id": "thread-booking-1",
        "sender_type": "customer",
        "sent_at": "2026-07-13T08:01:00+00:00",
      },
      {
        "id": "message-2",
        "thread_id": "thread-booking-1",
        "sender_type": "customer",
        "sent_at": "2026-07-13T08:02:00+00:00",
      },
    ]

    with (
      patch.object(partner_compat.real_workspace, "list_partner_bookings", AsyncMock(return_value=[booking])),
      patch.object(
        partner_compat.real_workspace,
        "list_partner_customers",
        AsyncMock(return_value=[{"id": "customer-1", "name": "고객"}]),
      ),
      patch.object(
        partner_compat.real_workspace,
        "list_experts",
        AsyncMock(return_value=[{"id": "expert-1", "name": "상담사"}]),
      ),
      patch.object(
        partner_compat.real_workspace,
        "list_chat_messages_for_bookings",
        AsyncMock(return_value={"booking-1": messages}),
      ),
    ):
      response = await partner_compat.chat_threads(principal=None)  # type: ignore[arg-type]

    thread = response["data"]["threads"][0]
    self.assertEqual(len(thread["messages"]), 1)
    self.assertEqual(thread["messages"][0]["id"], "message-2")
    self.assertEqual(thread["sharedReports"], [])
    self.assertEqual(thread["thread"]["unreadCount"], 2)


if __name__ == "__main__":
  unittest.main()
