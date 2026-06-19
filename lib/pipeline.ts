import { AnthropicError, streamAnthropic } from './anthropic'
import type { AudioSource, AudioSourceHandlers } from './audioSource'
import { ManualAudioSource } from './audioSource'
import {
  isOpenAiCompatProvider,
  keyFieldFor,
  modelFieldFor,
  OpenAiCompatError,
  streamOpenAiCompat,
} from './openai-compat'
import { buildSystemPrompt } from './prompts'
import { SentenceSpeaker } from './tts'
import type { HueSettings, LlmMessage } from './types'
import { hasSpeechContent, sanitizeUtterance } from './utterance'

// Mobile adaptation of the desktop VoicePipeline
// (..\..\hue-desktop\src\renderer\src\lib\pipeline.ts). The voice loop is the same
// shape — input source -> utterance -> LLM stream -> reply — but input arrives
// through the AudioSource abstraction (manual in Expo Go) and the reply streams
// from Anthropic over expo/fetch. In interviewer mode the reply is also spoken
// aloud through the OS speech engine (see lib/tts.ts); companion replies stay
// text-only so they aren't overheard.

export type PipelineState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'

export interface PipelineCallbacks {
  onStateChange?: (state: PipelineState) => void
  /** The interviewer's question (companion) or the user's answer (interviewer mode). */
  onUserTranscript?: (text: string) => void
  /** Cumulative assistant reply as it streams in. */
  onAssistantText?: (text: string) => void
  onError?: (message: string) => void
}

export class VoicePipeline {
  private readonly settings: HueSettings
  private readonly source: AudioSource
  private readonly callbacks: PipelineCallbacks

  private state: PipelineState = 'idle'
  private messages: LlmMessage[] = []
  private assistantText = ''

  /** Aborts the in-flight Anthropic stream on barge-in / stop / clear. */
  private controller: AbortController | null = null
  /** Distinguishes the active stream from a stale one whose deltas should be dropped. */
  private streamToken = 0
  /** Speaks the streaming reply in interviewer mode; null in companion mode. */
  private speaker: SentenceSpeaker | null = null

  /**
   * Whether replies are spoken aloud. True in interviewer mode (Hue asks questions
   * out loud). False in companion mode — the reply is a suggested answer shown as
   * text, so speaking it would talk over the user or be heard by the interviewer.
   */
  private readonly speakResponses: boolean

  constructor(settings: HueSettings, source: AudioSource, callbacks: PipelineCallbacks = {}) {
    this.settings = settings
    this.source = source
    this.callbacks = callbacks
    this.speakResponses = settings.hueMode === 'interviewer'
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return
    this.setState('connecting')
    const handlers: AudioSourceHandlers = {
      onSpeechStart: () => this.onSpeechStart(),
      // The hands-free source finished capturing and is uploading to ASR — reflect that.
      onCaptureEnd: () => {
        if (this.state !== 'idle') this.setState('transcribing')
      },
      onUtterance: (text) => this.onUtterance(text),
      onError: (msg) => this.callbacks.onError?.(msg),
    }
    try {
      await this.source.start(handlers)
    } catch (e) {
      this.callbacks.onError?.(errText(e))
      this.setState('idle')
      return
    }
    this.setState('listening')

    // Interviewer mode leads with the first question instead of waiting for input.
    if (this.settings.hueMode === 'interviewer') {
      this.messages.push({ role: 'user', content: 'Please begin the interview with your first question.' })
      this.startResponse(500)
    }
  }

  async stop(): Promise<void> {
    this.abortResponse()
    await this.source.stop()
    this.setState('idle')
  }

  /** Wipe history so the next turn starts clean. Aborts any in-flight reply first. */
  clearHistory(): void {
    this.abortResponse()
    this.messages = []
    this.assistantText = ''
    if (this.state !== 'idle') this.setState('listening')
  }

  getState(): PipelineState {
    return this.state
  }

  /**
   * Submit a typed question. The manual source routes it through its own handlers; for
   * any other source (e.g. the mic recorder) we inject it directly, so typing always
   * works as a fallback even when push-to-talk is the primary input.
   */
  submitManualQuestion(text: string): void {
    if (this.source instanceof ManualAudioSource) {
      this.source.submit(text)
      return
    }
    const clean = text.trim()
    if (!clean) return
    this.onSpeechStart()
    this.onUtterance(clean)
  }

