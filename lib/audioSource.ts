import {
  AudioQuality,
  getRecordingPermissionsAsync,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio'
import { Platform } from 'react-native'

import { groqAsrModelFor, transcribeWithGroq, type GroqAudioClip } from './groq-transcribe'
import type { AudioSource as AudioSourceSetting, HueSettings, MicSensitivity } from './types'

// Platform abstraction for "where Hue's input comes from", exactly as the vault
// prescribes (Decisions: Platform - Android First — "Stub iOS behind a platform
// abstraction (e.g. an AudioSource interface)"). The manual source runs in Expo Go;
// the hands-free mic source (continuous capture + on-device VAD + cloud ASR, and later
// Android MediaProjection) plugs in behind this same interface in a dev-client build,
// with no change to the pipeline above it.

export interface AudioSourceHandlers {
  /** The user started speaking — used to barge in on an in-flight spoken reply. */
  onSpeechStart: () => void
  /** The user stopped speaking; the captured clip is now being transcribed. Lets the
   *  pipeline show a 'transcribing' state while the upload is in flight. */
  onCaptureEnd?: () => void
  /** A finalized utterance (already transcribed). For companion mode this is the
   *  interviewer's question. */
  onUtterance: (text: string) => void
  onError: (message: string) => void
}

export interface AudioSource {
  readonly kind: 'manual' | AudioSourceSetting
  /** Human-readable label for the UI. */
  readonly label: string
  /** True if this source needs an EAS dev-client (native module) rather than Expo Go. */
  readonly requiresDevClient: boolean
  start(handlers: AudioSourceHandlers): Promise<void>
  stop(): Promise<void>
  /**
   * Pause/resume live capture. The pipeline mutes the source while it is transcribing,
   * thinking, or speaking, and unmutes it when it returns to listening — so a hands-free
   * source never records the gap between turns or (in interviewer mode) Hue's own spoken
   * reply. Sources without live capture (manual/system) treat this as a no-op.
   */
  setMuted?(muted: boolean): void
}

/**
 * Expo-Go-friendly source: the user types the interviewer's question and submits
 * it, standing in for VAD + ASR until native capture lands. Submitting both signals
 * a "speech start" (so a streaming reply barges in) and delivers the utterance.
 */
export class ManualAudioSource implements AudioSource {
  readonly kind = 'manual' as const
  readonly label = 'Manual (type the question)'
  readonly requiresDevClient = false

  private handlers: AudioSourceHandlers | null = null

  async start(handlers: AudioSourceHandlers): Promise<void> {
    this.handlers = handlers
  }

  async stop(): Promise<void> {
    this.handlers = null
  }

  /** Called by the UI when the user submits a typed question. */
  submit(text: string): void {
    const trimmed = text.trim()
    if (!trimmed || !this.handlers) return
    this.handlers.onSpeechStart()
    this.handlers.onUtterance(trimmed)
  }
}

// Hands-free VAD tuning. expo-audio reports `metering` as a dBFS-style level (roughly
// -160 = silence, 0 = loudest). These are heuristics and will likely need a round of
// on-device tuning (see the plan's verification notes); they're the obvious knobs to turn
// if speech onset/end feels early or late.
const POLL_INTERVAL_MS = 100
/**
 * Trailing silence (after speech began) that ends an utterance. This is dead time on
 * every turn — we can't transcribe until we decide the user has stopped — so it's kept
 * close to the desktop VAD's 700ms `redemptionMs` (..\..\hue-desktop\src\renderer\src\lib\pipeline.ts).
 * A little higher than desktop because this is a coarse energy threshold, not Silero's
 * neural VAD, so a touch more hang guards against cutting off mid-sentence on a brief pause.
 */
const SILENCE_HANG_MS = 800
/**
 * Before speech is confirmed, a voiced run shorter than the sensitivity preset's minSpeechMs
 * that is then followed by this much silence is discarded (its accumulated voiced time is
 * reset to zero). That's what distinguishes an isolated non-speech transient — a brief blip
 * then quiet — from the start of an utterance, so stray clicks can never accumulate across a
 * clip into a false onset.
 */
const ONSET_RESET_MS = 300

/**
 * The two VAD knobs, per user-selected MicSensitivity (Settings → Speech input):
 * - `thresholdDbfs`: metering level (dBFS, ~-160 silence … 0 loudest) at/above which a frame
 *   counts as voiced. Closer to 0 = stricter (ignores quiet noise); more negative = catches
 *   softer speech but also more background.
 * - `minSpeechMs`: minimum *voiced* time before a clip is treated as real speech. Measures how
 *   long the level actually stayed above threshold — so a single loud transient (a door slam,
 *   a tap, a keyboard click) never counts as speech, only a sustained run does. Mobile
 *   stand-in for the desktop VAD's `minSpeechMs: 250` (Silero gates on real speech frames; our
 *   coarse energy VAD gates on voiced duration). Without it a one-frame blip arms the loop,
 *   gets uploaded, and Whisper hallucinates punctuation (the stray ".") on the non-speech audio.
 */
const SENSITIVITY_PRESETS: Record<MicSensitivity, { thresholdDbfs: number; minSpeechMs: number }> = {
  low: { thresholdDbfs: -30, minSpeechMs: 350 },
  balanced: { thresholdDbfs: -35, minSpeechMs: 250 },
  high: { thresholdDbfs: -42, minSpeechMs: 200 },
}
/** Hard cap so a single clip can't grow without bound (also recycles the idle clip). */
const MAX_UTTERANCE_MS = 30_000

/**
 * Recording config tuned for cloud ASR, not playback fidelity. Groq's Whisper downsamples
 * everything to 16 kHz mono internally, so recording at 44.1 kHz stereo
 * (RecordingPresets.HIGH_QUALITY) only makes a bigger file with no accuracy gain — and that
 * file has to be written to disk and uploaded before transcription can even start (see
 * lib/groq-transcribe.ts), so its size is pure added latency on every turn. 16 kHz mono AAC
 * at a low bitrate is a fraction of the bytes. Android's `voice_recognition` source applies
 * the platform's ASR-tuned capture chain (gain/echo handling). Stays `.m4a` / AAC so the
 * upload's filename and MIME in ContinuousMicAudioSource.finalize are unchanged.
 */
export const ASR_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    audioSource: 'voice_recognition',
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.LOW,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 32_000,
  },
}

