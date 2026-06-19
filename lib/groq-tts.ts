import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import { fetch } from 'expo/fetch'

import { normalizeReply } from './reply'
import { splitToMaxLen, takeSentence } from './tts-chunk'
import type { Speaker } from './tts'

// Cloud text-to-speech via Groq's hosted Orpheus model (canopylabs/orpheus-v1-english), an
// alternative to the on-device expo-speech voice (see lib/tts.ts). Same shape as SentenceSpeaker
// — push streamed text, finish, stop — so VoicePipeline swaps between them behind the Speaker
// interface based on settings.ttsProvider. Only interviewer mode speaks; companion answers stay
// text-only (see VoicePipeline.speakResponses).
//
// Groq's /audio/speech returns a complete WAV per call (no audio streaming) and caps `input` at
// 200 characters, so we chunk the reply sentence-by-sentence (splitting any over-long sentence,
// see lib/tts-chunk.ts), synthesize each chunk to a temp WAV, and play them in order through one
// reused expo-audio player. To hide the per-chunk network round-trip, the next chunk is
// synthesized while the current one plays. Reuses the same Groq account key as Groq LLM/ASR.

const GROQ_TTS_URL = 'https://api.groq.com/openai/v1/audio/speech'

/** Default Orpheus model and voice when the user hasn't pinned them in Settings. */
export const DEFAULT_GROQ_TTS_MODEL = 'canopylabs/orpheus-v1-english'
export const DEFAULT_GROQ_TTS_VOICE = 'autumn'

/** The six Orpheus voice personas Groq exposes for the English model (lowercase API ids). */
export const ORPHEUS_VOICES = [
  { id: 'autumn', label: 'Autumn', gender: 'Female' },
  { id: 'diana', label: 'Diana', gender: 'Female' },
  { id: 'hannah', label: 'Hannah', gender: 'Female' },
  { id: 'austin', label: 'Austin', gender: 'Male' },
  { id: 'daniel', label: 'Daniel', gender: 'Male' },
  { id: 'troy', label: 'Troy', gender: 'Male' },
] as const

/** Orpheus hard input cap: 200 characters per /audio/speech request. */
export const ORPHEUS_MAX_INPUT = 200

/** Raised for Groq TTS provider/transport failures. Never contains the API key. */
export class GroqTtsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GroqTtsError'
  }
}

/**
 * Synthesize one chunk of text (≤200 chars; longer input is truncated as a guard) to a temp WAV
 * file and return its uri. The caller owns playback and cleanup. `signal` aborts the request on
 * barge-in/stop, in which case the underlying fetch rejects with an AbortError.
 */
