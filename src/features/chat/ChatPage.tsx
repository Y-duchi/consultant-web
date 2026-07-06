import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileImage, Phone, Search, Send } from "lucide-react";
import { createPhoneAction, getChatThreadDetail, getChatThreads, sendMessage } from "../../services/api";
import { useAuth } from "../auth/AuthContext";
import { Badge, BookingStatusBadge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { TextInput } from "../../shared/ui/Field";
import { PageHeader } from "../../shared/ui/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { formatDateTime, formatTime } from "../../shared/utils/format";

export function ChatPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const threadsQuery = useQuery({
    queryKey: ["chat-threads", user?.id, user?.workspaceScope],
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
      setActiveThreadId(filteredThreads[0].thread.id);
    }
  }, [activeThreadId, filteredThreads]);

  const detailQuery = useQuery({
    queryKey: ["chat-thread-detail", activeThreadId],
    queryFn: () => getChatThreadDetail(activeThreadId!),
    enabled: Boolean(activeThreadId),
  });

  const sendMutation = useMutation({
    mutationFn: () => sendMessage(activeThreadId!, message.trim()),
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
      queryClient.invalidateQueries({ queryKey: ["chat-thread-detail", activeThreadId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim() || !activeThreadId) return;
    sendMutation.mutate();
  };

  if (threadsQuery.isLoading) return <LoadingState label="고객 대화를 불러오는 중입니다" />;
  if (threadsQuery.isError) return <ErrorState message={threadsQuery.error.message} onRetry={() => threadsQuery.refetch()} />;

  const detail = detailQuery.data;

  return (
    <>
      <PageHeader
        eyebrow="Communication"
        title="고객 대화"
        description="고객 대화, 앱 예약 정보, 선택 리포트, 내부 메모를 한 화면에서 보며 응대합니다. 연락 버튼은 action만 준비하고 자동 메시지는 보내지 않습니다."
      />

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
                {item.thread.unreadCount > 0 ? <Badge tone="danger">{item.thread.unreadCount}</Badge> : <span className="muted">{formatTime(item.thread.lastMessageAt)}</span>}
              </div>
              <span className="muted">{item.booking?.type ?? "일반 문의"} · {item.thread.channel}</span>
              <p className="muted">{lastMessage(item)?.body ?? "메시지 없음"}</p>
            </button>
          ))}
          {filteredThreads.length === 0 ? <EmptyState title="대화가 없습니다" description="검색 조건을 조정해보세요." /> : null}
        </aside>

        <main className="chat-main">
          <header className="chat-header">
            {detail ? (
              <>
                <div className="person-cell">
                  <img src={detail.customer.profileImageUrl} alt="" />
                  <div className="cell-main">
                    <strong>{detail.customer.name}</strong>
                    <span>{detail.customer.phone} · 담당 {detail.expert.name}</span>
                  </div>
                </div>
                <Button variant="secondary" icon={<Phone size={16} />} onClick={() => createPhoneAction({ customerId: detail.customer.id, bookingId: detail.booking?.id, channel: "phone" })}>
                  전화
                </Button>
              </>
            ) : (
              <span className="muted">대화를 선택하세요</span>
            )}
          </header>

          <div className="message-list">
            {detailQuery.isLoading ? <LoadingState label="대화 내용을 불러오는 중입니다" /> : null}
            {detail?.messages.map((item) => (
              <div className={`message ${item.senderType === "operator" || item.senderType === "expert" ? "mine" : ""}`} key={item.id}>
                <div className="message-bubble">{item.body}</div>
                <small>{item.senderName} · {formatDateTime(item.sentAt)}</small>
              </div>
            ))}
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <Button type="button" variant="secondary" icon={<FileImage size={16} />}>
              첨부
            </Button>
            <TextInput value={message} onChange={(event) => setMessage(event.target.value)} placeholder="고객에게 보낼 메시지를 입력하세요" />
            <Button type="submit" variant="primary" icon={<Send size={16} />} disabled={!message.trim() || sendMutation.isPending}>
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
                    <div className="report-item" key={report.id}>
                      <strong>{report.title}</strong>
                      <p>{report.summary}</p>
                    </div>
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
    </>
  );
}

function lastMessage(thread: { messages: Array<{ body: string }> }) {
  return thread.messages[thread.messages.length - 1];
}