  private setState(state: PipelineState): void {
    if (this.state === state) return
    this.state = state
    // Gate live capture on the conversation being ready for input: the hands-free source
    // listens only while 'listening', and is muted through transcribing/thinking/speaking so
    // it never records the gap between turns or (interviewer mode) Hue's own spoken reply.
    this.source.setMuted?.(state !== 'listening')
    this.callbacks.onStateChange?.(state)
  }

  private onSpeechStart(): void {
    // Barge-in: the user produced new input while a reply was streaming.
    if (this.state === 'thinking' || this.state === 'speaking') this.abortResponse()
  }

  private onUtterance(text: string): void {
    const clean = sanitizeUtterance(text)
    // Drop empties and content-free transcripts. Whisper hallucinates bare punctuation
    // ("." / "..." / ". .") when handed non-speech audio that slipped past the VAD, and
    // that "." was being sent as a real turn. If there's no letter or digit anywhere, it
    // isn't speech — treat it like silence and go back to listening without prompting the LLM.
    if (!clean || !hasSpeechContent(clean)) {
      if (this.state !== 'idle') this.setState('listening')
      return
    }
    this.callbacks.onUserTranscript?.(clean)
    this.messages.push({ role: 'user', content: clean })
    this.startResponse(500)
  }

  private startResponse(maxTokens: number): void {
    this.setState('thinking')
    this.assistantText = ''
    const token = ++this.streamToken
    const controller = new AbortController()
    this.controller = controller

    const speaker = this.speakResponses
      ? new SentenceSpeaker({
          voice: this.settings.ttsVoice || undefined,
          rate: this.settings.ttsSpeed || undefined,
        })
      : null
    this.speaker = speaker

    const onDelta = (delta: string): void => {
      if (token !== this.streamToken) return
      if (this.state !== 'speaking') this.setState('speaking')
      this.assistantText += delta
      this.callbacks.onAssistantText?.(this.assistantText)
      speaker?.push(delta)
    }

    void this.streamReply(maxTokens, { onDelta }, controller.signal)
      .then(() => {
        if (token !== this.streamToken) return
        this.controller = null
        if (this.assistantText) {
          this.messages.push({ role: 'assistant', content: this.assistantText })
        }
        // In interviewer mode the audio outlasts the text stream: stay on 'speaking'
        // until the engine finishes saying the last sentence, then go back to listening.
        if (speaker) {
          speaker.finish(() => {
            if (token === this.streamToken) this.setState('listening')
          })
        } else {
          this.setState('listening')
        }
      })
      .catch((e) => {
        if (token !== this.streamToken) return
        this.controller = null
        // An abort is a barge-in, not an error: drop the partial reply silently.
        if (controller.signal.aborted) {
          this.setState('listening')
          return
        }
        const friendly = e instanceof AnthropicError || e instanceof OpenAiCompatError
        this.callbacks.onError?.(friendly ? (e as Error).message : errText(e))
        this.setState('listening')
      })
  }

  /**
   * Stream the assistant reply from whichever provider is selected. Anthropic uses its
   * own client; the OpenAI-compatible providers (Google/Groq/Mistral/Cohere) share one.
   */
  private streamReply(
    maxTokens: number,
    callbacks: { onDelta: (text: string) => void },
    signal: AbortSignal,
  ): Promise<void> {
    const req = { messages: this.messages, system: buildSystemPrompt(this.settings), maxTokens }
    const provider = this.settings.llmProvider

    if (isOpenAiCompatProvider(provider)) {
      const apiKey = this.settings[keyFieldFor(provider)] as string
      const model = this.settings[modelFieldFor(provider)] as string
      return streamOpenAiCompat(apiKey, provider, model, req, callbacks, signal)
    }

    // Default / 'anthropic'.
    return streamAnthropic(this.settings.anthropicApiKey, this.settings.model, req, callbacks, signal)
  }

  /** Abort the in-flight stream and invalidate its token so late deltas are ignored. */
  private abortResponse(): void {
    this.streamToken++
    if (this.controller) {
      this.controller.abort()
      this.controller = null
    }
    // Cut off any audio still being spoken (barge-in / stop / clear).
    if (this.speaker) {
      this.speaker.stop()
      this.speaker = null
    }
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
