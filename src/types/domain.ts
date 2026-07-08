export type UserRole = "admin" | "operator" | "expert" | "business_manager";

export type WorkspaceScope = "expert_personal" | "business_operations";
export type PartnerType = "business" | "freelancer";
export type BusinessVerificationStatus = "not_submitted" | "submitted" | "approved" | "rejected" | "needs_update";
export type PartnerApplicationStatus = "submitted" | "needs_update" | "approved" | "rejected";
export type PartnerApplicationDocumentType = "business_registration" | "beauty_license" | "additional_certificate";
export type PartnerApplicationDocumentReviewStatus = "pending" | "verified" | "rejected";
export type ConsultationSummarySource = "manual" | "phone_ai" | "customer_app" | "expert_result";
export type ConsultationSummaryAiStatus = "not_requested" | "queued" | "processing" | "succeeded" | "failed";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded" | "partial_refund";

export type BookingStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show"
  | "refund_requested";

export type ReviewStatus = "visible" | "hidden" | "reported" | "needs_reply";

export type ExposureStatus = "public" | "private" | "pending_review";

export type AttachmentType = "image" | "document" | "credential" | "photo" | "report";

export interface Expert {
  id: string;
  businessId: string;
  name: string;
  roleLabel: string;
  tagline: string;
  email: string;
  phone: string;
  avatarUrl: string;
  specialties: string[];
  categories: string[];
  introduction: string;
  yearsOfExperience: number;
  credentials: Attachment[];
  price30Min: number;
  price60Min: number;
  exposureStatus: ExposureStatus;
  rating: number;
  reviewCount: number;
  consultationCount: number;
  rebookingRate: number;
  responseWithinMinutes: number;
}

export interface BusinessProfile {
  id: string;
  partnerType: PartnerType;
  name: string;
  ownerName: string;
  businessRegistrationNumber?: string;
  phone: string;
  address: string;
  website?: string;
  description: string;
  photos: Attachment[];
  exposureStatus: ExposureStatus;
  verificationStatus: BusinessVerificationStatus;
  verificationDocuments: Attachment[];
  settlementAccountStatus: "not_submitted" | "reviewing" | "approved" | "rejected";
  defaultOperatingHours: OperatingHours[];
  cancellationPolicy: string;
  refundPolicy: string;
}

export interface PartnerApplicationDocument {
  id: string;
  applicationId: string;
  type: PartnerApplicationDocumentType;
  fileName: string;
  mimeType: "application/pdf";
  sizeLabel: string;
  storageKey: string;
  uploadedAt: string;
  reviewStatus: PartnerApplicationDocumentReviewStatus;
  note?: string;
}

export interface PartnerApplication {
  id: string;
  partnerType: PartnerType;
  businessName: string;
  ownerName: string;
  businessRegistrationNumber?: string;
  phone: string;
  email: string;
  specialties: string[];
  categories: string[];
  introduction: string;
  price30Min: number;
  price60Min: number;
  status: PartnerApplicationStatus;
  submittedAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewerName?: string;
  reviewMemo?: string;
  businessId?: string;
  generatedAccountId?: string;
  documents: PartnerApplicationDocument[];
}

export interface PartnerAccount {
  id: string;
  applicationId: string;
  businessId: string;
  expertId?: string;
  email: string;
  temporaryPassword: string;
  role: "business_manager" | "expert";
  workspaceScope: WorkspaceScope;
  status: "invited" | "active" | "suspended";
  passwordChangeRequired: boolean;
  createdAt: string;
  deliveredBy: "manual" | "email" | "sms";
}

