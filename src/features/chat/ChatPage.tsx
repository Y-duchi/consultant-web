import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, FileImage, Phone, Search, Send } from "lucide-react";
import {
  getChatThreadDetail,
  getChatThreads,
  getPartnerSessionToken,
  markChatThreadRead,
  sendMessage as sendChatText,
  uploadChatAttachment,
} from "../../services/api";
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
import type { Attachment, AuthUser, BookingStatus, ChatMessage } from "../../types/domain";
import { AppReportCard } from "../reports/AppReportCard";

export function ChatPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastMarkedReadThreadRef = useRef<string | null>(null);
  const lastAppliedComposeRef = useRef<string | null>(null);
  const socketRef = useRef<ConsultingConversationSocketClient | null>(null);
  const [query, setQuery] = useState("");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [socketStatus, setSocketStatus] = useState<ConsultingSocketStatus>("idle");
  const [liveMessages, setLiveMessages] = useState<LiveChatMessage[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [realtimeNotice, setRealtimeNotice] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
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

  const threadsQuery = useQuery({
    queryKey: chatThreadsQueryKey,
    queryFn: () => getChatThreads(user ?? undefined),
  });
  const filteredThreads = useMemo(() => {
    const source = threadsQuery.data ?? [];
    if (!query) return source;
    const keyword = query.toLowerCase();
    return source.filter((item) => [item.customer.name, item.customer.phone, item.booking?.type, lastMessage(item)?.body].filter(Boolean).some((value) => value!.toLowerCase().includes(keyword)));
  }, [query, threadsQuery.data]);

  useEffect(() => {
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
  });

  const detail = detailQuery.data;
  const selectedReport = detail?.sharedReports.find((report) => report.id === selectedReportId);
  const activeBookingId = detail?.booking?.id;
  const isClosedBooking = Boolean(detail?.booking && isClosedBookingStatus(detail.booking.status));
  const socketBookingId = useMemo(() => {
    const override = new URLSearchParams(window.location.search).get("bookingId")?.trim();
    return override || activeBookingId;
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
  }, [detail, partnerSessionToken, socketBookingId, user]);

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

  if (threadsQuery.isLoading) return <LoadingState label="고객 대화를 불러오는 중입니다" />;
  if (threadsQuery.isError) return <ErrorState message={threadsQuery.error.message} onRetry={() => threadsQuery.refetch()} />;

  return (
    <div className="chat-page">
      <div className="chat-page-intro">
        <PageHeader
          eyebrow="Communication"
          title="고객 대화"
          description="예약 신청 후 생성된 채팅방에서 고객 문의, 선결제 또는 예약금 입금 확인, 앱 얼굴 리포트와 내부 메모를 함께 보며 응대합니다."
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
                  variant="secondary"
                  icon={<Phone size={16} />}
                  onClick={() => {
                    if (!detail.booking) return;
                    if (!canStartVideoCall(detail.booking.status, detail.booking.channel)) {
                      setRealtimeNotice("입금 확인 후 전문가가 예약을 확정하면 상담 시간에 화상 상담을 시작할 수 있습니다.");
                      window.setTimeout(() => setRealtimeNotice(null), 5200);
                      return;
                    }
                    navigate(`/workspace/bookings?bookingId=${detail.booking.id}&call=1`);
                  }}
                  disabled={!detail.booking}
                >
                  화상 상담
                </Button>
              </>
            ) : (
              <span className="muted">대화를 선택하세요</span>
            )}
          </header>

          {isClosedBooking ? (
            <div className="closed-thread-banner">
              <strong>취소된 예약</strong>
              <span>대화 기록은 확인할 수 있지만 새 메시지는 보낼 수 없습니다.</span>
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
        open={Boolean(selectedReport)}
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
    </div>
  );
}

type LiveChatMessage = ChatMessage & {
  clientMessageId?: string;
  deliveryStatus?: "failed" | "pending" | "sent";
};

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

function getMessageKey(message: LiveChatMessage) {
  return message.clientMessageId ?? message.id;
}

function mergeHistoryMessages(current: LiveChatMessage[], historyMessages: LiveChatMessage[]) {
  if (historyMessages.length === 0) {
    return current;
  }

  const byKey = new Map<string, LiveChatMessage>();
  for (const message of current) {
    byKey.set(getMessageKey(message), message);
  }
  for (const message of historyMessages) {
    byKey.set(getMessageKey(message), message);
  }

  return Array.from(byKey.values()).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

function lastMessage(thread: { messages: Array<{ body: string }> }) {
  return thread.messages[thread.messages.length - 1];
}
