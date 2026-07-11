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
  OperatingHours,
  ManagerSettings,
  RefundRequest,
  Review,
  ReviewFilters,
  SharedReport,
  UserRole,
  WorkspaceScope,
  PartnerType,
  ConsultingMode,
  ConsultingCaptionTranslation,
  ConsultingCallJoinResult,
  ConsultingCallLanguageCode,
  ConsultingCallState,
  ConsultingCallTranscription,
  ConsultingCallTranscriptionMode,
  ConsultingCallTranscriptionStatus,
} from "../types/domain";

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
const todayDate = () => dateKey(nowIso());

const PARTNER_SESSION_TOKEN_KEY = "consultant-web-partner-session-token";

type PartnerApiEnvelope<T> = {
  data: T | null;
  error?: {
    message?: string;
  } | null;
};

export interface SharedReportDetail {
  report: SharedReport;
  kind: "analysis" | "feedback";
  detail: Record<string, unknown>;
}

function getPartnerApiBaseUrl() {
  const explicit = import.meta.env.VITE_PARTNER_API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    return "/api/consulting/partner";
  }

  const raw = import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? `${trimmed}/consulting/partner` : `${trimmed}/api/consulting/partner`;
}

function getAdminApiBaseUrl() {
  const explicit = import.meta.env.VITE_ADMIN_API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    return "/api/admin";
  }

  const raw = import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? `${trimmed}/admin` : `${trimmed}/api/admin`;
}

function getPartnerApplicationsApiBaseUrl() {
  const explicit = import.meta.env.VITE_PARTNER_APPLICATIONS_API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    return "/api/partner-applications";
  }

  const raw = import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? `${trimmed}/partner-applications` : `${trimmed}/api/partner-applications`;
}

function shouldUseAdminApi() {
  return true;
}

export function getPartnerSessionToken() {
  return window.localStorage.getItem(PARTNER_SESSION_TOKEN_KEY);
}

function setPartnerSessionToken(token: string) {
  window.localStorage.setItem(PARTNER_SESSION_TOKEN_KEY, token);
}

export function clearPartnerSession() {
  window.localStorage.removeItem(PARTNER_SESSION_TOKEN_KEY);
}

function shouldUsePartnerApi(user?: AuthUser) {
  return Boolean(user && !isAdminUser(user) && getPartnerSessionToken());
}

function buildPartnerPath(path: string, params: object = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const queryString = query.toString();
  return queryString ? `${normalizedPath}?${queryString}` : normalizedPath;
}

async function requestPartnerJson<T>(
  path: string,
  init: RequestInit = {},
  options: { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const needsAuth = options.auth !== false;
  const token = getPartnerSessionToken();
  if (needsAuth) {
    if (!token) {
      throw new Error("파트너 세션이 없습니다. 다시 로그인해 주세요.");
    }
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${getPartnerApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });
  const envelope = (await response.json().catch(() => null)) as PartnerApiEnvelope<T> | null;
  if (!response.ok || envelope?.error) {
    const payload = envelope as (PartnerApiEnvelope<T> & { detail?: string }) | null;
    throw new Error(payload?.error?.message || payload?.detail || "파트너 백엔드 요청에 실패했습니다.");
  }
  if (!envelope || envelope.data === null) {
    throw new Error("파트너 백엔드 응답이 비어 있습니다.");
  }
  return envelope.data;
}

async function requestAdminJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Admin-Id", "admin-web");
  headers.set("X-Aura-Role", "admin");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${getAdminApiBaseUrl()}${path}`, { ...init, headers });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload) || "관리자 백엔드 요청에 실패했습니다.");
  }
  return unwrapApiEnvelope<T>(payload);
}

async function requestPartnerApplicationJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${getPartnerApplicationsApiBaseUrl()}${path}`, { ...init, headers });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload) || "입점 신청 요청에 실패했습니다.");
  }
  return unwrapApiEnvelope<T>(payload);
}

function unwrapApiEnvelope<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    const envelope = payload as PartnerApiEnvelope<T>;
    if (envelope.error) {
      throw new Error(envelope.error.message || "백엔드 요청에 실패했습니다.");
    }
    return envelope.data as T;
  }
  return payload as T;
}

function getApiErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  const error = record.error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
    return (error as Record<string, string>).message;
  }
  return "";
}

function toCamelDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCamelDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [snakeToCamel(key), toCamelDeep(item)]),
  );
}

function toSnakeDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toSnakeDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [camelToSnake(key), toSnakeDeep(item)]),
  );
}

function snakeToCamel(key: string) {
  return key.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

function camelToSnake(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Za-z])([0-9])/g, "$1_$2")
    .replace(/([0-9])([A-Za-z])/g, "$1_$2")
    .toLowerCase();
}

function normalizeConsultingModes(modes: ConsultingMode[] | undefined) {
  const normalized = Array.from(new Set((modes ?? []).filter((mode) => mode === "online" || mode === "offline")));
  return normalized.length ? normalized : (["online"] as ConsultingMode[]);
}

function upsertById<T extends { id: string }>(source: T[], records: T[]) {
  const byId = new Map(source.map((item) => [item.id, item] as const));
  for (const record of records) {
    byId.set(record.id, record);
  }
  return Array.from(byId.values());
}

const customerNameLookup = new Map<string, string>();
const expertNameLookup = new Map<string, string>();

function rememberBookings(records: Booking[]) {
  records.forEach((record) => {
    const customerName = (record as Booking & { customerName?: string }).customerName;
    const expertName = (record as Booking & { expertName?: string }).expertName;
    if (customerName) customerNameLookup.set(record.customerId, customerName);
    if (expertName) expertNameLookup.set(record.expertId, expertName);
  });
  bookings = upsertById(bookings, records);
}

function rememberCustomers(records: Customer[]) {
  customers = upsertById(customers, records);
}

function rememberExperts(records: Expert[]) {
  experts = upsertById(experts, records);
}

function rememberSharedReports(records: SharedReport[]) {
  sharedReports = upsertById(sharedReports, records);
}

function rememberConsultationSummaries(records: ConsultationSummary[]) {
  consultationSummaries = upsertById(consultationSummaries, records);
}

function rememberBookingDetail(detail: BookingDetail) {
  rememberBookings([detail.booking]);
  rememberCustomers([detail.customer]);
  rememberExperts([detail.expert]);
  rememberSharedReports(detail.sharedReports);
  if (detail.consultationSummary) {
    rememberConsultationSummaries([detail.consultationSummary]);
  }
  if (detail.review) {
    reviews = upsertById(reviews, [detail.review]);
  }
}

function rememberCustomerDetail(detail: CustomerDetail) {
  rememberCustomers([detail.customer]);
  rememberBookings(detail.bookings);
  rememberSharedReports(detail.sharedReports);
  consultationSummaries = upsertById(consultationSummaries, detail.consultationSummaries);
  reviews = upsertById(reviews, detail.reviews);
}

