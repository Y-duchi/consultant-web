import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, FileWarning, Search, XCircle } from "lucide-react";
import {
  decideAdminProfileChange,
  getAdminProfileChange,
  getAdminProfileChanges,
  prepareProfileChangeAvatarAccess,
  type ProfileImageAccessResult,
} from "../../services/api";
import { ProfileChangeStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Drawer } from "../../shared/ui/Drawer";
import { SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { formatCurrency, formatDateTime, profileChangeStatusLabel } from "../../shared/utils/format";
import type { ProfileChangeRequest, ProfileChangeStatus } from "../../types/domain";

const statusOptions: Array<ProfileChangeStatus | "all"> = ["all", "submitted", "needs_update", "approved", "rejected"];

const fieldLabels: Record<string, string> = {
  name: "이름/업체명",
  partnerType: "운영 형태",
  ownerName: "대표자",
  businessRegistrationNumber: "사업자등록번호",
  phone: "전화번호",
  address: "주소",
  description: "업체 소개",
  exposureStatus: "노출 상태",
  roleLabel: "직함",
  tagline: "한 줄 소개",
  price30Min: "30분 가격",
  price60Min: "60분 가격",
  yearsOfExperience: "경력",
  specialties: "전문 분야",
  categories: "상담 카테고리",
  introduction: "전문가 소개",
};

export function AdminProfileChangesPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProfileChangeStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewMemo, setReviewMemo] = useState("");
  const [avatarAccess, setAvatarAccess] = useState<ProfileImageAccessResult | null>(null);
  const [avatarError, setAvatarError] = useState("");

  const requestsQuery = useQuery({
    queryKey: ["admin-profile-change-requests", query, status],
    queryFn: () => getAdminProfileChanges({ query, status }),
  });
  const detailQuery = useQuery({
    queryKey: ["admin-profile-change-request", selectedId],
    queryFn: () => getAdminProfileChange(selectedId!),
    enabled: Boolean(selectedId),
  });
  const selectedRequest = detailQuery.data;
  const isFinal = selectedRequest?.status === "approved" || selectedRequest?.status === "rejected";

  useEffect(() => {
    setReviewMemo(selectedRequest?.reviewMemo ?? "");
  }, [selectedRequest?.id, selectedRequest?.reviewMemo]);

  useEffect(() => {
    setAvatarAccess(null);
    setAvatarError("");
  }, [selectedId]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-profile-change-requests"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-profile-change-request", selectedId] });
    await queryClient.invalidateQueries({ queryKey: ["admin-businesses"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-experts"] });
  };

  const decisionMutation = useMutation({
    mutationFn: (action: "approve" | "needs-update" | "reject") => decideAdminProfileChange(
      selectedId!,
      action,
      {
        reviewMemo: reviewMemo || defaultReviewMemo(action),
        reviewerName: "플랫폼 관리자",
      },
    ),
    onSuccess: refresh,
  });

  const summary = useMemo(() => {
    const requests = requestsQuery.data ?? [];
    return {
      submitted: requests.filter((item) => item.status === "submitted").length,
      needsUpdate: requests.filter((item) => item.status === "needs_update").length,
      approved: requests.filter((item) => item.status === "approved").length,
    };
  }, [requestsQuery.data]);

  const viewAvatar = async () => {
    if (!selectedId) return;
    setAvatarError("");
    try {
      setAvatarAccess(await prepareProfileChangeAvatarAccess(selectedId));
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "요청 사진을 열지 못했습니다.");
    }
  };

  if (requestsQuery.isLoading) return <LoadingState label="프로필 변경 요청을 불러오는 중입니다" />;
  if (requestsQuery.isError) return <ErrorState message={requestsQuery.error.message} onRetry={() => requestsQuery.refetch()} />;

  const requests = requestsQuery.data ?? [];

  return (
    <>
      <PageHeader title="프로필 변경 심사" description="업체와 전문가가 요청한 변경 내용을 기존 공개 정보와 비교한 뒤 반영 여부를 결정합니다." />

      <section className="metric-grid" aria-label="프로필 변경 심사 상태">
        <div className="metric"><span>검토 대기</span><strong>{summary.submitted}</strong><small>새 변경 요청</small></div>
        <div className="metric"><span>보완 요청</span><strong>{summary.needsUpdate}</strong><small>파트너 수정 필요</small></div>
        <div className="metric"><span>승인 완료</span><strong>{summary.approved}</strong><small>공개 프로필 반영</small></div>
      </section>

      <div className="filter-bar">
        <TextInput className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름, 업체명, 이메일 검색" />
        <SelectInput className="control narrow" value={status} onChange={(event) => setStatus(event.target.value as ProfileChangeStatus | "all")}>
          {statusOptions.map((option) => <option key={option} value={option}>{option === "all" ? "전체 상태" : profileChangeStatusLabel[option]}</option>)}
        </SelectInput>
        <Button variant="secondary" icon={<Search size={16} />} onClick={() => requestsQuery.refetch()}>검색</Button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>요청자</th><th>대상</th><th>변경 항목</th><th>상태</th><th>요청일</th><th /></tr></thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td><div className="cell-main"><strong>{requestLabel(request)}</strong><span>{request.requesterEmail}</span></div></td>
                <td>{request.targetType === "business" ? "업체 정보" : "전문가 프로필"}</td>
                <td>{Object.keys(request.proposedChanges).length + (request.avatarFileName ? 1 : 0)}개</td>
                <td><ProfileChangeStatusBadge status={request.status} /></td>
                <td>{formatDateTime(request.updatedAt)}</td>
                <td><Button variant="secondary" icon={<Eye size={15} />} onClick={() => setSelectedId(request.id)}>상세</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {requests.length === 0 ? <EmptyState title="프로필 변경 요청이 없습니다" /> : null}
      </div>

      <Drawer
        open={Boolean(selectedId)}
        title={selectedRequest ? `${requestLabel(selectedRequest)} 변경 요청` : "프로필 변경 요청"}
        description={selectedRequest?.requesterEmail}
        onClose={() => setSelectedId(null)}
        footer={selectedRequest ? (
          <>
            <Button variant="secondary" icon={<FileWarning size={16} />} disabled={isFinal || decisionMutation.isPending} onClick={() => decisionMutation.mutate("needs-update")}>보완 요청</Button>
            <Button variant="danger" icon={<XCircle size={16} />} disabled={isFinal || decisionMutation.isPending} onClick={() => decisionMutation.mutate("reject")}>반려</Button>
            <Button variant="primary" icon={<CheckCircle2 size={16} />} disabled={isFinal || decisionMutation.isPending} onClick={() => decisionMutation.mutate("approve")}>승인 및 반영</Button>
          </>
        ) : null}
      >
        {detailQuery.isLoading ? <LoadingState label="변경 요청 상세를 불러오는 중입니다" /> : null}
        {detailQuery.isError ? <ErrorState message={detailQuery.error.message} onRetry={() => detailQuery.refetch()} /> : null}
        {selectedRequest ? (
          <div className="application-detail">
            <section className="detail-section">
              <div className="section-title-row"><h3>심사 상태</h3><ProfileChangeStatusBadge status={selectedRequest.status} /></div>
              <dl className="detail-list">
                <CompareMeta label="요청 대상">{selectedRequest.targetType === "business" ? "업체 정보" : "전문가 프로필"}</CompareMeta>
                <CompareMeta label="요청일">{formatDateTime(selectedRequest.submittedAt)}</CompareMeta>
                <CompareMeta label="요청자">{selectedRequest.requesterEmail}</CompareMeta>
              </dl>
            </section>

            {selectedRequest.avatarFileName ? (
              <section className="detail-section">
                <div className="section-title-row"><h3>요청 프로필 사진</h3><Button variant="secondary" icon={<Eye size={15} />} onClick={viewAvatar}>사진 열람</Button></div>
                {avatarAccess ? <img className="profile-change-avatar-preview" src={avatarAccess.accessUrl} alt="요청 프로필" /> : null}
                <span className="muted">{selectedRequest.avatarFileName}</span>
                {avatarError ? <p className="form-error">{avatarError}</p> : null}
              </section>
            ) : null}

            <section className="detail-section">
              <h3>기존 정보와 요청 정보 비교</h3>
              <div className="profile-change-compare">
                <div className="profile-change-compare-head"><span>항목</span><span>현재 공개 정보</span><span>승인 후 정보</span></div>
                {Object.entries(selectedRequest.proposedChanges).map(([key, value]) => (
                  <div className="profile-change-compare-row" key={key}>
                    <strong>{fieldLabels[key] ?? key}</strong>
                    <span>{formatProfileValue(key, selectedRequest.currentSnapshot[key])}</span>
                    <span className="is-proposed">{formatProfileValue(key, value)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="detail-section">
              <h3>관리자 검토 의견</h3>
              <TextArea value={reviewMemo} onChange={(event) => setReviewMemo(event.target.value)} placeholder="승인, 보완 요청 또는 반려 사유를 작성해 주세요." />
              {decisionMutation.isError ? <p className="form-error">{decisionMutation.error.message}</p> : null}
            </section>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function requestLabel(request: ProfileChangeRequest) {
  return String(request.proposedChanges.name || request.currentSnapshot.name || request.currentSnapshot.ownerName || "파트너");
}

function formatProfileValue(key: string, value: unknown) {
  if (key === "price30Min" || key === "price60Min") return formatCurrency(Number(value || 0));
  if (key === "yearsOfExperience") return `${Number(value || 0)}년`;
  if (key === "partnerType") return value === "business" ? "사업자 업체" : "프리랜서 전문가";
  if (key === "exposureStatus") return value === "public" ? "공개" : "비공개";
  if (Array.isArray(value)) return value.join(", ") || "없음";
  return String(value ?? "") || "미입력";
}

function defaultReviewMemo(action: "approve" | "needs-update" | "reject") {
  if (action === "approve") return "요청 내용을 확인하고 공개 프로필에 반영했습니다.";
  if (action === "needs-update") return "변경 요청 내용을 보완해 다시 제출해 주세요.";
  return "운영 정책과 제출 정보를 검토한 결과 변경 요청을 반려했습니다.";
}

function CompareMeta({ children, label }: { children: ReactNode; label: string }) {
  return <div className="detail-row"><dt>{label}</dt><dd>{children}</dd></div>;
}
