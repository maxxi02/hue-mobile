import * as Speech from 'expo-speech'

// Mobile text-to-speech, the analogue of the desktop StreamingTTSQueue
// (..\..\hue-desktop\src\renderer\src\lib\streamingTTS.ts). Desktop runs Kokoro
// in a WebGPU worker and plays raw audio buffers gaplessly; that doesn't port to
// a phone, so here we lean on the OS speech engine via expo-speech. expo-speech
// queues utterances itself, so we feed it one *complete sentence at a time* as the
// LLM reply streams in: speaking starts after the first sentence rather than after
// the whole reply, and a barge-in can cut it off instantly with Speech.stop().
//
// Only interviewer mode speaks (Hue asks questions aloud). Companion answers stay
// text-only — speaking them would talk over the user or be overheard by the real
// interviewer (see VoicePipeline.speakResponses).

export interface SentenceSpeakerOptions {
  /** A Voice identifier from Speech.getAvailableVoicesAsync(); omit for the system default. */
  voice?: string
  /** Speech rate; 1.0 is normal (expo-speech default). */
  rate?: number
}

/**
 * Matches one complete sentence at the start of the buffer: any run of text up to
 * and including its terminal punctuation, any trailing closing quotes/brackets, and
 * the whitespace that follows. Requiring that trailing whitespace is what makes the
 * sentence "complete" — it means at least one more character has streamed in past
 * the punctuation, so we won't mistake a decimal ("3.14") or mid-word "." for an end.
 */
const SENTENCE_BOUNDARY = /[^.!?。！？]*[.!?。！？]+[)"'’”\]]*\s/

/** expo-speech caps a single utterance; sentences are far shorter, but guard anyway. */
const MAX_UTTERANCE = 3500

export class SentenceSpeaker {
  private readonly options: SentenceSpeakerOptions
  private buffer = ''
  /** Utterances handed to the engine that haven't reported completion yet. */
  private pending = 0
  /** True once the LLM stream has ended and the trailing text has been flushed. */
  private streamEnded = false
  /** True after stop(): no more speaking, and the done callback is suppressed. */
  private stopped = false
  /** Fired once everything queued has finished speaking (or immediately if nothing). */
  private doneCb: (() => void) | null = null

  constructor(options: SentenceSpeakerOptions = {}) {
    this.options = options
  }

  /** Feed a chunk of streamed reply text; speaks any sentences it completes. */
  push(delta: string): void {
    if (this.stopped) return
    this.buffer += delta
    let match: RegExpExecArray | null
    while ((match = SENTENCE_BOUNDARY.exec(this.buffer))) {
      const end = match.index + match[0].length
      const sentence = this.buffer.slice(0, end).trim()
      this.buffer = this.buffer.slice(end)
      if (sentence) this.speak(sentence)
    }
  }

  /**
   * The stream is done: speak whatever partial sentence is left, then invoke onDone
   * once the engine has finished saying everything. Fires immediately if nothing is
   * (or remains) being spoken.
   */
  finish(onDone: () => void): void {
    if (this.stopped) {
      onDone()
      return
    }
    this.streamEnded = true
    this.doneCb = onDone
    const tail = this.buffer.trim()
    this.buffer = ''
    if (tail) this.speak(tail)
    this.maybeDone()
  }

  /**
   * Discard any not-yet-spoken buffered text and re-seed the buffer with `text`. Used when
   * the pipeline re-sanitizes the streamed reply and the cleaned text no longer extends what
   * was buffered — a leading label ("Interviewer:") was stripped after part of it had been
   * pushed. Safe because a leading label has no sentence-ending punctuation, so nothing
   * buffered has been spoken yet; only un-spoken partial text is discarded.
   */
  reseed(text: string): void {
    if (this.stopped) return
    this.buffer = ''
    this.push(text)
  }

  /** Interrupt speech immediately (barge-in / stop / clear) and drop the queue. */
  stop(): void {
    this.stopped = true
    this.buffer = ''
    this.doneCb = null
    void Speech.stop()
  }

  private speak(text: string): void {
    if (this.stopped) return
    this.pending++
    Speech.speak(text.slice(0, MAX_UTTERANCE), {
      voice: this.options.voice,
      rate: this.options.rate,
      onDone: () => this.onUtteranceEnd(),
      onStopped: () => this.onUtteranceEnd(),
      onError: () => this.onUtteranceEnd(),
    })
  }

  private onUtteranceEnd(): void {
    this.pending = Math.max(0, this.pending - 1)
    this.maybeDone()
  }

  private maybeDone(): void {
    if (this.stopped || !this.streamEnded || this.pending > 0 || !this.doneCb) return
    const cb = this.doneCb
    this.doneCb = null
    cb()
  }
}

/**
 * The voices the OS speech engine offers, narrowed to English and sorted so higher
 * quality voices come first. Used by Settings to populate the voice picker.
 */
export async function listSpeechVoices(): Promise<Speech.Voice[]> {
  const voices = await Speech.getAvailableVoicesAsync()
  return voices
    .filter((v) => v.language?.toLowerCase().startsWith('en'))
    .sort((a, b) => {
      const q = qualityRank(b.quality) - qualityRank(a.quality)
      return q !== 0 ? q : a.name.localeCompare(b.name)
    })
}

function qualityRank(quality: Speech.VoiceQuality): number {
  return quality === Speech.VoiceQuality.Enhanced ? 1 : 0
}
