from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import json
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services import partner_workspace


router = APIRouter()

_connections: dict[str, set[WebSocket]] = defaultdict(set)
_messages: dict[str, list[dict[str, object]]] = defaultdict(list)
_caption_source_languages = {"ko-KR", "en-US"}
_caption_target_languages = {"ko", "en"}


def _now_iso() -> str:
  return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _event_from_payload(booking_id: str, payload: object, participant_type: str) -> dict[str, object] | None:
  if isinstance(payload, str):
    body = payload.strip()
    client_message_id = None
    media_ids = []
  elif isinstance(payload, dict):
    event_type = payload.get("type")
    if event_type == "ping":
      return {"type": "pong", "at": _now_iso()}
    if event_type == "caption.translation":
      return _caption_translation_from_payload(booking_id, payload)
    if event_type not in {None, "message.send"}:
      return None

    raw_body = payload.get("body") or payload.get("message") or payload.get("text") or payload.get("content")
    body = str(raw_body or "").strip()
    client_message_id = payload.get("clientMessageId")
    media_ids = payload.get("mediaIds") if isinstance(payload.get("mediaIds"), list) else []
  else:
    return None

  if not body:
    return None

  sender_name = "Customer App" if participant_type == "user" else "AURA Web"
  return {
    "type": "message.new",
    "id": f"local-msg-{uuid4().hex}",
    "bookingId": booking_id,
    "body": body,
    "clientMessageId": client_message_id,
    "mediaIds": media_ids,
    "media": [],
    "senderType": participant_type,
    "senderName": sender_name,
    "sentAt": _now_iso(),
  }


def _caption_translation_from_payload(booking_id: str, payload: dict[str, object]) -> dict[str, object] | None:
  result_id = str(payload.get("resultId") or "").strip()
  source_language_code = str(payload.get("sourceLanguageCode") or "").strip()
  target_language_code = str(payload.get("targetLanguageCode") or "").strip()
  translated_content = str(payload.get("translatedContent") or "").strip()

  if not result_id or not translated_content:
    return None
  if source_language_code not in _caption_source_languages:
    return None
  if target_language_code not in _caption_target_languages:
    return None

  return {
    "type": "caption.translation",
    "bookingId": booking_id,
    "resultId": result_id,
    "sourceLanguageCode": source_language_code,
    "targetLanguageCode": target_language_code,
    "translatedContent": translated_content,
  }


async def _broadcast(booking_id: str, event: dict[str, object]) -> None:
  disconnected: set[WebSocket] = set()
  for connection in list(_connections[booking_id]):
    try:
      await connection.send_json(event)
    except RuntimeError:
      disconnected.add(connection)

  for connection in disconnected:
    _connections[booking_id].discard(connection)


async def broadcast_booking_status(booking_id: str, status: str, message: str) -> None:
  """Push a customer-readable booking status notice to the active chat."""
  await _broadcast(
    booking_id,
    {
      "type": "booking.status",
      "bookingId": booking_id,
      "status": status,
      "message": message,
    },
  )


@router.get("/bookings/{booking_id}/summary")
async def get_customer_booking_summary(booking_id: str):
  return partner_workspace.get_customer_visible_summary(booking_id)


@router.websocket("/ws/bookings/{booking_id}")
async def consulting_conversation_ws(
  websocket: WebSocket,
  booking_id: str,
  participantType: str = "user",
):
  await websocket.accept()
  _connections[booking_id].add(websocket)
  connection_id = f"local-conn-{uuid4().hex}"

  await websocket.send_json({
    "type": "connected",
    "bookingId": booking_id,
    "connectionId": connection_id,
    "participantType": participantType,
  })
  await websocket.send_json({
    "type": "message.history",
    "bookingId": booking_id,
    "messages": _messages[booking_id],
  })
  await _broadcast(booking_id, {
    "type": "presence",
    "bookingId": booking_id,
    "participants": [
      {"participantType": "user", "connectionCount": len(_connections[booking_id])},
    ],
  })

  try:
    while True:
      raw_payload = await websocket.receive_text()
      try:
        payload = json.loads(raw_payload)
      except json.JSONDecodeError:
        payload = raw_payload
      event = _event_from_payload(booking_id, payload, participantType)
      if not event:
        continue
      if event.get("type") == "pong":
        await websocket.send_json(event)
        continue

      if event.get("type") == "message.new":
        _messages[booking_id].append(event)
        client_message_id = event.get("clientMessageId")
        if client_message_id:
          await websocket.send_json({
            "type": "message.ack",
            "bookingId": booking_id,
            "clientMessageId": client_message_id,
            "messageId": event["id"],
            "sentAt": event["sentAt"],
          })
      await _broadcast(booking_id, event)
  except WebSocketDisconnect:
    _connections[booking_id].discard(websocket)
