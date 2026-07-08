from __future__ import annotations

from fastapi import APIRouter

from app.services import partner_workspace


router = APIRouter()


@router.get("/bookings/{booking_id}/summary")
async def get_customer_booking_summary(booking_id: str):
  return partner_workspace.get_customer_visible_summary(booking_id)
