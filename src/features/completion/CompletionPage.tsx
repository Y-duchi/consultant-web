import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Send } from "lucide-react";
import { createConsultationSummary, getBookingDetail, getBookings, getCustomerName, getSharedReports } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { BookingStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Field, SelectInput, TextArea } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { formatDateTime, isTerminalBookingStatus } from "../../shared/utils/format";

export function CompletionPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedBookingId, setSelectedBookingId] = useState(searchParams.get("bookingId") ?? "");
  const [internalMemo, setInternalMemo] = useState("");
  const [customerSummary, setCustomerSummary] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [sendReviewRequest, setSendReviewRequest] = useState(true);

  const bookingsQuery = useQuery({
    queryKey: ["completion-bookings", user?.id, user?.workspaceScope],
    queryFn: () => getBookings({ sort: "startsAtDesc" }, user ?? undefined),
  });
  const eligibleBookings = useMemo(
    () => (bookingsQuery.data ?? []).filter((booking) => !isTerminalBookingStatus(booking.status)),
    [bookingsQuery.data],
  );

  useEffect(() => {
    if (!selectedBookingId && eligibleBookings[0]) {
      setSelectedBookingId(eligibleBookings[0].id);
    }
  }, [eligibleBookings, selectedBookingId]);

  const detailQuery = useQuery({
    queryKey: ["completion-booking-detail", selectedBookingId],
    queryFn: () => getBookingDetail(selectedBookingId),
    enabled: Boolean(selectedBookingId),
  });
  const sharedReportsQuery = useQuery({
    queryKey: ["completion-shared-reports", detailQuery.data?.customer.id],
    queryFn: () => getSharedReports(detailQuery.data!.customer.id),
    enabled: Boolean(detailQuery.data?.customer.id),
  });

  const completionMutation = useMutation({
    mutationFn: () =>
      createConsultationSummary({
        bookingId: selectedBookingId,
        internalMemo,
        customerSummary,
        recommendations,
        deliveredReportIds: selectedReportIds,
        sendReviewRequest,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      queryClient.invalidateQueries({ queryKey: ["completion-booking-detail"] });
      queryClient.invalidateQueries({ queryKey: ["customer-detail"] });
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
        title="상담 완료 및 처방 노트 전달"
        description="전문가가 내부 메모와 고객용 뷰티 처방 노트, 추천사항을 남기고 앱으로 전달할 리포트를 선택합니다. 완료 후 리뷰 요청 상태를 추적합니다."
      />

      {eligibleBookings.length === 0 ? (
        <EmptyState title="완료 처리할 수 있는 예약이 없습니다" description="취소, 노쇼, 환불 요청 예약은 완료/리포트/리뷰 흐름에서 제외됩니다." />
      ) : (
        <div className="completion-layout">
          <form className="panel" onSubmit={handleSubmit}>
            <div className="panel-header">
              <div>
              <h2>뷰티 처방 노트 작성</h2>
              <p>고객에게 앱으로 전달될 내용과 내부 운영 메모를 분리해서 남깁니다.</p>
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
              <Field label="내부 메모" hint="운영자와 전문가만 볼 내용입니다.">
                <TextArea value={internalMemo} onChange={(event) => setInternalMemo(event.target.value)} placeholder="다음 상담에서 확인할 점, 민감한 운영 메모 등을 적어주세요." />
              </Field>
              <Field label="고객용 처방 노트">
                <TextArea value={customerSummary} onChange={(event) => setCustomerSummary(event.target.value)} placeholder="고객에게 전달될 톤/메이크업/스타일 진단 요약을 작성하세요." required />
              </Field>
              <Field label="추천사항">
                <TextArea value={recommendations} onChange={(event) => setRecommendations(event.target.value)} placeholder="바로 적용할 메이크업 루틴, 제품 톤, 다음 예약 권장 시점을 작성하세요." required />
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
                  <strong>완료 후 리뷰 요청 상태 추적</strong>
                  <span>저장 시 리뷰 요청 상태를 sent로 표시합니다.</span>
                </span>
                <input type="checkbox" checked={sendReviewRequest} onChange={(event) => setSendReviewRequest(event.target.checked)} />
              </label>
            </div>
            <div className="drawer-footer">
              <Button type="submit" variant="primary" icon={<Send size={16} />} disabled={completionMutation.isPending || !customerSummary.trim() || !recommendations.trim()}>
                완료 처리 및 앱 전달
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
