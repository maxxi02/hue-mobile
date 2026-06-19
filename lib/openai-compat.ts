import { fetch } from 'expo/fetch'

import type {
  HueSettings,
  LlmContentBlock,
  LlmMessage,
  LlmStreamRequest,
  OpenAiCompatProvider,
} from './types'

// One generic client for every OpenAI-compatible LLM provider (Google Gemini, Groq,
// Mistral, Cohere). They all speak the same wire format — Bearer auth, POST
// /chat/completions with SSE streaming, GET /models — and differ only by base URL and
// which settings key/model field they read. Ported from the desktop main-process
// client (..\..\hue-desktop\src\main\openai-compat.ts) but adapted to the same
// bring-your-own-key, expo/fetch transport as lib/anthropic.ts: no backend, the
// user's key calls the provider directly, and expo/fetch (unlike RN's built-in fetch)
// exposes a readable response body for SSE.

const MODELS_TIMEOUT_MS = 8000
const DEFAULT_MAX_TOKENS = 500

export interface OpenAiCompatStreamCallbacks {
  /** Fired for each streamed text delta (not cumulative). */
  onDelta: (text: string) => void
}

/** Raised for provider/transport failures. Never contains the API key. */
export class OpenAiCompatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenAiCompatError'
  }
}

interface ProviderConfig {
  baseUrl: string
  /** Which HueSettings field holds this provider's API key. */
  keyField: keyof HueSettings
  /** Which HueSettings field holds the selected model. */
  modelField: keyof HueSettings
}

/** Base URLs match desktop's PROVIDERS map so behaviour is identical across apps. */
const PROVIDERS: Record<OpenAiCompatProvider, ProviderConfig> = {
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyField: 'googleApiKey',
    modelField: 'googleModel',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    // Reuses the same Groq account key as the (future) cloud ASR provider.
    keyField: 'groqApiKey',
    modelField: 'groqModel',
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    keyField: 'mistralApiKey',
    modelField: 'mistralModel',
  },
  cohere: {
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    keyField: 'cohereApiKey',
    modelField: 'cohereModel',
  },
}

export function isOpenAiCompatProvider(p: string): p is OpenAiCompatProvider {
  return p === 'google' || p === 'groq' || p === 'mistral' || p === 'cohere'
}

/** The HueSettings field that holds the given provider's API key. */
export function keyFieldFor(provider: OpenAiCompatProvider): keyof HueSettings {
  return PROVIDERS[provider].keyField
}

/** The HueSettings field that holds the given provider's selected model. */
export function modelFieldFor(provider: OpenAiCompatProvider): keyof HueSettings {
  return PROVIDERS[provider].modelField
}

/**
 * List the chat models the provider exposes, for the Settings "Detect models" picker.
 * Returns [] on any failure (bad key, network, timeout) so the UI can show an empty
 * state rather than crash. Uses a manual AbortController + timer instead of
 * AbortSignal.timeout(), which isn't guaranteed on the Hermes engine.
 */