function rememberChatDetail(detail: ChatThreadDetail) {
  chatThreads = upsertById(chatThreads, [detail.thread]);
  rememberCustomers([detail.customer]);
  rememberExperts([detail.expert]);
  if (detail.booking) {
    rememberBookings([detail.booking]);
  }
  rememberSharedReports(detail.sharedReports);
  chatMessages = [
    ...chatMessages.filter((message) => message.threadId !== detail.thread.id),
    ...detail.messages,
  ];
}

type PartnerUpload = {
  bucket: string;
  cacheControl?: string | null;
  cdnUrl?: string | null;
  expiresIn?: number;
  method?: string;
  objectKey: string;
  uploadUrl: string;
};

type PartnerMedia = {
  id: string;
  cdnUrl?: string | null;
  contentType?: string | null;
  createdAt?: string | null;
  originalFilename?: string | null;
  thumbnailCdnUrl?: string | null;
};

async function rememberPartnerWorkspaceLookups() {
  const [customersData, expertsData] = await Promise.all([
    requestPartnerJson<{ customers: Customer[] }>("/customers"),
    requestPartnerJson<{ experts: Expert[] }>("/experts"),
  ]);
  rememberCustomers(customersData.customers);
  rememberExperts(expertsData.experts);
}

const defaultOperatingHours: OperatingHours[] = [
  { dayOfWeek: 0, label: "월", opensAt: "10:00", closesAt: "19:00", isClosed: false },
  { dayOfWeek: 1, label: "화", opensAt: "10:00", closesAt: "19:00", isClosed: false },
  { dayOfWeek: 2, label: "수", opensAt: "10:00", closesAt: "19:00", isClosed: false },
  { dayOfWeek: 3, label: "목", opensAt: "10:00", closesAt: "19:00", isClosed: false },
  { dayOfWeek: 4, label: "금", opensAt: "10:00", closesAt: "19:00", isClosed: false },
  { dayOfWeek: 5, label: "토", opensAt: "10:00", closesAt: "17:00", isClosed: true },
  { dayOfWeek: 6, label: "일", opensAt: "10:00", closesAt: "17:00", isClosed: true },
];

let attachments: Attachment[] = [];
let availabilitySlots: AvailabilitySlot[] = [];
let bookings: Booking[] = [];
let businessProfiles: BusinessProfile[] = [];
let chatMessages: ChatMessage[] = [];
let chatThreads: ChatThread[] = [];
let consultationSummaryJobs: ConsultationSummaryJob[] = [];
let consultationSummaries: ConsultationSummary[] = [];
let customers: Customer[] = [];
let experts: Expert[] = [];
let applicationReviewLogs: ApplicationReviewLog[] = [];
let partnerAccounts: PartnerAccount[] = [];
let partnerBusinessMembers: PartnerBusinessMember[] = [];
let partnerApplications: PartnerApplication[] = [];
let refundRequests: RefundRequest[] = [];
let reviews: Review[] = [];
let managerSettings: ManagerSettings = {
  operatingHours: defaultOperatingHours,
  holidays: [],
  temporaryBookingBlocks: [],
  bookingOpenMonths: 1,
  notification: {
    bookingCreated: true,
    bookingReminder: true,
    unreadChatDigest: true,
    reviewCreated: true,
  },
  integrations: {
    phoneProvider: "none",
    chatProvider: "websocket",
    smsProvider: "none",
  },
  accountRoles: [],
};
let sharedReports: SharedReport[] = [];

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
  emailVerificationToken: string;
  specialties: string[];
  categories: string[];
  introduction: string;
  consultingModes: ConsultingMode[];
  price30Min: number;
  price60Min: number;
  onlinePrice30Min?: number;
  onlinePrice60Min?: number;
  offlinePrice30Min?: number;
  offlinePrice60Min?: number;
  offlineAddress?: string;
  offlineDetailAddress?: string;
  offlineLocationNote?: string;
  businessRegistrationFileName?: string;
  businessRegistrationStorageKey?: string;
  beautyLicenseFileName?: string;
  beautyLicenseStorageKey?: string;
  additionalCertificateFileNames?: string[];
  additionalCertificateStorageKeys?: string[];
}

export interface PartnerEmailVerificationRequested {
  expiresInMinutes: number;
  resendAfterSeconds: number;
}

