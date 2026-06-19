import type { HueSettings } from './types'

/**
 * Default settings for a fresh install. Mirrors the desktop DEFAULT_SETTINGS for
 * the fields the mobile app keeps. Secret keys start empty — the user enters their
 * own (bring-your-own-key, no backend; see vault: Architecture - BYO Key No Backend).
 */
export const DEFAULT_SETTINGS: HueSettings = {
  llmProvider: 'anthropic',
  anthropicApiKey: '',
  model: 'claude-opus-4-8',
  googleApiKey: '',
  mistralApiKey: '',
  cohereApiKey: '',
  // Empty = auto-pick the provider's first listed model (see lib/openai-compat.ts).
  googleModel: '',
  groqModel: '',
  mistralModel: '',
  cohereModel: '',
  cloudAsrProvider: 'deepgram',
  deepgramApiKey: '',
  assemblyAiApiKey: '',
  groqApiKey: '',
  // Empty = auto-pick the turbo Whisper default (see lib/groq-transcribe.ts).
  groqAsrModel: '',
  // Device speech engine by default (free, offline); Groq Orpheus is opt-in (see TtsProvider).
  ttsProvider: 'device',
  ttsVoice: '',
  ttsSpeed: 1.05,
  groqTtsModel: '',
  groqTtsVoice: 'autumn',
  resumeSummary: '',
  additionalContext: '',
  jobTitle: '',
  interviewMode: 'practice',
  hueMode: 'companion',
  audioSource: 'microphone',
  micSensitivity: 'balanced',
  bubbleEnabled: false,
}
