import type { Booking } from "../types/domain";

const visibleStatuses = new Set<Booking["status"]>(["confirmed", "scheduled", "in_progress", "completed"]);
const closedStatuses = new Set<Booking["status"]>(["cancelled", "no_show", "refund_requested"]);

export function isBookingVisibleInChat(
  booking: Pick<Booking, "paymentStatus" | "status"> | null | undefined,
) {
  if (!booking) return true;
  if (visibleStatuses.has(booking.status)) return true;
  return closedStatuses.has(booking.status) && booking.paymentStatus === "paid";
}
