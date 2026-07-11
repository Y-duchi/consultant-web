import {
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Settings,
  Star,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import { getChatThreads, getPartnerSessionToken, type ChatThreadDetail } from "../../services/api";
import {
  connectConsultingConversationSocket,
  type ConsultingRealtimeMessageEvent,
  type ConsultingServerSocketEvent,
} from "../../services/consultingRealtime";
import {
  connectPartnerEventStream,
  getPartnerEventFallbackRefetchRoots,
  getPartnerEventInvalidationRoots,
  isPartnerEventInScope,
} from "../../services/partnerEvents";
import { Button } from "../../shared/ui/Button";
import { formatTime, workspaceScopeLabel } from "../../shared/utils/format";
import type { BookingStatus, ChatMessage } from "../../types/domain";

const navItems = [
  { to: "/workspace", label: "내 대시보드", icon: LayoutDashboard, end: true },
  { to: "/workspace/bookings", label: "내 예약", icon: CalendarDays },
  { to: "/workspace/customers", label: "내 고객", icon: Users },
  { to: "/workspace/chat", label: "내 채팅", icon: MessageSquareText },
  { to: "/workspace/completion", label: "상담 요약", icon: CheckCircle2 },
  { to: "/workspace/reviews", label: "내 리뷰", icon: Star },
  { to: "/workspace/profile", label: "프로필/가격", icon: Building2 },
  { to: "/workspace/settings", label: "설정", icon: Settings },
];

const pageTitle: Record<string, string> = {
  "/workspace": "내 업체 운영 현황",
  "/workspace/bookings": "내 예약 관리",
  "/workspace/customers": "내 고객 관리",
  "/workspace/chat": "내 고객 대화",
  "/workspace/completion": "상담 요약 및 처방 노트",
  "/workspace/reviews": "내 리뷰 관리",
  "/workspace/profile": "프로필/영업 정보",
  "/workspace/settings": "워크스페이스 설정",
};

export function PartnerLayout() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const previousBookingIdsRef = useRef<Set<string> | null>(null);
  const seenRealtimeEventsRef = useRef(new Set<string>());
  const toastTimerRef = useRef<number | null>(null);
  const [notifications, setNotifications] = useState<PartnerNotification[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [liveToast, setLiveToast] = useState<PartnerNotification | null>(null);
  const title = pageTitle[location.pathname] ?? "AURA Workspace";
  const chatThreadsQueryKey = useMemo(
    () => ["chat-threads", user?.id, user?.businessId, user?.expertId, user?.workspaceScope] as const,
    [user?.businessId, user?.expertId, user?.id, user?.workspaceScope],
  );
  const unreadChatQuery = useQuery({
    queryKey: chatThreadsQueryKey,
    queryFn: () => getChatThreads(user ?? undefined),
    enabled: Boolean(user),
    refetchInterval: 5_000,
  });
  const unreadChatCount = (unreadChatQuery.data ?? []).reduce((total, item) => total + item.thread.unreadCount, 0);
  const unreadNotificationCount = notifications.filter((notification) => !notification.read).length;
  const unreadBookingCount = notifications.filter(
    (notification) => !notification.read && notification.kind !== "message",
  ).length;
  const realtimeTargets = useMemo(
    () =>
      (unreadChatQuery.data ?? [])
        .filter((item) => item.booking && !isClosedBookingStatus(item.booking.status))
        .slice(0, 32)
        .map((item) => ({
          bookingId: item.booking!.id,
          customerName: item.customer.name,
          threadId: item.thread.id,
        })),
    [unreadChatQuery.data],
  );
  const realtimeTargetsKey = realtimeTargets.map((target) => `${target.threadId}:${target.bookingId}`).join("|");

  const pushNotification = useCallback((notification: Omit<PartnerNotification, "read">) => {
    const nextNotification = { ...notification, read: false };
    setNotifications((current) => [nextNotification, ...current.filter((item) => item.id !== notification.id)].slice(0, 30));
    setLiveToast(nextNotification);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setLiveToast(null), 6500);
    playPartnerNotificationSound(notification.kind);
  }, []);

  const handleRealtimeEvent = useCallback(
    (target: RealtimeTarget, event: ConsultingServerSocketEvent) => {
      if (event.type === "message.new" && event.senderType === "user") {
        const eventKey = `message:${event.id}`;
        if (seenRealtimeEventsRef.current.has(eventKey)) return;
        seenRealtimeEventsRef.current.add(eventKey);
        queryClient.setQueryData<ChatThreadDetail[]>(chatThreadsQueryKey, (current) =>
          current?.map((item) => {
            if (item.thread.id !== target.threadId) return item;
            const exists = item.messages.some(
              (message) => message.id === event.id || (event.clientMessageId && message.id === event.clientMessageId),
            );
            if (exists) return item;
            return {
              ...item,
              messages: [...item.messages, mapRealtimeMessage(event, target.threadId)],
              thread: {
                ...item.thread,
                lastMessageAt: event.sentAt,
                status: "waiting",
                unreadCount: item.thread.unreadCount + 1,
              },
            };
          }) ?? current,
        );
        pushNotification({
          id: eventKey,
          bookingId: target.bookingId,
          createdAt: event.sentAt,
          description: event.body || "사진을 보냈습니다.",
          kind: "message",
          title: `${event.senderName || target.customerName} 고객의 새 메시지`,
        });
        queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
        return;
      }

      if (event.type === "booking.status") {
        pushNotification({
          id: `status:${target.bookingId}:${event.status}:${Date.now()}`,
          bookingId: target.bookingId,
          createdAt: new Date().toISOString(),
          description: event.message,
          kind: "booking",
          title: `${target.customerName} 고객 예약 상태 변경`,
        });
        invalidateBookingQueries(queryClient);
        return;
      }

      if (event.type === "call.status") {
        pushNotification({
          id: `call:${target.bookingId}:${event.status}:${Date.now()}`,
          bookingId: target.bookingId,
          createdAt: new Date().toISOString(),
          description: event.message,
          kind: "call",
          title: `${target.customerName} 고객 화상 상담`,
        });
      }
    },
    [chatThreadsQueryKey, pushNotification, queryClient],
  );

  useEffect(() => {
    if (!user?.businessId) return undefined;
    const connection = connectPartnerEventStream({
      accountId: user.id,
      businessId: user.businessId,
      expertId: user.expertId,
      onEvent: (event) => {
        if (!isPartnerEventInScope(event, { businessId: user.businessId, expertId: user.expertId })) return;
        getPartnerEventInvalidationRoots(event).forEach((queryKey) => {
          queryClient.invalidateQueries({ queryKey: [queryKey] });
        });
      },
    });
    return () => connection.close();
  }, [queryClient, user?.businessId, user?.expertId, user?.id]);

  useEffect(() => {
    if (!user?.businessId) return undefined;
    const timer = window.setInterval(() => {
      getPartnerEventFallbackRefetchRoots().forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey: [queryKey] });
      });
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [queryClient, user?.businessId, user?.expertId]);

  useEffect(() => {
    if (!unreadChatQuery.isSuccess) return;
    const currentIds = new Set((unreadChatQuery.data ?? []).map((item) => item.booking?.id).filter(Boolean) as string[]);
    const previousIds = previousBookingIdsRef.current;
    previousBookingIdsRef.current = currentIds;
    if (!previousIds) return;

    for (const item of unreadChatQuery.data ?? []) {
      if (!item.booking || previousIds.has(item.booking.id)) continue;
      pushNotification({
        id: `booking-created:${item.booking.id}`,
        bookingId: item.booking.id,
        createdAt: item.booking.requestedAt,
        description: `${item.booking.type} · ${formatTime(item.booking.startsAt)}`,
        kind: "booking",
        title: `${item.customer.name} 고객의 새 예약 신청`,
      });
      invalidateBookingQueries(queryClient);
    }
  }, [pushNotification, queryClient, unreadChatQuery.data, unreadChatQuery.isSuccess]);

  useEffect(() => {
    if (!user) return undefined;
    const clients = realtimeTargets.map((target) =>
      connectConsultingConversationSocket({
        authToken: getPartnerSessionToken(),
        bookingId: target.bookingId,
        onEvent: (event) => handleRealtimeEvent(target, event),
        participantType: user.role === "expert" ? "expert" : "operator",
      }),
    );
    return () => clients.forEach((client) => client.close());
    // Keep sockets alive when only cached message contents change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleRealtimeEvent, realtimeTargetsKey, user?.role]);

  useEffect(() => {
    setNotificationOpen(false);
  }, [location.pathname]);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">P</div>
          <div className="brand-title">
            <strong>AURA Workspace</strong>
            <span>업체/전문가 운영툴</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="워크스페이스 메뉴">
          {navItems.map((item) => {
            const Icon = item.icon;
            const badgeCount = item.to === "/workspace/chat"
              ? unreadChatCount
              : item.to === "/workspace/bookings"
                ? unreadBookingCount
                : 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link ${isActive ? "is-active" : ""}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {badgeCount > 0 ? (
                  <span aria-label={`${item.label} 새 알림 ${badgeCount}개`} className="nav-unread-badge">
                    {formatBadgeCount(badgeCount)}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="scope-card">
            <span>현재 워크스페이스</span>
            <strong>{user ? workspaceScopeLabel[user.workspaceScope] : "로그인 필요"}</strong>
            <span>{user?.role === "expert" ? "본인 예약/고객만 표시" : "소속 업체의 예약과 고객만 표시"}</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-title">
              <strong>{title}</strong>
              <span>서버 scope 기준으로 내 업체/전문가 데이터만 조회합니다.</span>
            </div>
          </div>
          <div className="topbar-right">
            <span className="topbar-meta">Partner API scope</span>
            <div className="notification-center">
              <Button
                variant="ghost"
                icon={<Bell size={17} />}
                onClick={() => {
                  setNotificationOpen((current) => !current);
                  setNotifications((current) => current.map((item) => ({ ...item, read: true })));
                }}
              >
                알림
                {unreadNotificationCount > 0 ? (
                  <span className="topbar-notification-badge">{formatBadgeCount(unreadNotificationCount)}</span>
                ) : null}
              </Button>
              {notificationOpen ? (
                <div className="notification-panel" role="dialog" aria-label="실시간 알림">
                  <div className="notification-panel-header">
                    <div>
                      <strong>실시간 알림</strong>
                      <span>예약·메시지·통화 변경을 모아봅니다.</span>
                    </div>
                    <button type="button" aria-label="알림 닫기" onClick={() => setNotificationOpen(false)}>
                      <X size={17} />
                    </button>
                  </div>
                  <div className="notification-list">
                    {notifications.length ? notifications.map((notification) => (
                      <button
                        className="notification-item"
                        key={notification.id}
                        type="button"
                        onClick={() => openNotification(notification, navigate, setNotificationOpen)}
                      >
                        <span className={`notification-kind ${notification.kind}`} />
                        <span>
                          <strong>{notification.title}</strong>
                          <small>{notification.description}</small>
                        </span>
                        <time>{formatTime(notification.createdAt)}</time>
                      </button>
                    )) : (
                      <div className="notification-empty">아직 새 알림이 없습니다.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="person-cell">
              <img className="avatar" src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=160&q=80" alt="" />
              <div className="cell-main">
                <strong>{user?.name}</strong>
                <span>{user?.email}</span>
              </div>
            </div>
            <Button variant="ghost" icon={<LogOut size={17} />} onClick={logout}>
              로그아웃
            </Button>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
        {liveToast ? (
          <button
            className={`partner-live-toast ${liveToast.kind}`}
            type="button"
            onClick={() => {
              setLiveToast(null);
              openNotification(liveToast, navigate, setNotificationOpen);
            }}
          >
            <Bell size={19} />
            <span>
              <strong>{liveToast.title}</strong>
              <small>{liveToast.description}</small>
            </span>
          </button>
        ) : null}
      </main>
    </div>
  );
}

type PartnerNotification = {
  bookingId: string;
  createdAt: string;
  description: string;
  id: string;
  kind: "booking" | "call" | "message";
  read: boolean;
  title: string;
};

type RealtimeTarget = {
  bookingId: string;
  customerName: string;
  threadId: string;
};

function mapRealtimeMessage(event: ConsultingRealtimeMessageEvent, threadId: string): ChatMessage {
  return {
    attachments: event.media?.map((media) => ({
      id: media.id,
      name: media.contentType ?? "채팅 이미지",
      ownerId: event.bookingId,
      type: "image",
      uploadedAt: event.sentAt,
      url: media.thumbnailUrl ?? media.cdnUrl ?? "",
    })) ?? [],
    body: event.body,
    id: event.id,
    senderName: event.senderName,
    senderType: "customer",
    sentAt: event.sentAt,
    threadId,
  };
}

function isClosedBookingStatus(status: BookingStatus) {
  return ["cancelled", "completed", "no_show", "refund_requested"].includes(status);
}

function formatBadgeCount(count: number) {
  return count > 99 ? "99+" : count;
}

function invalidateBookingQueries(queryClient: QueryClient) {
  ["bookings", "booking-detail", "dashboard-summary", "completion-bookings", "chat-threads"].forEach((queryKey) => {
    queryClient.invalidateQueries({ queryKey: [queryKey] });
  });
}

function openNotification(
  notification: PartnerNotification,
  navigate: ReturnType<typeof useNavigate>,
  setNotificationOpen: (open: boolean) => void,
) {
  setNotificationOpen(false);
  navigate(
    notification.kind === "message"
      ? `/workspace/chat?bookingId=${notification.bookingId}`
      : `/workspace/bookings?bookingId=${notification.bookingId}`,
  );
}

function playPartnerNotificationSound(kind: PartnerNotification["kind"]) {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    void context.resume().then(() => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(kind === "message" ? 880 : 660, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(kind === "message" ? 1174 : 880, context.currentTime + 0.16);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.32);
      window.setTimeout(() => void context.close(), 450);
    }).catch(() => void context.close());
  } catch {
    // Browsers may block sound until the first interaction; badges and toast remain visible.
  }
}