export async function synthesizeSpeechToFile(
  apiKey: string,
  model: string,
  voice: string,
  text: string,
  signal: AbortSignal,
): Promise<string> {
  const key = apiKey.trim()
  if (!key) throw new GroqTtsError('No Groq API key set. Add it in Settings.')

  const body = {
    model: model.trim() || DEFAULT_GROQ_TTS_MODEL,
    input: text.slice(0, ORPHEUS_MAX_INPUT),
    voice: voice.trim() || DEFAULT_GROQ_TTS_VOICE,
    response_format: 'wav',
  }

  let res: Awaited<ReturnType<typeof fetch>>
  try {
    res = await fetch(GROQ_TTS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (signal.aborted) throw e // re-throw aborts untouched so the caller treats them as barge-in
    throw new GroqTtsError(`Network error reaching Groq TTS: ${errText(e)}`)
  }

  if (!res.ok) throw new GroqTtsError(await describeHttpError(res))

  const bytes = new Uint8Array(await res.arrayBuffer())
  const file = new File(Paths.cache, `hue-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`)
  try {
    file.create({ overwrite: true })
  } catch {
    // create() can throw if it already exists; the random name makes that effectively impossible,
    // and write() below would surface any real problem.
  }
  file.write(bytes)
  return file.uri
}

/** Build a user-facing message from a non-2xx response without leaking the key. */
async function describeHttpError(res: Awaited<ReturnType<typeof fetch>>): Promise<string> {
  let detail = ''
  try {
    const text = await res.text()
    const json = JSON.parse(text) as { error?: { message?: string; type?: string } }
    detail = json.error?.message ?? json.error?.type ?? text.slice(0, 200)
  } catch {
    // Non-JSON (e.g. a stray WAV/HTML body); the status line alone is enough.
  }
  if (res.status === 401) return 'Groq rejected the API key (401). Check it in Settings.'
  if (res.status === 429) return 'Groq TTS rate limit hit (429). Wait a moment and retry.'
  return `Groq TTS request failed (${res.status})${detail ? `: ${detail}` : ''}`
}

/** Best-effort delete of a temp WAV once it's been played (or on teardown). */
function cleanupFile(uri: string): void {
  try {
    new File(uri).delete()
  } catch {
    // Already gone or unwritable; the OS clears the cache dir anyway.
  }
}

export interface GroqSpeakerOptions {
  apiKey: string
  /** Orpheus model id; empty resolves to DEFAULT_GROQ_TTS_MODEL. */
  model: string
  /** Orpheus voice id; empty resolves to DEFAULT_GROQ_TTS_VOICE. */
  voice: string
  /** Surfaced once if synthesis fails (bad key, 429, network) so the UI can show it. */
  onError?: (message: string) => void
}

/**
 * Streaming Orpheus speaker. Splits the streamed reply into ≤200-char chunks, synthesizes each
 * to a WAV, and plays them in order while prefetching the next, so playback is roughly gapless
 * after the first chunk. Implements {@link Speaker} so it's interchangeable with SentenceSpeaker.
 */
export class GroqSentenceSpeaker implements Speaker {
  private readonly opts: GroqSpeakerOptions
  private buffer = ''
  /** Ready-to-synthesize text chunks, each within the Orpheus input cap, in speak order. */
  private texts: string[] = []
  /** True while the synth/play loop is running, so concurrent drains don't overlap. */
  private draining = false
  private streamEnded = false
  private stopped = false
  /** Set once a synth fails: stop trying for this turn and let the reply finish silently. */
  private errored = false
  private doneCb: (() => void) | null = null
  /** Aborts the in-flight synth fetch on barge-in/stop. One per speaker (turn). */
  private readonly controller = new AbortController()
  private player: AudioPlayer | null = null
  /** Resolver for the clip currently playing, so stop() can unblock the loop immediately. */
  private playResolve: (() => void) | null = null

  constructor(opts: GroqSpeakerOptions) {
    this.opts = opts
  }

  push(delta: string): void {
    if (this.stopped) return
    this.buffer += delta
    let next: ReturnType<typeof takeSentence>
    while ((next = takeSentence(this.buffer))) {
      this.buffer = next.rest
      if (next.sentence) this.enqueue(next.sentence)
    }
  }

  finish(onDone: () => void): void {
    if (this.stopped) {
      onDone()
      return
    }
    this.streamEnded = true
    this.doneCb = onDone
    const tail = this.buffer.trim()
    this.buffer = ''
    if (tail) this.enqueue(tail)
    this.maybeDone()
  }

  stop(): void {
    this.stopped = true
    this.buffer = ''
    this.texts = []
    this.doneCb = null
    this.controller.abort()
    this.releasePlayer()
  }

  /** Split a sentence to the input cap, queue the pieces, and make sure the loop is running. */
  private enqueue(sentence: string): void {
    // Strip any section/role header the model prepended and flatten line breaks, so Orpheus
    // never reads "Skills colon" (see lib/reply.ts). A header-only chunk normalizes to empty.
    const clean = normalizeReply(sentence)
    if (!clean) return
    for (const piece of splitToMaxLen(clean, ORPHEUS_MAX_INPUT)) {
      const t = piece.trim()
      if (t) this.texts.push(t)
    }
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining || this.stopped || this.errored) return
    this.draining = true
    // Audio for the head chunk, synthesized during the previous clip's playback to hide latency.
    let prefetch: Promise<string> | null = null
    try {
      for (;;) {
        let uri: string
        if (prefetch) {
          uri = await prefetch
          prefetch = null
        } else {
          const text = this.texts.shift()
          if (text === undefined) break
          uri = await this.synth(text)
        }
        if (this.stopped) {
          cleanupFile(uri)
          break
        }
        // Start synthesizing the next chunk while this one plays.
        const nextText = this.texts.shift()
        if (nextText !== undefined) prefetch = this.synth(nextText)
        await this.playFile(uri)
        cleanupFile(uri)
      }
    } catch (e) {
      // Aborts are barge-in/stop, not errors. Anything else: surface once and stop this turn.
      if (!this.controller.signal.aborted) {
        this.errored = true
        this.texts = []
        this.opts.onError?.(e instanceof GroqTtsError ? e.message : errText(e))
      }
    } finally {
      this.draining = false
      // A dangling prefetch (we broke out mid-flight) — swallow its result and clean up the file.
      if (prefetch) void prefetch.then(cleanupFile, () => {})
      // Text may have streamed in after the loop saw an empty queue; pick it up. Otherwise settle.
      if (!this.stopped && !this.errored && this.texts.length > 0) void this.drain()
      else this.maybeDone()
    }
  }

  private synth(text: string): Promise<string> {
    return synthesizeSpeechToFile(this.opts.apiKey, this.opts.model, this.opts.voice, text, this.controller.signal)
  }

  /** Play one WAV file to completion. Resolves on didJustFinish, or immediately if stopped. */
  private playFile(uri: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        if (this.playResolve === resolve) this.playResolve = null
        resolve()
      }
      this.playResolve = resolve
      if (this.stopped) {
        done()
        return
      }
      if (!this.player) this.player = createAudioPlayer({ uri })
      else this.player.replace({ uri })
      const sub = this.player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          sub.remove()
          done()
        }
      })
      this.player.play()
    })
  }

  private releasePlayer(): void {
    if (this.playResolve) {
      const r = this.playResolve
      this.playResolve = null
      r()
    }
    if (this.player) {
      try {
        this.player.remove()
      } catch {
        // Already released.
      }
      this.player = null
    }
  }

  private maybeDone(): void {
    if (this.stopped || !this.streamEnded || this.draining || this.texts.length > 0 || !this.doneCb) {
      return
    }
    this.releasePlayer()
    const cb = this.doneCb
    this.doneCb = null
    cb()
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
