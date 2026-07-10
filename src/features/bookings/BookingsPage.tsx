import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, CheckCircle2, Clock3, CreditCard, MessageSquareText, Mic, MicOff, Phone, Save, Search, Video, VideoOff, XCircle } from "lucide-react";
import {
  endBookingCall,
  getAvailability,
  getBookingDetail,
  getBookings,
  getCustomerName,
  getExperts,
  getPartnerSessionToken,
  getSettings,
  joinBookingCall,
  saveBookingChanges,
  startBookingCallTranscription,
  stopBookingCallTranscription,
  translateBookingCallCaption,
  updateAvailability,
} from "../../services/api";
import type { BookingSaveChangesInput } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { BookingStatusBadge, PaymentStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Drawer } from "../../shared/ui/Drawer";
import { Modal } from "../../shared/ui/Modal";
import { Field, SelectInput, TextArea, TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { Tabs } from "../../shared/ui/Tabs";
import { bookingStatusOptions } from "../../shared/utils/options";
import { addDays, formatCurrency, formatDate, formatDateTime, formatTime, toInputDate } from "../../shared/utils/format";
import type { AvailabilitySlot, Booking, BookingStatus, ConsultingCaptionTranslation, ConsultingCallJoinResult, ConsultingCallLanguageCode, ConsultingCallState, ManagerSettings, OperatingHours } from "../../types/domain";
import { AppReportCard } from "../reports/AppReportCard";
import { startWebChimeMeeting, type WebChimeMeetingController, type WebChimeTranscriptResult } from "../../services/chimeMeetingClient";
import { connectConsultingConversationSocket, type ConsultingConversationSocketClient, type ConsultingParticipantType, type ConsultingServerSocketEvent } from "../../services/consultingRealtime";

type CalendarView = "month" | "week" | "day";
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type BookingFlowActionKey = "contacting" | "payment" | "confirm" | "start" | "summary";
type BookingFlowAction = {
  description: string;
  disabled?: boolean;
  key: BookingFlowActionKey;
  label: string;
  variant: ButtonVariant;
};
type BookingEditDraft = {
  type: string;
  internalMemo: string;
  date: string;
  startsAt: string;
  durationMinutes: 30 | 60;
};
type ScheduleNotice = {
  dateKey: string;
  label: string;
  reason: string;
};
type CallCaptionViewModel = {
  id: string;
  isPartial: boolean;
  resultId: string;
  sourceLanguageCode: ConsultingCallLanguageCode;
  speakerLabel: string;
  targetLanguageCode?: "ko" | "en";
  transcript: string;
  translatedContent?: string;
};

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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [view, setView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [pendingStatus, setPendingStatus] = useState<BookingStatus | null>(null);
  const [pendingPaymentPaid, setPendingPaymentPaid] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState("");
  const [callFeedback, setCallFeedback] = useState("");
  const [callJoinResult, setCallJoinResult] = useState<ConsultingCallJoinResult | null>(null);
  const [callState, setCallState] = useState<ConsultingCallState | null>(null);
  const [callLanguageCode, setCallLanguageCode] = useState<ConsultingCallLanguageCode>("ko-KR");
  const [callConnectionStatus, setCallConnectionStatus] = useState("idle");
  const [callConnectionError, setCallConnectionError] = useState("");
  const [isCallMuted, setIsCallMuted] = useState(false);
  const [isCallVideoEnabled, setIsCallVideoEnabled] = useState(true);
  const callAudioRef = useRef<HTMLAudioElement | null>(null);
  const callLocalVideoRef = useRef<HTMLVideoElement | null>(null);
  const callRemoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const chimeClientRef = useRef<WebChimeMeetingController | null>(null);
  const captionSocketRef = useRef<ConsultingConversationSocketClient | null>(null);
  const translatedCaptionIdsRef = useRef<Set<string>>(new Set());
  const [callCaptions, setCallCaptions] = useState<CallCaptionViewModel[]>([]);
  const [editDraft, setEditDraft] = useState<BookingEditDraft>({
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
  const requestedBookingId = searchParams.get("bookingId")?.trim() ?? "";
  const requestedCall = searchParams.get("call") === "1";
  const autoJoinBookingIdRef = useRef<string | null>(null);

  const bookingsQuery = useQuery({
    queryKey: ["bookings", query, status, user?.id, user?.businessId, user?.expertId, user?.workspaceScope],
    queryFn: () => getBookings({ query, status, sort: "startsAtAsc" }, user ?? undefined),
  });
  const expertsQuery = useQuery({
    queryKey: ["experts", user?.id, user?.businessId, user?.expertId, user?.workspaceScope],
    queryFn: () => getExperts(user ?? undefined),
  });
  const settingsQuery = useQuery({
    queryKey: ["settings", user?.id, user?.businessId, user?.expertId, user?.workspaceScope],
    queryFn: () => getSettings(user ?? undefined),
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
    queryClient.invalidateQueries({ queryKey: ["customer-detail"] });
    queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
  };

  const saveChangesMutation = useMutation({
    mutationFn: ({ bookingId, changes }: { bookingId: string; changes: BookingSaveChangesInput }) => saveBookingChanges(bookingId, changes, user ?? undefined),
    onSuccess: (booking) => {
      setEditDraft(makeEditDraft(booking));
      setPendingStatus(null);
      setPendingPaymentPaid(false);
      setNoteDraft("");
      setSaveFeedback("변경사항이 저장되었습니다.");
      invalidateBookings();
    },
  });
  const availabilityMutation = useMutation({
    mutationFn: (slot: AvailabilitySlot) => updateAvailability(slot),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["availability"] }),
  });
  const joinCallMutation = useMutation({
    mutationFn: (booking: Booking) => joinBookingCall(booking.id, callLanguageCode, user ?? undefined),
    onSuccess: (result) => {
      setCallJoinResult(result);
      setCallState(null);
      setCallConnectionError("");
      setCallConnectionStatus("connecting");
      setCallFeedback("Chime 입장 정보가 준비되었습니다. 브라우저 권한을 확인해 주세요.");
      saveChangesMutation.mutate({ bookingId: result.bookingId, changes: { status: "in_progress" } });
    },
    onError: (error) => {
      setCallFeedback(error instanceof Error ? error.message : "화상 상담 입장 정보를 가져오지 못했습니다.");
    },
  });
  const startTranscriptionMutation = useMutation({
    mutationFn: ({ booking, transcriptionConsentAccepted }: { booking: Booking; transcriptionConsentAccepted: boolean }) =>
      startBookingCallTranscription(booking.id, callLanguageCode, user ?? undefined, transcriptionConsentAccepted),
    onSuccess: (result) => {
      setCallState(result);
      setCallFeedback(getCallTranscriptionLabel(result.transcription.status, result.transcription.mode));
    },
    onError: (error) => {
      setCallFeedback(error instanceof Error ? error.message : "실시간 자막을 시작하지 못했습니다.");
    },
  });
  const stopTranscriptionMutation = useMutation({
    mutationFn: (booking: Booking) => stopBookingCallTranscription(booking.id, user ?? undefined),
    onSuccess: (result) => {
      setCallState(result);
      setCallFeedback(getCallTranscriptionLabel(result.transcription.status, result.transcription.mode));
    },
    onError: (error) => {
      setCallFeedback(error instanceof Error ? error.message : "실시간 자막을 중지하지 못했습니다.");
    },
  });

  const stopWebMeeting = useCallback(async () => {
    const client = chimeClientRef.current;
    chimeClientRef.current = null;
    if (!client) return;
    await client.stop().catch((error: unknown) => {
      setCallConnectionError(error instanceof Error ? error.message : "Chime 미팅 정리에 실패했습니다.");
    });
    setCallConnectionStatus("stopped");
    setIsCallMuted(false);
    setIsCallVideoEnabled(true);
  }, []);

  const bookings = bookingsQuery.data ?? [];
  const visibleDates = useMemo(() => getVisibleDates(anchorDate, view), [anchorDate, view]);
  const scheduleSummary = useMemo(
    () => buildVisibleScheduleSummary(visibleDates, settingsQuery.data),
    [settingsQuery.data, visibleDates],
  );
  const currentLabel = useMemo(() => {
    if (view === "day") return formatDate(anchorDate.toISOString());
    if (view === "week") return `${formatDate(visibleDates[0].toISOString())} - ${formatDate(visibleDates[visibleDates.length - 1].toISOString())}`;
    return `${anchorDate.getFullYear()}년 ${anchorDate.getMonth() + 1}월`;
  }, [anchorDate, view, visibleDates]);

  const selectedDetail = detailQuery.data;
  const selectedReport = selectedDetail?.sharedReports.find((report) => report.id === selectedReportId);
  const previewBooking = useMemo(() => {
    if (!selectedDetail) return null;
    return makePreviewBooking(selectedDetail.booking, editDraft, pendingStatus, pendingPaymentPaid);
  }, [editDraft, pendingPaymentPaid, pendingStatus, selectedDetail]);
  const hasPendingChanges = Boolean(
    selectedDetail &&
      (
        hasEditDraftChanges(editDraft, selectedDetail.booking) ||
        pendingStatus ||
        pendingPaymentPaid ||
        noteDraft.trim()
      ),
  );
  const callTranscription = callState?.transcription ?? callJoinResult?.transcription ?? null;

  const openBooking = (booking: Booking) => {
    void stopWebMeeting();
    setSelectedBookingId(booking.id);
    setSelectedReportId(null);
    setEditDraft(makeEditDraft(booking));
    setPendingStatus(null);
    setPendingPaymentPaid(false);
    setNoteDraft("");
    setSaveFeedback("");
    setCallFeedback("");
    setCallJoinResult(null);
    setCallState(null);
    setCallLanguageCode("ko-KR");
    setCallConnectionStatus("idle");
    setCallConnectionError("");
    setIsCallMuted(false);
    setIsCallVideoEnabled(true);
    setCallCaptions([]);
    translatedCaptionIdsRef.current.clear();
  };

  const closeBooking = () => {
    void stopWebMeeting();
    setSelectedBookingId(null);
    setSelectedReportId(null);
    setPendingStatus(null);
    setPendingPaymentPaid(false);
    setNoteDraft("");
    setSaveFeedback("");
    setCallFeedback("");
    setCallJoinResult(null);
    setCallState(null);
    setCallLanguageCode("ko-KR");
    setCallConnectionStatus("idle");
    setCallConnectionError("");
    setIsCallMuted(false);
    setIsCallVideoEnabled(true);
    setCallCaptions([]);
    translatedCaptionIdsRef.current.clear();
    if (requestedBookingId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("bookingId");
      nextParams.delete("call");
      setSearchParams(nextParams, { replace: true });
    }
  };

  const handleTranscriptResults = useCallback(
    (results: WebChimeTranscriptResult[]) => {
      const bookingId = callJoinResult?.bookingId ?? selectedBookingId;
      if (!bookingId) return;

      setCallCaptions((current) => mergeTranscriptCaptions(current, results, callLanguageCode));

      for (const result of results) {
        const sourceLanguageCode = normalizeTranscriptLanguageCode(result.languageCode) ?? callLanguageCode;
        const transcript = result.transcript.trim();
        if (result.isPartial || !result.resultId || !transcript) continue;
        if (translatedCaptionIdsRef.current.has(result.resultId)) continue;
        translatedCaptionIdsRef.current.add(result.resultId);

        void translateBookingCallCaption(
          bookingId,
          {
            resultId: result.resultId,
            sourceLanguageCode,
            content: transcript,
          },
          user ?? undefined,
        )
          .then((translation) => {
            setCallCaptions((current) => applyCaptionTranslation(current, translation));
            captionSocketRef.current?.sendCaptionTranslation({
              bookingId,
              resultId: translation.resultId,
              sourceLanguageCode: translation.sourceLanguageCode,
              targetLanguageCode: translation.targetLanguageCode,
              translatedContent: translation.translatedContent,
            });
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "확정 자막 번역에 실패했습니다.";
            setCallFeedback(message);
          });
      }
    },
    [callJoinResult?.bookingId, callLanguageCode, selectedBookingId, user],
  );

  useEffect(() => {
    if (
      !callJoinResult ||
      chimeClientRef.current ||
      !callAudioRef.current ||
      !callLocalVideoRef.current ||
      !callRemoteVideoRef.current
    ) {
      return;
    }

    void startWebChimeMeeting(callJoinResult, {
      audioElement: callAudioRef.current,
      localVideoElement: callLocalVideoRef.current,
      remoteVideoElement: callRemoteVideoRef.current,
      onStatusChange: (message: string) => {
        setCallConnectionStatus(message);
        setCallFeedback(message);
      },
      onTranscriptResults: handleTranscriptResults,
      onTranscriptionStatus: (status) => {
        if (status.type === "failed") {
          setCallFeedback(status.message || "Chime 실시간 자막이 실패했습니다.");
        }
      },
    }).then((controller) => {
      chimeClientRef.current = controller;
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Chime 미팅 연결에 실패했습니다.";
      setCallConnectionStatus("failed");
      setCallConnectionError(message);
      setCallFeedback(message);
    });
  }, [callJoinResult, handleTranscriptResults]);

  useEffect(() => {
    const bookingId = callJoinResult?.bookingId;
    if (!bookingId) return;

    const client = connectConsultingConversationSocket({
      bookingId,
      participantType: getRealtimeParticipantType(user),
      authToken: getPartnerSessionToken(),
      onEvent: (event: ConsultingServerSocketEvent) => {
        if (event.type === "caption.translation") {
          setCallCaptions((current) => applyCaptionTranslation(current, event));
        }
      },
    });
    captionSocketRef.current = client;

    return () => {
      client.close();
      if (captionSocketRef.current === client) {
        captionSocketRef.current = null;
      }
    };
  }, [callJoinResult?.bookingId, user]);

  useEffect(() => {
    return () => {
      void stopWebMeeting();
    };
  }, [stopWebMeeting]);

  const selectStatus = (nextStatus: BookingStatus) => {
    setPendingStatus((current) => (current === nextStatus ? null : nextStatus));
    setSaveFeedback("");
  };

  const toggleCallMuted = () => {
    const nextMuted = !isCallMuted;
    chimeClientRef.current?.setMuted(nextMuted);
    setIsCallMuted(nextMuted);
  };

  const toggleCallVideo = () => {
    const nextEnabled = !isCallVideoEnabled;
    setIsCallVideoEnabled(nextEnabled);
    const updateVideo = chimeClientRef.current?.setLocalVideoEnabled(nextEnabled);
    if (!updateVideo) return;
    void updateVideo.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "카메라 상태를 바꾸지 못했습니다.";
      setCallConnectionError(message);
      setCallFeedback(message);
      setIsCallVideoEnabled(!nextEnabled);
    });
  };

  const buildPendingBookingChanges = (extra: BookingSaveChangesInput = {}) => {
    if (!selectedDetail) return extra;
    const changes: BookingSaveChangesInput = {};
    if (hasEditDraftChanges(editDraft, selectedDetail.booking)) {
      changes.patch = buildEditPatch(editDraft);
    }
    if (pendingStatus) changes.status = pendingStatus;
    if (pendingPaymentPaid) changes.markPaymentPaid = true;
    if (noteDraft.trim()) changes.note = noteDraft.trim();
    if (pendingStatus === "cancelled") changes.cancelReason = "운영자 수동 취소";
    return { ...changes, ...extra };
  };

  const handleFlowAction = (actionKey: BookingFlowActionKey) => {
    setSaveFeedback("");
    if (!selectedDetail) return;
    if (actionKey === "contacting") {
      saveChangesMutation.mutate({ bookingId: selectedDetail.booking.id, changes: buildPendingBookingChanges({ status: "contacting" }) });
      return;
    }
    if (actionKey === "payment") {
      saveChangesMutation.mutate({ bookingId: selectedDetail.booking.id, changes: buildPendingBookingChanges({ markPaymentPaid: true }) });
      return;
    }
    if (actionKey === "confirm") {
      saveChangesMutation.mutate({ bookingId: selectedDetail.booking.id, changes: buildPendingBookingChanges({ status: "confirmed" }) });
      return;
    }
    if (actionKey === "start") {
      if (canJoinVideoCall(selectedDetail.booking)) {
        joinCallMutation.mutate(selectedDetail.booking);
        return;
      }
      selectStatus("in_progress");
      return;
    }
    if (actionKey === "summary" && canOpenCompletion(selectedDetail.booking.status)) {
      if (selectedDetail.booking.channel === "video") {
        void endBookingCall(selectedDetail.booking.id, user ?? undefined);
      }
      navigate(`/workspace/completion?bookingId=${selectedDetail.booking.id}`);
    }
  };

  const handleSaveChanges = () => {
    if (!selectedDetail) return;
    const changes = buildPendingBookingChanges();
    saveChangesMutation.mutate({ bookingId: selectedDetail.booking.id, changes });
  };

  useEffect(() => {
    if (!requestedBookingId || selectedBookingId || bookings.length === 0) return;
    const requestedBooking = bookings.find((booking) => booking.id === requestedBookingId);
    if (!requestedBooking) return;
    setAnchorDate(new Date(requestedBooking.startsAt));
    openBooking(requestedBooking);
  }, [bookings, requestedBookingId, selectedBookingId]);

  useEffect(() => {
    if (!requestedCall || !selectedDetail || callJoinResult || joinCallMutation.isPending) return;
    if (autoJoinBookingIdRef.current === selectedDetail.booking.id) return;
    if (!canJoinVideoCall(selectedDetail.booking)) return;
    autoJoinBookingIdRef.current = selectedDetail.booking.id;
    joinCallMutation.mutate(selectedDetail.booking);
  }, [callJoinResult, joinCallMutation, requestedCall, selectedDetail]);

  if (bookingsQuery.isLoading) return <LoadingState label="예약 데이터를 불러오는 중입니다" />;
  if (bookingsQuery.isError) return <ErrorState message={bookingsQuery.error.message} onRetry={() => bookingsQuery.refetch()} />;
  if (settingsQuery.isError) return <ErrorState message={settingsQuery.error.message} onRetry={() => settingsQuery.refetch()} />;

  return (
    <>
      <PageHeader
        eyebrow="Bookings"
        title="앱 예약 관리"
        description="고객 예약 신청 이후 채팅방에서 선결제 또는 예약금 입금을 확인하고, 전문가가 확정한 상담만 화상통화와 AI 요약 리포트로 이어집니다."
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
              <p>설정에서 닫아둔 휴무일과 영업 외 시간은 캘린더에 같이 표시합니다.</p>
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
          {scheduleSummary.length ? (
            <div className="schedule-notice-list" aria-label="예약 운영 제한">
              {scheduleSummary.map((item) => (
                <div className="schedule-notice" key={`${item.dateKey}-${item.reason}`}>
                  <Clock3 size={16} />
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="panel-body">
            <CalendarViewRenderer
              view={view}
              dates={visibleDates}
              bookings={bookings}
              settings={settingsQuery.data}
              onOpenBooking={openBooking}
            />
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
        description={selectedDetail && previewBooking ? `${formatDateTime(previewBooking.startsAt)} · ${selectedDetail.expert.name}` : undefined}
        onClose={closeBooking}
        footer={
          selectedDetail ? (
            <>
              <Button
                variant="secondary"
                icon={<MessageSquareText size={16} />}
                onClick={() => navigate(`/workspace/chat?bookingId=${selectedDetail.booking.id}`)}
              >
                채팅
              </Button>
              <Button
                variant="secondary"
                icon={<Phone size={16} />}
                onClick={() => joinCallMutation.mutate(selectedDetail.booking)}
                disabled={!canJoinVideoCall(selectedDetail.booking) || joinCallMutation.isPending}
              >
                {joinCallMutation.isPending ? "입장 준비 중" : "화상 입장"}
              </Button>
              {canOpenCompletion(selectedDetail.booking.status) ? (
                <Button variant="primary" icon={<CheckCircle2 size={16} />} onClick={() => navigate(`/workspace/completion?bookingId=${selectedDetail.booking.id}`)}>
                  통화 종료/AI 요약
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {detailQuery.isLoading ? <LoadingState label="예약 상세를 불러오는 중입니다" /> : null}
        {selectedDetail && previewBooking ? (
          <div className="settings-section">
            <BookingFlow booking={previewBooking} />
            <dl className="detail-list">
              <div className="detail-row">
                <dt>상태</dt>
                <dd className="tag-list">
                  <BookingStatusBadge status={previewBooking.status} />
                  <PaymentStatusBadge status={previewBooking.paymentStatus} />
                  {hasPendingChanges ? <span className="tag warning">저장 전</span> : null}
                </dd>
              </div>
              <div className="detail-row">
                <dt>고객</dt>
                <dd>{selectedDetail.customer.name} · {selectedDetail.customer.phone}</dd>
              </div>
              <div className="detail-row">
                <dt>상담</dt>
                <dd>
                  {previewBooking.type} · {previewBooking.durationMinutes}분 ·
                  {previewBooking.channel === "video" ? " 1:1 화상" : previewBooking.channel === "chat" ? " 채팅" : " 방문"} ·
                  {formatCurrency(previewBooking.paidAmount)}
                  {previewBooking.discountAmount > 0 ? ` (${formatCurrency(previewBooking.discountAmount)} 할인)` : ""}
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
                <dd>{previewBooking.internalMemo || "등록된 메모 없음"}</dd>
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
                    <AppReportCard
                      compact
                      key={report.id}
                      onClick={() => setSelectedReportId(report.id)}
                      report={report}
                      selected={selectedReportId === report.id}
                    />
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
                  <TextInput
                    value={editDraft.type}
                    onChange={(event) => {
                      setEditDraft((prev) => ({ ...prev, type: event.target.value }));
                      setSaveFeedback("");
                    }}
                  />
                </Field>
                <div className="form-grid">
                  <Field label="예약 날짜">
                    <TextInput
                      type="date"
                      value={editDraft.date}
                      onChange={(event) => {
                        setEditDraft((prev) => ({ ...prev, date: event.target.value }));
                        setSaveFeedback("");
                      }}
                    />
                  </Field>
                  <Field label="시작 시간">
                    <TextInput
                      type="time"
                      value={editDraft.startsAt}
                      onChange={(event) => {
                        setEditDraft((prev) => ({ ...prev, startsAt: event.target.value }));
                        setSaveFeedback("");
                      }}
                    />
                  </Field>
                  <Field label="상담 길이">
                    <SelectInput
                      value={editDraft.durationMinutes}
                      onChange={(event) => {
                        setEditDraft((prev) => ({ ...prev, durationMinutes: Number(event.target.value) as 30 | 60 }));
                        setSaveFeedback("");
                      }}
                    >
                      <option value={30}>30분</option>
                      <option value={60}>1시간</option>
                    </SelectInput>
                  </Field>
                </div>
                <Field label="내부 메모">
                  <TextArea
                    value={editDraft.internalMemo}
                    onChange={(event) => {
                      setEditDraft((prev) => ({ ...prev, internalMemo: event.target.value }));
                      setSaveFeedback("");
                    }}
                  />
                </Field>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>예약 처리</h3>
                  <p>초록색 버튼은 현재 예약에서 바로 해야 할 한 가지 작업입니다.</p>
                </div>
              </div>
              <div className="panel-body settings-section">
                <div className="workflow-action-panel">
                  <div className="workflow-current">
                    <span>현재 상태</span>
                    <strong>{getFlowStageLabel(previewBooking)}</strong>
                    <p>{getFlowStageDescription(previewBooking)}</p>
                  </div>

                  {(() => {
                    const action = getPrimaryFlowAction(previewBooking, selectedDetail.booking);
                    if (!action) {
                      return (
                        <div className="workflow-next-card is-muted">
                          <span>처리 결과</span>
                          <strong>{previewBooking.status === "completed" ? "상담 완료" : "추가 처리 없음"}</strong>
                          <p>{previewBooking.status === "completed" ? "화상 상담과 AI 요약이 완료된 예약입니다." : "이미 종료된 예약은 상태 변경 대신 기록 확인만 진행합니다."}</p>
                        </div>
                      );
                    }

                    return (
                      <div className="workflow-next-card">
                        <div>
                          <span>지금 할 일</span>
                          <strong>{action.label}</strong>
                          <p>{action.description}</p>
                        </div>
                        <Button
                          variant={action.variant}
                          icon={getFlowActionIcon(action.key)}
                          onClick={() => handleFlowAction(action.key)}
                          disabled={action.disabled || saveChangesMutation.isPending || (action.key === "start" && joinCallMutation.isPending)}
                        >
                          {saveChangesMutation.isPending
                            ? "반영 중"
                            : action.key === "start" && joinCallMutation.isPending
                              ? "입장 준비 중"
                              : action.label}
                        </Button>
                      </div>
                    );
                  })()}

                  {selectedDetail.booking.channel === "video" ? (
                    <div className="workflow-call-card">
                      <span>화상 상담</span>
                      <strong>{callJoinResult ? getCallConnectionLabel(callConnectionStatus) : "Chime 입장 전"}</strong>
                      <p>
                        {callConnectionError ||
                          callFeedback ||
                          "상담 시작을 누르면 예약 확정 여부와 입장 가능 시간을 확인한 뒤 Chime 미팅/참가자 정보를 발급합니다."}
                      </p>
                      <div className="workflow-call-language">
                        <Field label="상담 언어">
                          <SelectInput
                            value={callLanguageCode}
                            onChange={(event) => setCallLanguageCode(event.target.value as ConsultingCallLanguageCode)}
                            disabled={Boolean(callJoinResult) || joinCallMutation.isPending}
                          >
                            <option value="ko-KR">한국어</option>
                            <option value="en-US">English</option>
                          </SelectInput>
                        </Field>
                        {callTranscription ? (
                          <span className="tag">{getCallTranscriptionLabel(callTranscription.status, callTranscription.mode)}</span>
                        ) : null}
                      </div>
                      {callJoinResult ? (
                        <>
                          <div className="workflow-call-stage">
                            <div className="workflow-call-video is-remote">
                              <video ref={callRemoteVideoRef} playsInline autoPlay />
                              <span>고객 영상 대기 중</span>
                            </div>
                            <div className="workflow-call-video is-local">
                              <video ref={callLocalVideoRef} playsInline autoPlay muted />
                              <span>{isCallVideoEnabled ? "내 화면" : "카메라 꺼짐"}</span>
                            </div>
                            {callCaptions.length ? (
                              <div className="workflow-call-captions" aria-live="polite">
                                {callCaptions.slice(-4).map((caption) => (
                                  <div className={`workflow-call-caption ${caption.isPartial ? "is-partial" : ""}`} key={caption.id}>
                                    <span>{caption.speakerLabel}</span>
                                    <strong>{caption.transcript}</strong>
                                    {caption.translatedContent ? <em>{caption.translatedContent}</em> : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            <audio ref={callAudioRef} autoPlay />
                          </div>
                          <div className="workflow-call-controls">
                            <Button variant="secondary" icon={isCallMuted ? <MicOff size={16} /> : <Mic size={16} />} onClick={toggleCallMuted}>
                              {isCallMuted ? "마이크 켜기" : "마이크 끄기"}
                            </Button>
                            <Button variant="secondary" icon={isCallVideoEnabled ? <Video size={16} /> : <VideoOff size={16} />} onClick={toggleCallVideo}>
                              {isCallVideoEnabled ? "카메라 끄기" : "카메라 켜기"}
                            </Button>
                            {callTranscription?.enabled ? (
                              callTranscription.status === "active" || callTranscription.status === "starting" ? (
                                <Button
                                  variant="secondary"
                                  onClick={() => stopTranscriptionMutation.mutate(selectedDetail.booking)}
                                  disabled={stopTranscriptionMutation.isPending || callTranscription.status === "starting"}
                                >
                                  {stopTranscriptionMutation.isPending ? "자막 중지 중" : "자막 중지"}
                                </Button>
                              ) : (
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    const accepted = window.confirm(
                                      "고객과 상담사가 실시간 음성 인식 및 번역 자막 사용에 동의했나요?",
                                    );
                                    if (accepted) {
                                      startTranscriptionMutation.mutate({
                                        booking: selectedDetail.booking,
                                        transcriptionConsentAccepted: true,
                                      });
                                    }
                                  }}
                                  disabled={startTranscriptionMutation.isPending || callTranscription.status === "stopping"}
                                >
                                  {startTranscriptionMutation.isPending ? "자막 시작 중" : "자막 시작"}
                                </Button>
                              )
                            ) : null}
                          </div>
                          <small>세션 {callJoinResult.callSessionId.slice(0, 8)}</small>
                        </>
                      ) : canJoinVideoCall(selectedDetail.booking) ? (
                        <Button
                          variant="secondary"
                          icon={<Video size={16} />}
                          onClick={() => joinCallMutation.mutate(selectedDetail.booking)}
                          disabled={joinCallMutation.isPending}
                        >
                          {joinCallMutation.isPending ? "입장 준비 중" : "Chime 입장"}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="workflow-status-grid">
                    <div>
                      <span>입금 상태</span>
                      <strong>{previewBooking.paymentStatus === "paid" ? "입금 확인 완료" : "입금 확인 전"}</strong>
                    </div>
                    <div>
                      <span>저장 상태</span>
                      <strong>{hasPendingChanges ? "저장 전 변경 있음" : "저장됨"}</strong>
                    </div>
                  </div>

                  {canUseExceptionActions(selectedDetail.booking.status) ? (
                    <div className="workflow-exception-row">
                      <Button variant={previewBooking.status === "no_show" ? "primary" : "secondary"} icon={<XCircle size={16} />} onClick={() => selectStatus("no_show")}>
                        {previewBooking.status === "no_show" ? "노쇼 선택됨" : "노쇼 처리"}
                      </Button>
                      <Button variant={previewBooking.status === "cancelled" ? "danger" : "secondary"} icon={<XCircle size={16} />} onClick={() => selectStatus("cancelled")}>
                        {previewBooking.status === "cancelled" ? "취소 선택됨" : "예약 취소"}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <Field label="메모 추가">
                  <TextArea
                    value={noteDraft}
                    onChange={(event) => {
                      setNoteDraft(event.target.value);
                      setSaveFeedback("");
                    }}
                    placeholder="상담 전 확인사항, 고객 연락 기록, 운영 메모를 추가하세요."
                  />
                </Field>
                <div className={`save-status ${hasPendingChanges ? "is-pending" : ""}`}>
                  {hasPendingChanges ? "예약 정보, 메모 또는 예외 처리가 아직 저장되지 않았습니다." : "모든 변경사항이 저장되어 있습니다."}
                </div>
                {saveFeedback ? <div className="form-success">{saveFeedback}</div> : null}
                {saveChangesMutation.isError ? <div className="form-error">{saveChangesMutation.error.message}</div> : null}
                <Button
                  variant="primary"
                  icon={<Save size={16} />}
                  disabled={!hasPendingChanges || saveChangesMutation.isPending}
                  onClick={handleSaveChanges}
                >
                  {saveChangesMutation.isPending ? "저장 중" : "변경사항 저장"}
                </Button>
              </div>
            </section>
          </div>
        ) : null}
      </Drawer>

      <Modal
        bodyClassName="report-viewer-body"
        className="report-viewer-modal"
        open={Boolean(selectedReportId)}
        title={selectedReport?.title ?? "리포트 상세"}
        onClose={() => setSelectedReportId(null)}
        footer={
          <Button variant="primary" onClick={() => setSelectedReportId(null)}>
            확인
          </Button>
        }
      >
        {selectedReport ? <AppReportCard className="report-modal-card" report={selectedReport} /> : null}
      </Modal>
    </>
  );
}

function mergeTranscriptCaptions(
  current: CallCaptionViewModel[],
  results: WebChimeTranscriptResult[],
  fallbackLanguageCode: ConsultingCallLanguageCode,
) {
  const next = [...current];
  for (const result of results) {
    const transcript = result.transcript.trim();
    if (!result.resultId || !transcript) continue;

    const caption: CallCaptionViewModel = {
      id: result.resultId,
      isPartial: result.isPartial,
      resultId: result.resultId,
      sourceLanguageCode: normalizeTranscriptLanguageCode(result.languageCode) ?? fallbackLanguageCode,
      speakerLabel: getCaptionSpeakerLabel(result.speakerExternalUserId),
      transcript,
    };
    const existingIndex = next.findIndex((item) => item.resultId === caption.resultId);
    if (existingIndex >= 0) {
      next[existingIndex] = {
        ...next[existingIndex],
        ...caption,
        targetLanguageCode: next[existingIndex].targetLanguageCode,
        translatedContent: next[existingIndex].translatedContent,
      };
    } else {
      next.push(caption);
    }
  }
  return next.slice(-16);
}

function applyCaptionTranslation<T extends ConsultingCaptionTranslation>(
  current: CallCaptionViewModel[],
  translation: T,
) {
  return current.map((caption) =>
    caption.resultId === translation.resultId
      ? {
          ...caption,
          sourceLanguageCode: translation.sourceLanguageCode,
          targetLanguageCode: translation.targetLanguageCode,
          translatedContent: translation.translatedContent,
        }
      : caption,
  );
}

function normalizeTranscriptLanguageCode(value?: string): ConsultingCallLanguageCode | null {
  if (value === "ko-KR" || value?.toLowerCase().startsWith("ko")) return "ko-KR";
  if (value === "en-US" || value?.toLowerCase().startsWith("en")) return "en-US";
  return null;
}

function getCaptionSpeakerLabel(externalUserId?: string) {
  if (externalUserId?.startsWith("customer:")) return "고객";
  if (externalUserId?.startsWith("partner:")) return "상담사";
  return "참가자";
}

function getRealtimeParticipantType(user: { role?: string } | null): ConsultingParticipantType {
  return user?.role === "admin" || user?.role === "operator" ? "operator" : "expert";
}

function CalendarViewRenderer({
  bookings,
  dates,
  onOpenBooking,
  settings,
  view,
}: {
  view: CalendarView;
  dates: Date[];
  bookings: Booking[];
  settings?: ManagerSettings;
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
          const dateStatus = getDateOperatingStatus(date, settings);
          return (
            <div className={`calendar-cell ${dateStatus.isClosed ? "is-closed" : ""}`} key={date.toISOString()}>
              <div className="calendar-date-row">
                <span className="calendar-date">{date.getDate()}</span>
                {dateStatus.isClosed ? <span className="closed-badge">{dateStatus.reason}</span> : null}
              </div>
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
      <div className="calendar-head time-head">시간</div>
      {dates.map((date) => (
        <div className="calendar-head day-head" key={date.toISOString()}>
          <strong>{formatDate(date.toISOString())}</strong>
          <span>{getDateOperatingSummary(date, settings)}</span>
        </div>
      ))}
      {slotTimes.map((time) => (
        <Fragment key={time}>
          <div className="time-cell" key={`${time}-label`}>{time}</div>
          {dates.map((date) => {
            const slotBookings = bookingsForDate(bookings, date).filter((booking) => getLocalTimeKey(booking.startsAt) === time);
            const closedReason = getSlotClosedReason(date, time, settings);
            return (
              <div className={`slot-cell ${closedReason ? "is-closed" : ""}`} key={`${date.toISOString()}-${time}`}>
                {closedReason ? <span className="slot-closed-label">{closedReason}</span> : null}
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

function buildVisibleScheduleSummary(dates: Date[], settings?: ManagerSettings): ScheduleNotice[] {
  if (!settings) return [];
  const visibleDateKeys = new Set(dates.map((date) => getLocalDateKey(date)));
  const visibleOperatingDays = new Set(dates.map(getOperatingDayOfWeek));
  const notices: ScheduleNotice[] = [];

  notices.push({
    dateKey: "booking-open-days",
    label: "예약 오픈",
    reason: `오늘부터 ${settings.bookingOpenMonths ?? 1}개월`,
  });

  const holidays = (settings.holidays ?? []).filter((dateKey) => visibleDateKeys.has(dateKey));
  if (holidays.length) {
    notices.push({
      dateKey: "holidays",
      label: "휴무일",
      reason: formatLimitedList(holidays, 4),
    });
  }

  const closedDays = (settings.operatingHours ?? [])
    .filter((hour) => visibleOperatingDays.has(hour.dayOfWeek) && hour.isClosed)
    .map((hour) => hour.label);
  if (closedDays.length) {
    notices.push({
      dateKey: "closed-days",
      label: "휴무 요일",
      reason: closedDays.join(", "),
    });
  }

  const lunchHours = (settings.operatingHours ?? [])
    .filter((hour) => visibleOperatingDays.has(hour.dayOfWeek) && !hour.isClosed && hour.lunchStart && hour.lunchEnd)
    .map((hour) => `${hour.label} ${hour.lunchStart}-${hour.lunchEnd}`);
  if (lunchHours.length) {
    notices.push({
      dateKey: "lunch-hours",
      label: "점심 차단",
      reason: formatLimitedList(lunchHours, 3),
    });
  }

  return notices;
}

function getDateOperatingStatus(date: Date, settings?: ManagerSettings) {
  const windowReason = getBookingWindowClosedReason(date, settings);
  if (windowReason) {
    return { isClosed: true, reason: windowReason };
  }
  const dateKey = getLocalDateKey(date);
  if (settings?.holidays?.includes(dateKey)) {
    return { isClosed: true, reason: "휴무일" };
  }
  const hour = getOperatingHourForDate(date, settings);
  if (hour?.isClosed) {
    return { isClosed: true, reason: "휴무" };
  }
  return { isClosed: false, reason: "" };
}

function getDateOperatingSummary(date: Date, settings?: ManagerSettings) {
  const dateStatus = getDateOperatingStatus(date, settings);
  if (dateStatus.isClosed) return dateStatus.reason;
  const hour = getOperatingHourForDate(date, settings);
  if (!hour) return "운영 설정 없음";
  const lunch = hour.lunchStart && hour.lunchEnd ? ` · 점심 ${hour.lunchStart}-${hour.lunchEnd}` : "";
  return `${hour.opensAt}-${hour.closesAt}${lunch}`;
}

function getSlotClosedReason(date: Date, time: string, settings?: ManagerSettings) {
  const dateStatus = getDateOperatingStatus(date, settings);
  if (dateStatus.isClosed) return dateStatus.reason;
  const hour = getOperatingHourForDate(date, settings);
  if (!hour) return "";
  if (time < hour.opensAt) return "영업 전";
  if (time >= hour.closesAt) return "마감";
  if (hour.lunchStart && hour.lunchEnd && time >= hour.lunchStart && time < hour.lunchEnd) return "점심";
  return "";
}

function getBookingWindowClosedReason(date: Date, settings?: ManagerSettings) {
  if (!settings?.bookingOpenMonths) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  const openUntil = addCalendarMonths(today, settings.bookingOpenMonths);
  openUntil.setHours(0, 0, 0, 0);
  if (targetDate > openUntil) return "미오픈";
  return "";
}

function addCalendarMonths(date: Date, months: number) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDayOfTargetMonth));
  return result;
}

function getOperatingHourForDate(date: Date, settings?: ManagerSettings): OperatingHours | undefined {
  const dayOfWeek = getOperatingDayOfWeek(date);
  return settings?.operatingHours?.find((hour) => hour.dayOfWeek === dayOfWeek);
}

function getOperatingDayOfWeek(date: Date) {
  return (date.getDay() + 6) % 7;
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLimitedList(values: string[], limit: number) {
  const visible = values.slice(0, limit).join(", ");
  const hiddenCount = values.length - limit;
  return hiddenCount > 0 ? `${visible} 외 ${hiddenCount}건` : visible;
}

function BookingPill({ booking, onClick }: { booking: Booking; onClick: () => void }) {
  return (
    <button type="button" className={`booking-pill ${booking.status}`} onClick={onClick}>
      <strong>
        <span>{formatTime(booking.startsAt)}</span>
        <span>{getCustomerName(booking.customerId)}</span>
      </strong>
      <small>{booking.type}</small>
      <span>리포트 {booking.sharedReportIds.length}개</span>
    </button>
  );
}

function makeEditDraft(booking: Booking): BookingEditDraft {
  return {
    type: booking.type,
    internalMemo: booking.internalMemo,
    date: toInputDate(booking.startsAt),
    startsAt: getLocalTimeKey(booking.startsAt),
    durationMinutes: booking.durationMinutes,
  };
}

function buildEditPatch(draft: BookingEditDraft): NonNullable<BookingSaveChangesInput["patch"]> {
  const startsAt = toIsoFromLocalInput(draft.date, draft.startsAt);
  const endsAtDate = new Date(startsAt);
  endsAtDate.setMinutes(endsAtDate.getMinutes() + draft.durationMinutes);
  return {
    type: draft.type,
    internalMemo: draft.internalMemo,
    durationMinutes: draft.durationMinutes,
    startsAt,
    endsAt: endsAtDate.toISOString(),
  };
}

function hasEditDraftChanges(draft: BookingEditDraft, booking: Booking) {
  return (
    draft.type !== booking.type ||
    draft.internalMemo !== booking.internalMemo ||
    draft.date !== toInputDate(booking.startsAt) ||
    draft.startsAt !== getLocalTimeKey(booking.startsAt) ||
    draft.durationMinutes !== booking.durationMinutes
  );
}

function makePreviewBooking(booking: Booking, draft: BookingEditDraft, pendingStatus: BookingStatus | null, pendingPaymentPaid: boolean): Booking {
  const patch = buildEditPatch(draft);
  const preview: Booking = {
    ...booking,
    ...patch,
  };
  if (pendingPaymentPaid) {
    preview.paymentStatus = "paid";
    if (!pendingStatus && booking.status === "requested") {
      preview.status = "contacting";
    }
  }
  if (pendingStatus) {
    preview.status = pendingStatus;
  }
  return preview;
}

function getFlowStageLabel(booking: Booking) {
  if (booking.status === "completed") return "자동 완료";
  if (booking.status === "cancelled") return "예약 취소";
  if (booking.status === "no_show") return "노쇼";
  if (booking.status === "refund_requested") return "환불 요청";
  if (booking.status === "in_progress") return "상담 진행";
  if (booking.status === "scheduled") return "상담 예정";
  if (booking.status === "confirmed") return "전문가 확정";
  if (booking.status === "contacting" && booking.paymentStatus === "paid") return "입금 확인 완료";
  if (booking.status === "contacting") return "채팅/입금 확인";
  return "예약 신청";
}

function getFlowStageDescription(booking: Booking) {
  if (booking.status === "requested" && booking.paymentStatus === "paid") return "입금이 확인되었고 전문가 확정을 기다리는 단계입니다.";
  if (booking.status === "requested") return "예약 신청이 들어왔고, 채팅방에서 선결제 또는 예약금 안내를 시작할 단계입니다.";
  if (booking.status === "contacting" && booking.paymentStatus !== "paid") return "채팅방에서 입금 여부를 확인한 뒤 다음 단계로 넘깁니다.";
  if (booking.status === "contacting" && booking.paymentStatus === "paid") return "입금이 확인되었고 전문가 확정을 기다리는 단계입니다.";
  if (booking.status === "confirmed" || booking.status === "scheduled") return "예약이 확정되었고 상담 시작 전 단계입니다.";
  if (booking.status === "in_progress") return "상담이 진행 중입니다. 통화가 끝나면 AI 요약 리포트를 생성합니다.";
  if (booking.status === "completed") return "화상 상담 종료 후 AI 요약 리포트까지 완료된 상태입니다.";
  if (booking.status === "cancelled") return "취소된 예약입니다. 필요하면 내부 메모만 추가하세요.";
  if (booking.status === "no_show") return "고객 노쇼로 처리된 예약입니다. 필요하면 내부 메모만 추가하세요.";
  return "운영 확인이 필요한 예약입니다.";
}

function getPrimaryFlowAction(previewBooking: Booking, savedBooking: Booking): BookingFlowAction | null {
  if (["completed", "cancelled", "no_show", "refund_requested"].includes(previewBooking.status)) {
    return null;
  }

  if (previewBooking.status === "requested") {
    return {
      description: "채팅방에서 입금 안내와 고객 확인을 시작합니다.",
      key: "contacting",
      label: "채팅/입금 확인 시작",
      variant: "primary",
    };
  }

  if (previewBooking.paymentStatus !== "paid") {
    return {
      description: "선결제 또는 예약금 입금이 확인되면 다음 저장 때 반영합니다.",
      key: "payment",
      label: "입금 확인",
      variant: "primary",
    };
  }

  if (previewBooking.status === "contacting") {
    return {
      description: "입금 확인 후 전문가가 예약을 확정합니다.",
      key: "confirm",
      label: "전문가 확정",
      variant: "primary",
    };
  }

  if (previewBooking.status === "confirmed" || previewBooking.status === "scheduled") {
    return {
      description: "상담 시간이 되었을 때 화상 상담 진행 상태로 넘깁니다.",
      key: "start",
      label: "상담 시작",
      variant: "primary",
    };
  }

  if (previewBooking.status === "in_progress") {
    return {
      description: canOpenCompletion(savedBooking.status)
        ? "통화를 종료하고 AI 상담 요약 리포트를 생성합니다."
        : "상담 시작 변경사항을 저장한 뒤 통화 종료와 AI 요약을 진행할 수 있습니다.",
      disabled: !canOpenCompletion(savedBooking.status),
      key: "summary",
      label: "통화 종료/AI 요약",
      variant: "primary",
    };
  }

  return null;
}

function getFlowActionIcon(actionKey: BookingFlowActionKey) {
  if (actionKey === "payment") return <CreditCard size={16} />;
  if (actionKey === "confirm" || actionKey === "summary") return <CheckCircle2 size={16} />;
  if (actionKey === "start") return <Video size={16} />;
  return <Clock3 size={16} />;
}

function getCallConnectionLabel(status: string) {
  if (status === "connecting") return "Chime 연결 중";
  if (status === "failed") return "연결 실패";
  if (status === "stopped") return "통화 종료됨";
  if (status.includes("시작")) return "화상 상담 연결됨";
  if (status.includes("종료")) return "통화 종료됨";
  return "Chime 입장 준비 완료";
}

function getCallTranscriptionLabel(status: string, mode: string) {
  if (status === "disabled") return "자막 꺼짐";
  if (status === "starting") return "자막 시작 중";
  if (status === "active") return mode === "identify" ? "자막 켜짐 · 한/영 자동" : "자막 켜짐";
  if (status === "stopping") return "자막 중지 중";
  if (status === "failed") return "자막 오류";
  return "자막 대기";
}

function canJoinVideoCall(booking: Booking) {
  return booking.channel === "video" && ["confirmed", "scheduled", "in_progress"].includes(booking.status);
}

function canUseExceptionActions(status: BookingStatus) {
  return !["completed", "cancelled", "no_show", "refund_requested"].includes(status);
}

function BookingFlow({ booking }: { booking: Booking }) {
  const steps = [
    { key: "requested", label: "신청", done: ["requested", "contacting", "confirmed", "scheduled", "in_progress", "completed"].includes(booking.status) },
    { key: "chat", label: "채팅방", done: ["contacting", "confirmed", "scheduled", "in_progress", "completed"].includes(booking.status) },
    { key: "payment", label: "입금", done: booking.paymentStatus === "paid" },
    { key: "confirmed", label: "전문가 확정", done: ["confirmed", "scheduled", "in_progress", "completed"].includes(booking.status) },
    { key: "summary", label: "AI 요약", done: booking.status === "completed" },
  ];
  return (
    <section className="booking-flow">
      {steps.map((step) => (
        <div className={step.done ? "is-done" : ""} key={step.key}>
          <span>{step.done ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}</span>
          <strong>{step.label}</strong>
        </div>
      ))}
    </section>
  );
}

function canOpenCompletion(status: BookingStatus) {
  return status === "scheduled" || status === "in_progress" || status === "completed";
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
