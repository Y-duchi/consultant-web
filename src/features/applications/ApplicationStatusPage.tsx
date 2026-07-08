import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, LogOut, RefreshCw } from "lucide-react";
import { getPartnerApplicationDetail } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { PartnerApplicationDocumentReviewBadge, PartnerApplicationStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { formatDateTime, partnerApplicationDocumentTypeLabel } from "../../shared/utils/format";

export function ApplicationStatusPage() {
  const { logout, user } = useAuth();
  const detailQuery = useQuery({
    queryKey: ["my-partner-application", user?.applicationId],
    queryFn: () => getPartnerApplicationDetail(user!.applicationId!),
    enabled: Boolean(user?.applicationId),
  });

  if (!user) return <Navigate to="/login" replace />;
  if (user.applicationStatus === "approved") return <Navigate to="/workspace" replace />;

  if (!user.applicationId) {
    return (
      <main className="login-page">
        <section className="login-panel login-panel-wide">
          <EmptyState title="입점 신청 내역이 없습니다" description="업체/전문가 입점 신청을 먼저 제출해주세요." />
          <div className="page-actions">
            <Link to="/apply">
              <Button variant="primary" icon={<ArrowRight size={17} />}>
                입점 신청
              </Button>
            </Link>
            <Button variant="ghost" icon={<LogOut size={17} />} onClick={logout}>
              로그아웃
            </Button>
          </div>
        </section>
      </main>
    );
  }

  if (detailQuery.isLoading) return <LoadingState label="입점 신청 상태를 불러오는 중입니다" />;
  if (detailQuery.isError) return <ErrorState message={detailQuery.error.message} onRetry={() => detailQuery.refetch()} />;

  const application = detailQuery.data?.application;
  if (!application) return null;

  return (
    <main className="login-page">
      <section className="login-panel login-panel-wide">
        <div className="application-result">
          <span className="page-eyebrow">Partner Status</span>
          <h1>{statusTitle(application.status)}</h1>
          <p>{statusDescription(application.status)}</p>
          <div className="result-summary">
            <div>
              <span>업체/전문가</span>
              <strong>{application.businessName}</strong>
            </div>
            <div>
              <span>신청 상태</span>
              <PartnerApplicationStatusBadge status={application.status} />
            </div>
            <div>
              <span>최근 변경</span>
              <strong>{formatDateTime(application.updatedAt)}</strong>
            </div>
          </div>

          {application.reviewMemo ? (
            <div className="verification-note">
              <FileText size={18} />
              <div>
                <strong>관리자 검토 메모</strong>
                <span>{application.reviewMemo}</span>
              </div>
            </div>
          ) : null}

          <div className="attachment-list">
            {application.documents.map((document) => (
              <div className="attachment-item application-document" key={document.id}>
                <div className="document-main">
                  <FileText size={18} />
                  <div className="cell-main">
                    <strong>{document.fileName}</strong>
                    <span>
                      {partnerApplicationDocumentTypeLabel[document.type]} · {document.sizeLabel}
                    </span>
                  </div>
                </div>
                <PartnerApplicationDocumentReviewBadge status={document.reviewStatus} />
              </div>
            ))}
          </div>

          <div className="page-actions">
            <Button variant="secondary" icon={<RefreshCw size={17} />} onClick={() => detailQuery.refetch()}>
              새로고침
            </Button>
            {application.status === "needs_update" ? (
              <Link to="/apply">
                <Button variant="primary" icon={<ArrowRight size={17} />}>
                  보완 제출
                </Button>
              </Link>
            ) : null}
            <Button variant="ghost" icon={<LogOut size={17} />} onClick={logout}>
              로그아웃
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function statusTitle(status: string) {
  if (status === "submitted") return "입점 신청 검토 대기중입니다";
  if (status === "needs_update") return "서류 보완이 필요합니다";
  if (status === "rejected") return "입점 신청이 반려되었습니다";
  return "입점 신청 상태를 확인해주세요";
}

function statusDescription(status: string) {
  if (status === "submitted") return "관리자가 사업자등록증과 국가 미용사 면허증을 확인한 뒤 승인 여부를 처리합니다.";
  if (status === "needs_update") return "관리자 메모를 확인하고 필요한 PDF 서류를 다시 제출해주세요.";
  if (status === "rejected") return "반려 사유를 확인한 뒤 새 신청서를 제출할 수 있습니다.";
  return "승인 전에는 예약, 고객, 채팅, 리뷰 메뉴에 접근할 수 없습니다.";
}
