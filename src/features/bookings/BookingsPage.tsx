import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, CheckCircle2, Clock3, MessageSquareText, Phone, Plus, Save, Search, XCircle } from "lucide-react";
import {
  addBookingNote,
  cancelBooking,
  createPhoneAction,
  getAvailability,
  getBookingDetail,
  getBookings,
  getCustomerName,
  getExperts,
  updateAvailability,
  updateBooking,
  updateBookingStatus,
} from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { BookingStatusBadge, PaymentStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Drawer } from "../../shared/ui/Drawer";
import { Field, SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { Tabs } from "../../shared/ui/Tabs";
import { bookingStatusOptions } from "../../shared/utils/options";
import { addDays, formatCurrency, formatDate, formatDateTime, formatTime, toInputDate } from "../../shared/utils/format";
import type { AvailabilitySlot, Booking, BookingStatus } from "../../types/domain";

type CalendarView = "month" | "week" | "day";

const viewOptions: Array<{ value: CalendarView; label: string }> = [
  { value: "month", label: "월" },
  { value: "week", label: "주" },
  { value: "day", label: "일" },
];

const slotTimes = Array.from({ length: 21 }, (_, index) => {
  const minutes = 10 * 60 + index * 30;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

export function BookingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editDraft, setEditDraft] = useState({
    type: "",
    internalMemo: "",
    date: "",
    startsAt: "",
    durationMinutes: 60 as 30 | 60,
  });
  const [availabilityDraft, setAvailabilityDraft] = useState({
    date: toInputDate(new Date().toISOString()),
    startsAt: "10:00",
    endsAt: "20:00",
    kind: "available" as AvailabilitySlot["kind"],
    note: "",
  });

  const bookingsQuery = useQuery({
    queryKey: ["bookings", query, status, user?.id, user?.businessId, user?.expertId, user?.workspaceScope],
    queryFn: () => getBookings({ query, status, sort: "startsAtAsc" }, user ?? undefined),
  });
  const expertsQuery = useQuery({
    queryKey: ["experts", user?.id, user?.businessId, user?.expertId, user?.workspaceScope],
    queryFn: () => getExperts(user ?? undefined),
  });
  const selectedExpertId = expertsQuery.data?.[0]?.id ?? "exp-1";
  const availabilityQuery = useQuery({
    queryKey: ["availability", selectedExpertId, availabilityDraft.date],
    queryFn: () => getAvailability(selectedExpertId, availabilityDraft.date),
    enabled: Boolean(selectedExpertId),
  });
  const detailQuery = useQuery({
    queryKey: ["booking-detail", selectedBookingId, user?.id, user?.businessId],
    queryFn: () => getBookingDetail(selectedBookingId!, user ?? undefined),
    enabled: Boolean(selectedBookingId),
  });

  const invalidateBookings = () => {
    queryClient.invalidateQueries({ queryKey: ["bookings"] });
    queryClient.invalidateQueries({ queryKey: ["booking-detail"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ bookingId, nextStatus }: { bookingId: string; nextStatus: BookingStatus }) => updateBookingStatus(bookingId, nextStatus, user ?? undefined),
    onSuccess: invalidateBookings,
  });
  const noteMutation = useMutation({
    mutationFn: ({ bookingId, note }: { bookingId: string; note: string }) => addBookingNote(bookingId, note, user ?? undefined),
    onSuccess: () => {
      setNoteDraft("");
      invalidateBookings();
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ bookingId, patch }: { bookingId: string; patch: Parameters<typeof updateBooking>[1] }) => updateBooking(bookingId, patch, user ?? undefined),
    onSuccess: invalidateBookings,
  });
  const cancelMutation = useMutation({
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason: string }) => cancelBooking(bookingId, reason, user ?? undefined),
    onSuccess: invalidateBookings,
  });
  const availabilityMutation = useMutation({
    mutationFn: (slot: AvailabilitySlot) => updateAvailability(slot),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["availability"] }),
  });

  const bookings = bookingsQuery.data ?? [];
  const visibleDates = useMemo(() => getVisibleDates(anchorDate, view), [anchorDate, view]);
  const currentLabel = useMemo(() => {
    if (view === "day") return formatDate(anchorDate.toISOString());
    if (view === "week") return `${formatDate(visibleDates[0].toISOString())} - ${formatDate(visibleDates[visibleDates.length - 1].toISOString())}`;
    return `${anchorDate.getFullYear()}년 ${anchorDate.getMonth() + 1}월`;
  }, [anchorDate, view, visibleDates]);

  const selectedDetail = detailQuery.data;

  const openBooking = (booking: Booking) => {
    setSelectedBookingId(booking.id);
    setEditDraft({
      type: booking.type,
      internalMemo: booking.internalMemo,
      date: toInputDate(booking.startsAt),
      startsAt: getLocalTimeKey(booking.startsAt),
      durationMinutes: booking.durationMinutes,
    });
  };

  if (bookingsQuery.isLoading) return <LoadingState label="예약 데이터를 불러오는 중입니다" />;
  if (bookingsQuery.isError) return <ErrorState message={bookingsQuery.error.message} onRetry={() => bookingsQuery.refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="Bookings"
        title="앱 예약 관리"
        description="고객이 앱에서 선택한 전문가, 날짜/30분 슬롯, 전달 리포트, 사전 질문, 결제 상태를 한 흐름으로 관리합니다."
        actions={
          <Button variant="secondary" icon={<CalendarRange size={17} />} onClick={() => setAnchorDate(new Date())}>
            오늘로 이동
          </Button>
        }
      />

      <div className="filter-bar">
        <Search size={17} />
        <TextInput className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="고객명, 전화번호, 뷰티 상담 유형, 선택 리포트 검색" />
        <SelectInput value={status} onChange={(event) => setStatus(event.target.value as BookingStatus | "all")}>
          {bookingStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectInput>
        <Tabs value={view} options={viewOptions} onChange={setView} />
      </div>

      <div className="calendar-layout">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{currentLabel}</h2>
              <p>앱 예약 기본 노출 시간은 10:00-20:00이며, 30분/1시간 화상 상담 슬롯을 기준으로 표시합니다.</p>
            </div>
            <div className="page-actions">
              <Button variant="secondary" onClick={() => setAnchorDate(addDays(anchorDate, view === "month" ? -30 : view === "week" ? -7 : -1))}>
                이전
              </Button>
              <Button variant="secondary" onClick={() => setAnchorDate(addDays(anchorDate, view === "month" ? 30 : view === "week" ? 7 : 1))}>
                다음
              </Button>
            </div>
          </div>
          <div className="panel-body">
            <CalendarViewRenderer view={view} dates={visibleDates} bookings={bookings} onOpenBooking={openBooking} />
          </div>
        </section>

        <aside className="panel">
          <div className="panel-header">
            <div>
              <h2>가능 시간 조정</h2>
              <p>앱에 노출될 특정 날짜의 가능 시간, 휴무, 점심, 예외 시간을 저장합니다.</p>
            </div>
          </div>
          <div className="panel-body settings-section">
            <Field label="전문가">
              <SelectInput value={selectedExpertId} disabled>
                {expertsQuery.data?.map((expert) => (
                  <option key={expert.id} value={expert.id}>
                    {expert.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="form-grid">
              <Field label="날짜">
                <TextInput type="date" value={availabilityDraft.date} onChange={(event) => setAvailabilityDraft((prev) => ({ ...prev, date: event.target.value }))} />
              </Field>
              <Field label="구분">
                <SelectInput value={availabilityDraft.kind} onChange={(event) => setAvailabilityDraft((prev) => ({ ...prev, kind: event.target.value as AvailabilitySlot["kind"] }))}>
                  <option value="available">가능</option>
                  <option value="lunch">점심</option>
                  <option value="blocked">차단</option>
                  <option value="holiday">휴무</option>
                  <option value="exception">예외</option>
                </SelectInput>
              </Field>
              <Field label="시작">
                <TextInput type="time" value={availabilityDraft.startsAt} onChange={(event) => setAvailabilityDraft((prev) => ({ ...prev, startsAt: event.target.value }))} />
              </Field>
              <Field label="종료">
                <TextInput type="time" value={availabilityDraft.endsAt} onChange={(event) => setAvailabilityDraft((prev) => ({ ...prev, endsAt: event.target.value }))} />
              </Field>
              <div className="span-2">
                <Field label="메모">
                  <TextInput value={availabilityDraft.note} onChange={(event) => setAvailabilityDraft((prev) => ({ ...prev, note: event.target.value }))} placeholder="예: 내부 회의, 오후 휴무" />
                </Field>
              </div>
            </div>
            <Button
              variant="primary"
              icon={<Save size={17} />}
              onClick={() =>
                availabilityMutation.mutate({
                  id: `slot-${Date.now()}`,
                  expertId: selectedExpertId,
                  ...availabilityDraft,
                })
              }
            >
              가능 시간 저장
            </Button>
            <div className="availability-list">
              {availabilityQuery.data?.map((slot) => (
                <div className="availability-item" key={slot.id}>
                  <div className="thread-meta">
                    <strong>{slot.startsAt} - {slot.endsAt}</strong>
                    <span className="tag">{slot.kind}</span>
                  </div>
                  <span className="muted">{slot.note || "메모 없음"}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <Drawer
        open={Boolean(selectedBookingId)}
        title={selectedDetail ? `${selectedDetail.customer.name} 예약 상세` : "예약 상세"}
        description={selectedDetail ? `${formatDateTime(selectedDetail.booking.startsAt)} · ${selectedDetail.expert.name}` : undefined}
        onClose={() => setSelectedBookingId(null)}
        footer={
          selectedDetail ? (
            <>
              <Button
                variant="secondary"
                icon={<MessageSquareText size={16} />}
                onClick={() => navigate("/workspace/chat")}
              >
                채팅
              </Button>
              <Button
                variant="secondary"
                icon={<Phone size={16} />}
                onClick={() => createPhoneAction({ customerId: selectedDetail.customer.id, bookingId: selectedDetail.booking.id, channel: "phone" })}
              >
                전화 준비
              </Button>
              {selectedDetail.booking.status === "confirmed" || selectedDetail.booking.status === "completed" ? (
                <Button variant="primary" icon={<CheckCircle2 size={16} />} onClick={() => navigate(`/workspace/completion?bookingId=${selectedDetail.booking.id}`)}>
                  완료/AI 요약
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {detailQuery.isLoading ? <LoadingState label="예약 상세를 불러오는 중입니다" /> : null}
        {selectedDetail ? (
          <div className="settings-section">
            <dl className="detail-list">
              <div className="detail-row">
                <dt>상태</dt>
                <dd className="tag-list">
                  <BookingStatusBadge status={selectedDetail.booking.status} />
                  <PaymentStatusBadge status={selectedDetail.booking.paymentStatus} />
                </dd>
              </div>
              <div className="detail-row">
                <dt>고객</dt>
                <dd>{selectedDetail.customer.name} · {selectedDetail.customer.phone}</dd>
              </div>
              <div className="detail-row">
                <dt>상담</dt>
                <dd>
                  {selectedDetail.booking.type} · {selectedDetail.booking.durationMinutes}분 ·
                  {selectedDetail.booking.channel === "video" ? " 1:1 화상" : selectedDetail.booking.channel === "chat" ? " 채팅" : " 방문"} ·
                  {formatCurrency(selectedDetail.booking.paidAmount)}
                  {selectedDetail.booking.discountAmount > 0 ? ` (${formatCurrency(selectedDetail.booking.discountAmount)} 할인)` : ""}
                </dd>
              </div>
              <div className="detail-row">
                <dt>고민 태그</dt>
                <dd className="tag-list">
                  {selectedDetail.booking.selectedConcernTags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                </dd>
              </div>
              <div className="detail-row">
                <dt>요청사항</dt>
                <dd>{selectedDetail.booking.requestMemo}</dd>
              </div>
              <div className="detail-row">
                <dt>내부 메모</dt>
                <dd>{selectedDetail.booking.internalMemo || "등록된 메모 없음"}</dd>
              </div>
            </dl>

            <section className="panel">
              <div className="panel-header">
                <h3>고객이 앱에서 선택한 전달 리포트</h3>
              </div>
              <div className="panel-body report-list">
                {selectedDetail.sharedReports.length === 0 ? (
                  <EmptyState title="선택된 리포트 없음" description="고객이 앱에서 룩톡/AI 분석/퍼스널컬러 리포트를 선택하면 여기에 표시됩니다." />
                ) : (
                  selectedDetail.sharedReports.map((report) => (
                    <div className="report-item" key={report.id}>
                      <strong>{report.title}</strong>
                      <p>{report.summary}</p>
                      <span className="tag">{report.source === "customer_app" ? "고객 앱 선택" : "전문가 작성"}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3>예약 수정</h3>
              </div>
              <div className="panel-body settings-section">
                <Field label="상담 유형">
                  <TextInput value={editDraft.type} onChange={(event) => setEditDraft((prev) => ({ ...prev, type: event.target.value }))} />
                </Field>
                <div className="form-grid">
                  <Field label="예약 날짜">
                    <TextInput type="date" value={editDraft.date} onChange={(event) => setEditDraft((prev) => ({ ...prev, date: event.target.value }))} />
                  </Field>
                  <Field label="시작 시간">
                    <TextInput type="time" value={editDraft.startsAt} onChange={(event) => setEditDraft((prev) => ({ ...prev, startsAt: event.target.value }))} />
                  </Field>
                  <Field label="상담 길이">
                    <SelectInput value={editDraft.durationMinutes} onChange={(event) => setEditDraft((prev) => ({ ...prev, durationMinutes: Number(event.target.value) as 30 | 60 }))}>
                      <option value={30}>30분</option>
                      <option value={60}>1시간</option>
                    </SelectInput>
                  </Field>
                </div>
                <Field label="내부 메모">
                  <TextArea value={editDraft.internalMemo} onChange={(event) => setEditDraft((prev) => ({ ...prev, internalMemo: event.target.value }))} />
                </Field>
                <Button
                  variant="secondary"
                  icon={<Save size={16} />}
                  onClick={() => {
                    const startsAt = toIsoFromLocalInput(editDraft.date, editDraft.startsAt);
                    const endsAtDate = new Date(startsAt);
                    endsAtDate.setMinutes(endsAtDate.getMinutes() + editDraft.durationMinutes);
                    updateMutation.mutate({
                      bookingId: selectedDetail.booking.id,
                      patch: {
                        type: editDraft.type,
                        internalMemo: editDraft.internalMemo,
                        durationMinutes: editDraft.durationMinutes,
                        startsAt,
                        endsAt: endsAtDate.toISOString(),
                      },
                    });
                  }}
                >
                  수정 저장
                </Button>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3>상태/메모 액션</h3>
              </div>
              <div className="panel-body settings-section">
                <div className="form-grid">
                  <Button variant="secondary" icon={<Clock3 size={16} />} onClick={() => statusMutation.mutate({ bookingId: selectedDetail.booking.id, nextStatus: "requested" })}>
                    신청
                  </Button>
                  <Button variant="secondary" icon={<Clock3 size={16} />} onClick={() => statusMutation.mutate({ bookingId: selectedDetail.booking.id, nextStatus: "contacting" })}>
                    확인중
                  </Button>
                  <Button variant="secondary" icon={<CheckCircle2 size={16} />} onClick={() => statusMutation.mutate({ bookingId: selectedDetail.booking.id, nextStatus: "confirmed" })}>
                    확정
                  </Button>
                  <Button variant="secondary" icon={<CheckCircle2 size={16} />} onClick={() => navigate(`/workspace/completion?bookingId=${selectedDetail.booking.id}`)} disabled={selectedDetail.booking.status !== "confirmed" && selectedDetail.booking.status !== "completed"}>
                    완료/AI 요약
                  </Button>
                  <Button variant="secondary" icon={<XCircle size={16} />} onClick={() => statusMutation.mutate({ bookingId: selectedDetail.booking.id, nextStatus: "no_show" })}>
                    노쇼
                  </Button>
                  <Button variant="danger" icon={<XCircle size={16} />} onClick={() => cancelMutation.mutate({ bookingId: selectedDetail.booking.id, reason: "운영자 수동 취소" })}>
                    취소
                  </Button>
                </div>
                <Field label="메모 추가">
                  <TextArea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="상담 전 확인사항, 고객 연락 기록, 운영 메모를 추가하세요." />
                </Field>
                <Button variant="secondary" icon={<Plus size={16} />} disabled={!noteDraft.trim()} onClick={() => noteMutation.mutate({ bookingId: selectedDetail.booking.id, note: noteDraft })}>
                  메모 추가
                </Button>
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function CalendarViewRenderer({
  bookings,
  dates,
  onOpenBooking,
  view,
}: {
  view: CalendarView;
  dates: Date[];
  bookings: Booking[];
  onOpenBooking: (booking: Booking) => void;
}) {
  if (view === "month") {
    return (
      <div className="calendar-grid month">
        {["월", "화", "수", "목", "금", "토", "일"].map((day) => (
          <div className="calendar-head" key={day}>{day}</div>
        ))}
        {dates.map((date) => {
          const dateBookings = bookingsForDate(bookings, date);
          return (
            <div className="calendar-cell" key={date.toISOString()}>
              <span className="calendar-date">{date.getDate()}</span>
              {dateBookings.slice(0, 4).map((booking) => (
                <BookingPill booking={booking} key={booking.id} onClick={() => onOpenBooking(booking)} />
              ))}
              {dateBookings.length > 4 ? <span className="muted">+{dateBookings.length - 4}건</span> : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`calendar-grid ${view}`}>
      <div className="calendar-head">시간</div>
      {dates.map((date) => (
        <div className="calendar-head" key={date.toISOString()}>{formatDate(date.toISOString())}</div>
      ))}
      {slotTimes.map((time) => (
        <Fragment key={time}>
          <div className="time-cell" key={`${time}-label`}>{time}</div>
          {dates.map((date) => {
            const slotBookings = bookingsForDate(bookings, date).filter((booking) => getLocalTimeKey(booking.startsAt) === time);
            return (
              <div className="slot-cell" key={`${date.toISOString()}-${time}`}>
                {slotBookings.map((booking) => (
                  <BookingPill booking={booking} key={booking.id} onClick={() => onOpenBooking(booking)} />
                ))}
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

function BookingPill({ booking, onClick }: { booking: Booking; onClick: () => void }) {
  return (
    <button type="button" className={`booking-pill ${booking.status}`} onClick={onClick}>
      <strong>{formatTime(booking.startsAt)} {getCustomerName(booking.customerId)}</strong>
      <span>{booking.type} · 리포트 {booking.sharedReportIds.length}개</span>
    </button>
  );
}

function getVisibleDates(anchorDate: Date, view: CalendarView) {
  if (view === "day") return [anchorDate];
  if (view === "week") {
    const start = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }
  const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function bookingsForDate(bookings: Booking[], date: Date) {
  const key = toInputDate(date.toISOString());
  return bookings.filter((booking) => toInputDate(booking.startsAt) === key).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function getLocalTimeKey(iso: string) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toIsoFromLocalInput(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}
