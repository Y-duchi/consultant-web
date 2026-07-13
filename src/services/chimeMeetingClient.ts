import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  type AudioVideoObserver,
  type MeetingSession,
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
};

export type ChimeMeetingElements = {
  audioElement: HTMLAudioElement;
  localVideoElement: HTMLVideoElement | null;
  remoteVideoElement: HTMLVideoElement | null;
};

type WebChimeMeetingElements = {
  audioElement: HTMLAudioElement;
  localVideoElement: HTMLVideoElement | null;
  remoteVideoElement: HTMLVideoElement | null;
  onStatusChange?: (message: string) => void;
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
        });
        options.onStatusChange?.("connected");
      } catch (error) {
        const message = error instanceof Error ? error.message : "화상 상담을 시작하지 못했습니다.";
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

  audioVideo.chooseVideoInputQuality(1280, 720, 30);
  audioVideo.setVideoMaxBandwidthKbps(2500);

  const observer: AudioVideoObserver = {
    audioVideoDidStart: () => elements.onStatusChange?.("화상 상담이 연결되었습니다."),
    audioVideoDidStop: () => elements.onStatusChange?.("화상 상담이 종료되었습니다."),
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
    throw new Error("화상 상담 연결 정보가 올바르지 않습니다. 예약 상태를 확인한 뒤 다시 시도해 주세요.");
  }
}

function toDeviceAccessErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("마이크 장치를 찾을 수 없습니다")) {
    return "마이크 장치를 찾을 수 없습니다. 장치를 연결한 뒤 다시 입장해 주세요.";
  }
  return "브라우저의 카메라/마이크 권한을 허용한 뒤 다시 입장해 주세요. 권한을 이미 허용했다면 장치 연결 상태를 확인해 주세요.";
}
