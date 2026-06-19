import type { HueSettings } from './types'

// Groq's hosted Whisper transcription (cloud ASR). The desktop/extension app
// (..\..\hue-extension-claude\hue\src\workers\whisper.worker.ts) runs Whisper
// on-device via transformers.js; mobile can't bundle that, so we use Groq's hosted
// /audio/transcriptions endpoint instead. It speaks the OpenAI audio API wire format
// (multipart POST, Bearer auth) on the same base URL and account key as the Groq LLM
// client in lib/openai-compat.ts — one key, two services (see vault: Architecture -
// BYO Key No Backend).
//
// This is a BATCH endpoint: it transcribes one complete utterance, not a live stream.
// The hands-free recorder (ContinuousMicAudioSource) segments an utterance to an audio file
// and passes its URI here; we upload it with React Native's XMLHttpRequest + a FormData
// `{ uri }` part, the idiomatic RN file-upload path — it streams the file from disk
// natively rather than reading it into JS memory.
//
// We deliberately do NOT use the global `fetch` here. On SDK 56 Expo's "winter" runtime
// swaps in a WinterCG `fetch` and patches `FormData`; that multipart encoder only handles
// strings and Blobs and throws "Unsupported FormDataPart implementation" on RN's `{ uri }`
// file part (node_modules/expo/src/winter/fetch/convertFormData.ts). Winter installs its
// `fetch` but leaves `XMLHttpRequest` alone, so XHR remains RN's native networking and the
// streaming file upload keeps working. (Transcription returns one JSON body, no streaming.)

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'

/**
 * Default Whisper model when the user hasn't picked one. `whisper-large-v3-turbo` is
 * Groq's fastest transcription model — the right default for a real-time companion
 * where latency matters more than the last point of accuracy.
 */
export const DEFAULT_GROQ_ASR_MODEL = 'whisper-large-v3-turbo'

/** Hard cap so a stuck request can't hang the listen loop forever. */
const TRANSCRIBE_TIMEOUT_MS = 20_000

/** The Groq key we've already opened a warm connection for (null = never warmed). */
let warmedForKey: string | null = null

/**
 * Pre-open the HTTPS connection to Groq so the first real transcription doesn't pay a
 * DNS lookup + TLS handshake on top of the audio upload — the "loading the transcribe"
 * lag on the first turn after launch. Fire-and-forget and fully best-effort: this is a
 * latency optimization, never a correctness step, so every failure is swallowed.
 *
 * This is the mobile analog of the desktop's `preloadOnDeviceModel()` (warm the slow part
 * of the first turn before the user asks for it). Mobile has no on-device model to load —
 * ASR is Groq's hosted Whisper — so the slow part is the cold network connection instead.
 * We warm it with a cheap `GET /models` and discard the body; even a 401 from a bad key
 * still establishes the DNS/TLS the upload reuses. We use XMLHttpRequest, the same RN
 * native transport the real upload uses (see the file header), so the warmed connection
 * is the one the upload actually reuses — `fetch` may pool separately. Guarded so a
 * re-render or an unrelated settings save doesn't re-fire it for an already-warm key.
 */
export function warmGroqConnection(apiKey: string): void {
  const key = apiKey.trim()
  if (!key || warmedForKey === key) return
  warmedForKey = key
  // On transport failure/timeout, clear the marker so a later attempt can retry.
  const reset = (): void => {
    if (warmedForKey === key) warmedForKey = null
  }
  try {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', `${GROQ_BASE_URL}/models`)
    xhr.setRequestHeader('Authorization', `Bearer ${key}`)
    xhr.timeout = 8000
    xhr.onerror = reset
    xhr.ontimeout = reset
    xhr.send()
  } catch {
    reset()
  }
}

/** Raised for transcription/transport failures. Never contains the API key. */
export class GroqTranscribeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GroqTranscribeError'
  }
}

/** A finished utterance recording on disk, ready to upload. */
export interface GroqAudioClip {
  /** Local file URI of the recording (e.g. file:///…/utterance.m4a). */
  uri: string
  /** File name including extension — Groq infers the container format from it. */
  filename: string
  /** MIME type of the recording (e.g. audio/m4a). */
  mimeType: string
}

// RN's FormData accepts a `{ uri, name, type }` file part, which the standard DOM
// FormData type doesn't model — this is the shape RN serializes into the multipart body.
type ReactNativeFilePart = { uri: string; name: string; type: string }

export interface GroqTranscribeOptions {
  /** ISO-639-1 hint (e.g. 'en'). Omit to let Whisper auto-detect. */
  language?: string
  /**
   * Optional priming text to bias spelling of names/jargon, exactly as the OpenAI
   * audio API uses it. Sanitized and length-capped before it leaves the device.
   */
  prompt?: string
}

/**
 * Transcribe one audio clip with Groq's hosted Whisper. Resolves to the recognized
 * text (possibly empty for silence); rejects with GroqTranscribeError on failure. If
 * `signal` aborts (stop / barge-in), the underlying fetch rejects with an AbortError,
 * which the caller distinguishes via signal.aborted — mirroring streamOpenAiCompat.
 */