export interface PartnerEmailVerificationResult {
  verificationToken: string;
  expiresInMinutes: number;
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

interface PartnerDocumentUploadResult {
  objectKey: string;
  uploadUrl: string;
  method: string;
  contentType: string;
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

export interface BookingSaveChangesInput {
  status?: BookingStatus;
  markPaymentPaid?: boolean;
  note?: string;
  cancelReason?: string;
  patch?: Partial<Pick<Booking, "startsAt" | "endsAt" | "durationMinutes" | "type" | "internalMemo" | "requestMemo">>;
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

export async function loginUser(request: LoginRequest): Promise<AuthUser> {
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

  const partnerLogin = await requestPartnerJson<{ token: string; user: AuthUser }>(
    "/login",
    {
      method: "POST",
      body: JSON.stringify({
        email,
        password: request.password ?? "",
      }),
    },
    { auth: false },
  );
  setPartnerSessionToken(partnerLogin.token);
  return partnerLogin.user;

}

export async function completePartnerPasswordChange(accountId: string, nextPassword: string): Promise<void> {
  const normalizedPassword = nextPassword.trim();
  if (normalizedPassword.length < 8) {
    throw new Error("새 비밀번호는 8자 이상이어야 합니다.");
  }
  const result = await requestPartnerJson<{ account: { accountId: string; status: string; passwordChangeRequired: boolean } }>(
    "/me/password",
    {
      method: "POST",
      body: JSON.stringify({ newPassword: normalizedPassword }),
    },
  );
  if (result.account.accountId !== accountId || result.account.passwordChangeRequired) {
    throw new Error("파트너 계정 비밀번호 변경 결과를 확인하지 못했습니다.");
  }
}

export async function submitPartnerApplication(input: PartnerApplicationInput): Promise<PartnerApplication> {
  const consultingModes = normalizeConsultingModes(input.consultingModes);
  const hasOnline = consultingModes.includes("online");
  const hasOffline = consultingModes.includes("offline");
  const price30Min = hasOnline ? input.onlinePrice30Min ?? input.price30Min : input.offlinePrice30Min ?? input.price30Min;
  const price60Min = hasOnline ? input.onlinePrice60Min ?? input.price60Min : input.offlinePrice60Min ?? input.price60Min;
  const payload: PartnerApplicationInput = {
    ...input,
    consultingModes,
    price30Min,
    price60Min,
    onlinePrice30Min: hasOnline ? input.onlinePrice30Min ?? price30Min : undefined,
    onlinePrice60Min: hasOnline ? input.onlinePrice60Min ?? price60Min : undefined,
    offlinePrice30Min: hasOffline ? input.offlinePrice30Min ?? price30Min : undefined,
    offlinePrice60Min: hasOffline ? input.offlinePrice60Min ?? price60Min : undefined,
    offlineAddress: hasOffline ? input.offlineAddress?.trim() : undefined,
    offlineDetailAddress: hasOffline ? input.offlineDetailAddress?.trim() : undefined,
    offlineLocationNote: hasOffline ? input.offlineLocationNote?.trim() : undefined,
  };
  const raw = await requestPartnerApplicationJson<unknown>("", {
    method: "POST",
    body: JSON.stringify(toSnakeDeep(payload)),
  });
  const application = toCamelDeep(raw) as PartnerApplication;
  partnerApplications = upsertById(partnerApplications, [application]);
  return clone(application);
}

export async function requestPartnerEmailVerification(email: string): Promise<PartnerEmailVerificationRequested> {
  const raw = await requestPartnerApplicationJson<unknown>("/email-verification/request", {
    method: "POST",
    body: JSON.stringify({ email: email.trim() }),
  });
  return toCamelDeep(raw) as PartnerEmailVerificationRequested;
}

export async function confirmPartnerEmailVerification(email: string, code: string): Promise<PartnerEmailVerificationResult> {
  const raw = await requestPartnerApplicationJson<unknown>("/email-verification/confirm", {
    method: "POST",
    body: JSON.stringify({ email: email.trim(), code: code.trim() }),
  });
  return toCamelDeep(raw) as PartnerEmailVerificationResult;
}

export async function uploadPartnerApplicationDocument(file: File, documentType: PartnerApplicationDocumentType): Promise<string> {
  const contentType = "application/pdf";
  const raw = await requestPartnerApplicationJson<unknown>("/documents/presigned-upload", {
    method: "POST",
    body: JSON.stringify({
      document_type: documentType,
      file_name: file.name,
      content_type: contentType,
      size_bytes: file.size,
    }),
  });
  const upload = toCamelDeep(raw) as PartnerDocumentUploadResult;
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: upload.method || "PUT",
    headers: { "Content-Type": upload.contentType || contentType },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`${file.name} 파일 업로드에 실패했습니다.`);
  }
  return upload.objectKey;
}

export async function getPartnerApplications(filters: PartnerApplicationFilters = {}): Promise<PartnerApplication[]> {
  const raw = await requestAdminJson<unknown>(buildPartnerPath("/partner-applications", filters));
  const records = toCamelDeep(raw) as PartnerApplication[];
  partnerApplications = upsertById(partnerApplications, records);
  return clone([...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export async function getPartnerApplicationDetail(applicationId: string): Promise<PartnerApplicationDetail> {
  const raw = await requestAdminJson<unknown>(`/partner-applications/${encodeURIComponent(applicationId)}`);
  const detail = toCamelDeep(raw) as PartnerApplicationDetail;
  partnerApplications = upsertById(partnerApplications, [detail.application]);
  if (detail.account) partnerAccounts = upsertById(partnerAccounts, [detail.account]);
  if (detail.member) partnerBusinessMembers = upsertById(partnerBusinessMembers, [detail.member]);
  applicationReviewLogs = upsertById(applicationReviewLogs, detail.reviewLogs);
  return clone(detail);
}

export async function updatePartnerApplicationStatus(
  applicationId: string,
  status: Exclude<PartnerApplicationStatus, "approved">,
  request: PartnerApplicationDecisionRequest,
): Promise<PartnerApplication> {
  const action = status === "needs_update" ? "needs-update" : "reject";
  const raw = await requestAdminJson<unknown>(
    `/partner-applications/${encodeURIComponent(applicationId)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify(toSnakeDeep(request)),
    },
  );
  const application = toCamelDeep(raw) as PartnerApplication;
  partnerApplications = upsertById(partnerApplications, [application]);
  return clone(application);
}

export async function approvePartnerApplication(
  applicationId: string,
  request: PartnerApplicationApprovalRequest,
): Promise<PartnerApplicationApprovalResult> {
  const raw = await requestAdminJson<unknown>(
    `/partner-applications/${encodeURIComponent(applicationId)}/approve`,
    {
      method: "POST",
      body: JSON.stringify(toSnakeDeep(request)),
    },
  );
  const result = toCamelDeep(raw) as PartnerApplicationApprovalResult;
  partnerApplications = upsertById(partnerApplications, [result.application]);
  partnerAccounts = upsertById(partnerAccounts, [result.account]);
  partnerBusinessMembers = upsertById(partnerBusinessMembers, [result.member]);
  return clone(result);
}

export async function reissuePartnerApplicationCredentials(
  applicationId: string,
): Promise<PartnerApplicationApprovalResult> {
  const raw = await requestAdminJson<unknown>(
    `/partner-applications/${encodeURIComponent(applicationId)}/reissue-credentials`,
    { method: "POST" },
  );
  const result = toCamelDeep(raw) as PartnerApplicationApprovalResult;
  partnerApplications = upsertById(partnerApplications, [result.application]);
  partnerAccounts = upsertById(partnerAccounts, [result.account]);
  partnerBusinessMembers = upsertById(partnerBusinessMembers, [result.member]);
  return clone(result);
}

export async function preparePartnerApplicationDocumentAccess(documentId: string): Promise<PartnerDocumentAccessResult> {
  const raw = await requestAdminJson<unknown>(
    `/partner-applications/documents/${encodeURIComponent(documentId)}/access`,
    { method: "POST" },
  );
  return clone(toCamelDeep(raw) as PartnerDocumentAccessResult);
}

export async function getAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  const raw = await requestAdminJson<unknown>("/dashboard");
  const summary = normalizeAdminDashboardSummary(toCamelDeep(raw) as Partial<AdminDashboardSummary>);
  rememberBookings(summary.todayBookings);
  consultationSummaryJobs = upsertById(consultationSummaryJobs, summary.summaryJobs);
  partnerApplications = upsertById(partnerApplications, summary.recentApplications);
  return clone(summary);
}

export async function getAdminBusinesses(): Promise<BusinessProfile[]> {
  const raw = await requestAdminJson<unknown>("/businesses");
  const records = toCamelDeep(raw) as BusinessProfile[];
  businessProfiles = upsertById(businessProfiles, records);
  return clone(records);
}

export async function getAdminExperts(): Promise<Expert[]> {
  const raw = await requestAdminJson<unknown>("/experts");
  const records = toCamelDeep(raw) as Expert[];
  experts = upsertById(experts, records);
  return clone(records);
}

export async function getAdminBookings(filters: BookingFilters = {}): Promise<Booking[]> {
  const raw = await requestAdminJson<unknown>(buildPartnerPath("/bookings", filters));
  const records = toCamelDeep(raw) as Booking[];
  rememberBookings(records);
  return clone(filterBookings(records, filters));
}

export async function getDashboardSummary(user?: AuthUser): Promise<DashboardSummary> {
  if (shouldUsePartnerApi(user)) {
    const [data] = await Promise.all([
      requestPartnerJson<{ summary: DashboardSummary }>("/dashboard"),
      rememberPartnerWorkspaceLookups(),
    ]);
    rememberBookings(data.summary.todayTimeline);
    return clone(data.summary);
  }
  await delay();
  const scopedBookings = applyUserScope(bookings, user);
  const scopedBusiness = businessProfiles.find((business) => business.id === user?.businessId) ?? businessProfiles[0];
  const today = todayDate();
  const todayBookings = scopedBookings.filter((booking) => dateKey(booking.startsAt) === today);
  const upcoming = scopedBookings.filter((booking) => ["requested", "contacting", "confirmed", "scheduled", "in_progress"].includes(booking.status));
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
  if (shouldUsePartnerApi(user)) {
    const [data] = await Promise.all([
      requestPartnerJson<{ bookings: Booking[] }>(buildPartnerPath("/bookings", filters)),
      rememberPartnerWorkspaceLookups(),
    ]);
    rememberBookings(data.bookings);
    return clone(data.bookings);
  }
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
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ detail: BookingDetail }>(`/bookings/${encodeURIComponent(bookingId)}`);
    rememberBookingDetail(data.detail);
    return clone(data.detail);
  }
  await delay();
  const booking = findBooking(bookingId, user);
  return clone(makeBookingDetail(booking));
}

export async function saveBookingChanges(bookingId: string, changes: BookingSaveChangesInput, user?: AuthUser): Promise<Booking> {
  if (shouldUsePartnerApi(user)) {
    const changedKeys = Object.entries(changes).filter(([, value]) => {
      if (value === undefined || value === null || value === "") return false;
      if (typeof value === "object" && !Array.isArray(value)) return Object.keys(value).length > 0;
      return true;
    }).map(([key]) => key);

    // Status and manual-deposit actions have dedicated POST/PATCH endpoints.
    // Keeping these calls separate avoids proxies/CDNs that reject the generic
    // booking PATCH while preserving the atomic generic PATCH for edits + notes.
    if (changedKeys.length === 1 && changedKeys[0] === "status" && changes.status) {
      const data = await requestPartnerJson<{ booking: Booking }>(
        `/bookings/${encodeURIComponent(bookingId)}/status`,
        {
          method: "POST",
          body: JSON.stringify({ status: changes.status }),
        },
      );
      rememberBookings([data.booking]);
      return clone(data.booking);
    }

    if (changedKeys.length === 1 && changedKeys[0] === "markPaymentPaid" && changes.markPaymentPaid) {
      const data = await requestPartnerJson<{ booking: Booking }>(
        `/bookings/${encodeURIComponent(bookingId)}/payment`,
        { method: "POST" },
      );
      rememberBookings([data.booking]);
      return clone(data.booking);
    }

    const data = await requestPartnerJson<{ booking: Booking }>(
      `/bookings/${encodeURIComponent(bookingId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(toSnakeDeep(changes)),
      },
    );
    rememberBookings([data.booking]);
    return clone(data.booking);
  }

  await delay();
  const booking = findBooking(bookingId, user);
  const effectivePaymentStatus = changes.markPaymentPaid ? "paid" : booking.paymentStatus;
  if (changes.status && ["confirmed", "scheduled", "in_progress"].includes(changes.status) && effectivePaymentStatus !== "paid") {
    throw new Error("선결제 또는 예약금 입금 확인 후 전문가가 예약을 확정할 수 있습니다.");
  }

  if (changes.patch) {
    Object.assign(booking, changes.patch);
  }
  if (changes.markPaymentPaid) {
    booking.paymentStatus = "paid";
    if (booking.paidAmount <= 0) {
      const expert = experts.find((item) => item.id === booking.expertId);
      booking.paidAmount = booking.durationMinutes === 30 ? expert?.price30Min ?? 0 : expert?.price60Min ?? 0;
    }
    if (!changes.status && booking.status === "requested") {
      booking.status = "contacting";
    }
    booking.internalMemo = [
      booking.internalMemo,
      "선결제/예약금 입금 확인. 전문가 확정 대기 상태로 전환했습니다.",
    ].filter(Boolean).join("\n");
  }
  if (changes.status) {
    booking.status = changes.status;
  }
  if (changes.cancelReason) {
    booking.internalMemo = [booking.internalMemo, `취소 사유: ${changes.cancelReason}`].filter(Boolean).join("\n");
  }
  if (changes.note) {
    booking.internalMemo = [booking.internalMemo, changes.note].filter(Boolean).join("\n");
  }
  if (booking.status === "completed") {
    booking.reviewRequestStatus = "ready";
  }
  if (booking.status === "cancelled" || booking.status === "no_show") {
    booking.reviewRequestStatus = "not_ready";
  }
  return clone(booking);
}

export async function updateBookingStatus(bookingId: string, status: BookingStatus, user?: AuthUser): Promise<Booking> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ booking: Booking }>(
      `/bookings/${encodeURIComponent(bookingId)}/status`,
      {
        method: "POST",
        body: JSON.stringify({ status }),
      },
    );
    rememberBookings([data.booking]);
    return clone(data.booking);
  }
  await delay();
  const booking = findBooking(bookingId, user);
  if (["confirmed", "scheduled", "in_progress"].includes(status) && booking.paymentStatus !== "paid") {
    throw new Error("선결제 또는 예약금 입금 확인 후 전문가가 예약을 확정할 수 있습니다.");
  }
  booking.status = status;
  if (status === "completed") {
    booking.reviewRequestStatus = "ready";
  }
  if (status === "cancelled" || status === "no_show") {
    booking.reviewRequestStatus = "not_ready";
  }
  return clone(booking);
}

export async function markBookingDepositPaid(bookingId: string, user?: AuthUser): Promise<Booking> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ booking: Booking }>(
      `/bookings/${encodeURIComponent(bookingId)}/payment`,
      { method: "POST" },
    );
    rememberBookings([data.booking]);
    return clone(data.booking);
  }
  await delay(180);
  const booking = findBooking(bookingId, user);
  booking.paymentStatus = "paid";
  if (booking.paidAmount <= 0) {
    const expert = experts.find((item) => item.id === booking.expertId);
    booking.paidAmount = booking.durationMinutes === 30 ? expert?.price30Min ?? 0 : expert?.price60Min ?? 0;
  }
  if (booking.status === "requested") {
    booking.status = "contacting";
  }
  booking.internalMemo = [
    booking.internalMemo,
    "선결제/예약금 입금 확인. 전문가 확정 대기 상태로 전환했습니다.",
  ].filter(Boolean).join("\n");
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
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ customers: Customer[] }>(buildPartnerPath("/customers", filters));
    rememberCustomers(data.customers);
    return clone(data.customers);
  }
  await delay();
  const bookingCustomerIds = new Set(applyUserScope(bookings, user).map((booking) => booking.customerId));
  let result = canAccessAllData(user)
    ? customers
    : customers.filter((customer) => bookingCustomerIds.has(customer.id));
  const scopedBookings = applyUserScope(bookings, user);
  result = result.map((customer) => {
    const latestBooking = scopedBookings
      .filter((booking) => booking.customerId === customer.id)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
    return { ...customer, latestBookingStatus: latestBooking?.status };
  });
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
  if (filters.status && filters.status !== "all") {
    result = result.filter((customer) => customer.latestBookingStatus === filters.status);
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
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ detail: CustomerDetail }>(`/customers/${encodeURIComponent(customerId)}`);
    rememberCustomerDetail(data.detail);
    return clone(data.detail);
  }
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
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ threads: ChatThreadDetail[] }>("/chat/threads");
    data.threads.forEach(rememberChatDetail);
    return clone(data.threads);
  }
  await delay();
  return clone(applyChatUserScope(chatThreads, user).map(makeChatThreadDetail));
}

