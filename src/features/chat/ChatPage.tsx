import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, FileImage, Languages, LogOut, Mic, MicOff, Phone, PhoneOff, Search, Send, Video, VideoOff } from "lucide-react";
import {
  endBookingCall,
  getChatThreadDetail,
  getChatThreads,
  getPartnerSessionToken,
  joinBookingCall,
  leaveChatThread,
  markChatThreadRead,
  sendMessage as sendChatText,
  startBookingCallTranscription,
  translateBookingCallCaption,
  uploadChatAttachment,
} from "../../services/api";
import type { WebChimeMeetingController, WebChimeTranscriptResult } from "../../services/chimeMeetingClient";
import {
  connectConsultingConversationSocket,
  type ConsultingConversationSocketClient,
  type ConsultingRealtimeMessageEvent,
  type ConsultingServerSocketEvent,
  type ConsultingSocketStatus,
} from "../../services/consultingRealtime";
import { useAuth } from "../auth/AuthContext";
import { Badge, BookingStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Modal } from "../../shared/ui/Modal";
import { TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { formatDateTime, formatTime } from "../../shared/utils/format";
import type { Attachment, AuthUser, BookingStatus, ChatMessage, ConsultingCallLanguageCode } from "../../types/domain";
import { AppReportCard } from "../reports/AppReportCard";

export function ChatPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastMarkedReadThreadRef = useRef<string | null>(null);
  const lastAppliedComposeRef = useRef<string | null>(null);
  const socketRef = useRef<ConsultingConversationSocketClient | null>(null);
  const callControllerRef = useRef<WebChimeMeetingController | null>(null);
  const callRemoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const callLocalVideoRef = useRef<HTMLVideoElement | null>(null);
  const callAudioRef = useRef<HTMLAudioElement | null>(null);
  const callTranscriptRef = useRef<Map<string, string>>(new Map());
  const callTranslationActiveRef = useRef(false);
  const [query, setQuery] = useState("");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [socketStatus, setSocketStatus] = useState<ConsultingSocketStatus>("idle");
  const [liveMessages, setLiveMessages] = useState<LiveChatMessage[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [realtimeNotice, setRealtimeNotice] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [callStatus, setCallStatus] = useState("화상통화 시작 전");
  const [callError, setCallError] = useState("");
  const [callMuted, setCallMuted] = useState(false);
  const [callVideoEnabled, setCallVideoEnabled] = useState(true);
  const [callTranslationActive, setCallTranslationActive] = useState(false);
  const [callLanguageCode, setCallLanguageCode] = useState<ConsultingCallLanguageCode>("ko-KR");
  const [callCaptions, setCallCaptions] = useState<LiveCallCaption[]>([]);
  const [callSummaryPending, setCallSummaryPending] = useState(false);
  const requestedBookingId = searchParams.get("bookingId")?.trim() ?? "";
  const composeTemplate = searchParams.get("compose")?.trim() ?? "";
  const chatThreadsQueryKey = useMemo(
    () => ["chat-threads", user?.id, user?.businessId, user?.expertId, user?.workspaceScope] as const,
    [user?.businessId, user?.expertId, user?.id, user?.workspaceScope],
  );
  const partnerSessionToken = getPartnerSessionToken();
  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadChatAttachment(file, user ?? undefined),
    onSuccess: (attachment) => {
      setPendingAttachments((current) => [...current, attachment]);
    },
  });
  const leaveThreadMutation = useMutation({
    mutationFn: (threadId: string) => leaveChatThread(threadId, user ?? undefined),
    onSuccess: () => {
      socketRef.current?.close();
      setActiveThreadId(null);
      setLiveMessages([]);
      setRealtimeNotice("대화방에서 나갔습니다. 같은 고객의 다음 예약은 새 대화방에서 시작됩니다.");
      queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });
  const handleCallTranscriptResults = (bookingId: string, results: WebChimeTranscriptResult[]) => {
    setCallCaptions((current) => mergeCallCaptions(current, results));
    for (const result of results) {
      if (result.isPartial) continue;
      callTranscriptRef.current.set(result.resultId, result.transcript);
      if (!callTranslationActiveRef.current) continue;
      const sourceLanguageCode = result.languageCode === "en-US" ? "en-US" : "ko-KR";
      void translateBookingCallCaption(
        bookingId,
        { resultId: result.resultId, sourceLanguageCode, content: result.transcript },
        user ?? undefined,
      ).then((translation) => {
        setCallCaptions((current) => current.map((caption) =>
          caption.resultId === translation.resultId
            ? { ...caption, translatedContent: translation.translatedContent }
            : caption,
        ));
      }).catch((error: unknown) => {
        setCallError(error instanceof Error ? error.message : "실시간 번역에 실패했습니다.");
      });
    }
  };
  const joinCallMutation = useMutation({
    mutationFn: (bookingId: string) => joinBookingCall(bookingId, callLanguageCode, user ?? undefined),
    onSuccess: async (result) => {
      if (!callRemoteVideoRef.current || !callLocalVideoRef.current || !callAudioRef.current) {
        setCallError("화상통화 화면을 준비하지 못했습니다. 창을 닫고 다시 시도해 주세요.");
        return;
      }
      try {
        setCallStatus("카메라와 마이크를 연결하는 중입니다.");
        const { startWebChimeMeeting } = await import("../../services/chimeMeetingClient");
        callControllerRef.current = await startWebChimeMeeting(result, {
          remoteVideoElement: callRemoteVideoRef.current,
          localVideoElement: callLocalVideoRef.current,
          audioElement: callAudioRef.current,
          onStatusChange: setCallStatus,
          onTranscriptResults: (results) => handleCallTranscriptResults(result.bookingId, results),
          onTranscriptionStatus: (status) => setCallStatus(status.message || "실시간 자막 상태를 확인하고 있습니다."),
        });
        setCallStatus("화상통화 방이 열렸습니다. 고객의 입장을 기다리고 있습니다.");
      } catch (error) {
        setCallError(error instanceof Error ? error.message : "Chime 화상통화 연결에 실패했습니다.");
      }
    },
    onError: (error) => {
      setCallError(error instanceof Error ? error.message : "Chime 미팅 생성에 실패했습니다.");
    },
  });

  const threadsQuery = useQuery({
    queryKey: chatThreadsQueryKey,
    queryFn: () => getChatThreads(user ?? undefined),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const filteredThreads = useMemo(() => {
    const source = threadsQuery.data ?? [];
    if (!query) return source;
    const keyword = query.toLowerCase();
    return source.filter((item) => [item.customer.name, item.customer.phone, item.booking?.type, lastMessage(item)?.body].filter(Boolean).some((value) => value!.toLowerCase().includes(keyword)));
  }, [query, threadsQuery.data]);

  useEffect(() => {
    if (activeThreadId && !filteredThreads.some((item) => item.thread.id === activeThreadId)) {
      setActiveThreadId(null);
      return;
    }
    if (!activeThreadId && filteredThreads.length > 0) {
      const requestedThread = requestedBookingId
        ? filteredThreads.find((item) => item.booking?.id === requestedBookingId)
        : undefined;
      setActiveThreadId((requestedThread ?? filteredThreads[0]).thread.id);
    }
  }, [activeThreadId, filteredThreads, requestedBookingId]);

  const detailQuery = useQuery({
    queryKey: ["chat-thread-detail", activeThreadId, user?.id, user?.businessId],
    queryFn: () => getChatThreadDetail(activeThreadId!, user ?? undefined),
    enabled: Boolean(activeThreadId),
    refetchInterval: socketStatus === "connected" ? false : 2_000,
    refetchIntervalInBackground: true,
  });

  const detail = detailQuery.data;
  const selectedReport = detail?.sharedReports.find((report) => report.id === selectedReportId);
  const activeBookingId = detail?.booking?.id;
  const isClosedBooking = Boolean(
    detail?.thread.status === "closed" || (detail?.booking && isClosedBookingStatus(detail.booking.status)),
  );
  const socketBookingId = useMemo(() => {
    const override = new URLSearchParams(window.location.search).get("bookingId")?.trim();
    return activeBookingId || override;
  }, [activeBookingId]);
  useEffect(() => {
    setLiveMessages(detail?.messages ?? []);
    setPendingAttachments([]);
    setSelectedReportId(null);
  }, [detail?.thread.id]);

  useEffect(() => {
    if (!composeTemplate || !detail?.booking?.id || detail.booking.id !== requestedBookingId) return;
    const composeKey = `${detail.booking.id}:${composeTemplate}`;
    if (lastAppliedComposeRef.current === composeKey) return;
    lastAppliedComposeRef.current = composeKey;
    setMessage(composeTemplate);
    setRealtimeNotice("입금 안내 문구를 채웠습니다. 계좌 정보를 확인한 뒤 전송하세요.");
    window.setTimeout(() => setRealtimeNotice(null), 5200);
  }, [composeTemplate, detail?.booking?.id, requestedBookingId]);

  useEffect(() => {
    if (!detail?.thread.id || lastMarkedReadThreadRef.current === detail.thread.id) return;
    lastMarkedReadThreadRef.current = detail.thread.id;
    void markChatThreadRead(detail.thread.id, user ?? undefined)
      .then(() => {
        void threadsQuery.refetch();
        queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      })
      .catch(() => undefined);
  }, [detail?.thread.id, queryClient, threadsQuery, user]);

  useEffect(() => {
    if (!socketBookingId || !detail) {
      setSocketStatus("idle");
      return;
    }

    const client = connectConsultingConversationSocket({
      bookingId: socketBookingId,
      onEvent: (event) => {
        if (event.type === "message.ack") {
          setLiveMessages((current) =>
            current.map((item) =>
              item.clientMessageId === event.clientMessageId
                ? { ...item, id: event.messageId, sentAt: event.sentAt, deliveryStatus: "sent" }
                : item,
            ),
          );
          return;
        }

        if (event.type === "message.history") {
          const historyMessages = event.messages.map((item) => mapSocketMessage(item, detail.thread.id));
          setLiveMessages((current) => mergeHistoryMessages(current, historyMessages));
          return;
        }

        if (event.type === "message.new") {
          const nextMessage = mapSocketMessage(event, detail.thread.id);
          setLiveMessages((current) => {
            const existingIndex = current.findIndex((item) => item.id === event.id || (event.clientMessageId && item.clientMessageId === event.clientMessageId));
            if (existingIndex < 0) return [...current, nextMessage];
            return current.map((item, index) =>
              index === existingIndex
                ? { ...item, id: event.id, sentAt: event.sentAt, deliveryStatus: "sent" }
                : item,
            );
          });
          if (nextMessage.senderType === "customer") {
            setRealtimeNotice(`${nextMessage.senderName} 고객 메시지가 도착했습니다.`);
            window.setTimeout(() => setRealtimeNotice(null), 4200);
            socketRef.current?.send({
              bookingId: socketBookingId,
              readAt: new Date().toISOString(),
              type: "read",
            });
            void markChatThreadRead(detail.thread.id, user ?? undefined)
              .then(() => threadsQuery.refetch())
              .catch(() => undefined);
            void threadsQuery.refetch();
            void detailQuery.refetch();
          }
        }

        if (event.type === "booking.status") {
          setRealtimeNotice(event.message);
          window.setTimeout(() => setRealtimeNotice(null), 5200);
          void threadsQuery.refetch();
          void detailQuery.refetch();
          queryClient.invalidateQueries({ queryKey: ["bookings"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
        }

        if (event.type === "call.status") {
          setRealtimeNotice(event.message);
          window.setTimeout(() => setRealtimeNotice(null), 5200);
          void detailQuery.refetch();
        }

        if (event.type === "conversation.left") {
          setRealtimeNotice(event.message);
          void detailQuery.refetch();
          void threadsQuery.refetch();
          return;
        }

        if (event.type === "error" && event.clientMessageId) {
          setLiveMessages((current) =>
            current.map((item) =>
              item.clientMessageId === event.clientMessageId
                ? { ...item, deliveryStatus: "failed" }
                : item,
            ),
          );
        }
      },
      onStatusChange: setSocketStatus,
      participantType: getParticipantType(user),
      authToken: partnerSessionToken,
    });
    socketRef.current = client;

    return () => {
      client.close();
      if (socketRef.current === client) {
        socketRef.current = null;
      }
    };
  }, [detail?.thread.id, partnerSessionToken, socketBookingId, user]);

  const sendLiveMessage = async (targetMessage: LiveChatMessage) => {
    if (!socketBookingId || !detail) return false;
    const clientMessageId = targetMessage.clientMessageId ?? targetMessage.id;
    const sentBySocket = socketRef.current?.sendMessage({
      bookingId: socketBookingId,
      body: targetMessage.body,
      clientMessageId,
      mediaIds: targetMessage.attachments.map((attachment) => attachment.id),
    });
    if (sentBySocket) return true;

    try {
      const delivered = await sendChatText(
        detail.thread.id,
        targetMessage.body,
        targetMessage.attachments.map((attachment) => attachment.id),
        user ?? undefined,
        clientMessageId,
      );
      setLiveMessages((current) =>
        current.map((item) =>
          item.clientMessageId === clientMessageId
            ? { ...item, id: delivered.id, sentAt: delivered.sentAt, deliveryStatus: "sent" }
            : item,
        ),
      );
      setRealtimeNotice("실시간 연결이 끊겨 일반 메시지 전송으로 처리했습니다.");
      window.setTimeout(() => setRealtimeNotice(null), 4200);
      return true;
    } catch {
      return false;
    }
  };

  const retryMessage = (targetMessage: LiveChatMessage) => {
    setLiveMessages((current) =>
      current.map((item) =>
        item.clientMessageId === targetMessage.clientMessageId
          ? { ...item, deliveryStatus: "pending" }
          : item,
      ),
    );

    void sendLiveMessage(targetMessage).then((sent) => {
      if (sent) return;
      setLiveMessages((current) =>
        current.map((item) =>
          item.clientMessageId === targetMessage.clientMessageId
            ? { ...item, deliveryStatus: "failed" }
            : item,
        ),
      );
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const body = message.trim();
    if ((!body && pendingAttachments.length === 0) || !activeThreadId || !detail || !socketBookingId || isClosedBooking) return;
    const clientMessageId = createClientMessageId();
    const nextMessage: LiveChatMessage = {
      id: clientMessageId,
      threadId: detail.thread.id,
      senderType: getOutgoingSenderType(user),
      senderName: user?.name ?? "운영팀",
      body,
      sentAt: new Date().toISOString(),
      attachments: pendingAttachments,
      clientMessageId,
      deliveryStatus: "pending",
    };
    setLiveMessages((current) => [...current, nextMessage]);
    setMessage("");
    setPendingAttachments([]);

    void sendLiveMessage(nextMessage).then((sent) => {
      if (sent) return;
      setLiveMessages((current) =>
        current.map((item) =>
          item.clientMessageId === clientMessageId ? { ...item, deliveryStatus: "failed" } : item,
        ),
      );
    });
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    uploadMutation.mutate(file);
  };

  const openVideoCall = () => {
    if (!detail?.booking) return;
    if (!canStartVideoCall(detail.booking.status, detail.booking.channel)) {
      setRealtimeNotice("예약 확정 후 내 채팅에서 화상통화를 시작할 수 있습니다.");
      window.setTimeout(() => setRealtimeNotice(null), 5200);
      return;
    }
    setCallError("");
    setCallStatus("Chime 화상통화 방을 만드는 중입니다.");
    setCallCaptions([]);
    setCallTranslationActive(false);
    callTranslationActiveRef.current = false;
    callTranscriptRef.current.clear();
    setSelectedReportId(detail.sharedReports[0]?.id ?? null);
    setCallOpen(true);
    window.setTimeout(() => joinCallMutation.mutate(detail.booking!.id), 0);
  };

  const closeVideoCall = async () => {
    await callControllerRef.current?.stop().catch(() => undefined);
    callControllerRef.current = null;
    setCallOpen(false);
    setCallMuted(false);
    setCallVideoEnabled(true);
    setCallTranslationActive(false);
    callTranslationActiveRef.current = false;
  };

  const endVideoCall = async () => {
    const bookingId = detail?.booking?.id;
    const transcript = [...callTranscriptRef.current.values()].join("\n").trim();
    await closeVideoCall();
    if (!bookingId) return;
    try {
      setCallSummaryPending(true);
      const endedCall = await endBookingCall(bookingId, user ?? undefined, transcript);
      setRealtimeNotice(
        endedCall.summaryStatus === "failed"
          ? "통화는 종료됐지만 AI 상담 요약 저장에 실패했습니다. 완료 화면에서 다시 시도해 주세요."
          : "통화가 종료되고 AI 상담 요약과 리뷰 요청이 저장되었습니다.",
      );
      void detailQuery.refetch();
      void threadsQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    } catch (error) {
      setRealtimeNotice(error instanceof Error ? error.message : "화상통화 종료 후 요약을 저장하지 못했습니다.");
    } finally {
      setCallSummaryPending(false);
      window.setTimeout(() => setRealtimeNotice(null), 6200);
    }
  };

  const toggleCallTranslation = async () => {
    const bookingId = detail?.booking?.id;
    if (!bookingId || !callControllerRef.current) return;
    try {
      if (callTranslationActive) {
        setCallTranslationActive(false);
        callTranslationActiveRef.current = false;
        setCallStatus("내 화면의 실시간 번역을 껐습니다.");
        return;
      }
      await startBookingCallTranscription(bookingId, callLanguageCode, user ?? undefined, true);
      setCallTranslationActive(true);
      callTranslationActiveRef.current = true;
      setCallStatus(`${getTranslationDirectionLabel(callLanguageCode)} 번역이 시작됐습니다.`);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "실시간 번역을 시작하지 못했습니다.");
    }
  };

  const toggleCallMuted = () => {
    const nextMuted = !callMuted;
    callControllerRef.current?.setMuted(nextMuted);
    setCallMuted(nextMuted);
  };

  const toggleCallVideo = async () => {
    const nextEnabled = !callVideoEnabled;
    await callControllerRef.current?.setLocalVideoEnabled(nextEnabled);
    setCallVideoEnabled(nextEnabled);
  };

  const leaveConversation = () => {
    if (!detail?.thread.id || leaveThreadMutation.isPending) return;
    const confirmed = window.confirm(
      "이 대화방에서 나갈까요? 대화 기록은 보관되지만 목록에서 숨겨지고, 같은 고객의 다음 예약은 새 대화방에서 시작됩니다.",
    );
    if (confirmed) leaveThreadMutation.mutate(detail.thread.id);
  };

  if (threadsQuery.isLoading) return <LoadingState label="고객 대화를 불러오는 중입니다" />;
  if (threadsQuery.isError) return <ErrorState message={threadsQuery.error.message} onRetry={() => threadsQuery.refetch()} />;

  return (
    <div className="chat-page">
      <div className="chat-page-intro">
        <PageHeader
          eyebrow="Communication"
          title="고객 대화"
          description="확정된 예약의 고객 채팅과 앱 얼굴 리포트, 내부 메모를 함께 보며 상담을 이어갑니다."
        />
        {realtimeNotice ? (
          <div className="realtime-toast" role="status">
            <BellRing size={16} />
            <span>{realtimeNotice}</span>
          </div>
        ) : null}
      </div>

      <section className="chat-layout">
        <aside className="thread-list">
          <div className="filter-bar flush">
            <Search size={16} />
            <TextInput aria-label="대화 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="대화 검색" />
          </div>
          {filteredThreads.map((item) => (
            <button
              className={`thread-item ${activeThreadId === item.thread.id ? "is-active" : ""}`}
              key={item.thread.id}
              type="button"
              onClick={() => setActiveThreadId(item.thread.id)}
            >
              <div className="thread-meta">
                <strong>{item.customer.name}</strong>
                {item.booking && isClosedBookingStatus(item.booking.status) ? (
                  <Badge>취소됨</Badge>
                ) : item.thread.unreadCount > 0 ? (
                  <Badge tone="danger">{item.thread.unreadCount}</Badge>
                ) : (
                  <span className="muted">{formatTime(item.thread.lastMessageAt)}</span>
                )}
              </div>
              <span className="muted">{item.booking?.type ?? "일반 문의"} · {item.thread.channel}</span>
              <p className="muted">{lastMessage(item)?.body ?? "메시지 없음"}</p>
            </button>
          ))}
          {filteredThreads.length === 0 ? <EmptyState title="대화가 없습니다" description="검색 조건을 조정해보세요." /> : null}
        </aside>

        <main className={`chat-main ${isClosedBooking ? "has-closed" : ""}`}>
          <header className="chat-header">
            {detail ? (
              <>
                <div className="person-cell">
                  <img src={detail.customer.profileImageUrl} alt="" />
                  <div className="cell-main">
                    <strong>{detail.customer.name}</strong>
                    <span>{detail.customer.phone} · 담당 {detail.expert.name} · {getSocketStatusLabel(socketStatus)}</span>
                  </div>
                </div>
                {socketStatus !== "connected" ? (
                  <Button type="button" variant="ghost" onClick={() => socketRef.current?.reconnect()}>
                    재연결
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  icon={<Phone size={16} />}
                  onClick={openVideoCall}
                  disabled={!detail.booking}
                >
                  화상통화
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<LogOut size={16} />}
                  onClick={leaveConversation}
                  disabled={leaveThreadMutation.isPending}
                >
                  {leaveThreadMutation.isPending ? "나가는 중" : "대화방 나가기"}
                </Button>
              </>
            ) : (
              <span className="muted">대화를 선택하세요</span>
            )}
          </header>

          {isClosedBooking ? (
            <div className="closed-thread-banner">
              <strong>종료된 대화방</strong>
              <span>대화 기록은 확인할 수 있지만 새 메시지는 보낼 수 없습니다. 다음 예약은 새 대화방에서 시작됩니다.</span>
            </div>
          ) : null}

          <div className="message-list">
            {detailQuery.isLoading ? <LoadingState label="대화 내용을 불러오는 중입니다" /> : null}
            {liveMessages.map((item) => (
              <div className={`message ${item.senderType === "operator" || item.senderType === "expert" ? "mine" : ""}`} key={item.id}>
                <div className="message-bubble">
                  {item.body ? <span>{item.body}</span> : null}
                  {item.attachments.filter((attachment) => attachment.url).map((attachment) => (
                    <img alt="" className="message-image" key={attachment.id} src={attachment.url} />
                  ))}
                </div>
                <small>{item.senderName} · {formatDateTime(item.sentAt)}{getDeliveryLabel(item)}</small>
                {item.deliveryStatus === "failed" ? (
                  <Button type="button" variant="ghost" onClick={() => retryMessage(item)}>
                    다시 보내기
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
            <Button type="button" variant="secondary" icon={<FileImage size={16} />} disabled={isClosedBooking || uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
              {uploadMutation.isPending ? "첨부 중" : "첨부"}
            </Button>
            <div className="composer-field">
              {pendingAttachments.length > 0 ? (
                <div className="attachment-preview-row">
                  {pendingAttachments.map((attachment) => (
                    <button
                      className="attachment-preview"
                      key={attachment.id}
                      type="button"
                      onClick={() => setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                    >
                      {attachment.url ? <img alt="" src={attachment.url} /> : <FileImage size={15} />}
                      <span>{attachment.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {uploadMutation.isError ? <span className="form-error">{uploadMutation.error.message}</span> : null}
              <TextInput disabled={isClosedBooking} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={isClosedBooking ? "취소된 예약에는 메시지를 보낼 수 없습니다" : "고객에게 보낼 메시지를 입력하세요"} />
            </div>
            <Button type="submit" variant="primary" icon={<Send size={16} />} disabled={(!message.trim() && pendingAttachments.length === 0) || !socketBookingId || isClosedBooking || uploadMutation.isPending || (pendingAttachments.length > 0 && socketStatus !== "connected")}>
              전송
            </Button>
          </form>
        </main>

        <aside className="chat-side">
          {detail ? (
            <>
              <div className="chat-profile-header">
                <div className="cell-main">
                  <strong>고객 프로필</strong>
                  <span>{detail.customer.email}</span>
                </div>
                <Badge tone={detail.thread.status === "waiting" ? "warning" : "info"}>{detail.thread.status}</Badge>
              </div>
              <section className="chat-side-section">
                <strong>예약 정보</strong>
                {detail.booking ? (
                  <>
                    <div className="thread-meta">
                      <span>{detail.booking.type}</span>
                      <BookingStatusBadge status={detail.booking.status} />
                    </div>
                    <span className="muted">{formatDateTime(detail.booking.startsAt)} · {detail.booking.durationMinutes}분 · {detail.booking.channel === "video" ? "1:1 화상" : detail.booking.channel}</span>
                    <p className="muted">{detail.booking.requestMemo}</p>
                    <div className="tag-list">
                      {detail.booking.selectedConcernTags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                    </div>
                  </>
                ) : (
                  <span className="muted">연결된 예약 없음</span>
                )}
              </section>
              <section className="chat-side-section">
                <strong>선택 리포트</strong>
                {detail.sharedReports.length === 0 ? (
                  <span className="muted">선택 리포트 없음</span>
                ) : (
                  detail.sharedReports.map((report) => (
                    <AppReportCard
                      compact
                      key={report.id}
                      onClick={() => setSelectedReportId(report.id)}
                      report={report}
                      selected={selectedReportId === report.id}
                    />
                  ))
                )}
              </section>
              <section className="chat-side-section">
                <strong>내부 메모</strong>
                <p className="muted">{detail.customer.memo}</p>
              </section>
            </>
          ) : (
            <EmptyState title="대화를 선택하세요" />
          )}
        </aside>
      </section>

      <Modal
        bodyClassName="report-viewer-body"
        className="report-viewer-modal"
        open={Boolean(selectedReport) && !callOpen}
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

      <Modal
        bodyClassName="chat-call-body"
        className="chat-call-modal"
        open={callOpen}
        title={`${detail?.customer.name ?? "고객"}님과 화상통화`}
        onClose={() => void closeVideoCall()}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              icon={callMuted ? <MicOff size={16} /> : <Mic size={16} />}
              onClick={toggleCallMuted}
              disabled={!callControllerRef.current}
            >
              {callMuted ? "마이크 켜기" : "마이크 끄기"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              icon={callVideoEnabled ? <Video size={16} /> : <VideoOff size={16} />}
              onClick={() => void toggleCallVideo()}
              disabled={!callControllerRef.current}
            >
              {callVideoEnabled ? "카메라 끄기" : "카메라 켜기"}
            </Button>
            <Button
              type="button"
              variant={callTranslationActive ? "primary" : "secondary"}
              icon={<Languages size={16} />}
              onClick={() => void toggleCallTranslation()}
              disabled={!callControllerRef.current}
            >
              {callTranslationActive ? "번역 종료" : `${getTranslationDirectionLabel(callLanguageCode)} 번역`}
            </Button>
            <Button type="button" variant="danger" icon={<PhoneOff size={16} />} onClick={() => void endVideoCall()} disabled={callSummaryPending}>
              {callSummaryPending ? "요약 저장 중" : "통화 종료"}
            </Button>
          </>
        }
      >
        <div className="chat-call-content">
          <div className="chat-call-stage">
            <video ref={callRemoteVideoRef} autoPlay playsInline />
            <div className="chat-call-local">
              <video ref={callLocalVideoRef} autoPlay muted playsInline />
              <span>{callVideoEnabled ? "내 화면" : "카메라 꺼짐"}</span>
            </div>
            <audio ref={callAudioRef} autoPlay />
            {joinCallMutation.isPending ? <div className="chat-call-wait">Chime 화상통화 방을 만드는 중…</div> : null}
            {callCaptions.length > 0 ? (
              <div className="chat-call-captions" aria-live="polite">
                {callCaptions.slice(-2).map((caption) => (
                  <div className="chat-call-caption" key={caption.resultId}>
                    <strong>{caption.transcript}</strong>
                    {caption.translatedContent ? <span>{caption.translatedContent}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <aside className="chat-call-reports">
            <div>
              <strong>통화 중 공유 리포트</strong>
              <span>{detail?.sharedReports.length ?? 0}개</span>
            </div>
            {detail?.sharedReports.length ? (
              <>
                <div className="chat-call-report-tabs">
                  {detail.sharedReports.map((report) => (
                    <button
                      className={selectedReportId === report.id ? "is-active" : ""}
                      key={report.id}
                      type="button"
                      onClick={() => setSelectedReportId(report.id)}
                    >
                      {report.title}
                    </button>
                  ))}
                </div>
                {selectedReport ? <AppReportCard className="chat-call-report-detail" report={selectedReport} /> : null}
              </>
            ) : (
              <span className="muted">고객이 공유한 리포트가 없습니다.</span>
            )}
          </aside>
        </div>
        <div className={`chat-call-status ${callError ? "is-error" : ""}`} role="status">
          <label className="chat-call-translation-direction">
            <span>번역 방향</span>
            <select
              value={callLanguageCode}
              onChange={(event) => setCallLanguageCode(event.target.value as ConsultingCallLanguageCode)}
              disabled={callTranslationActive}
            >
              <option value="ko-KR">한국어 → English</option>
              <option value="en-US">English → 한국어</option>
            </select>
          </label>
          <strong>{callError ? "연결 실패" : "통화 상태"}</strong>
          <span>{callError || callStatus}</span>
          {callError ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!detail?.booking) return;
                setCallError("");
                joinCallMutation.mutate(detail.booking.id);
              }}
            >
              다시 연결
            </Button>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

function getTranslationDirectionLabel(languageCode: ConsultingCallLanguageCode) {
  return languageCode === "en-US" ? "영→한" : "한→영";
}

type LiveChatMessage = ChatMessage & {
  clientMessageId?: string;
  deliveryStatus?: "failed" | "pending" | "sent";
};

type LiveCallCaption = WebChimeTranscriptResult & {
  translatedContent?: string;
};

function mergeCallCaptions(current: LiveCallCaption[], incoming: WebChimeTranscriptResult[]) {
  const merged = [...current];
  for (const caption of incoming) {
    const existingIndex = merged.findIndex((item) => item.resultId === caption.resultId);
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...caption,
        translatedContent: merged[existingIndex].translatedContent,
      };
    } else {
      merged.push(caption);
    }
  }
  return merged.slice(-6);
}

function createClientMessageId() {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getParticipantType(user: AuthUser | null) {
  if (user?.role === "expert") {
    return "expert";
  }

  return "operator";
}

function getOutgoingSenderType(user: AuthUser | null): ChatMessage["senderType"] {
  return getParticipantType(user) === "expert" ? "expert" : "operator";
}

function getSocketStatusLabel(status: ConsultingSocketStatus) {
  if (status === "connected") return "실시간 연결됨";
  if (status === "connecting") return "연결 중";
  if (status === "reconnecting") return "재연결 중";
  if (status === "offline") return "실시간 연결 끊김 · 문자 전송 가능";
  return "대화 대기";
}

function getDeliveryLabel(message: LiveChatMessage) {
  if (message.deliveryStatus === "pending") return " · 전송 중";
  if (message.deliveryStatus === "failed") return " · 전송 실패";
  return "";
}

function isClosedBookingStatus(status: BookingStatus) {
  return status === "cancelled" || status === "no_show" || status === "refund_requested";
}

function canStartVideoCall(status: BookingStatus, channel: string) {
  return channel === "video" && ["confirmed", "scheduled", "in_progress"].includes(status);
}

function mapSocketSenderType(
  senderType: ConsultingRealtimeMessageEvent["senderType"],
): ChatMessage["senderType"] {
  if (senderType === "user") return "customer";
  return senderType;
}

function mapSocketMessage(
  event: ConsultingRealtimeMessageEvent,
  threadId: string,
): LiveChatMessage {
  return {
    id: event.id,
    threadId,
    senderType: mapSocketSenderType(event.senderType),
    senderName: event.senderName,
    body: event.body,
    sentAt: event.sentAt,
    attachments: event.media?.map((media) => ({
      id: media.id,
      ownerId: event.bookingId,
      type: "image",
      name: media.contentType ?? "chat-image",
      url: media.thumbnailUrl ?? media.cdnUrl ?? "",
      uploadedAt: event.sentAt,
    })) ?? [],
    clientMessageId: event.clientMessageId,
    deliveryStatus: "sent",
  };
}

function isSameMessage(left: LiveChatMessage, right: LiveChatMessage) {
  if (left.id === right.id) return true;
  if (left.clientMessageId && right.clientMessageId) {
    return left.clientMessageId === right.clientMessageId;
  }
  return false;
}

function mergeHistoryMessages(current: LiveChatMessage[], historyMessages: LiveChatMessage[]) {
  if (historyMessages.length === 0) {
    return current;
  }

  const merged = [...current];
  for (const message of historyMessages) {
    const existingIndex = merged.findIndex((existing) => isSameMessage(existing, message));
    if (existingIndex >= 0) {
      merged[existingIndex] = {...merged[existingIndex], ...message};
    } else {
      merged.push(message);
    }
  }

  return merged.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

function lastMessage(thread: { messages: Array<{ body: string }> }) {
  return thread.messages[thread.messages.length - 1];
}