/**
 * Hands-free microphone capture transcribed by Groq's hosted Whisper — the "talk to it
 * like a person" voice mode. Unlike a push-to-talk button, this runs a continuous loop:
 * it records with metering enabled, watches the audio level for speech onset and a
 * trailing silence, then stops, uploads the clip to Groq (see lib/groq-transcribe.ts),
 * and emits the recognized text — then waits to be unmuted before listening again.
 *
 * Groq Whisper is a BATCH endpoint, so we segment utterances ourselves with a simple
 * energy-based VAD over the recorder's `metering` level rather than streaming.
 *
 * Needs the native expo-audio module, so it only works in a dev-client build, never Expo
 * Go. The expo-audio recorder is created by `useAudioRecorder` in the React layer (it owns
 * the recorder's native lifecycle) and injected here; this class only drives the loop.
 */
export class ContinuousMicAudioSource implements AudioSource {
  readonly kind = 'microphone' as const
  readonly label = 'Microphone (hands-free)'
  readonly requiresDevClient = true

  private handlers: AudioSourceHandlers | null = null
  private disposed = false
  /** Paused by the pipeline between turns (transcribing/thinking/speaking). */
  private muted = false
  /** A record+poll cycle is currently running. */
  private armed = false
  private recording = false
  private pollTimer: ReturnType<typeof setInterval> | null = null

  // Per-clip VAD bookkeeping.
  private speechDetected = false
  private clipStartAt = 0
  private lastVoiceAt = 0
  /** Accumulated voiced time this clip; must reach `minSpeechMs` to confirm real speech. */
  private voicedMs = 0

  /** VAD knobs resolved once from the user's MicSensitivity setting (see SENSITIVITY_PRESETS). */
  private readonly thresholdDbfs: number
  private readonly minSpeechMs: number

  constructor(
    private readonly settings: HueSettings,
    private readonly recorder: AudioRecorder,
  ) {
    const preset = SENSITIVITY_PRESETS[settings.micSensitivity] ?? SENSITIVITY_PRESETS.balanced
    this.thresholdDbfs = preset.thresholdDbfs
    this.minSpeechMs = preset.minSpeechMs
  }

