import { fetch } from 'expo/fetch'

import type { LlmContentBlock, LlmMessage, LlmStreamRequest } from './types'

// Direct, bring-your-own-key Anthropic Messages streaming over expo/fetch, which
// (unlike React Native's built-in fetch) exposes a readable response body for SSE.
// No backend sits in front of this — the user's key calls Anthropic directly.
// See vault: Architecture - BYO Key No Backend.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 500

export interface AnthropicStreamCallbacks {
  /** Fired for each streamed text delta (not cumulative). */
  onDelta: (text: string) => void
}

/** Raised for provider/transport failures. Never contains the API key. */
export class AnthropicError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnthropicError'
  }
}

/**
 * Stream a completion from Anthropic. Resolves when the stream completes; rejects
 * with AnthropicError on failure. If `signal` aborts (barge-in), the underlying
 * fetch rejects with an AbortError, which the caller distinguishes by signal.aborted.
 */
export async function streamAnthropic(
  apiKey: string,
  model: string,
  req: LlmStreamRequest,
  callbacks: AnthropicStreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  // Validate inputs before they leave the device. A blank key would otherwise
  // produce an opaque 401; catch it here with a clear, actionable message.
  const key = apiKey.trim()
  if (!key) throw new AnthropicError('No Anthropic API key set. Add it in Settings.')
  if (!model.trim()) throw new AnthropicError('No model selected. Choose one in Settings.')
  if (req.messages.length === 0) throw new AnthropicError('Nothing to send: empty conversation.')

  const messages = req.messages.map(toAnthropicMessage)
  // Second cache breakpoint: mark the end of the conversation so the growing transcript is
  // cached and re-read from cache on the next turn — a cost + latency win on turn 2+, not
  // just on the static system prompt. Gated on there already being an assistant turn (a real
  // ongoing conversation) so we never pay a cache WRITE on a one-shot call such as the résumé
  // PDF cleanup, whose single large document message would be wasteful to cache. Anthropic
  // caches the prefix up to the last breakpoint and silently ignores a breakpoint whose
  // prefix is under the model's minimum cacheable size, so short chats stay safe too.
  if (messages.length > 0 && req.messages.some((m) => m.role === 'assistant')) {
    messages[messages.length - 1] = withTailCache(messages[messages.length - 1])
  }

  const body = {
    model: model.trim(),
    max_tokens: clampTokens(req.maxTokens),
    // Prompt caching: mark the system prompt as a cache breakpoint so the large,
    // stable instruction block is billed/processed once and reused across turns.
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages,
    stream: true,
    // Halt before the model can spill into a hallucinated next turn (see lib/reply.ts).
    ...(req.stopSequences?.length ? { stop_sequences: req.stopSequences } : {}),
  }

  let res: Awaited<ReturnType<typeof fetch>>
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    // Re-throw aborts untouched so the caller can treat them as a barge-in, not an error.
    if (signal.aborted) throw e
    throw new AnthropicError(`Network error reaching Anthropic: ${errText(e)}`)
  }

  if (!res.ok) {
    throw new AnthropicError(await describeHttpError(res))
  }
  if (!res.body) {
    throw new AnthropicError('Anthropic returned no response body to stream.')
  }

  await readSse(res.body, callbacks, signal)
}

/** Map our message shape to Anthropic's wire format (string or content blocks). */
function toAnthropicMessage(m: LlmMessage): { role: 'user' | 'assistant'; content: unknown } {
  if (typeof m.content === 'string') return { role: m.role, content: m.content }
  return { role: m.role, content: m.content.map(toAnthropicBlock) }
}

/**
 * Add an ephemeral cache breakpoint to the last content block of a message, normalizing a
 * bare-string content into a single text block so cache_control has somewhere to attach.
 */
function withTailCache(msg: { role: 'user' | 'assistant'; content: unknown }): {
  role: 'user' | 'assistant'
  content: unknown
} {
  const blocks =
    typeof msg.content === 'string'
      ? [{ type: 'text', text: msg.content }]
      : (msg.content as Record<string, unknown>[]).slice()
  if (blocks.length === 0) return msg
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
  return { role: msg.role, content: blocks }
}

function toAnthropicBlock(b: LlmContentBlock): unknown {
  if (b.type === 'text') return { type: 'text', text: b.text }
  if (b.type === 'document') {
    // Anthropic reads PDFs natively from a base64 document block.
    return {
      type: 'document',
      source: { type: 'base64', media_type: b.mediaType, data: b.dataBase64 },
    }
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: b.mediaType, data: b.dataBase64 },
  }
}

/** Anthropic enforces 1..N; keep a sane floor/ceiling so a bad value can't 400 us. */
function clampTokens(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return DEFAULT_MAX_TOKENS
  return Math.max(1, Math.min(4096, Math.floor(n)))
}

/**
 * Read the SSE stream, decoding text deltas. Anthropic sends events as
 * `data: {json}` lines separated by blank lines; we buffer partial chunks and
 * parse complete lines. Unknown event types are ignored.
 */
async function readSse(
  body: ReadableStream<Uint8Array>,
  callbacks: AnthropicStreamCallbacks,
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
        if (!payload || payload === '[DONE]') continue

        const evt = safeParse(payload)
        if (!evt) continue
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          if (typeof evt.delta.text === 'string') callbacks.onDelta(evt.delta.text)
        } else if (evt.type === 'error') {
          throw new AnthropicError(`Anthropic stream error: ${evt.error?.message ?? 'unknown'}`)
        }
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
  type?: string
  delta?: { type?: string; text?: string }
  error?: { message?: string }
}

function safeParse(s: string): SseEvent | null {
  try {
    return JSON.parse(s) as SseEvent
  } catch {
    return null
  }
}

/** Build a user-facing message from a non-2xx response without leaking the key. */
async function describeHttpError(res: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  let detail = ''
  try {
    const text = await res.text()
    const json = JSON.parse(text) as { error?: { message?: string; type?: string } }
    detail = json.error?.message ?? json.error?.type ?? text.slice(0, 200)
  } catch {
    // Non-JSON body; the status line alone is enough.
  }
  if (res.status === 401) return 'Anthropic rejected the API key (401). Check it in Settings.'
  if (res.status === 429) return 'Anthropic rate limit hit (429). Wait a moment and retry.'
  return `Anthropic request failed (${res.status})${detail ? `: ${detail}` : ''}`
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
