import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  type AudioVideoObserver,
  type MeetingSession,
  type Transcript,
  type TranscriptEvent,
  type TranscriptResult,
  type TranscriptionStatus,
  type VideoTileState,
} from "amazon-chime-sdk-js";
import type { ConsultingCallJoinResult } from "../types/domain";

export type WebChimeMeetingController = {
  setLocalVideoEnabled: (enabled: boolean) => Promise<void>;
  setMuted: (muted: boolean) => void;
  stop: () => Promise<void>;
};

export type ChimeMeetingStatus = "connecting" | "connected" | "stopped" | "failed";

export type ChimeMeetingClient = {
  setLocalVideoEnabled: (enabled: boolean) => Promise<void>;
  setMuted: (muted: boolean) => void;
  start: (elements: ChimeMeetingElements) => Promise<void>;
  stop: () => Promise<void>;
};

export type ChimeMeetingClientOptions = {
  onError?: (message: string) => void;
  onStatusChange?: (status: ChimeMeetingStatus) => void;
  onTranscriptResults?: (results: WebChimeTranscriptResult[]) => void;
  onTranscriptionStatus?: (status: WebChimeTranscriptionStatus) => void;
};

export type ChimeMeetingElements = {
  audioElement: HTMLAudioElement;
  localVideoElement: HTMLVideoElement | null;
  remoteVideoElement: HTMLVideoElement | null;
};

type WebChimeMeetingElements = {
  audioElement: HTMLAudioElement;
  localVideoElement: HTMLVideoElement | null;
  onTranscriptResults?: (results: WebChimeTranscriptResult[]) => void;
  onTranscriptionStatus?: (status: WebChimeTranscriptionStatus) => void;
  remoteVideoElement: HTMLVideoElement | null;
  onStatusChange?: (message: string) => void;
};

export type WebChimeTranscriptResult = {
  resultId: string;
  isPartial: boolean;
  languageCode?: string;
  speakerAttendeeId?: string;
  speakerExternalUserId?: string;
  transcript: string;
};

export type WebChimeTranscriptionStatus = {
  message?: string;
  transcriptionRegion?: string;
  type: string;
};

export function createChimeMeetingClient(
  joinResult: ConsultingCallJoinResult,
  options: ChimeMeetingClientOptions = {},
): ChimeMeetingClient {
  let controller: WebChimeMeetingController | null = null;

  return {
    setLocalVideoEnabled: async (enabled: boolean) => {
      await controller?.setLocalVideoEnabled(enabled);
    },
    setMuted: (muted: boolean) => {
      controller?.setMuted(muted);
    },
    start: async (elements: ChimeMeetingElements) => {
      options.onStatusChange?.("connecting");
      try {
        controller = await startWebChimeMeeting(joinResult, {
          ...elements,
          onStatusChange: () => options.onStatusChange?.("connected"),
          onTranscriptResults: options.onTranscriptResults,
          onTranscriptionStatus: options.onTranscriptionStatus,
        });
        options.onStatusChange?.("connected");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Chime 미팅을 시작하지 못했습니다.";
        options.onStatusChange?.("failed");
        options.onError?.(message);
        throw error;
      }
    },
    stop: async () => {
      await controller?.stop();
      controller = null;
      options.onStatusChange?.("stopped");
    },
  };
}

