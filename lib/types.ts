// Core types for Hue Mobile, ported from the desktop app's shared/types.ts and
// trimmed to what the mobile app needs. Desktop source of truth:
//   ..\..\hue-desktop\src\shared\types.ts
// Desktop-only concepts (Electron hotkeys, window opacity, phone-mirror,
// contentProtection) are intentionally dropped; their mobile equivalents arrive
// in later phases (quick-settings tile, FLAG_SECURE) per the vault Feature Map.

/** LLM backends. Anthropic uses its own client; the rest share one OpenAI-compatible client. */
export type LlmProvider = 'anthropic' | 'google' | 'groq' | 'mistral' | 'cohere'

/**
 * Providers that speak the OpenAI Chat Completions wire format (Bearer auth,
 * POST /chat/completions with SSE streaming, GET /models). They differ only by
 * base URL and which key/model setting they read, so one client drives them all.
 * Mirrors desktop's OpenAiCompatProvider (..\..\hue-desktop\src\shared\types.ts).
 */
export type OpenAiCompatProvider = 'google' | 'groq' | 'mistral' | 'cohere'

/** Cloud ASR providers (used once native mic capture lands in a dev-client build). */
export type CloudAsrProvider = 'deepgram' | 'assemblyai' | 'groq'

export type InterviewMode = 'practice' | 'star' | 'live'

/**
 * Which engine speaks Hue's questions aloud (interviewer mode only):
 * - 'device': the OS speech engine via expo-speech — free, offline, instant, the default.
 * - 'groq': Groq's hosted Orpheus TTS (canopylabs/orpheus-v1-english) — far more natural and
 *   expressive, but each ≤200-char chunk is a network round-trip and shares the Groq account's
 *   rate limits. Reuses the same `groqApiKey` as Groq LLM/ASR.
 */
export type TtsProvider = 'device' | 'groq'

/**
 * Which role Hue plays:
 * - 'companion': incoming speech is the INTERVIEWER's question; Hue drafts an
 *   answer for the user, shown as TEXT only (never spoken, so it isn't overheard).
 * - 'interviewer': Hue runs a mock interview, asking questions one at a time,
 *   spoken aloud via the device speech engine (lib/tts.ts).
 */
export type HueMode = 'companion' | 'interviewer'

/**
 * Where Hue listens:
 * - 'microphone': the device mic (echo-cancelled) — native, arrives via dev-client.
 * - 'system': system/loopback (the interviewer on a call) — Android MediaProjection,
 *   phase 4. In Expo Go both are stubbed behind the AudioSource interface.
 */
export type AudioSource = 'microphone' | 'system'

/**
 * How aggressively the hands-free VAD treats incoming sound as speech.
 * - 'low': needs louder, more sustained sound — ignores more background/non-speech noise
 *   (a fan, keyboard, distant voices). Best in a noisy room.
 * - 'balanced': the default trade-off.
 * - 'high': catches quiet or soft speech, at the cost of more false triggers from noise.
 * Maps to an energy threshold + minimum voiced duration in lib/audioSource.ts.
 */
export type MicSensitivity = 'low' | 'balanced' | 'high'