export async function getChatThreadDetail(threadId: string, user?: AuthUser): Promise<ChatThreadDetail> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ detail: ChatThreadDetail }>(`/chat/threads/${encodeURIComponent(threadId)}`);
    rememberChatDetail(data.detail);
    return clone(data.detail);
  }
  await delay();
  const thread = findThread(threadId, user);
  thread.unreadCount = 0;
  return clone(makeChatThreadDetail(thread));
}

export async function markChatThreadRead(threadId: string, user?: AuthUser): Promise<ChatThreadDetail> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ detail: ChatThreadDetail }>(
      `/chat/threads/${encodeURIComponent(threadId)}/read`,
      { method: "POST" },
    );
    rememberChatDetail(data.detail);
    return clone(data.detail);
  }
  await delay(120);
  const thread = findThread(threadId, user);
  thread.unreadCount = 0;
  thread.status = "open";
  return clone(makeChatThreadDetail(thread));
}

export async function uploadChatAttachment(file: File, user?: AuthUser): Promise<Attachment> {
  if (shouldUsePartnerApi(user)) {
    const contentType = file.type || "application/octet-stream";
    const { upload } = await requestPartnerJson<{ upload: PartnerUpload }>(
      "/media/presigned-upload",
      {
        method: "POST",
        body: JSON.stringify({
          byteSize: file.size,
          contentType,
          mediaKind: "consulting-chat",
          originalFilename: file.name || "chat-image",
          source: "gallery",
        }),
      },
    );

    const uploadResponse = await fetch(upload.uploadUrl, {
      method: upload.method || "PUT",
      headers: {
        "Content-Type": contentType,
        ...(upload.cacheControl ? { "Cache-Control": upload.cacheControl } : {}),
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error("사진 업로드에 실패했습니다.");
    }

    const { media } = await requestPartnerJson<{ media: PartnerMedia }>(
      "/media/complete-upload",
      {
        method: "POST",
        body: JSON.stringify({
          bucket: upload.bucket,
          byteSize: file.size,
          cdnUrl: upload.cdnUrl ?? null,
          contentType,
          mediaKind: "consulting-chat",
          objectKey: upload.objectKey,
          originalFilename: file.name || "chat-image",
          source: "gallery",
        }),
      },
    );

    return {
      id: media.id,
      ownerId: user?.id ?? "partner",
      type: "image",
      name: media.originalFilename || file.name || "chat-image",
      url: media.thumbnailCdnUrl || media.cdnUrl || upload.cdnUrl || "",
      uploadedAt: media.createdAt || nowIso(),
    };
  }

  await delay(180);
  const attachment: Attachment = {
    id: `att-chat-${Date.now()}`,
    ownerId: user?.id ?? "partner",
    type: "image",
    name: file.name || "chat-image",
    url: URL.createObjectURL(file),
    uploadedAt: nowIso(),
  };
  attachments = [...attachments, attachment];
  return clone(attachment);
}

export async function sendMessage(
  threadId: string,
  body: string,
  attachmentIds: string[] = [],
  user?: AuthUser,
  clientMessageId?: string,
): Promise<ChatMessage> {
  if (shouldUsePartnerApi(user)) {
    if (attachmentIds.length > 0) {
      throw new Error("사진 첨부는 실시간 연결이 복구된 뒤 전송해 주세요.");
    }
    const messageId = clientMessageId || `web-http-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const data = await requestPartnerJson<{
      message: {
        id: string;
        bookingId: string;
        body: string;
        senderName: string;
        senderType: "user" | "expert" | "operator" | "system";
        sentAt: string;
      };
    }>(`/chat/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, clientMessageId: messageId }),
    });
    const message: ChatMessage = {
      id: data.message.id,
      threadId,
      senderType: data.message.senderType === "user" ? "customer" : data.message.senderType,
      senderName: data.message.senderName,
      body: data.message.body,
      sentAt: data.message.sentAt,
      attachments: [],
    };
    return clone(message);
  }
  await delay();
  const thread = findThread(threadId, user);
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