export async function fetchOpenAiModels(
  provider: OpenAiCompatProvider,
  apiKey: string,
): Promise<string[]> {
  const key = apiKey.trim()
  if (!key) return []

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS)
  try {
    const res = await fetch(`${PROVIDERS[provider].baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    })
    if (!res.ok) return []
    const data = (await res.json()) as { data?: { id?: string }[] }
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id))
      .sort()
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

// Honour the user's chosen model; otherwise fetch the provider's list and take the
// first, so we never bake in a model version. Mirrors desktop's resolveModel.
async function resolveModel(
  provider: OpenAiCompatProvider,
  key: string,
  requested: string,
): Promise<string> {
  if (requested.trim()) return requested.trim()
  const models = await fetchOpenAiModels(provider, key)
  if (models.length === 0) {
    throw new OpenAiCompatError(
      `No model selected for ${provider} and none could be listed. Open Settings, ` +
        'enter your API key, and tap "Detect models".',
    )
  }
  return models[0]
}

/**
 * OpenAI-format message content: a bare string, or (for multimodal turns) an array of
 * text / image_url parts. Images ride as base64 data URIs. Ported from desktop.
 */
type OpenAiContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

function toOpenAiContent(content: LlmMessage['content']): OpenAiContent {
  if (typeof content === 'string') return content
  return content.map((b: LlmContentBlock) => {
    if (b.type === 'text') return { type: 'text' as const, text: b.text }
    if (b.type === 'document') {
      // These providers don't accept PDF documents in chat completions; the resume
      // flow routes PDFs to Anthropic, so this is a defensive guard, not an expected path.
      throw new OpenAiCompatError(
        'This provider can’t read PDF files directly. Upload a DOCX or TXT résumé, or switch to the Anthropic provider.',
      )
    }
    return {
      type: 'image_url' as const,
      image_url: { url: `data:${b.mediaType};base64,${b.dataBase64}` },
    }
  })
}

/**
 * Stream a completion from an OpenAI-compatible provider. Signature parallels
 * streamAnthropic: callback-based deltas, caller-owned AbortSignal. Resolves when the
 * stream completes; rejects with OpenAiCompatError on failure. If `signal` aborts
 * (barge-in), the underlying fetch rejects with an AbortError, which the caller
 * distinguishes via signal.aborted.
 */
export async function streamOpenAiCompat(
  apiKey: string,
  provider: OpenAiCompatProvider,
  model: string,
  req: LlmStreamRequest,
  callbacks: OpenAiCompatStreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const key = apiKey.trim()
  if (!key) throw new OpenAiCompatError(`No API key set for ${provider}. Add it in Settings.`)
  if (req.messages.length === 0) {
    throw new OpenAiCompatError('Nothing to send: empty conversation.')
  }

  const resolvedModel = await resolveModel(provider, key, model)

  // OpenAI format carries the system prompt as a leading system-role message.
  const messages = [
    ...(req.system ? [{ role: 'system', content: req.system }] : []),
    ...req.messages.map((m) => ({ role: m.role, content: toOpenAiContent(m.content) })),
  ]

  const body = {
    model: resolvedModel,
    messages,
    stream: true,
    max_tokens: clampTokens(req.maxTokens),
  }

  let res: Awaited<ReturnType<typeof fetch>>
  try {
    res = await fetch(`${PROVIDERS[provider].baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    // Re-throw aborts untouched so the caller can treat them as a barge-in, not an error.
    if (signal.aborted) throw e
    throw new OpenAiCompatError(`Network error reaching ${provider}: ${errText(e)}`)
  }

  if (!res.ok) {
    throw new OpenAiCompatError(await describeHttpError(provider, res))
  }
  if (!res.body) {
    throw new OpenAiCompatError(`${provider} returned no response body to stream.`)
  }

  await readSse(res.body, callbacks, signal)
}

/** Anthropic-style token clamp so a bad value can't 400 the request. */
function clampTokens(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return DEFAULT_MAX_TOKENS
  return Math.max(1, Math.min(4096, Math.floor(n)))
}

/**
 * Read the OpenAI-compatible SSE stream. Events arrive as `data: {json}` lines,
 * terminated by `data: [DONE]`. We buffer partial chunks, parse complete lines, and
 * emit choices[0].delta.content. Mirrors the buffered reader in lib/anthropic.ts.
 */
async function readSse(
  body: ReadableStream<Uint8Array>,
  callbacks: OpenAiCompatStreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue

        const payload = line.slice(5).trim()
        if (!payload) continue
        if (payload === '[DONE]') return

        const evt = safeParse(payload)
        if (!evt) continue
        const text = evt.choices?.[0]?.delta?.content
        if (typeof text === 'string' && text) callbacks.onDelta(text)
      }
    }
  } finally {
    // Release the lock so an aborted stream doesn't leak the reader.
    try {
      await reader.cancel()
    } catch {
      // Already closing; nothing to do.
    }
    if (signal.aborted) {
      // Caller treats abort as a barge-in, not a failure.
    }
  }
}

interface SseEvent {
  choices?: { delta?: { content?: string } }[]
}

function safeParse(s: string): SseEvent | null {
  try {
    return JSON.parse(s) as SseEvent
  } catch {
    return null
  }
}

/** Build a user-facing message from a non-2xx response without leaking the key. */
async function describeHttpError(
  provider: OpenAiCompatProvider,
  res: Awaited<ReturnType<typeof fetch>>,
): Promise<string> {
  let detail = ''
  try {
    const text = await res.text()
    const json = JSON.parse(text) as { error?: { message?: string; type?: string } }
    detail = json.error?.message ?? json.error?.type ?? text.slice(0, 200)
  } catch {
    // Non-JSON body; the status line alone is enough.
  }
  if (res.status === 401) return `${provider} rejected the API key (401). Check it in Settings.`
  if (res.status === 429) return `${provider} rate limit hit (429). Wait a moment and retry.`
  return `${provider} request failed (${res.status})${detail ? `: ${detail}` : ''}`
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
