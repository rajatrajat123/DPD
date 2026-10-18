import { Platform } from 'react-native';
import {
  AudioModule,
  createAudioPlayer,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type RecordingOptions,
  type AudioStatus,
} from 'expo-audio';

export interface AudioRecordingState {
  isRecording: boolean;
  durationMs: number;
  uri?: string;
  error?: string;
}

export interface AudioPlaybackState {
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  isBuffering: boolean;
}

export type PlaybackStatusListener = (state: AudioPlaybackState) => void;

// AAC-LC / M4A voice-note preset: mono, 16 kHz sample rate, 24 kbps bitrate
export const VOICE_NOTE_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 24000,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    extension: '.m4a',
    outputFormat: 'aac ',
    audioQuality: 32, // AudioQuality.LOW
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 24000,
  },
};

/**
 * Transforms cross-platform RecordingOptions into platform-specific format
 * required by the native AudioRecorder constructor in Expo SDK 57.
 */
function toPlatformRecordingOptions(options: RecordingOptions): any {
  const common = {
    extension: options.extension,
    sampleRate: options.sampleRate,
    numberOfChannels: options.numberOfChannels,
    bitRate: options.bitRate,
    isMeteringEnabled: options.isMeteringEnabled ?? false,
  };
  if (Platform.OS === 'ios') {
    return {
      ...common,
      directory: options.directory,
      ...options.ios,
    };
  } else if (Platform.OS === 'android') {
    return {
      ...common,
      directory: options.directory,
      ...options.android,
    };
  } else {
    return {
      ...common,
      ...options.web,
    };
  }
}

export function isAudioAvailable(): boolean {
  try {
    return Boolean(AudioModule && ((AudioModule as any).AudioRecorder || (AudioModule as any).AudioPlayer));
  } catch {
    return false;
  }
}

export function isPlaybackAvailable(): boolean {
  try {
    return Boolean(AudioModule && (AudioModule as any).AudioPlayer);
  } catch {
    return false;
  }
}

export class AudioService {
  private recorder: any = null;
  private player: AudioPlayer | null = null;
  private playerSubscription: { remove: () => void } | null = null;
  private activeSoundUri: string | null = null;
  private playbackListener: PlaybackStatusListener | null = null;
  private recordingStartTime = 0;
  private recordingTimer: any = null;
  private isRecordingActive = false;

  /**
   * Returns true if expo-audio native module is available in current runtime
   */
  isAvailable(): boolean {
    return isAudioAvailable();
  }

  /**
   * Returns true if expo-audio playback module is available in current runtime
   */
  isPlaybackAvailable(): boolean {
    return isPlaybackAvailable();
  }

  /**
   * Checks current microphone permission status without prompting
   */
  async checkMicrophonePermission(): Promise<boolean> {
    try {
      const res = await getRecordingPermissionsAsync();
      return res.granted;
    } catch {
      return false;
    }
  }

