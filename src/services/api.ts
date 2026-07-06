import type {
  Attachment,
  AuthUser,
  AvailabilitySlot,
  Booking,
  BookingFilters,
  BookingStatus,
  BusinessProfile,
  ChatMessage,
  ChatThread,
  ConsultationSummary,
  Customer,
  CustomerFilters,
  DashboardSummary,
  Expert,
  ManagerSettings,
  RefundRequest,
  Review,
  ReviewFilters,
  SharedReport,
  UserRole,
  WorkspaceScope,
  PartnerType,
} from "../types/domain";
import {
  attachments as initialAttachments,
  availabilitySlots as initialAvailabilitySlots,
  bookings as initialBookings,
  businessProfiles as initialBusinessProfiles,
  chatMessages as initialChatMessages,
  chatThreads as initialChatThreads,
  consultationSummaries as initialConsultationSummaries,
  customers as initialCustomers,
  experts as initialExperts,
  refundRequests as initialRefundRequests,
  reviews as initialReviews,
  settings as initialSettings,
  sharedReports as initialSharedReports,
  todayDate,
} from "./mock/mockData";

const delay = (ms = 180) => new Promise((resolve) => window.setTimeout(resolve, ms));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const nowIso = () => new Date().toISOString();
const dateKey = (iso: string) => {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

let attachments = clone(initialAttachments);
let availabilitySlots = clone(initialAvailabilitySlots);
let bookings = clone(initialBookings);
let businessProfiles = clone(initialBusinessProfiles);
let chatMessages = clone(initialChatMessages);
let chatThreads = clone(initialChatThreads);
let consultationSummaries = clone(initialConsultationSummaries);
let customers = clone(initialCustomers);
let experts = clone(initialExperts);
let refundRequests = clone(initialRefundRequests);
let reviews = clone(initialReviews);
let managerSettings = clone(initialSettings);
let sharedReports = clone(initialSharedReports);

export interface LoginRequest {
  email: string;
  role: UserRole;
  workspaceScope: WorkspaceScope;
  partnerType?: PartnerType;
  businessName?: string;
  businessRegistrationNumber?: string;
  verificationFileName?: string;
}

export interface BookingDetail {
  booking: Booking;
  customer: Customer;
  expert: Expert;
  sharedReports: SharedReport[];
  consultationSummary?: ConsultationSummary;
  refundRequest?: RefundRequest;
  review?: Review;
}

export interface CustomerDetail {
  customer: Customer;
  bookings: Booking[];
  sharedReports: SharedReport[];
  consultationSummaries: ConsultationSummary[];
  reviews: Review[];
}

export interface ChatThreadDetail {
  thread: ChatThread;
  customer: Customer;
  booking?: Booking;
  expert: Expert;
  sharedReports: SharedReport[];
  messages: ChatMessage[];
}

export interface CompletionDraft {
  bookingId: string;
  internalMemo: string;
  customerSummary: string;
  recommendations: string;
  deliveredReportIds: string[];
  sendReviewRequest: boolean;
}

export interface PhoneActionRequest {
  customerId: string;
  bookingId?: string;
  channel: "phone" | "sms";
  note?: string;
}

export async function mockLogin(request: LoginRequest): Promise<AuthUser> {
  await delay();
  const expert = experts[0];
  if (request.role === "business_manager" && request.businessName) {
    businessProfiles[0] = {
      ...businessProfiles[0],
      name: request.businessName,
      partnerType: request.partnerType ?? businessProfiles[0].partnerType,
      businessRegistrationNumber: request.businessRegistrationNumber || businessProfiles[0].businessRegistrationNumber,
      verificationStatus: request.verificationFileName ? "submitted" : businessProfiles[0].verificationStatus,
    };
  }
  return {
    id: request.role === "expert" ? "user-1" : request.role === "admin" ? "user-3" : "user-2",
    name: request.role === "expert" ? expert.name : request.role === "admin" ? "플랫폼 관리자" : businessProfiles[0].name,
    email: request.email || (request.role === "expert" ? expert.email : request.role === "admin" ? "admin@aura.example" : "partner@aura.example"),
    role: request.role,
    expertId: request.role === "expert" ? expert.id : undefined,
    businessId: "biz-1",
    workspaceScope: request.workspaceScope,
    partnerType: request.partnerType,
  };
}

export async function getDashboardSummary(user?: AuthUser): Promise<DashboardSummary> {
  await delay();
  const scopedBookings = applyUserScope(bookings, user);
  const today = todayDate();
  const todayBookings = scopedBookings.filter((booking) => dateKey(booking.startsAt) === today);
  const upcoming = scopedBookings.filter((booking) => ["scheduled", "in_progress"].includes(booking.status));
  const pendingCompletion = scopedBookings.filter((booking) => {
    const isPastOrToday = dateKey(booking.startsAt) <= today;
    return isPastOrToday && !["completed", "cancelled", "no_show", "refund_requested"].includes(booking.status);
  });
  const pendingReportDelivery = scopedBookings.filter((booking) => {
    if (booking.status !== "completed") return false;
    const summary = consultationSummaries.find((item) => item.id === booking.consultationSummaryId);
    return !summary || summary.deliveredReportIds.length === 0;
  });
  const unreadThreadIds = new Set(applyChatUserScope(chatThreads, user).filter((thread) => thread.unreadCount > 0).map((thread) => thread.id));
  const reviewExpertIds = new Set(applyUserScope(scopedBookings, user).map((booking) => booking.expertId));
  const newReviews = reviews.filter((review) => reviewExpertIds.has(review.expertId));
  const scopedExpertIds = new Set(scopedBookings.map((booking) => booking.expertId));

  return clone({
    todayBookingCount: todayBookings.length,
    upcomingBookingCount: upcoming.length,
    pendingCompletionCount: pendingCompletion.length,
    refundRequestCount: scopedBookings.filter((booking) => booking.status === "refund_requested").length,
    todayPaidAmount: todayBookings.filter((booking) => booking.paymentStatus === "paid").reduce((total, booking) => total + booking.paidAmount, 0),
    pendingReportDeliveryCount: pendingReportDelivery.length,
    availableSlotCount: availabilitySlots.filter((slot) => scopedExpertIds.has(slot.expertId) && slot.date === today && slot.kind === "available").length * 20,
    verificationStatus: businessProfiles[0].verificationStatus,
    unreadMessageCount: Array.from(unreadThreadIds).reduce((total, threadId) => {
      const thread = chatThreads.find((item) => item.id === threadId);
      return total + (thread?.unreadCount ?? 0);
    }, 0),
    newReviewCount: newReviews.length,
    todayTimeline: todayBookings.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    urgentTasks: [
      ...(businessProfiles[0].verificationStatus === "approved"
        ? []
        : [{
            id: "task-verification",
            type: "verification" as const,
            title: "업체 인증 검수 대기",
            description: "사업자등록증, 대표자 확인, 정산 계좌 검수가 완료되어야 앱 노출과 정산이 안정적으로 진행됩니다.",
            dueAt: nowIso(),
          }]),
      ...pendingReportDelivery.map((booking) => ({
        id: `task-report-${booking.id}`,
        type: "report" as const,
        title: "앱 전달 리포트 선택 필요",
        description: `${getCustomerName(booking.customerId)} 고객에게 상담 처방 노트와 전달 리포트를 선택해야 합니다.`,
        dueAt: booking.endsAt,
        bookingId: booking.id,
        customerId: booking.customerId,
      })),
      ...pendingCompletion.map((booking) => ({
        id: `task-complete-${booking.id}`,
        type: "completion" as const,
        title: "뷰티 상담 완료 처리 필요",
        description: `${getCustomerName(booking.customerId)} 고객의 AI 리포트 기반 처방 노트를 정리해야 합니다.`,
        dueAt: booking.endsAt,
        bookingId: booking.id,
        customerId: booking.customerId,
      })),
      ...scopedBookings
        .filter((booking) => booking.status === "refund_requested")
        .map((booking) => ({
          id: `task-refund-${booking.id}`,
          type: "refund" as const,
          title: "환불 요청 검토",
          description: `${getCustomerName(booking.customerId)} 고객의 취소/환불 요청을 확인하세요.`,
          dueAt: nowIso(),
          bookingId: booking.id,
          customerId: booking.customerId,
        })),
      ...applyChatUserScope(chatThreads, user)
        .filter((thread) => thread.unreadCount > 0)
        .map((thread) => ({
          id: `task-message-${thread.id}`,
          type: "message" as const,
          title: "읽지 않은 고객 메시지",
          description: `${getCustomerName(thread.customerId)} 고객이 리포트/예약 관련 메시지를 보냈습니다.`,
          dueAt: thread.lastMessageAt,
          bookingId: thread.bookingId,
          customerId: thread.customerId,
        })),
      ...newReviews
        .filter((review) => review.status === "needs_reply")
        .map((review) => ({
          id: `task-review-${review.id}`,
          type: "review" as const,
          title: "리뷰 답글 대기",
          description: `${getCustomerName(review.customerId)} 고객 리뷰에 답글을 남길 수 있습니다.`,
          dueAt: review.createdAt,
          bookingId: review.bookingId,
          customerId: review.customerId,
        })),
    ].slice(0, 8),
  });
}

export async function getBookings(filters: BookingFilters = {}, user?: AuthUser): Promise<Booking[]> {
  await delay();
  let result = applyUserScope(bookings, user);
  if (filters.status && filters.status !== "all") {
    result = result.filter((booking) => booking.status === filters.status);
  }
  if (filters.expertId) {
    result = result.filter((booking) => booking.expertId === filters.expertId);
  }
  if (filters.dateFrom) {
    result = result.filter((booking) => dateKey(booking.startsAt) >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    result = result.filter((booking) => dateKey(booking.startsAt) <= filters.dateTo!);
  }
  if (filters.query) {
    const query = filters.query.toLowerCase();
    result = result.filter((booking) => {
      const customer = customers.find((item) => item.id === booking.customerId);
      const expert = experts.find((item) => item.id === booking.expertId);
      return [booking.type, booking.requestMemo, customer?.name, customer?.phone, expert?.name]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    });
  }
  const sort = filters.sort ?? "startsAtAsc";
  result = [...result].sort((a, b) => {
    if (sort === "startsAtDesc") return b.startsAt.localeCompare(a.startsAt);
    if (sort === "createdDesc") return b.requestedAt.localeCompare(a.requestedAt);
    return a.startsAt.localeCompare(b.startsAt);
  });
  return clone(result);
}

export async function getBookingDetail(bookingId: string): Promise<BookingDetail> {
  await delay();
  const booking = findBooking(bookingId);
  return clone(makeBookingDetail(booking));
}

export async function updateBookingStatus(bookingId: string, status: BookingStatus): Promise<Booking> {
  await delay();
  const booking = findBooking(bookingId);
  booking.status = status;
  if (status === "completed") {
    booking.reviewRequestStatus = "ready";
  }
  if (status === "cancelled" || status === "no_show") {
    booking.reviewRequestStatus = "not_ready";
  }
  return clone(booking);
}

export async function updateBooking(bookingId: string, patch: Partial<Pick<Booking, "startsAt" | "endsAt" | "durationMinutes" | "type" | "internalMemo" | "requestMemo">>): Promise<Booking> {
  await delay();
  const booking = findBooking(bookingId);
  Object.assign(booking, patch);
  return clone(booking);
}

export async function addBookingNote(bookingId: string, note: string): Promise<Booking> {
  await delay();
  const booking = findBooking(bookingId);
  booking.internalMemo = [booking.internalMemo, note].filter(Boolean).join("\n");
  return clone(booking);
}

export async function cancelBooking(bookingId: string, reason: string): Promise<Booking> {
  await delay();
  const booking = findBooking(bookingId);
  booking.status = "cancelled";
  booking.reviewRequestStatus = "not_ready";
  booking.internalMemo = [booking.internalMemo, `취소 사유: ${reason}`].filter(Boolean).join("\n");
  return clone(booking);
}

export async function getCustomers(filters: CustomerFilters = {}, user?: AuthUser): Promise<Customer[]> {
  await delay();
  const bookingCustomerIds = new Set(applyUserScope(bookings, user).map((booking) => booking.customerId));
  let result = customers.filter((customer) => bookingCustomerIds.has(customer.id) || user?.workspaceScope !== "expert_personal");
  if (filters.tag && filters.tag !== "all") {
    result = result.filter((customer) => customer.tags.includes(filters.tag!));
  }
  if (filters.query) {
    const query = filters.query.toLowerCase();
    result = result.filter((customer) =>
      [customer.name, customer.phone, customer.email, customer.memo, customer.tags.join(" ")]
        .some((value) => value.toLowerCase().includes(query)),
    );
  }
  const sort = filters.sort ?? "lastActiveDesc";
  result = [...result].sort((a, b) => {
    if (sort === "nameAsc") return a.name.localeCompare(b.name);
    if (sort === "paidDesc") return b.totalPaidAmount - a.totalPaidAmount;
    return b.lastActiveAt.localeCompare(a.lastActiveAt);
  });
  return clone(result);
}

export async function getCustomerDetail(customerId: string): Promise<CustomerDetail> {
  await delay();
  const customer = findCustomer(customerId);
  const customerBookings = bookings.filter((booking) => booking.customerId === customerId);
  return clone({
    customer,
    bookings: customerBookings.sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    sharedReports: sharedReports.filter((report) => report.customerId === customerId),
    consultationSummaries: consultationSummaries.filter((summary) => summary.customerId === customerId),
    reviews: reviews.filter((review) => review.customerId === customerId),
  });
}

export async function getChatThreads(user?: AuthUser): Promise<ChatThreadDetail[]> {
  await delay();
  return clone(applyChatUserScope(chatThreads, user).map(makeChatThreadDetail));
}

export async function getChatThreadDetail(threadId: string): Promise<ChatThreadDetail> {
  await delay();
  const thread = findThread(threadId);
  thread.unreadCount = 0;
  return clone(makeChatThreadDetail(thread));
}

export async function sendMessage(threadId: string, body: string, attachmentIds: string[] = []): Promise<ChatMessage> {
  await delay();
  const thread = findThread(threadId);
  const message: ChatMessage = {
    id: `msg-${Date.now()}`,
    threadId,
    senderType: "operator",
    senderName: "운영팀",
    body,
    sentAt: nowIso(),
    attachments: attachments.filter((attachment) => attachmentIds.includes(attachment.id)),
  };
  chatMessages = [...chatMessages, message];
  thread.lastMessageAt = message.sentAt;
  thread.status = "open";
  return clone(message);
}

export async function createPhoneAction(request: PhoneActionRequest): Promise<{ id: string; status: "prepared" }> {
  await delay(120);
  return clone({
    id: `action-${Date.now()}`,
    status: "prepared" as const,
    ...request,
  });
}

export async function getSharedReports(customerId?: string): Promise<SharedReport[]> {
  await delay();
  const result = customerId ? sharedReports.filter((report) => report.customerId === customerId) : sharedReports;
  return clone(result);
}

export async function getConsultationSummaries(): Promise<ConsultationSummary[]> {
  await delay();
  return clone(consultationSummaries);
}

export async function createConsultationSummary(draft: CompletionDraft): Promise<ConsultationSummary> {
  await delay();
  const booking = findBooking(draft.bookingId);
  if (booking.status === "cancelled" || booking.status === "no_show" || booking.status === "refund_requested") {
    throw new Error("취소/노쇼/환불 요청 예약은 완료 리포트를 생성할 수 없습니다.");
  }
  const summary: ConsultationSummary = {
    id: `summary-${Date.now()}`,
    bookingId: booking.id,
    customerId: booking.customerId,
    expertId: booking.expertId,
    createdAt: nowIso(),
    internalMemo: draft.internalMemo,
    customerSummary: draft.customerSummary,
    recommendations: draft.recommendations,
    deliveredReportIds: draft.deliveredReportIds,
    reviewRequestStatus: draft.sendReviewRequest ? "sent" : "ready",
  };
  consultationSummaries = [...consultationSummaries.filter((item) => item.bookingId !== booking.id), summary];
  booking.consultationSummaryId = summary.id;
  booking.status = "completed";
  booking.reviewRequestStatus = draft.sendReviewRequest ? "sent" : "ready";
  booking.internalMemo = [booking.internalMemo, draft.internalMemo].filter(Boolean).join("\n");
  return clone(summary);
}

export async function getReviews(filters: ReviewFilters = {}, user?: AuthUser): Promise<Review[]> {
  await delay();
  const scopedExpertIds = new Set(applyUserScope(bookings, user).map((booking) => booking.expertId));
  let result = reviews.filter((review) => scopedExpertIds.has(review.expertId));
  if (filters.status && filters.status !== "all") {
    result = result.filter((review) => review.status === filters.status);
  }
  if (filters.rating && filters.rating !== "all") {
    result = result.filter((review) => review.rating === filters.rating);
  }
  if (filters.query) {
    const query = filters.query.toLowerCase();
    result = result.filter((review) => {
      const customer = customers.find((item) => item.id === review.customerId);
      const expert = experts.find((item) => item.id === review.expertId);
      return [review.content, customer?.name, expert?.name].filter(Boolean).some((value) => value!.toLowerCase().includes(query));
    });
  }
  const sort = filters.sort ?? "createdDesc";
  result = [...result].sort((a, b) => {
    if (sort === "ratingAsc") return a.rating - b.rating;
    if (sort === "ratingDesc") return b.rating - a.rating;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return clone(result);
}

export async function updateReview(reviewId: string, patch: Partial<Pick<Review, "status" | "reply">>): Promise<Review> {
  await delay();
  const review = reviews.find((item) => item.id === reviewId);
  if (!review) throw new Error("리뷰를 찾을 수 없습니다.");
  Object.assign(review, patch);
  return clone(review);
}

export async function getBusinessProfile(): Promise<BusinessProfile> {
  await delay();
  return clone(businessProfiles[0]);
}

export async function updateBusinessProfile(patch: Partial<BusinessProfile>): Promise<BusinessProfile> {
  await delay();
  businessProfiles[0] = { ...businessProfiles[0], ...patch };
  return clone(businessProfiles[0]);
}

export async function getExperts(user?: AuthUser): Promise<Expert[]> {
  await delay();
  const result = user?.workspaceScope === "expert_personal" && user.expertId
    ? experts.filter((expert) => expert.id === user.expertId)
    : experts;
  return clone(result);
}

export async function updateExpertProfile(expertId: string, patch: Partial<Expert>): Promise<Expert> {
  await delay();
  const expert = experts.find((item) => item.id === expertId);
  if (!expert) throw new Error("전문가를 찾을 수 없습니다.");
  Object.assign(expert, patch);
  return clone(expert);
}

export async function uploadCredentialMock(ownerId: string, fileName: string): Promise<Attachment> {
  await delay(260);
  const attachment: Attachment = {
    id: `att-${Date.now()}`,
    ownerId,
    type: "credential",
    name: fileName,
    url: "https://images.unsplash.com/photo-1554224154-26032fced8bd?auto=format&fit=crop&w=900&q=80",
    uploadedAt: nowIso(),
  };
  attachments = [...attachments, attachment];
  const expert = experts.find((item) => item.id === ownerId);
  if (expert) {
    expert.credentials = [...expert.credentials, attachment];
  }
  return clone(attachment);
}

export async function uploadBusinessVerificationMock(fileName: string): Promise<BusinessProfile> {
  await delay(260);
  const attachment: Attachment = {
    id: `att-business-verification-${Date.now()}`,
    ownerId: businessProfiles[0].id,
    type: "credential",
    name: fileName,
    url: "https://images.unsplash.com/photo-1554224154-26032fced8bd?auto=format&fit=crop&w=900&q=80",
    uploadedAt: nowIso(),
  };
  attachments = [...attachments, attachment];
  businessProfiles[0] = {
    ...businessProfiles[0],
    verificationStatus: "submitted",
    verificationDocuments: [...businessProfiles[0].verificationDocuments, attachment],
  };
  return clone(businessProfiles[0]);
}

export async function getAvailability(expertId: string, date?: string): Promise<AvailabilitySlot[]> {
  await delay();
  let result = availabilitySlots.filter((slot) => slot.expertId === expertId);
  if (date) {
    result = result.filter((slot) => slot.date === date);
  }
  return clone(result);
}

export async function updateAvailability(slot: AvailabilitySlot): Promise<AvailabilitySlot> {
  await delay();
  const index = availabilitySlots.findIndex((item) => item.id === slot.id);
  if (index >= 0) {
    availabilitySlots[index] = slot;
  } else {
    availabilitySlots = [...availabilitySlots, { ...slot, id: slot.id || `slot-${Date.now()}` }];
  }
  return clone(slot);
}

export async function getSettings(): Promise<ManagerSettings> {
  await delay();
  return clone(managerSettings);
}

export async function updateSettings(patch: Partial<ManagerSettings>): Promise<ManagerSettings> {
  await delay();
  managerSettings = { ...managerSettings, ...patch };
  return clone(managerSettings);
}

export function getCustomerName(customerId: string) {
  return customers.find((customer) => customer.id === customerId)?.name ?? "알 수 없는 고객";
}

export function getExpertName(expertId: string) {
  return experts.find((expert) => expert.id === expertId)?.name ?? "알 수 없는 전문가";
}

function applyUserScope(source: Booking[], user?: AuthUser) {
  if (user?.workspaceScope === "expert_personal" && user.expertId) {
    return source.filter((booking) => booking.expertId === user.expertId);
  }
  return source;
}

function applyChatUserScope(source: ChatThread[], user?: AuthUser) {
  if (user?.workspaceScope === "expert_personal" && user.expertId) {
    return source.filter((thread) => thread.assignedExpertId === user.expertId);
  }
  return source;
}

function makeBookingDetail(booking: Booking): BookingDetail {
  const customer = findCustomer(booking.customerId);
  const expert = experts.find((item) => item.id === booking.expertId);
  if (!expert) throw new Error("전문가를 찾을 수 없습니다.");
  return {
    booking,
    customer,
    expert,
    sharedReports: sharedReports.filter((report) => booking.sharedReportIds.includes(report.id)),
    consultationSummary: consultationSummaries.find((summary) => summary.id === booking.consultationSummaryId),
    refundRequest: refundRequests.find((refund) => refund.id === booking.refundRequestId),
    review: reviews.find((review) => review.id === booking.reviewId),
  };
}

function makeChatThreadDetail(thread: ChatThread): ChatThreadDetail {
  const customer = findCustomer(thread.customerId);
  const expert = experts.find((item) => item.id === thread.assignedExpertId);
  if (!expert) throw new Error("담당 전문가를 찾을 수 없습니다.");
  const booking = thread.bookingId ? bookings.find((item) => item.id === thread.bookingId) : undefined;
  return {
    thread,
    customer,
    booking,
    expert,
    sharedReports: sharedReports.filter((report) => report.customerId === thread.customerId),
    messages: chatMessages.filter((message) => message.threadId === thread.id).sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
  };
}

function findBooking(bookingId: string) {
  const booking = bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error("예약을 찾을 수 없습니다.");
  return booking;
}

function findCustomer(customerId: string) {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) throw new Error("고객을 찾을 수 없습니다.");
  return customer;
}

function findThread(threadId: string) {
  const thread = chatThreads.find((item) => item.id === threadId);
  if (!thread) throw new Error("대화방을 찾을 수 없습니다.");
  return thread;
}
