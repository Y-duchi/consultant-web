import type { BookingStatus, PaymentStatus, ReviewStatus } from "../../types/domain";

export const bookingStatusOptions: Array<{ value: BookingStatus | "all"; label: string }> = [
  { value: "all", label: "전체" },
  { value: "requested", label: "예약 신청" },
  { value: "confirmed", label: "예약 확정" },
  { value: "completed", label: "상담 완료" },
  { value: "cancelled", label: "예약 취소" },
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
