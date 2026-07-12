import type { ConsultingCallLanguageCode } from "../types/domain";

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

export type ConsultingCaptionTranslationEvent = {
  bookingId: string;
  resultId: string;
  sourceLanguageCode: ConsultingCallLanguageCode;
  targetLanguageCode: "ko" | "en";
  translatedContent: string;
  type: "caption.translation";
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
  | ConsultingCaptionTranslationEvent
  | {
      bookingId: string;
      message: string;
      status: string;
      type: "booking.status";
    }
  | {
      bookingId: string;
      callSessionId?: string | null;
      message: string;
      status: "started" | "ended";
      type: "call.status";
    }
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
    }
  | {
      bookingId: string;
      resultId: string;
      sourceLanguageCode: ConsultingCallLanguageCode;
      targetLanguageCode: "ko" | "en";
      translatedContent: string;
      type: "caption.translation";
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
  reconnect: () => void;
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
const MAX_RECONNECT_ATTEMPTS = 7;

function getConsultingRealtimeApiBaseUrl() {
  const explicit = import.meta.env.VITE_CONSULTING_API_BASE_URL?.trim();
  if (explicit) return normalizeConsultingApiBaseUrl(explicit);

  const partnerApiBaseUrl = import.meta.env.VITE_PARTNER_API_BASE_URL?.trim();
  if (partnerApiBaseUrl) return normalizeConsultingApiBaseUrl(partnerApiBaseUrl);

  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    return `${window.location.origin}/api/consulting`;
  }

  return normalizeConsultingApiBaseUrl(import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000");
}

function normalizeConsultingApiBaseUrl(raw: string) {
  const trimmed = raw.replace(/\/+$/, "");

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = normalizeConsultingApiPath(pathname);
    return url.toString().replace(/\/+$/, "");
  } catch {
    if (trimmed.endsWith("/api/consulting/partner")) return trimmed.slice(0, -"/partner".length);
    if (trimmed.endsWith("/consulting/partner")) return trimmed.slice(0, -"/partner".length);
    if (trimmed.endsWith("/api/consulting")) return trimmed;
    if (trimmed.endsWith("/api")) return `${trimmed}/consulting`;
    return `${trimmed}/api/consulting`;
  }
}

function normalizeConsultingApiPath(pathname: string) {
  if (pathname.endsWith("/api/consulting/partner")) return pathname.slice(0, -"/partner".length);
  if (pathname.endsWith("/consulting/partner")) return pathname.slice(0, -"/partner".length);
  if (pathname.endsWith("/api/consulting")) return pathname;
  if (pathname.endsWith("/api")) return `${pathname}/consulting`;
  return `${pathname}/api/consulting`;
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
  const url = new URL(getConsultingRealtimeApiBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws/bookings/${encodeURIComponent(bookingId)}`;
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
  let reconnectTimer: number | null = null;
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
    if (reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
      setStatus("offline");
      return;
    }
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
    reconnect: () => {
      if (closedByClient) return;
      reconnectAttempt = 0;
      clearReconnectTimer();
      if (socket) {
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
      socket = null;
      connect();
    },
    send,
    sendMessage: (payload) => send({ ...payload, type: "message.send" }),
  };
}