  async start(handlers: AudioSourceHandlers): Promise<void> {
    this.handlers = handlers
    const permission = await requestRecordingPermissionsAsync()
    if (!permission.granted) {
      throw new Error(
        'Microphone permission denied. Enable it for Hue in system settings, or switch the ' +
          'audio source to Manual and type the question.',
      )
    }
    // Route audio for recording; playsInSilentMode keeps capture alive if the ringer is off.
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })
    this.muted = false
    await this.arm()
  }

  /** Pause capture between turns; resume (re-arm) when the conversation is listening again. */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return
    this.muted = muted
    if (muted) {
      void this.disarm()
    } else if (!this.armed && !this.disposed && this.handlers) {
      void this.arm()
    }
  }

  async stop(): Promise<void> {
    this.disposed = true
    await this.disarm()
    this.handlers = null
  }

  /** Begin one record+poll cycle: capture until a trailing silence (or the length cap). */
  private async arm(): Promise<void> {
    if (this.armed || this.muted || this.disposed || !this.handlers) return
    this.armed = true
    this.speechDetected = false
    this.voicedMs = 0
    this.clipStartAt = Date.now()
    this.lastVoiceAt = this.clipStartAt
    try {
      await this.recorder.prepareToRecordAsync()
      // A late mute/stop may have landed while preparing — bail before we start capturing.
      if (this.muted || this.disposed) {
        this.armed = false
        return
      }
      this.recorder.record()
      this.recording = true
      this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
    } catch (e) {
      this.armed = false
      this.recording = false
      this.handlers?.onError(errText(e))
    }
  }

  /** Stop the current cycle without transcribing (mute / stop / pre-speech recycle). */
  private async disarm(): Promise<void> {
    this.clearTimer()
    this.armed = false
    if (this.recording) {
      this.recording = false
      try {
        await this.recorder.stop()
      } catch {
        // Already stopped or never started; nothing to clean up.
      }
    }
  }

  /** Metering tick: detect speech onset and a trailing silence that ends the utterance. */
  private poll(): void {
    if (!this.recording) return
    const level = this.recorder.getStatus().metering ?? -160
    const now = Date.now()

    if (level >= this.thresholdDbfs) {
      // Voiced frame: accumulate toward the sustained-speech threshold. Onset is only
      // confirmed once the level has stayed up for `minSpeechMs`, so a single loud blip
      // (a tap, a click, a slam) never arms the loop — it just adds a frame and decays.
      this.voicedMs += POLL_INTERVAL_MS
      this.lastVoiceAt = now
      if (!this.speechDetected && this.voicedMs >= this.minSpeechMs) {
        this.speechDetected = true
        this.handlers?.onSpeechStart()
      }
    } else if (!this.speechDetected && now - this.lastVoiceAt >= ONSET_RESET_MS) {
      // A brief blip that fell quiet again before reaching MIN_SPEECH_MS: forget it so
      // isolated non-speech transients can't accumulate across the clip into a false onset.
      this.voicedMs = 0
    }

    const elapsed = now - this.clipStartAt
    const trailingSilence = now - this.lastVoiceAt

    if (this.speechDetected && trailingSilence >= SILENCE_HANG_MS) {
      void this.finalize(true)
    } else if (elapsed >= MAX_UTTERANCE_MS) {
      // Cap reached: transcribe if we heard speech, otherwise recycle the idle clip so the
      // recording file doesn't grow without bound while no one is talking.
      void this.finalize(this.speechDetected)
    }
  }

  /** Close the current clip; transcribe + emit it when it actually held speech. */
  private async finalize(transcribe: boolean): Promise<void> {
    this.clearTimer()
    this.recording = false
    this.armed = false

    let uri: string | null = null
    try {
      await this.recorder.stop()
      uri = this.recorder.uri
    } catch (e) {
      this.handlers?.onError(errText(e))
    }

    if (!transcribe || !uri) {
      // Nothing worth sending (silence/recycle). Re-arm to keep listening unless paused.
      if (!this.muted && !this.disposed) void this.arm()
      return
    }

    // Tell the pipeline we've stopped capturing and are transcribing; it will mute us while
    // the upload, reply, and any spoken answer play out, then unmute to re-arm this loop.
    this.handlers?.onCaptureEnd?.()

    const clip: GroqAudioClip = { uri, filename: 'utterance.m4a', mimeType: 'audio/m4a' }
    try {
      const text = await transcribeWithGroq(
        this.settings.groqApiKey,
        groqAsrModelFor(this.settings),
        clip,
      )
      this.handlers?.onUtterance(text)
    } catch (e) {
      this.handlers?.onError(errText(e))
      // Transcription failed: the pipeline won't move off 'transcribing' on its own, so
      // recover by listening again (the pipeline mirrors this back to a 'listening' state).
      if (!this.muted && !this.disposed) void this.arm()
    }
  }

  private clearTimer(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }
}

