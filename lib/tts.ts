import * as Speech from 'expo-speech'

import { normalizeReply } from './reply'
import { takeSentence } from './tts-chunk'

/**
 * A streaming text-to-speech sink. The pipeline feeds it the reply as it streams (`push`),
 * tells it the stream ended (`finish`), and can cut it off instantly (`stop`) on barge-in.
 * Implemented by the on-device {@link SentenceSpeaker} and the cloud GroqSentenceSpeaker, so
 * the pipeline can swap engines behind one type (see lib/types.ts TtsProvider).
 */
export interface Speaker {
  /** Feed a chunk of streamed reply text; speaks any sentences it completes. */
  push(delta: string): void
  /** Stream is done: speak the trailing text, then call onDone once everything has been said. */
  finish(onDone: () => void): void
  /** Interrupt immediately and drop the queue (barge-in / stop / clear). */
  stop(): void
}

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

/** expo-speech caps a single utterance; sentences are far shorter, but guard anyway. */
const MAX_UTTERANCE = 3500

export class SentenceSpeaker implements Speaker {
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
    let next: ReturnType<typeof takeSentence>
    while ((next = takeSentence(this.buffer))) {
      this.buffer = next.rest
      if (next.sentence) this.speak(next.sentence)
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

  /** Interrupt speech immediately (barge-in / stop / clear) and drop the queue. */
  stop(): void {
    this.stopped = true
    this.buffer = ''
    this.doneCb = null
    void Speech.stop()
  }

  private speak(text: string): void {
    if (this.stopped) return
    // Normalize the sentence before it's spoken: drop any section/role header the model put
    // in front of it and flatten internal line breaks, so the engine never reads "Skills
    // colon" or stalls on a blank line (see lib/reply.ts). A header-only chunk normalizes to
    // empty and is skipped.
    const spoken = normalizeReply(text)
    if (!spoken) return
    this.pending++
    Speech.speak(spoken.slice(0, MAX_UTTERANCE), {
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
