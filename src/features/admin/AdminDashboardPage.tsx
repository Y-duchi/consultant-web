import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, FileCheck2, Sparkles, Star, Store } from "lucide-react";
import { getAdminDashboardSummary, getCustomerName, getExpertName } from "../../services/api";
import { Badge, BookingStatusBadge, PartnerApplicationStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { PageHeader } from "../../shared/ui/PageHeader";
import { formatDateTime } from "../../shared/utils/format";

const metricIcons = [FileCheck2, AlertTriangle, Store, CalendarDays, Sparkles, Star];

export function AdminDashboardPage() {
  const summaryQuery = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: getAdminDashboardSummary,
  });

  if (summaryQuery.isLoading) return <LoadingState label="운영자 대시보드를 불러오는 중입니다" />;
  if (summaryQuery.isError) return <ErrorState message={summaryQuery.error.message} onRetry={() => summaryQuery.refetch()} />;

  const summary = summaryQuery.data;
  if (!summary) return null;

  const metrics = [
    { label: "검토 대기 신청", value: summary.pendingApplicationCount, hint: "새 입점 신청" },
    { label: "보완 요청 신청", value: summary.needsUpdateApplicationCount, hint: "재제출 대기" },
    { label: "승인 업체", value: summary.approvedBusinessCount, hint: `${summary.totalExpertCount}명 전문가` },
    { label: "오늘 전체 예약", value: summary.todayBookingCount, hint: "모든 업체 합산" },
    { label: "AI 요약 실패", value: summary.failedSummaryJobCount, hint: "재시도 필요" },
    { label: "리뷰 이슈", value: summary.hiddenOrReportedReviewCount, hint: "숨김/신고" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Platform Admin"
        title="입점, 예약, AI 요약 운영 현황"
        description="운영자는 전체 업체 상태와 신청 심사, 예약 이슈, AI 요약 실패를 한 곳에서 확인합니다."
        actions={
          <>
            <Link to="/admin/applications">
              <Button variant="secondary" icon={<FileCheck2 size={17} />}>
                입점 심사
              </Button>
            </Link>
            <Link to="/admin/summary-jobs">
              <Button variant="primary" icon={<Sparkles size={17} />}>
                AI 요약 상태
              </Button>
            </Link>
          </>
        }
      />

      <section className="metric-grid" aria-label="플랫폼 운영 지표">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index];
          return (
            <div className="metric" key={metric.label}>
              <span>
                <Icon size={15} /> {metric.label}
              </span>
              <strong>{metric.value}</strong>
              <small>{metric.hint}</small>
            </div>
          );
        })}
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>최근 입점 신청</h2>
              <p>승인 전 신청자는 workspace에 접근하지 못하고 상태 화면만 확인합니다.</p>
            </div>
            <Link to="/admin/applications" className="muted">전체 보기</Link>
          </div>
          <div className="panel-body summary-list">
            {summary.recentApplications.length === 0 ? (
              <EmptyState title="최근 신청이 없습니다" />
            ) : (
              summary.recentApplications.map((application) => (
                <div className="summary-item" key={application.id}>
                  <div className="thread-meta">
                    <strong>{application.businessName}</strong>
                    <PartnerApplicationStatusBadge status={application.status} />
                  </div>
                  <p>{application.ownerName} · {application.email} · 서류 {application.documents.length}개</p>
                  <span className="muted">{formatDateTime(application.updatedAt)}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>오늘 전체 예약</h2>
              <p>업체별 workspace와 별도로 플랫폼 전체 예약을 검수합니다.</p>
            </div>
            <Link to="/admin/bookings" className="muted">전체 예약</Link>
          </div>
          <div className="panel-body summary-list">
            {summary.todayBookings.length === 0 ? (
              <EmptyState title="오늘 예약이 없습니다" />
            ) : (
              summary.todayBookings.map((booking) => (
                <div className="summary-item" key={booking.id}>
                  <div className="thread-meta">
                    <strong>{booking.type}</strong>
                    <BookingStatusBadge status={booking.status} />
                  </div>
                  <p>{getCustomerName(booking.customerId)} · {getExpertName(booking.expertId)} · {formatDateTime(booking.startsAt)}</p>
                  <span className="muted">{booking.businessId}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>AI 요약 작업</h2>
            <p>전화상담 transcript/메모 기반 OpenAI 요약 작업의 최근 상태입니다.</p>
          </div>
          <Link to="/admin/summary-jobs" className="muted">작업 로그</Link>
        </div>
        <div className="panel-body summary-list">
          {summary.summaryJobs.map((job) => (
            <div className="summary-item" key={job.id}>
              <div className="thread-meta">
                <strong>예약 #{job.bookingId}</strong>
                <Badge tone={job.status === "succeeded" ? "success" : job.status === "failed" ? "danger" : "warning"}>{job.status}</Badge>
              </div>
              <p>{job.businessId} · {job.source} · {job.aiModel ?? "model env"}</p>
              <span className="muted">{formatDateTime(job.updatedAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
