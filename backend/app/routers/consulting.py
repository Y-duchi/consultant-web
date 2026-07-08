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


def _now_iso() -> str:
  return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _message_from_payload(booking_id: str, payload: object, participant_type: str) -> dict[str, object] | None:
  if isinstance(payload, str):
    body = payload.strip()
    client_message_id = None
    media_ids = []
  elif isinstance(payload, dict):
    event_type = payload.get("type")
    if event_type == "ping":
      return {"type": "pong", "at": _now_iso()}
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


async def _broadcast(booking_id: str, event: dict[str, object]) -> None:
  disconnected: set[WebSocket] = set()
  for connection in list(_connections[booking_id]):
    try:
      await connection.send_json(event)
    except RuntimeError:
      disconnected.add(connection)

  for connection in disconnected:
    _connections[booking_id].discard(connection)


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
      event = _message_from_payload(booking_id, payload, participantType)
      if not event:
        continue
      if event.get("type") == "pong":
        await websocket.send_json(event)
        continue

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
