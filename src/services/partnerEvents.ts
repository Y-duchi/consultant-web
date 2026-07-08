export type { PartnerEvent, PartnerEventScope, PartnerEventType } from "./partnerEventRules";
export { getPartnerEventFallbackRefetchRoots, getPartnerEventInvalidationRoots, isPartnerEventInScope } from "./partnerEventRules";

import type { PartnerEvent } from "./partnerEventRules";

interface PartnerEventConnectionOptions {
  accountId: string;
  businessId: string;
  expertId?: string;
  onEvent: (event: PartnerEvent) => void;
}

interface PartnerEventConnection {
  close: () => void;
}

export function connectPartnerEventStream({
  accountId,
  businessId,
  expertId,
  onEvent,
}: PartnerEventConnectionOptions): PartnerEventConnection {
  const eventUrl = import.meta.env.VITE_PARTNER_EVENTS_URL;

  if (eventUrl && typeof EventSource !== "undefined") {
    const url = new URL(eventUrl);
    url.searchParams.set("accountId", accountId);
    url.searchParams.set("businessId", businessId);
    if (expertId) url.searchParams.set("expertId", expertId);
    url.searchParams.set("role", expertId ? "expert" : "business_manager");
    url.searchParams.set("workspaceScope", expertId ? "expert_personal" : "business_operations");

    const source = new EventSource(url.toString());
    source.onmessage = (message) => {
      try {
        onEvent(normalizePartnerEvent(JSON.parse(message.data)));
      } catch {
        onEvent(createHeartbeatEvent(businessId, expertId));
      }
    };
    source.onerror = () => {
      onEvent(createHeartbeatEvent(businessId, expertId));
    };
    return {
      close: () => source.close(),
    };
  }

  const timer = window.setInterval(() => {
    onEvent(createHeartbeatEvent(businessId, expertId));
  }, 60_000);
  return {
    close: () => window.clearInterval(timer),
  };
}

export function normalizePartnerEvent(raw: unknown): PartnerEvent {
  const event = raw as Record<string, unknown>;
  return {
    id: String(event.id ?? `event-${Date.now()}`),
    type: String(event.type ?? "heartbeat") as PartnerEvent["type"],
    businessId: String(event.businessId ?? event.business_id ?? ""),
    expertId: optionalString(event.expertId ?? event.expert_id),
    bookingId: optionalString(event.bookingId ?? event.booking_id),
    customerId: optionalString(event.customerId ?? event.customer_id),
    createdAt: String(event.createdAt ?? event.created_at ?? new Date().toISOString()),
  };
}

function createHeartbeatEvent(businessId: string, expertId?: string): PartnerEvent {
  return {
    id: `heartbeat-${Date.now()}`,
    type: "heartbeat",
    businessId,
    expertId,
    createdAt: new Date().toISOString(),
  };
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
