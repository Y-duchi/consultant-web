export type ConsultingParticipantType = "user" | "expert" | "operator";

export type ConsultingSocketStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

export type ConsultingRealtimeMessageEvent = {
  bookingId: string;
  body: string;
  clientMessageId?: string;
  id: string;
  media?: Array<{
    cdnUrl?: string | null;
    contentType?: string | null;
    id: string;
    thumbnailUrl?: string | null;
  }>;
  mediaIds?: string[];
  senderName: string;
  senderType: ConsultingParticipantType | "system";
  sentAt: string;
  type: "message.new";
};

export type ConsultingServerSocketEvent =
  | {
      bookingId: string;
      connectionId: string;
      participantType: ConsultingParticipantType;
      type: "connected";
    }
  | {
      bookingId: string;
      messages: ConsultingRealtimeMessageEvent[];
      type: "message.history";
    }
  | ConsultingRealtimeMessageEvent
  | {
      bookingId: string;
      clientMessageId: string;
      messageId: string;
      sentAt: string;
      type: "message.ack";
    }
  | {
      bookingId: string;
      isTyping: boolean;
      senderType: ConsultingParticipantType;
      type: "typing";
    }
  | {
      bookingId: string;
      readAt?: string | null;
      senderType: ConsultingParticipantType;
      type: "read";
    }
  | {
      bookingId: string;
      participants: Array<{
        connectionCount: number;
        participantType: ConsultingParticipantType;
      }>;
      type: "presence";
    }
  | {
      at?: string;
      type: "pong";
    }
  | {
      clientMessageId?: string;
      code: string;
      message: string;
      type: "error";
    };

type ConsultingClientSocketEvent =
  | {
      at: string;
      type: "ping";
    }
  | {
      body: string;
      bookingId: string;
      clientMessageId: string;
      mediaIds?: string[];
      type: "message.send";
    }
  | {
      bookingId: string;
      isTyping: boolean;
      type: "typing";
    }
  | {
      bookingId: string;
      readAt: string;
      type: "read";
    };

type ConnectOptions = {
  authToken?: string | null;
  bookingId: string;
  onEvent: (event: ConsultingServerSocketEvent) => void;
  onStatusChange?: (status: ConsultingSocketStatus) => void;
  participantType: ConsultingParticipantType;
};

export type ConsultingConversationSocketClient = {
  close: () => void;
  send: (event: ConsultingClientSocketEvent) => boolean;
  sendMessage: (payload: {
    body: string;
    bookingId: string;
    clientMessageId: string;
    mediaIds?: string[];
  }) => boolean;
};

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 5000;

function getApiBaseUrl() {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export function buildConsultingWebSocketUrl({
  authToken,
  bookingId,
  participantType,
}: {
  authToken?: string | null;
  bookingId: string;
  participantType: ConsultingParticipantType;
}) {
  const url = new URL(getApiBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/consulting/ws/bookings/${encodeURIComponent(bookingId)}`;
  url.searchParams.set("participantType", participantType);
  if (authToken) url.searchParams.set("token", authToken);
  return url.toString();
}

function parseSocketEvent(data: unknown): ConsultingServerSocketEvent | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as { type?: unknown };
    return typeof parsed.type === "string" ? (parsed as ConsultingServerSocketEvent) : null;
  } catch {
    return null;
  }
}

export function connectConsultingConversationSocket({
  authToken,
  bookingId,
  onEvent,
  onStatusChange,
  participantType,
}: ConnectOptions): ConsultingConversationSocketClient {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null;
  let reconnectAttempt = 0;
  let closedByClient = false;

  const setStatus = (status: ConsultingSocketStatus) => onStatusChange?.(status);
  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    clearReconnectTimer();
    reconnectAttempt += 1;
    setStatus("reconnecting");
    const delay = Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** Math.max(0, reconnectAttempt - 1), MAX_RECONNECT_DELAY_MS);
    reconnectTimer = window.setTimeout(connect, delay);
  };

  const connect = () => {
    clearReconnectTimer();
    setStatus(reconnectAttempt === 0 ? "connecting" : "reconnecting");
    try {
      socket = new WebSocket(buildConsultingWebSocketUrl({ authToken, bookingId, participantType }));
    } catch {
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      reconnectAttempt = 0;
      setStatus("connected");
    };
    socket.onmessage = (event) => {
      const parsed = parseSocketEvent(event.data);
      if (parsed) onEvent(parsed);
    };
    socket.onerror = () => {
      if (!closedByClient) setStatus("offline");
    };
    socket.onclose = () => {
      socket = null;
      if (closedByClient) {
        setStatus("idle");
        return;
      }
      scheduleReconnect();
    };
  };

  const send = (event: ConsultingClientSocketEvent) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(event));
    return true;
  };

  connect();

  return {
    close: () => {
      closedByClient = true;
      clearReconnectTimer();
      socket?.close();
      socket = null;
      setStatus("idle");
    },
    send,
    sendMessage: (payload) => send({ ...payload, type: "message.send" }),
  };
}
