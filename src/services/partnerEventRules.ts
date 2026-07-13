export type PartnerEventType =
  | "booking.created"
  | "booking.updated"
  | "summary.created"
  | "summary.failed"
  | "review.created"
  | "refund.updated"
  | "chat.unread"
  | "heartbeat";

export interface PartnerEvent {
  id: string;
  type: PartnerEventType;
  businessId: string;
  expertId?: string;
  bookingId?: string;
  customerId?: string;
  createdAt: string;
}

export interface PartnerEventScope {
  businessId: string;
  expertId?: string;
}

export const PARTNER_EVENT_FALLBACK_REFETCH_ROOTS = [
  "dashboard-summary",
  "bookings",
  "completion-bookings",
  "chat-threads",
  "reviews",
  "admin-summary-jobs",
] as const;

export function isPartnerEventInScope(event: PartnerEvent, scope: PartnerEventScope) {
  if (event.businessId !== scope.businessId) return false;
  if (scope.expertId && event.type !== "heartbeat") return event.expertId === scope.expertId;
  return true;
}

export function getPartnerEventFallbackRefetchRoots() {
  return [...PARTNER_EVENT_FALLBACK_REFETCH_ROOTS];
}

export function getPartnerEventInvalidationRoots(event: PartnerEvent) {
  if (event.type === "heartbeat") return [];
  const roots = ["dashboard-summary"];
  if (event.type.startsWith("booking.")) {
    roots.push(
      "bookings",
      "completion-bookings",
      "booking-detail",
      "completion-booking-detail",
      "chat-threads",
      "chat-thread-detail",
    );
  }
  if (event.type.startsWith("summary.")) roots.push("completion-booking-detail", "customer-detail", "admin-summary-jobs");
  if (event.type === "review.created") roots.push("reviews");
  if (event.type === "refund.updated") roots.push("bookings", "dashboard-summary");
  if (event.type === "chat.unread") roots.push("chat-threads", "chat-thread-detail");
  return Array.from(new Set(roots));
}
