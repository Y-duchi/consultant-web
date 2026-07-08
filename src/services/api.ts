import type {
  Attachment,
  AdminDashboardSummary,
  ApplicationReviewLog,
  AuthUser,
  AvailabilitySlot,
  Booking,
  BookingFilters,
  BookingStatus,
  BusinessProfile,
  ChatMessage,
  ChatThread,
  ConsultationSummaryJob,
  ConsultationSummary,
  Customer,
  CustomerFilters,
  DashboardSummary,
  Expert,
  PartnerAccount,
  PartnerApplication,
  PartnerApplicationDocument,
  PartnerApplicationDocumentType,
  PartnerApplicationStatus,
  PartnerBusinessMember,
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
  consultationSummaryJobs as initialConsultationSummaryJobs,
  consultationSummaries as initialConsultationSummaries,
  customers as initialCustomers,
  experts as initialExperts,
  applicationReviewLogs as initialApplicationReviewLogs,
  partnerAccounts as initialPartnerAccounts,
  partnerBusinessMembers as initialPartnerBusinessMembers,
  partnerApplications as initialPartnerApplications,
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
let consultationSummaryJobs = clone(initialConsultationSummaryJobs);
let consultationSummaries = clone(initialConsultationSummaries);
let customers = clone(initialCustomers);
let experts = clone(initialExperts);
let applicationReviewLogs = clone(initialApplicationReviewLogs);
let partnerAccounts = clone(initialPartnerAccounts);
let partnerBusinessMembers = clone(initialPartnerBusinessMembers);
let partnerApplications = clone(initialPartnerApplications);
let refundRequests = clone(initialRefundRequests);
let reviews = clone(initialReviews);
let managerSettings = clone(initialSettings);
let sharedReports = clone(initialSharedReports);

export interface LoginRequest {
  email: string;
  password?: string;
  role: UserRole;
  workspaceScope?: WorkspaceScope;
  partnerType?: PartnerType;
  businessName?: string;
  businessRegistrationNumber?: string;
  verificationFileName?: string;
}

export interface PartnerApplicationFilters {
  query?: string;
  status?: PartnerApplicationStatus | "all";
}

export interface PartnerApplicationInput {
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
  businessRegistrationFileName?: string;
  beautyLicenseFileName?: string;
  additionalCertificateFileNames?: string[];
}

export interface PartnerApplicationDetail {
  application: PartnerApplication;
  reviewLogs: ApplicationReviewLog[];
  account?: PartnerAccount;
  member?: PartnerBusinessMember;
}

export interface PartnerApplicationDecisionRequest {
  reviewMemo: string;
  reviewerName?: string;
}

export interface PartnerApplicationApprovalRequest extends PartnerApplicationDecisionRequest {
  accountEmail?: string;
  workspaceScope?: WorkspaceScope;
}

export interface PartnerApplicationApprovalResult {
  application: PartnerApplication;
  account: PartnerAccount;
  member: PartnerBusinessMember;
}

export interface PartnerDocumentAccessResult {
  documentId: string;
  fileName: string;
  accessUrl: string;
  expiresInMinutes: number;
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
  transcript?: string;
  internalMemo: string;
  customerSummary: string;
  recommendations: string;
  visibleToCustomer: boolean;
  deliveredReportIds: string[];
  sendReviewRequest: boolean;
}

export interface SummaryGenerateInput {
  transcript?: string;
  internalMemo?: string;
  visibleToCustomer?: boolean;
}

export interface SummaryGenerateResult {
  job: ConsultationSummaryJob;
  summary: ConsultationSummary;
}

export interface PhoneActionRequest {
  customerId: string;
  bookingId?: string;
  channel: "phone" | "sms";
  note?: string;
}

export async function mockLogin(request: LoginRequest): Promise<AuthUser> {
  await delay();
  const email = request.email.trim().toLowerCase();

  if (request.role === "admin" || request.role === "operator") {
    return {
      id: "user-3",
      name: "플랫폼 관리자",
      email: email || "admin@aura.example",
      role: "admin",
      businessId: "platform",
      workspaceScope: "business_operations",
    };
  }

  const account = partnerAccounts.find((item) => item.email.toLowerCase() === email && item.status !== "suspended");
  if (account) {
    const application = partnerApplications.find((item) => item.id === account.applicationId);
    const accountExpert = experts.find((item) => item.businessId === account.businessId);
    return {
      id: account.id,
      name: application?.businessName ?? businessProfiles.find((business) => business.id === account.businessId)?.name ?? "AURA 파트너",
      email: account.email,
      role: account.role,
      expertId: account.role === "expert" ? accountExpert?.id : undefined,
      businessId: account.businessId,
      workspaceScope: account.workspaceScope,
      partnerType: application?.partnerType ?? "business",
      applicationId: account.applicationId,
      applicationStatus: application?.status ?? "approved",
      accountId: account.id,
      passwordChangeRequired: account.passwordChangeRequired,
    };
  }

  const application = partnerApplications.find((item) => item.email.toLowerCase() === email);
  if (application) {
    return {
      id: `application-user-${application.id}`,
      name: application.businessName,
      email: application.email,
      role: application.partnerType === "freelancer" ? "expert" : "business_manager",
      businessId: application.businessId ?? `pending-${application.id}`,
      workspaceScope: "business_operations",
      partnerType: application.partnerType,
      applicationId: application.id,
      applicationStatus: application.status,
    };
  }

  throw new Error("승인된 파트너 계정 또는 제출된 입점 신청을 찾을 수 없습니다.");
}

export async function completePartnerPasswordChange(accountId: string, nextPassword: string): Promise<void> {
  await delay(240);
  const normalizedPassword = nextPassword.trim();
  if (normalizedPassword.length < 8) {
    throw new Error("새 비밀번호는 8자 이상이어야 합니다.");
  }

  const account = partnerAccounts.find((item) => item.id === accountId);
  if (!account) {
    throw new Error("파트너 계정을 찾을 수 없습니다.");
  }

  account.passwordChangeRequired = false;
  account.status = "active";
  account.temporaryPassword = "";
}

export async function submitPartnerApplication(input: PartnerApplicationInput): Promise<PartnerApplication> {
  await delay(320);
  const id = `app-${Date.now()}`;
  const submittedAt = nowIso();
  const documents = createApplicationDocuments(id, input);
  const application: PartnerApplication = {
    id,
    partnerType: input.partnerType,
    businessName: input.businessName,
    ownerName: input.ownerName,
    businessRegistrationNumber: input.businessRegistrationNumber,
    phone: input.phone,
    email: input.email,
    specialties: input.specialties,
    categories: input.categories,
    introduction: input.introduction,
    price30Min: input.price30Min,
    price60Min: input.price60Min,
    status: "submitted",
    submittedAt,
    updatedAt: submittedAt,
    documents,
  };
  partnerApplications = [application, ...partnerApplications];
  addApplicationReviewLog(application.id, "신청자", "submitted", "입점 신청서와 필수 PDF 서류를 제출했습니다.");
  return clone(application);
}

export async function getPartnerApplications(filters: PartnerApplicationFilters = {}): Promise<PartnerApplication[]> {
  await delay();
  let result = partnerApplications;
  if (filters.status && filters.status !== "all") {
    result = result.filter((application) => application.status === filters.status);
  }
  if (filters.query) {
    const query = filters.query.toLowerCase();
    result = result.filter((application) =>
      [
        application.businessName,
        application.ownerName,
        application.email,
        application.phone,
        application.businessRegistrationNumber,
        application.specialties.join(" "),
        application.categories.join(" "),
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }
  return clone([...result].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export async function getPartnerApplicationDetail(applicationId: string): Promise<PartnerApplicationDetail> {
  await delay();
  const application = findPartnerApplication(applicationId);
  const account = partnerAccounts.find((item) => item.applicationId === applicationId);
  return clone({
    application,
    reviewLogs: applicationReviewLogs
      .filter((log) => log.applicationId === applicationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    account,
    member: partnerBusinessMembers.find((member) => account && member.accountId === account.id),
  });
}

export async function updatePartnerApplicationStatus(
  applicationId: string,
  status: Exclude<PartnerApplicationStatus, "approved">,
  request: PartnerApplicationDecisionRequest,
): Promise<PartnerApplication> {
  await delay(260);
  const application = findPartnerApplication(applicationId);
  ensureApplicationReviewable(application);
  ensureReviewMemo(request.reviewMemo);
  application.status = status;
  application.reviewMemo = request.reviewMemo.trim();
  application.reviewerName = request.reviewerName ?? "플랫폼 관리자";
  application.reviewedAt = nowIso();
  application.updatedAt = application.reviewedAt;
  addApplicationReviewLog(application.id, application.reviewerName, status, application.reviewMemo);
  return clone(application);
}

export async function approvePartnerApplication(
  applicationId: string,
  request: PartnerApplicationApprovalRequest,
): Promise<PartnerApplicationApprovalResult> {
  await delay(360);
  const application = findPartnerApplication(applicationId);
  ensureApplicationReviewable(application);
  const reviewedAt = nowIso();
  const businessId = application.businessId ?? `biz-${Date.now()}`;
  const business = ensureBusinessFromApplication(application, businessId);
  const expert = ensureExpertFromApplication(application, businessId);
  const existingAccount = partnerAccounts.find((account) => account.applicationId === application.id);
  const accountRole: PartnerAccount["role"] = application.partnerType === "freelancer" ? "expert" : "business_manager";
  const workspaceScope: WorkspaceScope = accountRole === "expert" ? "expert_personal" : request.workspaceScope ?? "business_operations";
  const account: PartnerAccount = existingAccount ?? {
    id: `account-${Date.now()}`,
    applicationId: application.id,
    businessId,
    expertId: application.partnerType === "freelancer" ? expert.id : undefined,
    email: request.accountEmail || application.email,
    temporaryPassword: createTemporaryPassword(application.businessName),
    role: accountRole,
    workspaceScope,
    status: "invited",
    passwordChangeRequired: true,
    createdAt: reviewedAt,
    deliveredBy: "manual",
  };
  const member = ensureBusinessMemberFromAccount(account, expert.id, reviewedAt);

  application.status = "approved";
  application.businessId = businessId;
  application.generatedAccountId = account.id;
  application.reviewMemo = request.reviewMemo || "제출 서류 확인 완료. 파트너 계정 발급 가능.";
  application.reviewerName = request.reviewerName ?? "플랫폼 관리자";
  application.reviewedAt = reviewedAt;
  application.updatedAt = reviewedAt;
  application.documents = application.documents.map((document) => ({ ...document, reviewStatus: "verified" }));

  if (existingAccount) {
    Object.assign(existingAccount, account);
  } else {
    partnerAccounts = [account, ...partnerAccounts];
  }

  addApplicationReviewLog(application.id, application.reviewerName, "approved", application.reviewMemo);
  addApplicationReviewLog(application.id, application.reviewerName, "account_created", `${business.name} 업체, ${expert.name} 전문가, ${account.email} 계정과 ${member.role} 멤버십을 수동 전달용으로 생성했습니다.`);

  return clone({ application, account, member });
}

export async function preparePartnerApplicationDocumentAccess(documentId: string): Promise<PartnerDocumentAccessResult> {
  await delay(180);
  const document = findPartnerApplicationDocument(documentId);
  return clone({
    documentId: document.id,
    fileName: document.fileName,
    accessUrl: `mock-presigned-url://${document.storageKey}`,
    expiresInMinutes: 10,
  });
}

export async function getAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  await delay();
  const today = todayDate();
  const todayBookings = bookings.filter((booking) => dateKey(booking.startsAt) === today);

  return clone({
    pendingApplicationCount: partnerApplications.filter((application) => application.status === "submitted").length,
    needsUpdateApplicationCount: partnerApplications.filter((application) => application.status === "needs_update").length,
    approvedBusinessCount: businessProfiles.filter((business) => business.verificationStatus === "approved").length,
    totalExpertCount: experts.length,
    todayBookingCount: todayBookings.length,
    refundRequestCount: bookings.filter((booking) => booking.status === "refund_requested").length,
    failedSummaryJobCount: consultationSummaryJobs.filter((job) => job.status === "failed").length,
    hiddenOrReportedReviewCount: reviews.filter((review) => review.status === "hidden" || review.status === "reported").length,
    recentApplications: [...partnerApplications].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
    todayBookings: todayBookings.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    summaryJobs: [...consultationSummaryJobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5),
  });
}

export async function getAdminBusinesses(): Promise<BusinessProfile[]> {
  await delay();
  return clone(businessProfiles);
}

export async function getAdminExperts(): Promise<Expert[]> {
  await delay();
  return clone(experts);
}

export async function getAdminBookings(filters: BookingFilters = {}): Promise<Booking[]> {
  return getBookings(filters);
}

export async function getDashboardSummary(user?: AuthUser): Promise<DashboardSummary> {
  await delay();
  const scopedBookings = applyUserScope(bookings, user);
  const scopedBusiness = businessProfiles.find((business) => business.id === user?.businessId) ?? businessProfiles[0];
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
    verificationStatus: scopedBusiness.verificationStatus,
    unreadMessageCount: Array.from(unreadThreadIds).reduce((total, threadId) => {
      const thread = chatThreads.find((item) => item.id === threadId);
      return total + (thread?.unreadCount ?? 0);
    }, 0),
    newReviewCount: newReviews.length,
    todayTimeline: todayBookings.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    urgentTasks: [
      ...(scopedBusiness.verificationStatus === "approved"
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

export async function getBookingDetail(bookingId: string, user?: AuthUser): Promise<BookingDetail> {
  await delay();
  const booking = findBooking(bookingId, user);
  return clone(makeBookingDetail(booking));
}

export async function updateBookingStatus(bookingId: string, status: BookingStatus, user?: AuthUser): Promise<Booking> {
  await delay();
  const booking = findBooking(bookingId, user);
  booking.status = status;
  if (status === "completed") {
    booking.reviewRequestStatus = "ready";
  }
  if (status === "cancelled" || status === "no_show") {
    booking.reviewRequestStatus = "not_ready";
  }
  return clone(booking);
}

export async function updateBooking(
  bookingId: string,
  patch: Partial<Pick<Booking, "startsAt" | "endsAt" | "durationMinutes" | "type" | "internalMemo" | "requestMemo">>,
  user?: AuthUser,
): Promise<Booking> {
  await delay();
  const booking = findBooking(bookingId, user);
  Object.assign(booking, patch);
  return clone(booking);
}

export async function addBookingNote(bookingId: string, note: string, user?: AuthUser): Promise<Booking> {
  await delay();
  const booking = findBooking(bookingId, user);
  booking.internalMemo = [booking.internalMemo, note].filter(Boolean).join("\n");
  return clone(booking);
}

export async function cancelBooking(bookingId: string, reason: string, user?: AuthUser): Promise<Booking> {
  await delay();
  const booking = findBooking(bookingId, user);
  booking.status = "cancelled";
  booking.reviewRequestStatus = "not_ready";
  booking.internalMemo = [booking.internalMemo, `취소 사유: ${reason}`].filter(Boolean).join("\n");
  return clone(booking);
}

export async function getCustomers(filters: CustomerFilters = {}, user?: AuthUser): Promise<Customer[]> {
  await delay();
  const bookingCustomerIds = new Set(applyUserScope(bookings, user).map((booking) => booking.customerId));
  let result = canAccessAllData(user)
    ? customers
    : customers.filter((customer) => bookingCustomerIds.has(customer.id));
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

export async function getCustomerDetail(customerId: string, user?: AuthUser): Promise<CustomerDetail> {
  await delay();
  const customer = findCustomer(customerId);
  const customerBookings = applyUserScope(bookings, user).filter((booking) => booking.customerId === customerId);
  if (!canAccessAllData(user) && customerBookings.length === 0) {
    throw new Error("이 고객은 현재 워크스페이스에서 조회할 수 없습니다.");
  }
  const scopedBookingIds = new Set(customerBookings.map((booking) => booking.id));
  const scopedExpertIds = new Set(customerBookings.map((booking) => booking.expertId));
  return clone({
    customer,
    bookings: customerBookings.sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    sharedReports: sharedReports.filter((report) => report.customerId === customerId && (!report.bookingId || scopedBookingIds.has(report.bookingId))),
    consultationSummaries: consultationSummaries.filter((summary) => summary.customerId === customerId && scopedBookingIds.has(summary.bookingId)),
    reviews: reviews.filter((review) => review.customerId === customerId && scopedExpertIds.has(review.expertId)),
  });
}

export async function getChatThreads(user?: AuthUser): Promise<ChatThreadDetail[]> {
  await delay();
  return clone(applyChatUserScope(chatThreads, user).map(makeChatThreadDetail));
}

export async function getChatThreadDetail(threadId: string, user?: AuthUser): Promise<ChatThreadDetail> {
  await delay();
  const thread = findThread(threadId, user);
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

export async function getSharedReports(customerId?: string, user?: AuthUser): Promise<SharedReport[]> {
  await delay();
  if (customerId && !canAccessCustomer(customerId, user)) {
    throw new Error("이 고객의 리포트를 조회할 수 없습니다.");
  }
  const scopedBookingIds = new Set(applyUserScope(bookings, user).map((booking) => booking.id));
  const result = customerId
    ? sharedReports.filter((report) => report.customerId === customerId && (canAccessAllData(user) || !report.bookingId || scopedBookingIds.has(report.bookingId)))
    : sharedReports.filter((report) => canAccessAllData(user) || !report.bookingId || scopedBookingIds.has(report.bookingId));
  return clone(result);
}

export async function getConsultationSummaries(user?: AuthUser): Promise<ConsultationSummary[]> {
  await delay();
  const scopedBookingIds = new Set(applyUserScope(bookings, user).map((booking) => booking.id));
  const result = canAccessAllData(user)
    ? consultationSummaries
    : consultationSummaries.filter((summary) => scopedBookingIds.has(summary.bookingId));
  return clone(result);
}

export async function getConsultationSummaryJobs(user?: AuthUser): Promise<ConsultationSummaryJob[]> {
  await delay();
  const result = canAccessAllData(user)
    ? consultationSummaryJobs
    : consultationSummaryJobs.filter((job) => job.businessId === user?.businessId);
  return clone([...result].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export async function getConsultationSummaryForBooking(bookingId: string, user?: AuthUser): Promise<ConsultationSummary | undefined> {
  await delay();
  findBooking(bookingId, user);
  return clone(consultationSummaries.find((summary) => summary.bookingId === bookingId));
}

export async function createConsultationSummary(draft: CompletionDraft, user?: AuthUser): Promise<ConsultationSummary> {
  await delay();
  const booking = findBooking(draft.bookingId, user);
  if (booking.status === "cancelled" || booking.status === "no_show" || booking.status === "refund_requested") {
    throw new Error("취소/노쇼/환불 요청 예약은 완료 리포트를 생성할 수 없습니다.");
  }
  const summary: ConsultationSummary = {
    id: `summary-${Date.now()}`,
    bookingId: booking.id,
    customerId: booking.customerId,
    expertId: booking.expertId,
    createdAt: nowIso(),
    source: draft.transcript?.trim() ? "phone_ai" : "manual",
    aiStatus: draft.transcript?.trim() ? "succeeded" : "not_requested",
    aiModel: draft.transcript?.trim() ? "mock-openai-summary" : undefined,
    transcript: draft.transcript,
    internalMemo: draft.internalMemo,
    customerSummary: draft.customerSummary,
    recommendations: draft.recommendations,
    visibleToCustomer: draft.visibleToCustomer,
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

export async function generateConsultationSummary(
  bookingId: string,
  input: SummaryGenerateInput,
  user?: AuthUser,
): Promise<SummaryGenerateResult> {
  await delay(520);
  const booking = findBooking(bookingId, user);
  const transcript = input.transcript?.trim() ?? "";
  const internalMemo = input.internalMemo?.trim() ?? "";
  const sourceText = transcript || internalMemo;
  if (!sourceText) {
    throw new Error("AI 요약 생성을 위해 transcript 또는 상담 메모가 필요합니다.");
  }

  const job: ConsultationSummaryJob = {
    id: `summary-job-${Date.now()}`,
    bookingId: booking.id,
    businessId: booking.businessId,
    expertId: booking.expertId,
    requestedBy: user?.accountId ?? user?.id ?? "mock-user",
    status: "processing",
    source: transcript ? "phone_transcript" : "manual_memo",
    aiModel: "mock-openai-summary",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  consultationSummaryJobs = [job, ...consultationSummaryJobs];

  if (/fail|실패/i.test(sourceText)) {
    job.status = "failed";
    job.errorMessage = "OpenAI summary mock failed for retry-path validation.";
    job.updatedAt = nowIso();
    throw new Error("AI 요약 생성에 실패했습니다. 상담 메모를 확인한 뒤 다시 시도하세요.");
  }

  const customerName = getCustomerName(booking.customerId);
  const concernText = booking.selectedConcernTags.join(", ") || booking.type;
  const summary: ConsultationSummary = {
    id: `summary-${Date.now()}`,
    bookingId: booking.id,
    expertId: booking.expertId,
    customerId: booking.customerId,
    createdAt: nowIso(),
    source: "phone_ai",
    aiStatus: "succeeded",
    aiModel: job.aiModel,
    transcript,
    internalMemo: internalMemo || `${customerName} 고객 상담 transcript 기반 AI 초안입니다. 원문 확인 후 필요한 운영 메모를 보강하세요.`,
    customerSummary: `${customerName} 고객의 ${concernText} 상담 내용을 바탕으로 현재 고민, 전문가 판단, 적용 우선순위를 정리했습니다.`,
    recommendations: "오늘 바로 적용할 수 있는 1순위 액션을 먼저 안내하고, 다음 상담에서는 앱 리포트 변화와 실제 적용 사진을 함께 확인하세요.",
    visibleToCustomer: input.visibleToCustomer ?? true,
    deliveredReportIds: [],
    reviewRequestStatus: "ready",
  };

  job.status = "succeeded";
  job.updatedAt = summary.createdAt;
  consultationSummaries = [...consultationSummaries.filter((item) => item.bookingId !== booking.id), summary];
  booking.consultationSummaryId = summary.id;
  return clone({ job, summary });
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

export async function getBusinessProfile(user?: AuthUser): Promise<BusinessProfile> {
  await delay();
  const business = businessProfiles.find((item) => item.id === user?.businessId) ?? businessProfiles[0];
  return clone(business);
}

export async function updateBusinessProfile(patch: Partial<BusinessProfile>, user?: AuthUser): Promise<BusinessProfile> {
  await delay();
  const index = businessProfiles.findIndex((item) => item.id === user?.businessId);
  const targetIndex = index >= 0 ? index : 0;
  businessProfiles[targetIndex] = { ...businessProfiles[targetIndex], ...patch };
  return clone(businessProfiles[targetIndex]);
}

export async function getExperts(user?: AuthUser): Promise<Expert[]> {
  await delay();
  const result = canAccessAllData(user)
    ? experts
    : user?.workspaceScope === "expert_personal" && user.expertId
    ? experts.filter((expert) => expert.id === user.expertId)
    : experts.filter((expert) => expert.businessId === user?.businessId);
  return clone(result);
}

export async function updateExpertProfile(expertId: string, patch: Partial<Expert>, user?: AuthUser): Promise<Expert> {
  await delay();
  const expert = experts.find((item) => item.id === expertId);
  if (!expert) throw new Error("전문가를 찾을 수 없습니다.");
  if (!canAccessAllData(user) && expert.businessId !== user?.businessId) {
    throw new Error("현재 워크스페이스의 전문가만 수정할 수 있습니다.");
  }
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

export async function uploadBusinessVerificationMock(fileName: string, user?: AuthUser): Promise<BusinessProfile> {
  await delay(260);
  const businessIndex = businessProfiles.findIndex((item) => item.id === user?.businessId);
  const targetIndex = businessIndex >= 0 ? businessIndex : 0;
  const business = businessProfiles[targetIndex];
  const attachment: Attachment = {
    id: `att-business-verification-${Date.now()}`,
    ownerId: business.id,
    type: "credential",
    name: fileName,
    url: "https://images.unsplash.com/photo-1554224154-26032fced8bd?auto=format&fit=crop&w=900&q=80",
    uploadedAt: nowIso(),
  };
  attachments = [...attachments, attachment];
  businessProfiles[targetIndex] = {
    ...business,
    verificationStatus: "submitted",
    verificationDocuments: [...business.verificationDocuments, attachment],
  };
  return clone(businessProfiles[targetIndex]);
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
  if (canAccessAllData(user)) {
    return source;
  }
  if (user?.workspaceScope === "expert_personal" && user.expertId) {
    return source.filter((booking) => booking.businessId === user.businessId && booking.expertId === user.expertId);
  }
  return source.filter((booking) => booking.businessId === user?.businessId);
}

function applyChatUserScope(source: ChatThread[], user?: AuthUser) {
  if (canAccessAllData(user)) {
    return source;
  }
  if (user?.workspaceScope === "expert_personal" && user.expertId) {
    return source.filter((thread) => thread.assignedExpertId === user.expertId);
  }
  return source.filter((thread) => {
    const expert = experts.find((item) => item.id === thread.assignedExpertId);
    return expert?.businessId === user?.businessId;
  });
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
    sharedReports: sharedReports.filter((report) => report.customerId === thread.customerId && (!report.bookingId || report.bookingId === thread.bookingId)),
    messages: chatMessages.filter((message) => message.threadId === thread.id).sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
  };
}

function findBooking(bookingId: string, user?: AuthUser) {
  const booking = bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error("예약을 찾을 수 없습니다.");
  if (!canAccessAllData(user) && !applyUserScope([booking], user).some((item) => item.id === booking.id)) {
    throw new Error("현재 워크스페이스에서 접근할 수 없는 예약입니다.");
  }
  return booking;
}

function findCustomer(customerId: string) {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) throw new Error("고객을 찾을 수 없습니다.");
  return customer;
}

function findThread(threadId: string, user?: AuthUser) {
  const thread = chatThreads.find((item) => item.id === threadId);
  if (!thread) throw new Error("대화방을 찾을 수 없습니다.");
  if (!canAccessAllData(user) && !applyChatUserScope([thread], user).some((item) => item.id === thread.id)) {
    throw new Error("현재 워크스페이스에서 접근할 수 없는 대화방입니다.");
  }
  return thread;
}

function findPartnerApplication(applicationId: string) {
  const application = partnerApplications.find((item) => item.id === applicationId);
  if (!application) throw new Error("입점 신청을 찾을 수 없습니다.");
  return application;
}

function ensureApplicationReviewable(application: PartnerApplication) {
  if (application.status === "approved" || application.status === "rejected") {
    throw new Error("이미 최종 처리된 입점 신청은 변경할 수 없습니다.");
  }
}

function ensureReviewMemo(reviewMemo: string) {
  if (!reviewMemo.trim()) {
    throw new Error("보완 요청 또는 반려에는 관리자 검토 메모가 필요합니다.");
  }
}

function findPartnerApplicationDocument(documentId: string) {
  const document = partnerApplications.flatMap((application) => application.documents).find((item) => item.id === documentId);
  if (!document) throw new Error("제출 서류를 찾을 수 없습니다.");
  return document;
}

function createApplicationDocuments(applicationId: string, input: PartnerApplicationInput): PartnerApplicationDocument[] {
  const entries: Array<{ type: PartnerApplicationDocumentType; fileName?: string; index?: number }> = [
    { type: "business_registration", fileName: input.businessRegistrationFileName },
    { type: "beauty_license", fileName: input.beautyLicenseFileName },
    ...(input.additionalCertificateFileNames ?? []).map((fileName, index) => ({
      type: "additional_certificate" as const,
      fileName,
      index,
    })),
  ];

  return entries
    .filter((entry) => entry.fileName)
    .map((entry, index) => ({
      id: `app-doc-${Date.now()}-${index}`,
      applicationId,
      type: entry.type,
      fileName: entry.fileName!,
      mimeType: "application/pdf" as const,
      sizeLabel: `${Math.max(420, entry.fileName!.length * 28)}KB`,
      storageKey: `${entry.type === "business_registration" ? "business-verifications" : "credentials"}/${applicationId}/${entry.type}-${entry.index ?? 0}.pdf`,
      uploadedAt: nowIso(),
      reviewStatus: "pending" as const,
    }));
}

function addApplicationReviewLog(
  applicationId: string,
  actorName: string,
  action: ApplicationReviewLog["action"],
  memo: string,
) {
  applicationReviewLogs = [
    {
      id: `log-${Date.now()}-${applicationReviewLogs.length}`,
      applicationId,
      actorName,
      action,
      memo,
      createdAt: nowIso(),
    },
    ...applicationReviewLogs,
  ];
}

function ensureBusinessFromApplication(application: PartnerApplication, businessId: string) {
  const existingBusiness = businessProfiles.find((business) => business.id === businessId);
  if (existingBusiness) return existingBusiness;

  const verificationDocuments: Attachment[] = application.documents.map((document) => ({
    id: `att-${document.id}`,
    ownerId: businessId,
    type: "credential",
    name: document.fileName,
    url: `mock-presigned-url://${document.storageKey}`,
    uploadedAt: document.uploadedAt,
  }));
  attachments = [...attachments, ...verificationDocuments];

  const business: BusinessProfile = {
    id: businessId,
    partnerType: application.partnerType,
    name: application.businessName,
    ownerName: application.ownerName,
    businessRegistrationNumber: application.businessRegistrationNumber,
    phone: application.phone,
    address: "승인 후 업체가 워크스페이스에서 입력 예정",
    description: application.introduction,
    photos: [],
    exposureStatus: "pending_review",
    verificationStatus: "approved",
    verificationDocuments,
    settlementAccountStatus: "not_submitted",
    defaultOperatingHours: managerSettings.operatingHours,
    cancellationPolicy: "예약 시작 24시간 전까지 무료 취소 가능하며, 이후 취소는 파트너 확인 후 처리됩니다.",
    refundPolicy: "상담 미진행 또는 플랫폼 귀책 시 전액 환불됩니다.",
  };

  businessProfiles = [business, ...businessProfiles];
  return business;
}

function ensureExpertFromApplication(application: PartnerApplication, businessId: string) {
  const existingExpert = experts.find((expert) => expert.businessId === businessId && expert.email === application.email);
  if (existingExpert) return existingExpert;

  const expert: Expert = {
    id: `exp-${Date.now()}`,
    businessId,
    name: application.ownerName,
    roleLabel: application.partnerType === "freelancer" ? "프리랜서 뷰티 전문가" : "대표 전문가",
    tagline: application.specialties[0] ? `${application.specialties[0]} 상담 전문가` : "AURA 승인 파트너 전문가",
    email: application.email,
    phone: application.phone,
    avatarUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80",
    specialties: application.specialties,
    categories: application.categories,
    introduction: application.introduction,
    yearsOfExperience: 0,
    credentials: [],
    price30Min: application.price30Min,
    price60Min: application.price60Min,
    exposureStatus: "pending_review",
    rating: 0,
    reviewCount: 0,
    consultationCount: 0,
    rebookingRate: 0,
    responseWithinMinutes: 60,
  };

  experts = [expert, ...experts];
  return expert;
}

function ensureBusinessMemberFromAccount(account: PartnerAccount, expertId: string, timestamp: string) {
  const existingMember = partnerBusinessMembers.find((member) => member.businessId === account.businessId && member.accountId === account.id);
  const role: PartnerBusinessMember["role"] = account.workspaceScope === "expert_personal" ? "expert" : "owner";
  const scopedExpertId = account.workspaceScope === "expert_personal" ? account.expertId ?? expertId : undefined;

  if (existingMember) {
    Object.assign(existingMember, {
      expertId: scopedExpertId,
      role,
      workspaceScope: account.workspaceScope,
      status: "active" as const,
      updatedAt: timestamp,
    });
    return existingMember;
  }

  const member: PartnerBusinessMember = {
    id: `member-${Date.now()}`,
    businessId: account.businessId,
    accountId: account.id,
    expertId: scopedExpertId,
    role,
    workspaceScope: account.workspaceScope,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  partnerBusinessMembers = [member, ...partnerBusinessMembers];
  return member;
}

function createTemporaryPassword(seed: string) {
  const compactSeed = seed.replace(/[^A-Za-z0-9가-힣]/g, "").slice(0, 4) || "Aura";
  return `${compactSeed}!${String(Date.now()).slice(-6)}`;
}

function isAdminUser(user?: AuthUser) {
  return user?.role === "admin" || user?.role === "operator";
}

function canAccessAllData(user?: AuthUser) {
  return !user || isAdminUser(user);
}

function canAccessCustomer(customerId: string, user?: AuthUser) {
  if (canAccessAllData(user)) return true;
  return applyUserScope(bookings, user).some((booking) => booking.customerId === customerId);
}
