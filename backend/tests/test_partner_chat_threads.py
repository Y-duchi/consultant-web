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

  async def test_thread_list_groups_rebookings_by_conversation_and_hides_left_room(self) -> None:
    bookings = [
      {
        "id": "booking-new",
        "conversation_id": "conversation-open",
        "customer_id": "customer-1",
        "expert_id": "expert-1",
        "status": "requested",
        "requested_at": "2026-07-13T09:00:00+00:00",
        "expert_read_at": None,
      },
      {
        "id": "booking-old",
        "conversation_id": "conversation-open",
        "customer_id": "customer-1",
        "expert_id": "expert-1",
        "status": "completed",
        "requested_at": "2026-07-01T09:00:00+00:00",
        "expert_read_at": None,
      },
      {
        "id": "booking-left",
        "conversation_id": "conversation-left",
        "customer_id": "customer-1",
        "expert_id": "expert-1",
        "status": "completed",
        "requested_at": "2026-06-01T09:00:00+00:00",
        "expert_read_at": None,
        "expert_left_at": "2026-06-02T09:00:00+00:00",
      },
    ]

    with (
      patch.object(partner_compat.real_workspace, "list_partner_bookings", AsyncMock(return_value=bookings)),
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
        AsyncMock(return_value={booking["id"]: [] for booking in bookings}),
      ),
    ):
      response = await partner_compat.chat_threads(principal=None)  # type: ignore[arg-type]

    self.assertEqual(len(response["data"]["threads"]), 1)
    self.assertEqual(response["data"]["threads"][0]["thread"]["id"], "thread-booking-new")

  async def test_confirm_booking_marks_payment_and_status_in_one_operation(self) -> None:
    booking = {
      "id": "booking-1",
      "status": "confirmed",
      "customer_notice": "예약이 확정되었습니다.",
    }
    principal = object()

    with (
      patch.object(
        partner_compat.real_workspace,
        "save_partner_booking_changes",
        AsyncMock(return_value=booking),
      ) as save_changes,
      patch(
        "app.routers.consulting.broadcast_booking_status",
        AsyncMock(),
      ) as broadcast,
    ):
      response = await partner_compat.confirm_booking_after_payment(
        "booking-1",
        {"internal_memo": "입금 확인"},
        principal,  # type: ignore[arg-type]
      )

    save_changes.assert_awaited_once_with(
      "booking-1",
      {"internal_memo": "입금 확인", "mark_payment_paid": True, "status": "confirmed"},
      principal,
    )
    broadcast.assert_awaited_once_with("booking-1", "confirmed", "예약이 확정되었습니다.")
    self.assertEqual(response["data"]["booking"]["status"], "confirmed")


if __name__ == "__main__":
  unittest.main()
