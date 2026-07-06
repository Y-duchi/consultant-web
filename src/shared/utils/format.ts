import type { BookingStatus, BusinessVerificationStatus, ExposureStatus, PaymentStatus, ReviewStatus, WorkspaceScope } from "../../types/domain";

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(new Date(iso));

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(amount);

export const bookingStatusLabel: Record<BookingStatus, string> = {
  scheduled: "예정",
  in_progress: "진행중",
  completed: "완료",
  cancelled: "취소",
  no_show: "노쇼",
  refund_requested: "환불요청",
};

export const paymentStatusLabel: Record<PaymentStatus, string> = {
  pending: "결제대기",
  paid: "결제완료",
  failed: "결제실패",
  refunded: "환불완료",
  partial_refund: "부분환불",
};

export const reviewStatusLabel: Record<ReviewStatus, string> = {
  visible: "노출중",
  hidden: "숨김",
  reported: "신고됨",
  needs_reply: "답글대기",
};

export const exposureStatusLabel: Record<ExposureStatus, string> = {
  public: "공개",
  private: "비공개",
  pending_review: "검수중",
};

export const workspaceScopeLabel: Record<WorkspaceScope, string> = {
  expert_personal: "전문가 개인용",
  business_operations: "업체/프리랜서 운영자용",
};

export const businessVerificationStatusLabel: Record<BusinessVerificationStatus, string> = {
  not_submitted: "인증 전",
  submitted: "검수 대기",
  approved: "인증 완료",
  rejected: "반려",
  needs_update: "보완 필요",
};

export const toInputDate = (iso: string) => {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const isTerminalBookingStatus = (status: BookingStatus) =>
  status === "cancelled" || status === "no_show" || status === "refund_requested";