export async function startWebChimeMeeting(
  joinResult: ConsultingCallJoinResult,
  elements: WebChimeMeetingElements,
): Promise<WebChimeMeetingController> {
  assertJoinCredentials(joinResult);
  const logger = new ConsoleLogger("AURAChimeMeeting", LogLevel.WARN);
  const deviceController = new DefaultDeviceController(logger);
  const configuration = new MeetingSessionConfiguration(
    { Meeting: joinResult.meeting },
    { Attendee: joinResult.attendee },
  );
  const meetingSession: MeetingSession = new DefaultMeetingSession(configuration, logger, deviceController);
  const audioVideo = meetingSession.audioVideo;
  let transcriptEventCallback: ((transcriptEvent: TranscriptEvent) => void) | null = null;

  audioVideo.chooseVideoInputQuality(1280, 720, 30);
  audioVideo.setVideoMaxBandwidthKbps(1400);

  const observer: AudioVideoObserver = {
    audioVideoDidStart: () => elements.onStatusChange?.("Chime 미디어 세션이 시작됐습니다."),
    audioVideoDidStop: () => elements.onStatusChange?.("Chime 미디어 세션이 종료됐습니다."),
    videoTileDidUpdate: (tileState: VideoTileState) => {
      if (!tileState.tileId || tileState.isContent) return;
      const videoElement = tileState.localTile ? elements.localVideoElement : elements.remoteVideoElement;
      if (!videoElement) return;
      audioVideo.bindVideoElement(tileState.tileId, videoElement);
    },
    videoTileWasRemoved: (tileId: number) => {
      audioVideo.unbindVideoElement(tileId, true);
    },
  };

  audioVideo.addObserver(observer);
  if (elements.onTranscriptResults || elements.onTranscriptionStatus) {
    transcriptEventCallback = (transcriptEvent) => {
      if (isTranscriptEvent(transcriptEvent)) {
        const results = transcriptEvent.results
          .map(mapTranscriptResult)
          .filter((result): result is WebChimeTranscriptResult => Boolean(result));
        if (results.length) elements.onTranscriptResults?.(results);
        return;
      }

      if (isTranscriptionStatusEvent(transcriptEvent)) {
        elements.onTranscriptionStatus?.({
          message: transcriptEvent.message,
          transcriptionRegion: transcriptEvent.transcriptionRegion,
          type: String(transcriptEvent.type),
        });
      }
    };
    audioVideo.transcriptionController?.subscribeToTranscriptEvent(transcriptEventCallback);
  }
  await audioVideo.bindAudioElement(elements.audioElement);

  let videoInputDeviceId: string | null = null;
  try {
    const audioInputs = await audioVideo.listAudioInputDevices();
    if (!audioInputs[0]?.deviceId) {
      throw new Error("마이크 장치를 찾을 수 없습니다.");
    }
    await audioVideo.startAudioInput(audioInputs[0].deviceId);

    const videoInputs = await audioVideo.listVideoInputDevices();
    videoInputDeviceId = videoInputs[0]?.deviceId ?? null;
    if (videoInputDeviceId) {
      await audioVideo.startVideoInput(videoInputDeviceId);
    }
  } catch (error) {
    audioVideo.removeObserver(observer);
    audioVideo.unbindAudioElement();
    throw new Error(toDeviceAccessErrorMessage(error));
  }

  audioVideo.start();
  if (videoInputDeviceId) {
    audioVideo.startLocalVideoTile();
  }

  return {
    setLocalVideoEnabled: async (enabled: boolean) => {
      if (enabled) {
        const devices = await audioVideo.listVideoInputDevices();
        if (devices[0]?.deviceId) {
          await audioVideo.startVideoInput(devices[0].deviceId);
          audioVideo.startLocalVideoTile();
        }
        return;
      }
      audioVideo.stopLocalVideoTile();
      await audioVideo.stopVideoInput();
    },
    setMuted: (muted: boolean) => {
      if (muted) {
        audioVideo.realtimeMuteLocalAudio();
      } else {
        audioVideo.realtimeUnmuteLocalAudio();
      }
    },
    stop: async () => {
      if (transcriptEventCallback) {
        audioVideo.transcriptionController?.unsubscribeFromTranscriptEvent(transcriptEventCallback);
        transcriptEventCallback = null;
      }
      audioVideo.removeObserver(observer);
      audioVideo.stopLocalVideoTile();
      await audioVideo.stopVideoInput().catch(() => undefined);
      await audioVideo.stopAudioInput().catch(() => undefined);
      audioVideo.unbindAudioElement();
      audioVideo.stop();
    },
  };
}

function assertJoinCredentials(joinResult: ConsultingCallJoinResult) {
  const meetingId = joinResult.meeting.MeetingId;
  const attendeeId = joinResult.attendee.AttendeeId;
  const joinToken = joinResult.attendee.JoinToken;
  if (typeof meetingId !== "string" || !meetingId || typeof attendeeId !== "string" || !attendeeId || typeof joinToken !== "string" || !joinToken) {
    throw new Error("화상상담 입장 정보가 올바르지 않습니다. 서버의 Chime 설정과 예약 상태를 확인해 주세요.");
  }
}

function toDeviceAccessErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("마이크 장치를 찾을 수 없습니다")) {
    return "마이크 장치를 찾을 수 없습니다. 장치를 연결한 뒤 다시 입장해 주세요.";
  }
  return "브라우저의 카메라/마이크 권한을 허용한 뒤 다시 입장해 주세요. 권한을 이미 허용했다면 장치 연결 상태를 확인해 주세요.";
}

function isTranscriptEvent(transcriptEvent: TranscriptEvent): transcriptEvent is Transcript {
  return Array.isArray((transcriptEvent as Transcript).results);
}

function isTranscriptionStatusEvent(transcriptEvent: TranscriptEvent): transcriptEvent is TranscriptionStatus {
  return typeof (transcriptEvent as TranscriptionStatus).type !== "undefined" &&
    typeof (transcriptEvent as TranscriptionStatus).eventTimeMs === "number";
}

function mapTranscriptResult(result: TranscriptResult): WebChimeTranscriptResult | null {
  const alternative = result.alternatives[0];
  const transcript = alternative?.transcript?.trim() ?? "";
  if (!result.resultId || !transcript) return null;

  const speakerItem = alternative.items.find((item) => item.attendee);
  return {
    resultId: result.resultId,
    isPartial: Boolean(result.isPartial),
    languageCode: result.languageCode,
    speakerAttendeeId: speakerItem?.attendee?.attendeeId,
    speakerExternalUserId: speakerItem?.attendee?.externalUserId,
    transcript,
  };
}
