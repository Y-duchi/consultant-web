import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourcePath = resolve("src/services/partnerEventRules.ts");
const source = readFileSync(sourcePath, "utf8");

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourcePath,
});

const module = { exports: {} };
new Function("exports", "module", outputText)(module.exports, module);

const { getPartnerEventFallbackRefetchRoots, getPartnerEventInvalidationRoots, isPartnerEventInScope } = module.exports;

const eventsSourcePath = resolve("src/services/partnerEvents.ts");
const eventsSource = readFileSync(eventsSourcePath, "utf8");
const strippedEventsSource = eventsSource
  .replace(/export type \{[^;]+;\n/, "")
  .replace(/export \{[^;]+;\n/, "")
  .replace(/import type \{ PartnerEvent \} from "\.\/partnerEventRules";\n/, "");
const { outputText: eventsOutputText } = ts.transpileModule(strippedEventsSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: eventsSourcePath,
});
const eventsModule = { exports: {} };
new Function("exports", "module", "importMeta", eventsOutputText.replaceAll("import.meta", "importMeta"))(
  eventsModule.exports,
  eventsModule,
  { env: {} },
);
const { normalizePartnerEvent } = eventsModule.exports;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const bookingEvent = {
  id: "event-1",
  type: "booking.created",
  businessId: "biz-1",
  expertId: "exp-1",
  bookingId: "book-1",
  createdAt: new Date().toISOString(),
};

const summaryEvent = {
  ...bookingEvent,
  id: "event-2",
  type: "summary.created",
};

const heartbeat = {
  ...bookingEvent,
  id: "heartbeat-1",
  type: "heartbeat",
};

const reviewEvent = {
  ...bookingEvent,
  id: "event-review",
  type: "review.created",
};

const refundEvent = {
  ...bookingEvent,
  id: "event-refund",
  type: "refund.updated",
};

const chatEvent = {
  ...bookingEvent,
  id: "event-chat",
  type: "chat.unread",
};

const businessWideEvent = {
  ...bookingEvent,
  id: "event-business-wide",
  type: "refund.updated",
  expertId: undefined,
};

const snakeCaseEvent = {
  id: "event-snake",
  type: "booking.created",
  business_id: "biz-1",
  expert_id: "exp-1",
  booking_id: "book-2",
  customer_id: "cus-2",
  created_at: new Date().toISOString(),
};
const normalizedSnakeCaseEvent = normalizePartnerEvent(snakeCaseEvent);

assert(isPartnerEventInScope(bookingEvent, { businessId: "biz-1" }), "business manager should accept own business event");
assert(isPartnerEventInScope(bookingEvent, { businessId: "biz-1", expertId: "exp-1" }), "expert should accept own expert event");
assert(!isPartnerEventInScope(bookingEvent, { businessId: "biz-2" }), "other business event must be ignored");
assert(!isPartnerEventInScope(bookingEvent, { businessId: "biz-1", expertId: "exp-2" }), "other expert event must be ignored");
assert(isPartnerEventInScope(businessWideEvent, { businessId: "biz-1" }), "business manager should accept business-wide event");
assert(!isPartnerEventInScope(businessWideEvent, { businessId: "biz-1", expertId: "exp-1" }), "expert should reject events without a matching expert_id");
assert(isPartnerEventInScope(heartbeat, { businessId: "biz-1", expertId: "exp-1" }), "heartbeat should be accepted for an expert scope");
assert(normalizedSnakeCaseEvent.businessId === "biz-1", "snake_case event should normalize business_id");
assert(normalizedSnakeCaseEvent.expertId === "exp-1", "snake_case event should normalize expert_id");
assert(normalizedSnakeCaseEvent.bookingId === "book-2", "snake_case event should normalize booking_id");
assert(isPartnerEventInScope(normalizedSnakeCaseEvent, { businessId: "biz-1", expertId: "exp-1" }), "normalized backend event should pass expert scope");

const bookingRoots = getPartnerEventInvalidationRoots(bookingEvent);
assert(bookingRoots.includes("dashboard-summary"), "booking event should invalidate dashboard");
assert(bookingRoots.includes("bookings"), "booking event should invalidate bookings");
assert(bookingRoots.includes("completion-bookings"), "booking event should invalidate completion candidates");

const summaryRoots = getPartnerEventInvalidationRoots(summaryEvent);
assert(summaryRoots.includes("customer-detail"), "summary event should invalidate customer detail");
assert(summaryRoots.includes("admin-summary-jobs"), "summary event should invalidate summary jobs");
assert(getPartnerEventInvalidationRoots(reviewEvent).includes("reviews"), "review event should invalidate reviews");
assert(getPartnerEventInvalidationRoots(refundEvent).includes("bookings"), "refund event should invalidate bookings");
assert(getPartnerEventInvalidationRoots(chatEvent).includes("chat-threads"), "chat event should invalidate chat threads");

assert(getPartnerEventInvalidationRoots(heartbeat).length === 0, "heartbeat should not invalidate queries");

const fallbackRoots = getPartnerEventFallbackRefetchRoots();
for (const root of ["dashboard-summary", "bookings", "completion-bookings", "chat-threads", "reviews", "admin-summary-jobs"]) {
  assert(fallbackRoots.includes(root), `fallback refetch should include ${root}`);
}
assert(new Set(fallbackRoots).size === fallbackRoots.length, "fallback roots should be unique");

console.log("partner event rules checks passed");
