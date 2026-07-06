import type { BookingStatus, PaymentStatus, ReviewStatus } from "../../types/domain";

export const bookingStatusOptions: Array<{ value: BookingStatus | "all"; label: string }> = [
  { value: "all", label: "전체 상태" },
  { value: "scheduled", label: "예정" },
  { value: "in_progress", label: "진행중" },
  { value: "completed", label: "완료" },
  { value: "cancelled", label: "취소" },
  { value: "no_show", label: "노쇼" },
  { value: "refund_requested", label: "환불요청" },
];

export const paymentStatusOptions: Array<{ value: PaymentStatus | "all"; label: string }> = [
  { value: "all", label: "전체 결제" },
  { value: "pending", label: "결제대기" },
  { value: "paid", label: "결제완료" },
  { value: "failed", label: "결제실패" },
  { value: "refunded", label: "환불완료" },
  { value: "partial_refund", label: "부분환불" },
];

export const reviewStatusOptions: Array<{ value: ReviewStatus | "all"; label: string }> = [
  { value: "all", label: "전체 리뷰" },
  { value: "visible", label: "노출중" },
  { value: "hidden", label: "숨김" },
  { value: "reported", label: "신고됨" },
  { value: "needs_reply", label: "답글대기" },
];