export async function transcribeWithGroq(
  apiKey: string,
  model: string,
  clip: GroqAudioClip,
  options: GroqTranscribeOptions = {},
  signal?: AbortSignal,
): Promise<string> {
  const key = apiKey.trim()
  if (!key) {
    throw new GroqTranscribeError('No Groq API key set. Add it in Settings.')
  }
  if (!clip.uri) {
    throw new GroqTranscribeError('Nothing to transcribe: the recording was empty.')
  }

  const resolvedModel = model.trim() || DEFAULT_GROQ_ASR_MODEL

  const form = new FormData()
  // RN serializes this `{ uri, name, type }` part by streaming the file from disk.
  const filePart: ReactNativeFilePart = { uri: clip.uri, name: clip.filename, type: clip.mimeType }
  form.append('file', filePart as unknown as Blob)
  form.append('model', resolvedModel)
  form.append('response_format', 'json')
  if (options.language) form.append('language', options.language)
  const prompt = sanitizePrompt(options.prompt)
  if (prompt) form.append('prompt', prompt)

  // Own timer so a hung upload aborts even when the caller passes no signal; chain the
  // caller's signal so stop/barge-in still cancels us. (AbortSignal.timeout/any aren't
  // guaranteed on Hermes, so we wire it by hand — same reasoning as openai-compat.ts.)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort)
  }

  let res: { status: number; body: string }
  try {
    res = await uploadFormData(
      `${GROQ_BASE_URL}/audio/transcriptions`,
      `Bearer ${key}`,
      form,
      controller.signal,
    )
  } catch (e) {
    // Re-throw a caller-driven abort untouched so it reads as stop/barge-in, not error.
    if (signal?.aborted) throw e
    if (controller.signal.aborted) {
      throw new GroqTranscribeError(
        `Groq transcription timed out after ${TRANSCRIBE_TIMEOUT_MS / 1000}s.`,
      )
    }
    throw new GroqTranscribeError(`Network error reaching Groq: ${errText(e)}`)
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }

  if (res.status < 200 || res.status >= 300) {
    throw new GroqTranscribeError(describeHttpError(res.status, res.body))
  }

  let data: { text?: unknown }
  try {
    data = JSON.parse(res.body) as { text?: unknown }
  } catch (e) {
    throw new GroqTranscribeError(`Groq returned an unreadable transcription response: ${errText(e)}`)
  }
  return typeof data.text === 'string' ? data.text.trim() : ''
}

/**
 * The Groq ASR model the user selected, or the turbo default. Mirrors how the
 * OpenAI-compatible LLM client resolves a model from settings.
 */
export function groqAsrModelFor(settings: HueSettings): string {
  return settings.groqAsrModel.trim() || DEFAULT_GROQ_ASR_MODEL
}

/** Strip control chars and cap the priming prompt so it can't bloat the request. */
function sanitizePrompt(prompt: string | undefined): string {
  if (!prompt) return ''
  return prompt
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

/**
 * Upload the multipart form with React Native's XMLHttpRequest, streaming the recording
 * from disk via the FormData `{ uri }` part. See the file header for why this can't use the
 * global `fetch` on SDK 56. Resolves with the raw status + body for any completed response
 * (the caller maps non-2xx via describeHttpError); rejects only on transport failure/abort.
 * Chains `signal` so the caller's timeout / stop / barge-in cancels the in-flight upload.
 */
function uploadFormData(
  url: string,
  authHeader: string,
  form: FormData,
  signal: AbortSignal,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Upload aborted before it started.'))
      return
    }
    const xhr = new XMLHttpRequest()
    const onAbort = (): void => xhr.abort()
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)

    xhr.open('POST', url)
    // No explicit Content-Type: RN sets multipart/form-data with the boundary for a
    // FormData body. Setting it by hand would omit the boundary and corrupt the upload.
    xhr.setRequestHeader('Authorization', authHeader)
    xhr.onload = (): void => {
      cleanup()
      resolve({ status: xhr.status, body: xhr.responseText })
    }
    xhr.onerror = (): void => {
      cleanup()
      reject(new Error('network request failed'))
    }
    xhr.onabort = (): void => {
      cleanup()
      reject(new Error('Upload aborted.'))
    }
    signal.addEventListener('abort', onAbort)
    xhr.send(form)
  })
}

/** Build a user-facing message from a non-2xx response without leaking the key. */
function describeHttpError(status: number, body: string): string {
  let detail = ''
  try {
    const json = JSON.parse(body) as { error?: { message?: string; type?: string } }
    detail = json.error?.message ?? json.error?.type ?? body.slice(0, 200)
  } catch {
    // Non-JSON body; the status line alone is enough.
  }
  if (status === 401) return 'Groq rejected the API key (401). Check it in Settings.'
  if (status === 429) return 'Groq rate limit hit (429). Wait a moment and retry.'
  if (status === 413) return 'Recording too large for Groq (413). Keep utterances shorter.'
  return `Groq transcription failed (${status})${detail ? `: ${detail}` : ''}`
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
