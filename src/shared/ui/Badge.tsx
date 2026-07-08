import type {
  BookingStatus,
  BusinessVerificationStatus,
  ExposureStatus,
  PartnerApplicationDocumentReviewStatus,
  PartnerApplicationStatus,
  PaymentStatus,
  ReviewStatus,
} from "../../types/domain";
import {
  bookingStatusLabel,
  businessVerificationStatusLabel,
  exposureStatusLabel,
  partnerApplicationDocumentReviewStatusLabel,
  partnerApplicationStatusLabel,
  paymentStatusLabel,
  reviewStatusLabel,
} from "../utils/format";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
}

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const tone: Record<BookingStatus, BadgeTone> = {
    scheduled: "info",
    in_progress: "warning",
    completed: "success",
    cancelled: "neutral",
    no_show: "danger",
    refund_requested: "danger",
  };
  return <Badge tone={tone[status]}>{bookingStatusLabel[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const tone: Record<PaymentStatus, BadgeTone> = {
    pending: "warning",
    paid: "success",
    failed: "danger",
    refunded: "neutral",
    partial_refund: "warning",
  };
  return <Badge tone={tone[status]}>{paymentStatusLabel[status]}</Badge>;
}

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const tone: Record<ReviewStatus, BadgeTone> = {
    visible: "success",
    hidden: "neutral",
    reported: "danger",
    needs_reply: "warning",
  };
  return <Badge tone={tone[status]}>{reviewStatusLabel[status]}</Badge>;
}

export function ExposureStatusBadge({ status }: { status: ExposureStatus }) {
  const tone: Record<ExposureStatus, BadgeTone> = {
    public: "success",
    private: "neutral",
    pending_review: "warning",
  };
  return <Badge tone={tone[status]}>{exposureStatusLabel[status]}</Badge>;
}

export function BusinessVerificationBadge({ status }: { status: BusinessVerificationStatus }) {
  const tone: Record<BusinessVerificationStatus, BadgeTone> = {
    not_submitted: "neutral",
    submitted: "warning",
    approved: "success",
    rejected: "danger",
    needs_update: "warning",
  };
  return <Badge tone={tone[status]}>{businessVerificationStatusLabel[status]}</Badge>;
}

export function PartnerApplicationStatusBadge({ status }: { status: PartnerApplicationStatus }) {
  const tone: Record<PartnerApplicationStatus, BadgeTone> = {
    submitted: "warning",
    needs_update: "info",
    approved: "success",
    rejected: "danger",
  };
  return <Badge tone={tone[status]}>{partnerApplicationStatusLabel[status]}</Badge>;
}

export function PartnerApplicationDocumentReviewBadge({ status }: { status: PartnerApplicationDocumentReviewStatus }) {
  const tone: Record<PartnerApplicationDocumentReviewStatus, BadgeTone> = {
    pending: "warning",
    verified: "success",
    rejected: "danger",
  };
  return <Badge tone={tone[status]}>{partnerApplicationDocumentReviewStatusLabel[status]}</Badge>;
}