export interface PartnerBusinessMember {
  id: string;
  businessId: string;
  accountId: string;
  expertId?: string;
  role: "owner" | "manager" | "expert";
  workspaceScope: WorkspaceScope;
  status: "active" | "invited" | "suspended";
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationReviewLog {
  id: string;
  applicationId: string;
  actorName: string;
  action: "submitted" | "needs_update" | "approved" | "rejected" | "account_created";
  memo: string;
  createdAt: string;
}

export interface OperatingHours {
  dayOfWeek: number;
  label: string;
  opensAt: string;
  closesAt: string;
  lunchStart?: string;
  lunchEnd?: string;
  isClosed: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  joinedAt: string;
  lastActiveAt: string;
  tags: string[];
  memo: string;
  profileImageUrl?: string;
  totalBookings: number;
  completedBookings: number;
  totalPaidAmount: number;
  riskFlags: string[];
  preferredChannel: "chat" | "phone" | "sms";
  attachments: Attachment[];
}

export interface Booking {
  id: string;
  customerId: string;
  expertId: string;
  businessId: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: 30 | 60;
  type: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  discountAmount: number;
  channel: "video" | "chat" | "offline";
  requestedAt: string;
  requestMemo: string;
  selectedConcernTags: string[];
  internalMemo: string;
  sharedReportIds: string[];
  consultationSummaryId?: string;
  refundRequestId?: string;
  reviewId?: string;
  reviewRequestStatus: "not_ready" | "ready" | "sent" | "reviewed";
}

export interface AvailabilitySlot {
  id: string;
  expertId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  kind: "available" | "blocked" | "lunch" | "holiday" | "exception";
  note?: string;
}

export interface ChatThread {
  id: string;
  customerId: string;
  bookingId?: string;
  assignedExpertId: string;
  lastMessageAt: string;
  unreadCount: number;
  status: "open" | "waiting" | "closed";
  channel: "app_chat" | "sms_bridge" | "web";
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderType: "customer" | "expert" | "operator" | "system";
  senderName: string;
  body: string;
  sentAt: string;
  attachments: Attachment[];
}

export interface SharedReport {
  id: string;
  customerId: string;
  bookingId?: string;
  title: string;
  category: string;
  createdAt: string;
  source: "customer_app" | "expert_result";
  summary: string;
  attachmentIds: string[];
}

export interface ConsultationSummary {
  id: string;
  bookingId: string;
  expertId: string;
  customerId: string;
  createdAt: string;
  source: ConsultationSummarySource;
  aiStatus: ConsultationSummaryAiStatus;
  aiModel?: string;
  transcript?: string;
  internalMemo: string;
  customerSummary: string;
  recommendations: string;
  visibleToCustomer: boolean;
  deliveredReportIds: string[];
  reviewRequestStatus: "ready" | "sent" | "reviewed";
}

export interface ConsultationSummaryJob {
  id: string;
  bookingId: string;
  businessId: string;
  expertId: string;
  requestedBy: string;
  status: ConsultationSummaryAiStatus;
  source: "phone_transcript" | "manual_memo";
  aiModel?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  bookingId: string;
  customerId: string;
  expertId: string;
  rating: number;
  content: string;
  createdAt: string;
  status: ReviewStatus;
  reply?: string;
}

export interface Attachment {
  id: string;
  ownerId: string;
  type: AttachmentType;
  name: string;
  url: string;
  uploadedAt: string;
}

export interface RefundRequest {
  id: string;
  bookingId: string;
  customerId: string;
  requestedAt: string;
  amount: number;
  reason: string;
  status: "requested" | "reviewing" | "approved" | "rejected";
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  expertId?: string;
  businessId: string;
  workspaceScope: WorkspaceScope;
  partnerType?: PartnerType;
  applicationId?: string;
  applicationStatus?: PartnerApplicationStatus;
  accountId?: string;
  passwordChangeRequired?: boolean;
}

export interface DashboardSummary {
  todayBookingCount: number;
  upcomingBookingCount: number;
  pendingCompletionCount: number;
  refundRequestCount: number;
  unreadMessageCount: number;
  newReviewCount: number;
  todayPaidAmount: number;
  pendingReportDeliveryCount: number;
  availableSlotCount: number;
  verificationStatus: BusinessVerificationStatus;
  todayTimeline: Booking[];
  urgentTasks: UrgentTask[];
}

export interface AdminDashboardSummary {
  pendingApplicationCount: number;
  needsUpdateApplicationCount: number;
  approvedBusinessCount: number;
  totalExpertCount: number;
  todayBookingCount: number;
  refundRequestCount: number;
  failedSummaryJobCount: number;
  hiddenOrReportedReviewCount: number;
  recentApplications: PartnerApplication[];
  todayBookings: Booking[];
  summaryJobs: ConsultationSummaryJob[];
}

export interface UrgentTask {
  id: string;
  type: "completion" | "refund" | "message" | "review" | "availability" | "verification" | "report";
  title: string;
  description: string;
  dueAt?: string;
  bookingId?: string;
  customerId?: string;
}

export interface ManagerSettings {
  operatingHours: OperatingHours[];
  holidays: string[];
  notification: {
    bookingCreated: boolean;
    bookingReminder: boolean;
    unreadChatDigest: boolean;
    reviewCreated: boolean;
  };
  integrations: {
    phoneProvider: "none" | "twilio" | "pinpoint" | "sens";
    chatProvider: "mock" | "websocket" | "firebase" | "sendbird" | "stream";
    smsProvider: "none" | "twilio" | "pinpoint" | "sens";
  };
  accountRoles: Array<{
    id: string;
    name: string;
    email: string;
    role: UserRole;
    scope: WorkspaceScope;
  }>;
}

export interface BookingFilters {
  query?: string;
  status?: BookingStatus | "all";
  dateFrom?: string;
  dateTo?: string;
  expertId?: string;
  sort?: "startsAtAsc" | "startsAtDesc" | "createdDesc";
}

export interface CustomerFilters {
  query?: string;
  tag?: string;
  sort?: "lastActiveDesc" | "nameAsc" | "paidDesc";
}

export interface ReviewFilters {
  query?: string;
  status?: ReviewStatus | "all";
  rating?: number | "all";
  sort?: "createdDesc" | "ratingDesc" | "ratingAsc";
}
