import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Send, Sparkles } from "lucide-react";
import { createConsultationSummary, generateConsultationSummary, getBookingDetail, getBookings, getCustomerName, getSharedReports } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { BookingStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Field, SelectInput, TextArea } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { formatDateTime } from "../../shared/utils/format";

export function CompletionPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedBookingId, setSelectedBookingId] = useState(searchParams.get("bookingId") ?? "");
  const [transcript, setTranscript] = useState("");
  const [internalMemo, setInternalMemo] = useState("");
  const [customerSummary, setCustomerSummary] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [sendReviewRequest, setSendReviewRequest] = useState(true);
  const [visibleToCustomer, setVisibleToCustomer] = useState(true);

  const bookingsQuery = useQuery({
    queryKey: ["completion-bookings", user?.id, user?.businessId, user?.expertId, user?.workspaceScope],
    queryFn: () => getBookings({ sort: "startsAtDesc" }, user ?? undefined),
  });
  const eligibleBookings = useMemo(
    () => (bookingsQuery.data ?? []).filter((booking) => ["scheduled", "in_progress", "completed"].includes(booking.status)),
    [bookingsQuery.data],
  );

  useEffect(() => {
    if (!selectedBookingId && eligibleBookings[0]) {
      setSelectedBookingId(eligibleBookings[0].id);
    }
  }, [eligibleBookings, selectedBookingId]);

  const detailQuery = useQuery({
    queryKey: ["completion-booking-detail", selectedBookingId, user?.id, user?.businessId],
    queryFn: () => getBookingDetail(selectedBookingId, user ?? undefined),
    enabled: Boolean(selectedBookingId),
  });
  const sharedReportsQuery = useQuery({
    queryKey: ["completion-shared-reports", detailQuery.data?.customer.id, user?.id, user?.businessId],
    queryFn: () => getSharedReports(detailQuery.data!.customer.id, user ?? undefined),
    enabled: Boolean(detailQuery.data?.customer.id),
  });

  const completionMutation = useMutation({
    mutationFn: () =>
      createConsultationSummary({
        bookingId: selectedBookingId,
        transcript,
        internalMemo,
        customerSummary,
        recommendations,
        visibleToCustomer,
        deliveredReportIds: selectedReportIds,
        sendReviewRequest,
      }, user ?? undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      queryClient.invalidateQueries({ queryKey: ["completion-booking-detail"] });
      queryClient.invalidateQueries({ queryKey: ["customer-detail"] });
      queryClient.invalidateQueries({ queryKey: ["admin-summary-jobs"] });
    },
  });

  const aiSummaryMutation = useMutation({
    mutationFn: () =>
      generateConsultationSummary(
        selectedBookingId,
        {
          transcript,
          internalMemo,
          visibleToCustomer,
        },
        user ?? undefined,
      ),
    onSuccess: (result) => {
      setInternalMemo(result.summary.internalMemo);
      setCustomerSummary(result.summary.customerSummary);
      setRecommendations(result.summary.recommendations);
      setVisibleToCustomer(result.summary.visibleToCustomer);
      queryClient.invalidateQueries({ queryKey: ["admin-summary-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      queryClient.invalidateQueries({ queryKey: ["completion-booking-detail"] });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedBookingId || !customerSummary.trim() || !recommendations.trim()) return;
    completionMutation.mutate();
  };

  if (bookingsQuery.isLoading) return <LoadingState label="완료 처리 대상 예약을 불러오는 중입니다" />;
  if (bookingsQuery.isError) return <ErrorState message={bookingsQuery.error.message} onRetry={() => bookingsQuery.refetch()} />;

  const detail = detailQuery.data;
  const sharedReports = sharedReportsQuery.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Completion"
        title="상담 완료 및 AI 요약 리포트"
        description="화상통화가 종료되면 예약은 자동 완료로 전환되고, 통화 transcript 기반 AI 상담 요약 리포트를 고객 앱으로 전달합니다."
      />

      {eligibleBookings.length === 0 ? (
        <EmptyState title="완료 처리할 수 있는 예약이 없습니다" description="AI 요약 전달은 상담 예정 또는 진행 중인 화상 상담에서 진행할 수 있습니다." />
      ) : (
        <div className="completion-layout">
          <form className="panel" onSubmit={handleSubmit}>
            <div className="panel-header">
              <div>
              <h2>통화 종료 후 AI 상담 요약</h2>
              <p>상담사는 통화 transcript로 생성된 요약을 확인하고 필요한 전문가 코멘트만 덧붙입니다.</p>
              </div>
              {detail ? <BookingStatusBadge status={detail.booking.status} /> : null}
            </div>
            <div className="panel-body settings-section">
              <Field label="완료 처리할 예약">
                <SelectInput value={selectedBookingId} onChange={(event) => setSelectedBookingId(event.target.value)}>
                  {eligibleBookings.map((booking) => (
                    <option value={booking.id} key={booking.id}>
                      {formatDateTime(booking.startsAt)} · {getCustomerName(booking.customerId)} · {booking.type}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="화상상담 transcript" hint="화상통화 연동 전 v1에서는 테스트용 transcript를 붙여넣으면 예약 완료와 AI 요약 생성이 함께 처리됩니다.">
                <TextArea value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="고객 발화와 전문가 안내를 시간순으로 입력하면 AI 요약본을 생성합니다." />
              </Field>
              <Button
                type="button"
                variant="secondary"
                icon={<Sparkles size={16} />}
                disabled={aiSummaryMutation.isPending || !transcript.trim() || !selectedBookingId}
                onClick={() => aiSummaryMutation.mutate()}
              >
                {aiSummaryMutation.isPending ? "AI 요약 생성 중" : "통화 종료/AI 요약 생성"}
              </Button>
              {aiSummaryMutation.isError ? <div className="form-error">{aiSummaryMutation.error.message}</div> : null}
              <Field label="전문가 추가 코멘트" hint="AI 요약본 맨 아래에 전문가 코멘트로 추가됩니다.">
                <TextArea value={internalMemo} onChange={(event) => setInternalMemo(event.target.value)} placeholder="AI 요약 이후 고객에게 추가로 전할 보완 코멘트를 적어주세요." />
              </Field>
              <Field label="AI 요약본">
                <TextArea readOnly value={customerSummary} onChange={(event) => setCustomerSummary(event.target.value)} placeholder="AI 요약 생성 후 자동으로 채워집니다." required />
              </Field>
              <Field label="AI 추천사항">
                <TextArea readOnly value={recommendations} onChange={(event) => setRecommendations(event.target.value)} placeholder="AI 요약 생성 후 자동으로 채워집니다." required />
              </Field>

              <section className="settings-section">
                <strong>앱으로 전달할 리포트 선택</strong>
                {sharedReports.length === 0 ? (
                  <EmptyState title="선택 가능한 리포트가 없습니다" description="고객이 선택한 룩톡/AI 분석/퍼스널컬러 리포트 또는 전문가 작성 결과 리포트가 표시됩니다." />
                ) : (
                  sharedReports.map((report) => (
                    <label className="report-choice" key={report.id}>
                      <input
                        type="checkbox"
                        checked={selectedReportIds.includes(report.id)}
                        onChange={(event) => {
                          setSelectedReportIds((prev) =>
                            event.target.checked ? [...prev, report.id] : prev.filter((id) => id !== report.id),
                          );
                        }}
                      />
                      <span className="cell-main">
                        <strong>{report.title}</strong>
                        <span>{report.source === "customer_app" ? "고객이 앱에서 선택한 리포트" : "전문가가 작성한 결과 리포트"}</span>
                        <span>{report.summary}</span>
                      </span>
                    </label>
                  ))
                )}
              </section>

              <label className="switch-row">
                <span className="cell-main">
                  <strong>고객 앱 공개</strong>
                  <span>공개 요약만 고객 앱에서 조회됩니다.</span>
                </span>
                <input type="checkbox" checked={visibleToCustomer} onChange={(event) => setVisibleToCustomer(event.target.checked)} />
              </label>

              <label className="switch-row">
                <span className="cell-main">
                  <strong>완료 후 리뷰 요청 상태 추적</strong>
                  <span>저장 시 리뷰 요청 상태를 sent로 표시합니다.</span>
                </span>
                <input type="checkbox" checked={sendReviewRequest} onChange={(event) => setSendReviewRequest(event.target.checked)} />
              </label>
            </div>
            <div className="drawer-footer">
              <Button type="submit" variant="primary" icon={<Send size={16} />} disabled={completionMutation.isPending || !customerSummary.trim() || !recommendations.trim()}>
                앱 전달 상태 저장
              </Button>
            </div>
          </form>

          <aside className="panel">
            <div className="panel-header">
              <h2>선택 예약 컨텍스트</h2>
            </div>
            <div className="panel-body settings-section">
              {detailQuery.isLoading ? <LoadingState label="예약 상세를 불러오는 중입니다" /> : null}
              {detail ? (
                <>
                  <div className="person-cell">
                    <img className="profile-photo large" src={detail.customer.profileImageUrl} alt="" />
                    <div className="cell-main">
                      <strong>{detail.customer.name}</strong>
                      <span>{detail.customer.phone}</span>
                    </div>
                  </div>
                  <dl className="detail-list">
                    <div className="detail-row">
                      <dt>상담 유형</dt>
                      <dd>{detail.booking.type}</dd>
                    </div>
                    <div className="detail-row">
                      <dt>앱 사전 질문</dt>
                      <dd>{detail.booking.requestMemo}</dd>
                    </div>
                    <div className="detail-row">
                      <dt>리뷰 상태</dt>
                      <dd>{detail.booking.reviewRequestStatus}</dd>
                    </div>
                  </dl>
                  {completionMutation.isSuccess ? (
                    <div className="state-view">
                      <CheckCircle2 size={24} />
                      <strong>완료 처리되었습니다</strong>
                      <span>예약 상태가 완료로 바뀌고 리뷰 요청 상태가 갱신되었습니다.</span>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