  /**
   * Prompts the user for microphone permission on-demand
   */
  async requestMicrophonePermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
    try {
      const res = await requestRecordingPermissionsAsync();
      return {
        granted: res.granted,
        canAskAgain: Boolean(res.canAskAgain),
      };
    } catch {
      return { granted: false, canAskAgain: false };
    }
  }

  /**
   * Configures audio session for recording
   */
  async configureAudioForRecording(): Promise<void> {
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
        shouldRouteThroughEarpiece: false,
      });
    } catch (err) {
      if (__DEV__) {
        console.warn('[AudioService.configureAudioForRecording] Failed to set audio mode:', err);
      }
    }
  }

  /**
   * Configures audio session for media playback
   */
  async configureAudioForPlayback(): Promise<void> {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
        shouldRouteThroughEarpiece: false,
      });
    } catch (err) {
      if (__DEV__) {
        console.warn('[AudioService.configureAudioForPlayback] Failed to set audio mode:', err);
      }
    }
  }

  private clearRecordingTimer(): void {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  /**
   * Starts a new voice note recording session
   */
  async startRecording(onStatusUpdate?: (durationMs: number) => void): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    // If a sound is currently playing, unload it
    await this.unloadCurrentSound();

    // Ensure permission is granted
    const { granted } = await this.requestMicrophonePermission();
    if (!granted) {
      return false;
    }

    try {
      await this.configureAudioForRecording();

      if (this.recorder) {
        try {
          await this.recorder.stop();
        } catch {}
        this.recorder = null;
      }
      this.clearRecordingTimer();

      const platformOpts = toPlatformRecordingOptions(VOICE_NOTE_RECORDING_OPTIONS);
      const rec = new (AudioModule as any).AudioRecorder(platformOpts);
      await rec.prepareToRecordAsync(VOICE_NOTE_RECORDING_OPTIONS);

      rec.record();
      this.recorder = rec;
      this.isRecordingActive = true;
      this.recordingStartTime = Date.now();

      if (onStatusUpdate) {
        this.recordingTimer = setInterval(() => {
          if (!this.recorder || !this.isRecordingActive) return;
          try {
            const status = this.recorder.getStatus();
            const duration =
              status && typeof status.durationMillis === 'number' && status.durationMillis > 0
                ? status.durationMillis
                : Date.now() - this.recordingStartTime;
            onStatusUpdate(duration);
          } catch {
            onStatusUpdate(Date.now() - this.recordingStartTime);
          }
        }, 150);
      }

      return true;
    } catch (err) {
      if (__DEV__) {
        console.warn('[AudioService.startRecording] Error:', err);
      }
      this.recorder = null;
      this.isRecordingActive = false;
      this.clearRecordingTimer();
      return false;
    }
  }

  /**
   * Stops recording and returns URI and final duration
   */
  async stopRecording(): Promise<{ uri: string; durationMs: number } | null> {
    if (!this.recorder) return null;
    this.clearRecordingTimer();

    try {
      let durationMs = 0;
      try {
        const status = this.recorder.getStatus();
        if (status && typeof status.durationMillis === 'number' && status.durationMillis > 0) {
          durationMs = status.durationMillis;
        }
      } catch {}

      if (durationMs <= 0 && this.recordingStartTime > 0) {
        durationMs = Date.now() - this.recordingStartTime;
      }

      await this.recorder.stop();
      const uri = this.recorder.uri;
      this.recorder = null;
      this.isRecordingActive = false;
      this.recordingStartTime = 0;
      await this.configureAudioForPlayback();

      if (!uri) return null;
      return { uri, durationMs: Math.max(0, durationMs) };
    } catch (err) {
      if (__DEV__) {
        console.warn('[AudioService.stopRecording] Error:', err);
      }
      this.recorder = null;
      this.isRecordingActive = false;
      this.recordingStartTime = 0;
      await this.configureAudioForPlayback();
      return null;
    }
  }

  /**
   * Cancels and discards active recording without saving
   */
  async cancelRecording(): Promise<void> {
    this.clearRecordingTimer();
    if (this.recorder) {
      try {
        await this.recorder.stop();
      } catch {}
      this.recorder = null;
    }
    this.isRecordingActive = false;
    this.recordingStartTime = 0;
    await this.configureAudioForPlayback();
  }

  /**
   * Plays or resumes an audio URI (local file or authenticated streaming URL)
   */
  async playSound(
    uri: string,
    onStatusUpdate?: PlaybackStatusListener,
    initialPositionMs = 0
  ): Promise<boolean> {
    if (!this.isPlaybackAvailable()) {
      return false;
    }

    try {
      this.playbackListener = onStatusUpdate || null;

      // If already playing this URI, resume
      if (this.player && this.activeSoundUri === uri) {
        if (this.player.playing) {
          return true;
        }
        if (
          this.player.duration > 0 &&
          this.player.currentTime >= this.player.duration
        ) {
          await this.player.seekTo(0);
        }
        this.player.play();
        return true;
      }

      // Unload previous sound if any
      await this.unloadCurrentSound();
      await this.configureAudioForPlayback();

      const player = createAudioPlayer(uri, {
        updateInterval: 150,
        downloadFirst: false,
      });

      const subscription = player.addListener(
        'playbackStatusUpdate',
        (status: AudioStatus) => {
          const isPlaying = Boolean(status.playing);
          const positionMs = Math.round((status.currentTime || 0) * 1000);
          const durationMs = Math.round((status.duration || 0) * 1000);
          const isBuffering = Boolean(status.isBuffering);

          if (this.playbackListener) {
            this.playbackListener({
              isPlaying,
              positionMs,
              durationMs,
              isBuffering,
            });
          }

          if (status.didJustFinish) {
            player.seekTo(0).catch(() => {});
          }
        }
      );

      this.player = player;
      this.playerSubscription = subscription;
      this.activeSoundUri = uri;

      if (initialPositionMs > 0) {
        await player.seekTo(initialPositionMs / 1000);
      }

      player.play();
      return true;
    } catch (err) {
      if (__DEV__) {
        console.warn('[AudioService.playSound] Playback failure:', err);
      }
      await this.unloadCurrentSound();
      return false;
    }
  }

  /**
   * Pauses active audio playback
   */
  async pauseSound(): Promise<void> {
    if (!this.player) return;
    try {
      this.player.pause();
    } catch {}
  }

  /**
   * Seeks to a specific position in milliseconds
   */
  async seekTo(positionMs: number): Promise<void> {
    if (!this.player) return;
    try {
      const seconds = Math.max(0, positionMs / 1000);
      await this.player.seekTo(seconds);
    } catch {}
  }

  /**
   * Stops and unloads current sound instance
   */
  async unloadCurrentSound(): Promise<void> {
    if (this.playerSubscription) {
      try {
        this.playerSubscription.remove();
      } catch {}
      this.playerSubscription = null;
    }
    if (this.player) {
      try {
        this.player.pause();
      } catch {}
      try {
        this.player.remove();
      } catch {}
      this.player = null;
    }
    this.activeSoundUri = null;
    this.playbackListener = null;
  }
}

export const audioService = new AudioService();

/**
 * Formats milliseconds into mm:ss display string (e.g. 0:08, 1:45)
 */
export function formatAudioDuration(durationMs: number): string {
  if (!durationMs || isNaN(durationMs) || durationMs < 0) return '0:00';
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}