/** Subset of the desktop HueSettings relevant to the mobile app. */
export interface HueSettings {
  llmProvider: LlmProvider
  anthropicApiKey: string
  /** Anthropic model id (free text — Anthropic has no public /models listing here). */
  model: string
  /** API keys for the OpenAI-compatible LLM providers. Groq reuses `groqApiKey` below. */
  googleApiKey: string
  mistralApiKey: string
  cohereApiKey: string
  /**
   * Selected model per OpenAI-compatible provider. Empty = auto-pick the first model
   * the provider lists, so nothing is hardcoded to a version (mirrors desktop).
   */
  googleModel: string
  groqModel: string
  mistralModel: string
  cohereModel: string
  cloudAsrProvider: CloudAsrProvider
  deepgramApiKey: string
  assemblyAiApiKey: string
  /** Groq account key — reused for both its LLM and its cloud ASR. */
  groqApiKey: string
  /**
   * Selected Groq Whisper model for transcription. Empty = the turbo default
   * (see DEFAULT_GROQ_ASR_MODEL in lib/groq-transcribe.ts).
   */
  groqAsrModel: string
  /** Which engine speaks aloud in interviewer mode (see TtsProvider). */
  ttsProvider: TtsProvider
  /** Device (expo-speech) voice identifier. Empty = the system default. */
  ttsVoice: string
  ttsSpeed: number
  /**
   * Groq Orpheus TTS model. Empty = the English default (see DEFAULT_GROQ_TTS_MODEL in
   * lib/groq-tts.ts). Only used when ttsProvider is 'groq'.
   */
  groqTtsModel: string
  /**
   * Selected Orpheus voice persona, lowercase id (e.g. 'autumn'). Empty = the default voice.
   * Only used when ttsProvider is 'groq'; the device voice lives in ttsVoice above.
   */
  groqTtsVoice: string
  resumeSummary: string
  /**
   * Free-text context the user adds beyond the resume — goals, the company/role they're
   * targeting, projects not on paper, framing they want. Treated as ground truth the same
   * way as the resume: Hue may draw on it but must never contradict or fabricate around it.
   */
  additionalContext: string
  jobTitle: string
  interviewMode: InterviewMode
  hueMode: HueMode
  audioSource: AudioSource
  /** Hands-free VAD aggressiveness (see MicSensitivity). Tunable from Settings without a rebuild. */
  micSensitivity: MicSensitivity
  /**
   * Whether the floating chat-head bubble (Android system overlay) is enabled. Requires
   * the "draw over other apps" permission; Android-only (see vault: Platform - Android First).
   */
  bubbleEnabled: boolean
}

/**
 * Keys that are sensitive and must be stored in the OS keystore via
 * expo-secure-store, never in plain AsyncStorage or the bundle.
 */
export const SECRET_SETTING_KEYS = [
  'anthropicApiKey',
  'googleApiKey',
  'mistralApiKey',
  'cohereApiKey',
  'deepgramApiKey',
  'assemblyAiApiKey',
  'groqApiKey',
] as const satisfies readonly (keyof HueSettings)[]

export type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number]

/** A plain-text part of a message. */
export interface LlmTextBlock {
  type: 'text'
  text: string
}

/** Image formats every vision-capable provider here accepts. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** An image part of a message (e.g. a capture), base64-encoded. Phase 3. */
export interface LlmImageBlock {
  type: 'image'
  mediaType: ImageMediaType
  /** Raw base64 (no data: URI prefix). */
  dataBase64: string
}

/**
 * A PDF document part of a message, base64-encoded. Read NATIVELY by the LLM (the
 * model sees the rendered pages, not a fragile on-device text extraction), used by the
 * resume flow in lib/resume.ts. Only Anthropic is wired to accept this today.
 */
export interface LlmDocumentBlock {
  type: 'document'
  mediaType: 'application/pdf'
  /** Raw base64 (no data: URI prefix). */
  dataBase64: string
}

export type LlmContentBlock = LlmTextBlock | LlmImageBlock | LlmDocumentBlock

export interface LlmMessage {
  role: 'user' | 'assistant'
  /** A bare string (the common text turn) or ordered blocks for multimodal turns. */
  content: string | LlmContentBlock[]
}

/** A fully-rendered request to the LLM. The system prompt is built from settings. */
export interface LlmStreamRequest {
  messages: LlmMessage[]
  system: string
  maxTokens?: number
  /**
   * Strings that halt generation when produced. Used by the live answer pipeline to stop a
   * model from running past its answer into a hallucinated next turn ("\nUser:" etc.). At
   * most four, so it fits the OpenAI Chat Completions `stop` field. Omitted by the résumé
   * cleanup pass, which legitimately emits section labels.
   */
  stopSequences?: string[]
}