function normalizeCallLanguageCode(value: unknown): ConsultingCallLanguageCode | null {
  return value === "ko-KR" || value === "en-US" ? value : null;
}

function normalizeCallTranscriptionStatus(value: unknown): ConsultingCallTranscriptionStatus {
  return value === "stopped" ||
    value === "starting" ||
    value === "active" ||
    value === "stopping" ||
    value === "failed"
    ? value
    : "disabled";
}

function normalizeCallTranscriptionMode(value: unknown): ConsultingCallTranscriptionMode {
  return value === "identify" ? "identify" : "fixed";
}

function normalizeCallTranscription(value: unknown): ConsultingCallTranscription {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: Boolean(raw.enabled),
    translationEnabled: Boolean(raw.translationEnabled),
    status: normalizeCallTranscriptionStatus(raw.status),
    mode: normalizeCallTranscriptionMode(raw.mode),
    languageCode: normalizeCallLanguageCode(raw.languageCode),
    customerLanguageCode: normalizeCallLanguageCode(raw.customerLanguageCode),
    expertLanguageCode: normalizeCallLanguageCode(raw.expertLanguageCode),
  };
}

function normalizeCallState(value: unknown, bookingId: string): ConsultingCallState {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawStatus = raw.status;
  return {
    callSessionId: raw.callSessionId ? String(raw.callSessionId) : null,
    bookingId: String(raw.bookingId ?? bookingId),
    provider: "chime",
    providerMeetingId: raw.providerMeetingId ? String(raw.providerMeetingId) : null,
    mediaRegion: raw.mediaRegion ? String(raw.mediaRegion) : null,
    status:
      rawStatus === "created" ||
      rawStatus === "active" ||
      rawStatus === "ended" ||
      rawStatus === "failed"
        ? rawStatus
        : "not_started",
    startedAt: raw.startedAt ? String(raw.startedAt) : null,
    endedAt: raw.endedAt ? String(raw.endedAt) : null,
    chimeEnabled: Boolean(raw.chimeEnabled),
    transcription: normalizeCallTranscription(raw.transcription),
  };
}

