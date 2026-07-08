import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, CalendarCheck, CheckCircle2, MessageSquareWarning, ReceiptText, RotateCcw, Star } from "lucide-react";
import { getBusinessProfile, getCustomerName, getDashboardSummary, getExpertName } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { BookingStatusBadge, BusinessVerificationBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { PageHeader } from "../../shared/ui/PageHeader";
import { formatCurrency, formatDateTime, formatTime } from "../../shared/utils/format";

const metricIcons = [CalendarCheck, ReceiptText, CheckCircle2, RotateCcw, MessageSquareWarning, Star];

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const summaryQuery = useQuery({
    queryKey: ["dashboard-summary", user?.id, user?.businessId, user?.expertId, user?.workspaceScope],
    queryFn: () => getDashboardSummary(user ?? undefined),
  });
  const businessQuery = useQuery({
    queryKey: ["business-profile", user?.businessId],
    queryFn: () => getBusinessProfile(user ?? undefined),
  });

  if (summaryQuery.isLoading || businessQuery.isLoading) return <LoadingState label="파트너 운영 현황을 불러오는 중입니다" />;
  if (summaryQuery.isError) return <ErrorState message={summaryQuery.error.message} onRetry={() => summaryQuery.refetch()} />;
  if (businessQuery.isError) return <ErrorState message={businessQuery.error.message} onRetry={() => businessQuery.refetch()} />;

  const summary = summaryQuery.data;
  const business = businessQuery.data;
  if (!summary) return null;

  const metrics = [
    { label: "오늘 앱 예약", value: summary.todayBookingCount, hint: "화상/채팅 상담 예약", tone: "정상" },
    { label: "오늘 결제액", value: formatCurrency(summary.todayPaidAmount), hint: "쿠폰 적용 후 파트너 매출", tone: "정산" },
    { label: "리포트 전달 대기", value: summary.pendingReportDeliveryCount, hint: "처방 노트/리포트 선택 필요", tone: "업무" },
    { label: "취소/환불 요청", value: summary.refundRequestCount, hint: "운영 검토 필요", tone: "주의" },
    { label: "미응답 메시지", value: summary.unreadMessageCount, hint: "리포트/예약 문의", tone: "응답" },
    { label: "오늘 30분 슬롯", value: summary.availableSlotCount, hint: "앱 노출 가능 재고", tone: "슬롯" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Beauty Partner"
        title="오늘 앱에서 들어온 뷰티 상담 운영"
        description="고객 앱의 전문가 선택, 리포트 선택, 시간 예약, 결제 흐름이 웹 매니저에서 예약·고객관리·리포트 전달 업무로 이어지도록 구성했습니다."
        actions={
          <>
            <Button variant="secondary" icon={<ArrowRight size={17} />} onClick={() => navigate("/workspace/bookings")}>
              앱 예약 보기
            </Button>
            <Button variant="primary" icon={<ArrowRight size={17} />} onClick={() => navigate("/workspace/completion")}>
              처방 노트 작성
            </Button>
          </>
        }
      />

      <section className="panel dashboard-verification">
        <div className="panel-body verification-strip">
          <div>
            <span className="page-eyebrow">Partner Verification</span>
            <h2>{business?.name}</h2>
            <p>
              {business?.partnerType === "business" ? "사업자 업체" : "프리랜서 전문가"} · 사업자/자격 증빙 {business?.verificationDocuments.length ?? 0}개 제출 ·
              정산 계좌 {business?.settlementAccountStatus === "approved" ? "승인" : "검수중"}
            </p>
          </div>
          <div className="tag-list">
            {business ? <BusinessVerificationBadge status={business.verificationStatus} /> : null}
            <span className="tag">앱 노출 {business?.exposureStatus === "public" ? "공개" : "검수중"}</span>
          </div>
            <Button variant="secondary" icon={<BadgeCheck size={17} />} onClick={() => navigate("/workspace/profile")}>
            인증/프로필 관리
          </Button>
        </div>
      </section>

      <section className="metric-grid" aria-label="운영 지표">
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
              <h2>오늘의 일정 타임라인</h2>
              <p>고객 앱에서 결제한 화상 상담을 시간순으로 확인합니다.</p>
            </div>
            <Link to="/workspace/bookings" className="muted">전체 예약 보기</Link>
          </div>
          <div className="panel-body">
            {summary.todayTimeline.length === 0 ? (
              <EmptyState title="오늘 예약이 없습니다" description="상담 가능 시간과 예외 일정을 점검해보세요." />
            ) : (
              <div className="timeline">
                {summary.todayTimeline.map((booking) => (
                  <div className="timeline-item" key={booking.id}>
                    <div className="timeline-time">{formatTime(booking.startsAt)}</div>
                    <div className="cell-main">
                      <strong>{booking.type}</strong>
                      <span>
                        {getCustomerName(booking.customerId)} · {getExpertName(booking.expertId)} · {booking.durationMinutes}분
                      </span>
                      <div className="tag-list">
                        <BookingStatusBadge status={booking.status} />
                        <span className="tag">{booking.channel === "video" ? "1:1 화상" : booking.channel === "chat" ? "채팅" : "방문"}</span>
                        <span className="tag">리포트 {booking.sharedReportIds.length}개</span>
                        <span className="tag">종료 {formatTime(booking.endsAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>처리 필요</h2>
              <p>인증, 리포트 전달, 고객 문의, 환불처럼 앱 운영에 바로 영향을 주는 항목입니다.</p>
            </div>
          </div>
          <div className="panel-body">
            {summary.urgentTasks.length === 0 ? (
              <EmptyState title="급한 업무가 없습니다" description="새 메시지와 환불 요청이 들어오면 여기에 표시됩니다." />
            ) : (
              <div className="task-list">
                {summary.urgentTasks.map((task) => (
                  <div className="task-item" key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <p>{task.description}</p>
                      {task.dueAt ? <span className="muted">{formatDateTime(task.dueAt)}</span> : null}
                    </div>
                    <Link to={getTaskPath(task.type)}>
                      <Button variant="secondary" icon={<ArrowRight size={15} />}>
                        열기
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function getTaskPath(type: string) {
  if (type === "message") return "/workspace/chat";
  if (type === "review") return "/workspace/reviews";
  if (type === "verification") return "/workspace/profile";
  if (type === "report" || type === "completion") return "/workspace/completion";
  return "/workspace/bookings";
}