/**
 * The 'system' / loopback source (interviewer audio from the call) is Android
 * MediaProjection — phase 4. Until then it throws so the gap is obvious. HIGH_QUALITY
 * records `.m4a` (audio/mp4); Groq Whisper accepts it.
 */
export class NativeSystemAudioSource implements AudioSource {
  readonly kind = 'system' as const
  readonly label = 'System / call audio'
  readonly requiresDevClient = true

  async start(): Promise<void> {
    throw new Error(
      'System/call audio capture (loopback) is a later phase. Use the Microphone source ' +
        '(hands-free) or switch the audio source to Manual.',
    )
  }

  async stop(): Promise<void> {
    // Nothing to tear down; start() never succeeds yet.
  }
}

/**
 * Whether native audio capture is available in this runtime. expo-audio's recorder is
 * a native module: present in a dev-client on a device, absent on web. Gated to Android
 * for now (iOS stays stubbed per the Android-First decision); the factory falls back to
 * the manual source everywhere else.
 */
export function isNativeAudioAvailable(): boolean {
  return Platform.OS === 'android'
}

/** Whether the current settings + runtime yield a live (hands-free) mic source. */
export function micCaptureAvailable(settings: HueSettings): boolean {
  return isNativeAudioAvailable() && settings.audioSource === 'microphone'
}

/** True once we've paid the native recorder's cold init this app launch (process-global). */
let nativeAudioWarmed = false

/**
 * Spin up the native recording stack ahead of the user's first tap so starting a session
 * goes straight to listening instead of stalling on the cold MediaRecorder / audio-session
 * init. The mobile analog of the desktop's `preloadOnDeviceModel()`: warm the heavy native
 * thing once, guarded against re-firing.
 *
 * Permission-respecting by design: it reads the mic permission WITHOUT prompting
 * (`getRecordingPermissionsAsync`) and does nothing unless it's already granted — the
 * permission dialog stays tied to the user's first explicit tap, never the app launch.
 *
 * Runs a normal prepare → stop cycle on the shared (hook-owned) recorder: `prepareToRecordAsync`
 * pays the cold init, and `stop` immediately releases the microphone so capture is never held
 * while the app sits idle. The recorder is left stopped — NOT released, which would invalidate
 * the `useAudioRecorder` instance — and the first real `arm()` re-prepares it before recording,
 * exactly as it would have anyway. Fully best-effort: any failure just means the first tap pays
 * the init as before, and we still make a final attempt to release the mic.
 */
export async function warmNativeAudio(recorder: AudioRecorder): Promise<void> {
  if (nativeAudioWarmed || !isNativeAudioAvailable()) return
  const permission = await getRecordingPermissionsAsync()
  if (!permission.granted) return // don't prompt here; the first tap will request it
  nativeAudioWarmed = true
  try {
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })
    await recorder.prepareToRecordAsync()
    // Release the mic the prepare reserved — we only wanted the cold init, not live capture.
    await recorder.stop()
  } catch {
    nativeAudioWarmed = false
    // Never leave the mic held if prepare succeeded but stop didn't.
    try {
      await recorder.stop()
    } catch {
      // Already idle / never prepared; nothing to release.
    }
  }
}

/**
 * Pick the input source for the current settings + runtime. With native audio: the
 * hands-free Groq mic source for 'microphone' (given a recorder from the React layer's
 * useAudioRecorder), the (still-stubbed) system source for 'system'. Without it (web, iOS
 * for now), or if no recorder was provided: the manual typed source.
 */
export function createAudioSource(settings: HueSettings, recorder?: AudioRecorder | null): AudioSource {
  if (isNativeAudioAvailable()) {
    if (settings.audioSource === 'system') return new NativeSystemAudioSource()
    if (recorder) return new ContinuousMicAudioSource(settings, recorder)
  }
  return new ManualAudioSource()
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