function normalizeCallJoinResult(value: unknown, bookingId: string): ConsultingCallJoinResult {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const participant = raw.participant && typeof raw.participant === "object"
    ? (raw.participant as Record<string, unknown>)
    : {};
  const supportedLanguageCodes = Array.isArray(raw.supportedLanguageCodes)
    ? raw.supportedLanguageCodes.map(normalizeCallLanguageCode).filter((value): value is ConsultingCallLanguageCode => Boolean(value))
    : [];
  const transcription = normalizeCallTranscription(raw.transcription);
  return {
    callSessionId: String(raw.callSessionId ?? ""),
    bookingId: String(raw.bookingId ?? bookingId),
    participantType: raw.participantType === "user" || raw.participantType === "expert" ? raw.participantType : undefined,
    participantLanguageCode: normalizeCallLanguageCode(raw.participantLanguageCode) ?? undefined,
    supportedLanguageCodes: supportedLanguageCodes.length ? supportedLanguageCodes : undefined,
    participant: {
      id: String(participant.id ?? ""),
      type: participant.type === "customer" ? "customer" : "partner",
      languageCode: normalizeCallLanguageCode(participant.languageCode) ?? "ko-KR",
    },
    meeting: raw.meeting && typeof raw.meeting === "object" ? (raw.meeting as Record<string, unknown>) : {},
    attendee: raw.attendee && typeof raw.attendee === "object" ? (raw.attendee as Record<string, unknown>) : {},
    transcription,
    transcriptionStatus: normalizeCallTranscriptionStatus(raw.transcriptionStatus ?? transcription.status),
    transcriptionMode: normalizeCallTranscriptionMode(raw.transcriptionMode ?? transcription.mode),
  };
}

function normalizeCaptionTranslation(value: unknown): ConsultingCaptionTranslation {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const sourceLanguageCode = normalizeCallLanguageCode(raw.sourceLanguageCode);
  const targetLanguageCode = raw.targetLanguageCode === "en" ? "en" : "ko";
  return {
    resultId: String(raw.resultId ?? ""),
    sourceLanguageCode: sourceLanguageCode ?? "ko-KR",
    targetLanguageCode,
    translatedContent: String(raw.translatedContent ?? ""),
  };
}

export async function getBookingCallState(bookingId: string, user?: AuthUser): Promise<ConsultingCallState> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ call: unknown }>(`/bookings/${encodeURIComponent(bookingId)}/call`);
    return normalizeCallState(data.call, bookingId);
  }
  await delay(120);
  findBooking(bookingId, user);
  return normalizeCallState({ bookingId, chimeEnabled: false, status: "not_started" }, bookingId);
}

export async function joinBookingCall(
  bookingId: string,
  languageCode: ConsultingCallLanguageCode = "ko-KR",
  user?: AuthUser,
): Promise<ConsultingCallJoinResult> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ call: unknown }>(
      `/bookings/${encodeURIComponent(bookingId)}/call/join`,
      {
        method: "POST",
        body: JSON.stringify({ languageCode }),
      },
    );
    return normalizeCallJoinResult(data.call, bookingId);
  }
  await delay(160);
  findBooking(bookingId, user);
  throw new Error("로컬 목업에서는 Chime 화상상담 입장을 지원하지 않습니다.");
}

export async function endBookingCall(bookingId: string, user?: AuthUser): Promise<ConsultingCallState> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ call: unknown }>(
      `/bookings/${encodeURIComponent(bookingId)}/call/end`,
      { method: "POST" },
    );
    return normalizeCallState(data.call, bookingId);
  }
  await delay(120);
  findBooking(bookingId, user);
  return normalizeCallState({ bookingId, chimeEnabled: false, status: "ended" }, bookingId);
}

export async function startBookingCallTranscription(
  bookingId: string,
  languageCode: ConsultingCallLanguageCode = "ko-KR",
  user?: AuthUser,
  transcriptionConsentAccepted = false,
): Promise<ConsultingCallState> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ call: unknown }>(
      `/bookings/${encodeURIComponent(bookingId)}/call/transcription/start`,
      {
        method: "POST",
        body: JSON.stringify({ languageCode, transcriptionConsentAccepted }),
      },
    );
    return normalizeCallState(data.call, bookingId);
  }
  if (!transcriptionConsentAccepted) {
    throw new Error("실시간 자막을 시작하려면 고객과 상담사의 음성 인식 동의 확인이 필요합니다.");
  }
  await delay(120);
  findBooking(bookingId, user);
  return normalizeCallState({ bookingId, chimeEnabled: false, status: "not_started" }, bookingId);
}

export async function stopBookingCallTranscription(bookingId: string, user?: AuthUser): Promise<ConsultingCallState> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ call: unknown }>(
      `/bookings/${encodeURIComponent(bookingId)}/call/transcription/stop`,
      { method: "POST" },
    );
    return normalizeCallState(data.call, bookingId);
  }
  await delay(120);
  findBooking(bookingId, user);
  return normalizeCallState({ bookingId, chimeEnabled: false, status: "not_started" }, bookingId);
}

export async function translateBookingCallCaption(
  bookingId: string,
  payload: {
    resultId: string;
    sourceLanguageCode: ConsultingCallLanguageCode;
    content: string;
  },
  user?: AuthUser,
): Promise<ConsultingCaptionTranslation> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ resultId?: string; sourceLanguageCode?: ConsultingCallLanguageCode; targetLanguageCode?: "ko" | "en"; translatedContent?: string }>(
      `/bookings/${encodeURIComponent(bookingId)}/call/captions/translate`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
    return normalizeCaptionTranslation(data);
  }
  await delay(120);
  findBooking(bookingId, user);
  return normalizeCaptionTranslation({
    resultId: payload.resultId,
    sourceLanguageCode: payload.sourceLanguageCode,
    targetLanguageCode: payload.sourceLanguageCode === "ko-KR" ? "en" : "ko",
    translatedContent: payload.content,
  });
}

export async function getSharedReports(customerId?: string, user?: AuthUser): Promise<SharedReport[]> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ reports: SharedReport[] }>(
      buildPartnerPath("/shared-reports", { customerId }),
    );
    rememberSharedReports(data.reports);
    return clone(data.reports);
  }
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

