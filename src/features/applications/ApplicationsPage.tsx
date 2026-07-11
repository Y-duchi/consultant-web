import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Eye, FileText, KeyRound, RefreshCw, Search, XCircle } from "lucide-react";
import {
  approvePartnerApplication,
  getPartnerApplicationDetail,
  getPartnerApplications,
  preparePartnerApplicationDocumentAccess,
  reissuePartnerApplicationCredentials,
  updatePartnerApplicationStatus,
  type PartnerApplicationApprovalResult,
  type PartnerDocumentAccessResult,
} from "../../services/api";
import { Badge, PartnerApplicationDocumentReviewBadge, PartnerApplicationStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Drawer } from "../../shared/ui/Drawer";
import { Field, SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { PageHeader } from "../../shared/ui/PageHeader";
import {
  formatCurrency,
  formatDateTime,
  partnerApplicationDocumentTypeLabel,
  partnerApplicationStatusLabel,
  workspaceScopeLabel,
} from "../../shared/utils/format";
import type {
  ConsultingMode,
  PartnerAccount,
  PartnerApplication,
  PartnerApplicationDocument,
  PartnerApplicationDocumentType,
  PartnerApplicationStatus,
  PartnerBusinessMember,
} from "../../types/domain";

const statusOptions: Array<PartnerApplicationStatus | "all"> = ["all", "submitted", "needs_update", "approved", "rejected"];

export function ApplicationsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PartnerApplicationStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewMemo, setReviewMemo] = useState("");
  const [generatedAccount, setGeneratedAccount] = useState<PartnerAccount | null>(null);
  const [generatedMember, setGeneratedMember] = useState<PartnerBusinessMember | null>(null);
  const [documentAccess, setDocumentAccess] = useState<PartnerDocumentAccessResult | null>(null);
  const [credentialsCopied, setCredentialsCopied] = useState(false);

  const applicationsQuery = useQuery({
    queryKey: ["partner-applications", query, status],
    queryFn: () => getPartnerApplications({ query, status }),
  });

  const detailQuery = useQuery({
    queryKey: ["partner-application-detail", selectedId],
    queryFn: () => getPartnerApplicationDetail(selectedId!),
    enabled: Boolean(selectedId),
  });

  const selectedApplication = detailQuery.data?.application;
  const visibleAccount = generatedAccount ?? detailQuery.data?.account ?? null;
  const visibleMember = generatedMember ?? detailQuery.data?.member ?? null;
  const isFinalDecision = selectedApplication?.status === "approved" || selectedApplication?.status === "rejected";
  const hasReviewMemo = reviewMemo.trim().length > 0;

  useEffect(() => {
    setReviewMemo(selectedApplication?.reviewMemo ?? "");
  }, [selectedApplication?.id, selectedApplication?.reviewMemo]);

  useEffect(() => {
    setGeneratedAccount(null);
    setGeneratedMember(null);
    setDocumentAccess(null);
    setCredentialsCopied(false);
  }, [selectedId]);

  const refreshApplications = async () => {
    await queryClient.invalidateQueries({ queryKey: ["partner-applications"] });
    await queryClient.invalidateQueries({ queryKey: ["partner-application-detail", selectedId] });
  };

  const decisionMutation = useMutation({
    mutationFn: ({ nextStatus }: { nextStatus: Exclude<PartnerApplicationStatus, "approved"> }) =>
      updatePartnerApplicationStatus(selectedId!, nextStatus, {
        reviewMemo: reviewMemo || "관리자 검토 결과가 반영되었습니다.",
        reviewerName: "플랫폼 관리자",
      }),
    onSuccess: refreshApplications,
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      approvePartnerApplication(selectedId!, {
        reviewMemo: reviewMemo || "제출 서류 확인 완료. 파트너 계정을 생성했습니다.",
        reviewerName: "플랫폼 관리자",
        accountEmail: selectedApplication?.email,
        workspaceScope: "business_operations",
    }),
    onSuccess: async (result: PartnerApplicationApprovalResult) => {
      setGeneratedAccount(result.account);
      setGeneratedMember(result.member);
      setCredentialsCopied(false);
      await refreshApplications();
    },
  });

  const reissueMutation = useMutation({
    mutationFn: () => reissuePartnerApplicationCredentials(selectedId!),
    onSuccess: async (result: PartnerApplicationApprovalResult) => {
      setGeneratedAccount(result.account);
      setGeneratedMember(result.member);
      setCredentialsCopied(false);
      await refreshApplications();
    },
  });

  const copyVisibleCredentials = async () => {
    if (!visibleAccount?.temporaryPassword) return;
    await copyText([
      `로그인 이메일: ${visibleAccount.email}`,
      `임시 비밀번호: ${visibleAccount.temporaryPassword}`,
      "첫 로그인 후 새 비밀번호를 설정해 주세요.",
    ].join("\n"));
    setCredentialsCopied(true);
  };

  const reissueCredentials = () => {
    const confirmed = window.confirm("기존 임시 비밀번호와 로그인 세션이 무효화됩니다. 새 임시 비밀번호를 발급할까요?");
    if (confirmed) reissueMutation.mutate();
  };

  const applications = applicationsQuery.data ?? [];
  const summary = useMemo(
    () => ({
      submitted: applications.filter((application) => application.status === "submitted").length,
      needsUpdate: applications.filter((application) => application.status === "needs_update").length,
      approved: applications.filter((application) => application.status === "approved").length,
      rejected: applications.filter((application) => application.status === "rejected").length,
    }),
    [applications],
  );

  const openDocument = async (documentId: string) => {
    setDocumentAccess(await preparePartnerApplicationDocumentAccess(documentId));
  };

  if (applicationsQuery.isLoading) return <LoadingState label="입점 신청 목록을 불러오는 중입니다" />;
  if (applicationsQuery.isError) return <ErrorState message={applicationsQuery.error.message} onRetry={() => applicationsQuery.refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="Partner Review"
        title="입점 심사"
        description="업체/전문가가 제출한 사업자등록증, 국가 미용사 면허증, 자격 서류를 확인하고 승인 후 운영 계정을 발급합니다."
      />

      <section className="metric-grid" aria-label="입점 심사 상태">
        <div className="metric">
          <span>검토 대기</span>
          <strong>{summary.submitted}</strong>
          <small>새로 제출된 입점 신청</small>
        </div>
        <div className="metric">
          <span>보완 요청</span>
          <strong>{summary.needsUpdate}</strong>
          <small>서류 또는 정보 재제출 필요</small>
        </div>
        <div className="metric">
          <span>승인 완료</span>
          <strong>{summary.approved}</strong>
          <small>계정 발급 완료</small>
        </div>
      </section>

      <div className="filter-bar">
        <TextInput className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="업체명, 대표자, 이메일, 전문 분야 검색" />
        <SelectInput className="control narrow" value={status} onChange={(event) => setStatus(event.target.value as PartnerApplicationStatus | "all")}>
          {statusOptions.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "전체 상태" : partnerApplicationStatusLabel[option]}
            </option>
          ))}
        </SelectInput>
        <Button variant="secondary" icon={<Search size={16} />} onClick={() => applicationsQuery.refetch()}>
          검색
        </Button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>신청 업체/전문가</th>
              <th>상태</th>
              <th>대표자</th>
              <th>전문 분야</th>
              <th>상담 방식</th>
              <th>가격</th>
              <th>제출 서류</th>
              <th>최근 변경</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {applications.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <EmptyState title="신청 내역이 없습니다" description="상태 필터나 검색어를 조정해보세요." />
                </td>
              </tr>
            ) : (
              applications.map((application) => (
                <tr key={application.id}>
                  <td>
                    <div className="cell-main">
                      <strong>{application.businessName}</strong>
                      <span>
                        {application.partnerType === "business" ? "사업자 업체" : "프리랜서 전문가"} · {application.email}
                      </span>
                    </div>
                  </td>
                  <td>
                    <PartnerApplicationStatusBadge status={application.status} />
                  </td>
                  <td>{application.ownerName}</td>
                  <td>
                    <div className="tag-list">
                      {application.specialties.slice(0, 2).map((item) => (
                        <span className="tag" key={item}>
                          {item}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="cell-main">
                      <div className="tag-list">
                        {getApplicationConsultingModes(application).map((mode) => (
                          <span className="tag" key={mode}>
                            {consultingModeLabel(mode)}
                          </span>
                        ))}
                      </div>
                      {hasConsultingMode(application, "offline") && application.offlineAddress ? (
                        <span>{application.offlineAddress}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="cell-main">
                      <strong>{formatApplicationPrice(application, getPrimaryConsultingMode(application))}</strong>
                      {hasConsultingMode(application, "online") && hasConsultingMode(application, "offline") ? (
                        <span>오프라인 {formatApplicationPrice(application, "offline")}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <ApplicationDocumentSummary documents={application.documents} />
                  </td>
                  <td>{formatDateTime(application.updatedAt)}</td>
                  <td>
                    <div className="row-actions">
                      <Button variant="secondary" icon={<Eye size={15} />} onClick={() => setSelectedId(application.id)}>
                        상세
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Drawer
        open={Boolean(selectedId)}
        title={selectedApplication?.businessName ?? "입점 신청"}
        description={selectedApplication ? `${selectedApplication.ownerName} · ${selectedApplication.email}` : undefined}
        onClose={() => setSelectedId(null)}
        footer={
          selectedApplication ? (
            <>
              <Button
                variant="secondary"
                icon={<FileText size={16} />}
                disabled={isFinalDecision || !hasReviewMemo || decisionMutation.isPending}
                onClick={() => decisionMutation.mutate({ nextStatus: "needs_update" })}
              >
                보완 요청
              </Button>
              <Button
                variant="danger"
                icon={<XCircle size={16} />}
                disabled={isFinalDecision || decisionMutation.isPending}
                onClick={() => decisionMutation.mutate({ nextStatus: "rejected" })}
              >
                반려
              </Button>
              <Button
                variant="primary"
                icon={<CheckCircle2 size={16} />}
                disabled={isFinalDecision || approveMutation.isPending}
                onClick={() => approveMutation.mutate()}
              >
                승인 및 계정 생성
              </Button>
            </>
          ) : null
        }
      >
        {detailQuery.isLoading ? <LoadingState label="신청 상세를 불러오는 중입니다" /> : null}
        {detailQuery.isError ? <ErrorState message={detailQuery.error.message} onRetry={() => detailQuery.refetch()} /> : null}
        {selectedApplication ? (
          <div className="application-detail">
            <section className="detail-section">
              <div className="section-title-row">
                <h3>신청 정보</h3>
                <PartnerApplicationStatusBadge status={selectedApplication.status} />
              </div>
              <dl className="detail-list">
                <DetailRow label="유형">{selectedApplication.partnerType === "business" ? "사업자 업체" : "프리랜서 전문가"}</DetailRow>
                <DetailRow label="사업자번호">{selectedApplication.businessRegistrationNumber || "미입력"}</DetailRow>
                <DetailRow label="연락처">{selectedApplication.phone}</DetailRow>
                <DetailRow label="전문 분야">{selectedApplication.specialties.join(", ")}</DetailRow>
                <DetailRow label="카테고리">{selectedApplication.categories.join(", ")}</DetailRow>
                <DetailRow label="상담 방식">
                  <div className="tag-list">
                    {getApplicationConsultingModes(selectedApplication).map((mode) => (
                      <span className="tag" key={mode}>
                        {consultingModeLabel(mode)}
                      </span>
                    ))}
                  </div>
                </DetailRow>
                {hasConsultingMode(selectedApplication, "online") ? (
                  <DetailRow label="온라인 가격">{formatApplicationPrice(selectedApplication, "online")}</DetailRow>
                ) : null}
                {hasConsultingMode(selectedApplication, "offline") ? (
                  <>
                    <DetailRow label="오프라인 가격">{formatApplicationPrice(selectedApplication, "offline")}</DetailRow>
                    <DetailRow label="오프라인 주소">{selectedApplication.offlineAddress || "미입력"}</DetailRow>
                    <DetailRow label="상세 주소">{selectedApplication.offlineDetailAddress || "미입력"}</DetailRow>
                    <DetailRow label="위치/방문 안내">{selectedApplication.offlineLocationNote || "미입력"}</DetailRow>
                  </>
                ) : null}
                <DetailRow label="소개">{selectedApplication.introduction}</DetailRow>
              </dl>
            </section>

            <section className="detail-section">
              <div className="section-title-row">
                <h3>제출 서류</h3>
                <ApplicationDocumentSummary documents={selectedApplication.documents} />
              </div>
              <div className="attachment-list">
                {getApplicationDocumentRows(selectedApplication.documents).map((item) =>
                  item.document ? (
                    <div className="attachment-item application-document" key={item.key}>
                      <div className="document-main">
                        <FileText size={18} />
                        <div className="cell-main">
                          <strong>{item.document.fileName}</strong>
                          <span>
                            {item.label} · {item.required ? "필수" : "선택"} · {item.document.sizeLabel}
                          </span>
                        </div>
                      </div>
                      <div className="row-actions">
                        <Badge tone={item.required ? "info" : "neutral"}>{item.required ? "필수" : "선택"}</Badge>
                        <PartnerApplicationDocumentReviewBadge status={item.document.reviewStatus} />
                        <Button variant="secondary" icon={<Eye size={15} />} onClick={() => openDocument(item.document!.id)}>
                          열람
                        </Button>
                      </div>
                      {item.document.note ? <p>{item.document.note}</p> : null}
                    </div>
                  ) : (
                    <div
                      className={`attachment-item application-document document-missing ${item.required ? "document-missing-required" : ""}`}
                      key={item.key}
                    >
                      <div className="document-main">
                        <FileText size={18} />
                        <div className="cell-main">
                          <strong>{item.label}</strong>
                          <span>{item.required ? "필수 서류가 제출되지 않았습니다" : "선택 서류 미제출"}</span>
                        </div>
                      </div>
                      <Badge tone={item.required ? "danger" : "neutral"}>{item.required ? "필수 누락" : "선택"}</Badge>
                    </div>
                  ),
                )}
              </div>
              {documentAccess ? (
                <div className="verification-note">
                  <FileText size={18} />
                  <div>
                    <strong>{documentAccess.fileName}</strong>
                    <span>{documentAccess.expiresInMinutes}분짜리 문서 접근 URL이 준비되었습니다.</span>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="detail-section">
              <h3>관리자 검토 메모</h3>
              <Field label="검토 메모">
                <TextArea value={reviewMemo} onChange={(event) => setReviewMemo(event.target.value)} placeholder="사업자등록증, 미용사 면허증, 업체 실재 여부 확인 결과를 남겨주세요." />
              </Field>
            </section>

            {visibleAccount ? (
              <GeneratedAccountPanel
                account={visibleAccount}
                member={visibleMember}
                copied={credentialsCopied}
                reissuing={reissueMutation.isPending}
                reissueError={reissueMutation.isError ? reissueMutation.error.message : undefined}
                onCopy={copyVisibleCredentials}
                onReissue={reissueCredentials}
              />
            ) : null}

            <section className="detail-section">
              <h3>심사 로그</h3>
              <div className="summary-list">
                {(detailQuery.data?.reviewLogs ?? []).map((log) => (
                  <div className="summary-item" key={log.id}>
                    <strong>{reviewLogLabel(log.action)}</strong>
                    <p>{log.memo}</p>
                    <span className="muted">
                      {log.actorName} · {formatDateTime(log.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function DetailRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ApplicationDocumentSummary({ documents }: { documents: PartnerApplicationDocument[] }) {
  const hasBusinessRegistration = documents.some((document) => document.type === "business_registration");
  const optionalCount = documents.filter((document) => document.type !== "business_registration").length;
  return (
    <div className="document-summary">
      <Badge tone={hasBusinessRegistration ? "success" : "danger"}>{hasBusinessRegistration ? "필수 제출" : "필수 누락"}</Badge>
      <span>선택 {optionalCount}개</span>
    </div>
  );
}

function getApplicationDocumentRows(documents: PartnerApplicationDocument[]) {
  const rows: Array<{
    key: string;
    type: PartnerApplicationDocumentType;
    label: string;
    required: boolean;
    document?: PartnerApplicationDocument;
  }> = [];
  const definitions: Array<{ type: PartnerApplicationDocumentType; required: boolean }> = [
    { type: "business_registration", required: true },
    { type: "beauty_license", required: false },
    { type: "additional_certificate", required: false },
  ];

  definitions.forEach(({ type, required }) => {
    const matchingDocuments = documents.filter((document) => document.type === type);
    if (matchingDocuments.length === 0) {
      rows.push({ key: `${type}-missing`, type, label: partnerApplicationDocumentTypeLabel[type], required });
      return;
    }
    matchingDocuments.forEach((document) => {
      rows.push({ key: document.id, type, label: partnerApplicationDocumentTypeLabel[type], required, document });
    });
  });
  return rows;
}

function getApplicationConsultingModes(application: PartnerApplication): ConsultingMode[] {
  return application.consultingModes?.length ? application.consultingModes : ["online"];
}

function getPrimaryConsultingMode(application: PartnerApplication): ConsultingMode {
  const modes = getApplicationConsultingModes(application);
  return modes.includes("online") ? "online" : modes[0];
}

function hasConsultingMode(application: PartnerApplication, mode: ConsultingMode) {
  return getApplicationConsultingModes(application).includes(mode);
}

function consultingModeLabel(mode: ConsultingMode) {
  return mode === "offline" ? "오프라인" : "온라인";
}

function formatApplicationPrice(application: PartnerApplication, mode: ConsultingMode) {
  const price30Min =
    mode === "offline" ? application.offlinePrice30Min ?? application.price30Min : application.onlinePrice30Min ?? application.price30Min;
  const price60Min =
    mode === "offline" ? application.offlinePrice60Min ?? application.price60Min : application.onlinePrice60Min ?? application.price60Min;
  return `30분 ${formatCurrency(price30Min)} · 60분 ${formatCurrency(price60Min)}`;
}

function GeneratedAccountPanel({
  account,
  member,
  copied,
  reissuing,
  reissueError,
  onCopy,
  onReissue,
}: {
  account: PartnerAccount;
  member?: PartnerBusinessMember | null;
  copied: boolean;
  reissuing: boolean;
  reissueError?: string;
  onCopy: () => Promise<void>;
  onReissue: () => void;
}) {
  const hasTemporaryPassword = Boolean(account.temporaryPassword);
  return (
    <section className="detail-section generated-account">
      <div className="section-title-row">
        <h3>생성된 업체/전문가 계정</h3>
        <Badge tone="success">발급 가능</Badge>
      </div>
      <div className="credential-box">
        <KeyRound size={20} />
        <div className="cell-main">
          <strong>{account.email}</strong>
          {hasTemporaryPassword ? (
            <span className="credential-password">임시 비밀번호 {account.temporaryPassword}</span>
          ) : (
            <span>기존 임시 비밀번호는 보안을 위해 다시 표시되지 않습니다.</span>
          )}
          <span>첫 로그인 후 비밀번호 변경 대상</span>
          {member ? <span>멤버 권한 {member.role} · {workspaceScopeLabel[member.workspaceScope]}</span> : null}
        </div>
        <div className="credential-actions">
          {hasTemporaryPassword ? (
            <Button variant="secondary" icon={<Copy size={15} />} onClick={onCopy}>
              {copied ? "복사 완료" : "계정정보 복사"}
            </Button>
          ) : null}
          <Button variant="secondary" icon={<RefreshCw size={15} />} disabled={reissuing} onClick={onReissue}>
            {reissuing ? "재발급 중" : "임시 비밀번호 재발급"}
          </Button>
        </div>
      </div>
      {hasTemporaryPassword ? <span className="credential-notice">화면을 닫기 전에 신청자에게 안전하게 전달하세요.</span> : null}
      {reissueError ? <span className="form-error">{reissueError}</span> : null}
    </section>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("계정정보를 복사하지 못했습니다.");
}

function reviewLogLabel(action: string) {
  if (action === "submitted") return "신청 접수";
  if (action === "needs_update") return "보완 요청";
  if (action === "approved") return "승인";
  if (action === "rejected") return "반려";
  if (action === "account_created") return "계정 생성";
  return "검토 기록";
}