export async function getSharedReportDetail(reportId: string, user?: AuthUser): Promise<SharedReportDetail> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<SharedReportDetail>(`/reports/${encodeURIComponent(reportId)}`);
    rememberSharedReports([data.report]);
    return clone(data);
  }
  const report = sharedReports.find((item) => item.id === reportId);
  if (!report) {
    throw new Error("리포트를 찾을 수 없습니다.");
  }
  if (user && !canAccessCustomer(report.customerId, user)) {
    throw new Error("이 리포트를 조회할 수 없습니다.");
  }
  return clone(makeSharedReportDetail(report));
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
  if (canAccessAllData(user)) {
    const raw = await requestAdminJson<unknown>("/summary-jobs");
    const records = toCamelDeep(raw) as ConsultationSummaryJob[];
    consultationSummaryJobs = upsertById(consultationSummaryJobs, records);
    return clone([...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  await delay();
  const result = canAccessAllData(user)
    ? consultationSummaryJobs
    : consultationSummaryJobs.filter((job) => job.businessId === user?.businessId);
  return clone([...result].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export async function getConsultationSummaryForBooking(bookingId: string, user?: AuthUser): Promise<ConsultationSummary | undefined> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ summary: ConsultationSummary | null }>(`/summaries/${encodeURIComponent(bookingId)}`);
    if (data.summary) {
      rememberConsultationSummaries([data.summary]);
    }
    return clone(data.summary ?? undefined);
  }
  await delay();
  findBooking(bookingId, user);
  return clone(consultationSummaries.find((summary) => summary.bookingId === bookingId));
}

export async function createConsultationSummary(draft: CompletionDraft, user?: AuthUser): Promise<ConsultationSummary> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ summary: ConsultationSummary }>(
      `/summaries/${encodeURIComponent(draft.bookingId)}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          transcript: draft.transcript,
          expertComment: draft.internalMemo,
          customerSummary: draft.customerSummary,
          recommendations: draft.recommendations,
          visibleToCustomer: draft.visibleToCustomer,
          deliveredReportIds: draft.deliveredReportIds,
          sendReviewRequest: draft.sendReviewRequest,
        }),
      },
    );
    rememberConsultationSummaries([data.summary]);
    return clone(data.summary);
  }
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
    aiModel: draft.transcript?.trim() ? "phone-summary" : undefined,
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
  if (shouldUsePartnerApi(user)) {
    const transcript = input.transcript?.trim() ?? "";
    if (!transcript) {
      throw new Error("AI 요약 생성을 위해 화상상담 transcript가 필요합니다.");
    }
    const result = await requestPartnerJson<SummaryGenerateResult>(
      `/summaries/${encodeURIComponent(bookingId)}/generate`,
      {
        method: "POST",
        body: JSON.stringify({
          transcript,
          expertComment: input.internalMemo,
          visibleToCustomer: input.visibleToCustomer,
        }),
      },
    );
    return clone(result);
  }
  await delay(520);
  const booking = findBooking(bookingId, user);
  const transcript = input.transcript?.trim() ?? "";
  const internalMemo = input.internalMemo?.trim() ?? "";
  const sourceText = transcript;
  if (!sourceText) {
    throw new Error("AI 요약 생성을 위해 화상상담 transcript가 필요합니다.");
  }

  const job: ConsultationSummaryJob = {
    id: `summary-job-${Date.now()}`,
    bookingId: booking.id,
    businessId: booking.businessId,
    expertId: booking.expertId,
    requestedBy: user?.accountId ?? user?.id ?? "current-user",
    status: "processing",
    source: "phone_transcript",
    aiModel: "phone-summary",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  consultationSummaryJobs = [job, ...consultationSummaryJobs];

  if (/fail|실패/i.test(sourceText)) {
    job.status = "failed";
    job.errorMessage = "OpenAI summary generation failed for retry-path validation.";
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
    internalMemo,
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
  booking.status = "completed";
  booking.reviewRequestStatus = "ready";
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
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ business: BusinessProfile }>("/business-profile");
    businessProfiles = upsertById(businessProfiles, [data.business]);
    return clone(data.business);
  }
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
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ experts: Expert[] }>("/experts");
    rememberExperts(data.experts);
    return clone(data.experts);
  }
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

export async function getSettings(user?: AuthUser): Promise<ManagerSettings> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ settings: ManagerSettings }>("/settings");
    managerSettings = { ...managerSettings, ...data.settings };
    return clone(managerSettings);
  }
  await delay();
  return clone(managerSettings);
}

export async function updateSettings(patch: Partial<ManagerSettings>, user?: AuthUser): Promise<ManagerSettings> {
  if (shouldUsePartnerApi(user)) {
    const data = await requestPartnerJson<{ settings: ManagerSettings }>("/settings", {
      method: "PATCH",
      body: JSON.stringify(toSnakeDeep(patch)),
    });
    managerSettings = { ...managerSettings, ...data.settings };
    return clone(managerSettings);
  }
  await delay();
  managerSettings = { ...managerSettings, ...patch };
  return clone(managerSettings);
}

export function getCustomerName(customerId: string) {
  return customers.find((customer) => customer.id === customerId)?.name ?? customerNameLookup.get(customerId) ?? "알 수 없는 고객";
}

export function getExpertName(expertId: string) {
  return experts.find((expert) => expert.id === expertId)?.name ?? expertNameLookup.get(expertId) ?? "알 수 없는 전문가";
}

function normalizeAdminDashboardSummary(summary: Partial<AdminDashboardSummary>): AdminDashboardSummary {
  return {
    pendingApplicationCount: summary.pendingApplicationCount ?? 0,
    needsUpdateApplicationCount: summary.needsUpdateApplicationCount ?? 0,
    approvedBusinessCount: summary.approvedBusinessCount ?? 0,
    totalExpertCount: summary.totalExpertCount ?? 0,
    todayBookingCount: summary.todayBookingCount ?? 0,
    refundRequestCount: summary.refundRequestCount ?? 0,
    failedSummaryJobCount: summary.failedSummaryJobCount ?? 0,
    hiddenOrReportedReviewCount: summary.hiddenOrReportedReviewCount ?? 0,
    recentApplications: summary.recentApplications ?? [],
    todayBookings: summary.todayBookings ?? [],
    summaryJobs: summary.summaryJobs ?? [],
  };
}

function filterBookings(source: Booking[], filters: BookingFilters = {}) {
  let result = source;
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
  return [...result].sort((a, b) => {
    if (sort === "startsAtDesc") return b.startsAt.localeCompare(a.startsAt);
    if (sort === "createdDesc") return b.requestedAt.localeCompare(a.requestedAt);
    return a.startsAt.localeCompare(b.startsAt);
  });
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

function makeSharedReportDetail(report: SharedReport): SharedReportDetail {
  const reportAttachment = attachments.find((attachment) => report.attachmentIds.includes(attachment.id));
  const baseDetail = {
    category: report.category,
    createdAt: report.createdAt,
    imageUrl: reportAttachment?.url,
    shortSummary: report.summary,
    source: report.source,
    summary: report.summary,
  };
  const templates: Record<string, Record<string, unknown>> = {
    "report-1": {
      personalColor: "여름 쿨 라이트 후보",
      faceShape: "부드러운 계란형, 얼굴 중앙 여백이 균형적인 편",
      skinType: "수분 부족형 중성",
      toneSummary: "노란기보다 맑은 핑크 기가 올라올 때 얼굴이 밝아 보입니다.",
      recommendedMood: "글로우 코랄보다 소프트 로즈, 투명한 광",
      shootingQuality: "정면 구도 양호, 실내 조명 약간 따뜻함",
      colorPalette: [
        { name: "소프트 로즈", hex: "#d98a9d" },
        { name: "라이트 모브", hex: "#b7a2cf" },
        { name: "클리어 핑크", hex: "#f2a7bc" },
      ],
      keyFindings: [
        "따뜻한 코랄을 넓게 올리면 얼굴 중심이 붉게 보여 채도를 낮추는 편이 좋습니다.",
        "광은 T존보다 광대 위쪽에 작게 두면 얼굴 입체감이 살아납니다.",
        "립은 선명한 레드보다 맑은 로즈 계열이 피부 톤과 안정적으로 맞습니다.",
      ],
      actionSteps: [
        "현재 사용하는 코랄 블러셔와 로즈 블러셔를 상담 중 비교합니다.",
        "립 채도를 한 단계 낮춘 사진을 앱에 추가해 변화폭을 확인합니다.",
        "상담 후 3일 동안 같은 베이스에 블러셔 위치만 바꿔 테스트합니다.",
      ],
    },
    "report-2": {
      personalColor: "쿨 라이트-브라이트 경계",
      faceShape: "광대 라인이 살아 있는 계란형",
      skinType: "표면은 보송, 볼 중앙은 붉음",
      baseMakeupGuide: "베이스는 노란 보정 대신 뉴트럴 핑크 톤업을 얇게 사용",
      blushGuide: "눈동자 바깥 라인보다 안쪽, 광대 위쪽에 타원형으로 짧게",
      lipGuide: "코랄 MLBB보다 로즈 핑크, 글로스는 중앙만",
      browGuide: "눈썹 산을 세우기보다 꼬리 각도만 낮춰 인상을 부드럽게",
      shootingQuality: "얼굴 프레임은 안정적, 볼 조명만 오른쪽이 강함",
      colorPalette: [
        { name: "로즈 베이지", hex: "#c9858d" },
        { name: "페일 라벤더", hex: "#c9bddf" },
        { name: "쿨 브라운", hex: "#6f5558" },
      ],
      keyFindings: [
        "블러셔 위치가 낮아 팔자 주변 음영과 겹쳐 피곤해 보일 수 있습니다.",
        "립 채도는 크게 낮추기보다 색 온도만 차갑게 바꾸는 쪽이 자연스럽습니다.",
        "눈썹 꼬리 각도가 강해 전체 무드보다 또렷한 인상이 먼저 보입니다.",
      ],
      actionSteps: [
        "상담 전 평소 블러셔 위치가 보이는 정면 사진을 하나 더 첨부합니다.",
        "립 후보 2개를 손목 발색보다 얼굴 착용 사진으로 비교합니다.",
        "베이스 제품 호수와 톤업 제품 사용 여부를 채팅으로 남깁니다.",
      ],
    },
    "report-3": {
      personalColor: "여름 쿨 라이트 우세",
      faceShape: "이마와 턱 비율이 안정적인 타원형",
      toneSummary: "회색기가 많은 색보다 맑고 밝은 저채도 색에서 피부가 깨끗해 보입니다.",
      recommendedMood: "맑은 로즈, 라벤더, 투명한 쉬머",
      colorPalette: [
        { name: "라이트 핑크", hex: "#f1a7bf" },
        { name: "쿨 라일락", hex: "#bba9db" },
        { name: "소프트 플럼", hex: "#8d668f" },
      ],
      keyFindings: [
        "노란 베이지 섀도보다 라이트 모브 섀도가 눈가를 맑게 만듭니다.",
        "블랙 아이라인보다 딥 브라운이나 플럼 브라운이 자연스럽습니다.",
        "화이트 펄은 넓게 쓰기보다 눈 앞머리와 애교살 중앙에만 권장됩니다.",
      ],
      actionSteps: [
        "현재 보유 팔레트에서 라벤더/모브 계열을 상담 중 같이 분류합니다.",
        "데일리 메이크업은 색보다 면적을 줄이는 방향으로 먼저 조정합니다.",
      ],
    },
    "report-4": {
      personalColor: "재촬영 필요",
      faceShape: "얼굴 프레임 누락으로 자동 판정 제한",
      skinType: "조명 편차로 신뢰도 낮음",
      toneSummary: "사진에서 얼굴 하단과 헤어라인이 잘려 톤/비율 판단이 제한됩니다.",
      shootingQuality: "얼굴 프레임 미충족, 상단 조명 과다",
      recommendedMood: "상담 전 재촬영 후 확정 권장",
      colorPalette: [
        { name: "중립 베이스", hex: "#d8c8b8" },
        { name: "소프트 로즈", hex: "#d9909d" },
      ],
      keyFindings: [
        "현재 사진만으로는 퍼스널 컬러 확정값보다 촬영 오류 안내가 우선입니다.",
        "상담에서는 재촬영 가이드와 현재 메이크업 문제를 분리해 설명해야 합니다.",
      ],
      actionSteps: [
        "창가 자연광에서 얼굴 전체와 목선이 들어오게 다시 촬영합니다.",
        "필터, 보정, 그림자 없이 정면 사진을 추가합니다.",
      ],
    },
    "report-5": {
      personalColor: "여름 쿨 라이트",
      faceShape: "계란형, 볼 중앙 면적이 넓어 블러셔 면적 조절 중요",
      baseMakeupGuide: "파운데이션은 얇게, 붉은 볼 중앙은 컨실러보다 그린 베이스 소량",
      blushGuide: "광대 아래가 아닌 눈 밑 바깥쪽으로 작게 쌓기",
      lipGuide: "소프트 로즈와 뮤트 핑크를 번갈아 테스트",
      recommendedMood: "깨끗한 베이스, 작은 블러셔, 투명 로즈 립",
      colorPalette: [
        { name: "뮤트 핑크", hex: "#c98999" },
        { name: "로즈 밀크", hex: "#e1a8b4" },
        { name: "쿨 토프", hex: "#8b777c" },
      ],
      keyFindings: [
        "붉게 뜨는 원인은 블러셔 색보다 위치와 양이었습니다.",
        "베이스를 두껍게 덮으면 오히려 볼 중앙 붉음이 늦게 올라옵니다.",
      ],
      actionSteps: [
        "1주일 동안 블러셔 브러시 첫 터치를 광대 위쪽에서 시작합니다.",
        "립은 기존 채도 유지, 베이스와 블러셔만 먼저 바꿉니다.",
      ],
    },
  };

  return {
    report,
    kind: report.source === "expert_result" ? "feedback" : "analysis",
    detail: {
      ...baseDetail,
      ...(templates[report.id] ?? {}),
    },
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
    url: `backend-document-url://${document.storageKey}`,
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
