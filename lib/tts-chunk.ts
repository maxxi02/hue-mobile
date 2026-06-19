// Pure, dependency-free text-chunking for streamed TTS. Kept out of tts.ts / groq-tts.ts
// (which pull in expo-speech / expo-audio native modules) so the boundary logic can be
// unit-tested in isolation — same split as lib/utterance.ts vs lib/pipeline.ts.
//
// Two jobs:
//   - takeSentence: peel one *complete* sentence off the front of a growing stream buffer, so
//     speaking can start mid-stream instead of after the whole reply (shared by both speakers).
//   - splitToMaxLen: break a sentence that's longer than a provider's hard input cap into
//     smaller speakable pieces at the most natural boundary available. Groq's Orpheus TTS caps
//     `input` at 200 characters per request, so a long sentence has to be sent in parts.

/**
 * Matches one complete sentence at the start of the buffer: any run of text up to and
 * including its terminal punctuation, any trailing closing quotes/brackets, and the whitespace
 * that follows. Requiring that trailing whitespace is what makes the sentence "complete" — it
 * means at least one more character has streamed in past the punctuation, so we won't mistake a
 * decimal ("3.14") or a mid-word "." for an end.
 */
const SENTENCE_BOUNDARY = /[^.!?。！？]*[.!?。！？]+[)"'’”\]]*\s/

/**
 * Peel the first complete sentence off the front of `buffer`. Returns the trimmed sentence and
 * the remaining text, or null when no terminal punctuation (followed by more input) has arrived
 * yet — in which case the caller keeps buffering. Pure: a function of the input string only.
 */
export function takeSentence(buffer: string): { sentence: string; rest: string } | null {
  const m = SENTENCE_BOUNDARY.exec(buffer)
  if (!m) return null
  const end = m.index + m[0].length
  return { sentence: buffer.slice(0, end).trim(), rest: buffer.slice(end) }
}

// Where to break a too-long string, best first: after a sentence end, then after clause
// punctuation (comma/semicolon/colon), then at the last space. Each keeps the trailing space so
// the cut lands cleanly between words. Greedy + dot-all so they reach the LAST such boundary
// inside the window we're allowed to cut at.
const SENTENCE_CUT = /^.*[.!?。！？][)"'’”\]]*\s/s
const CLAUSE_CUT = /^.*[,;:][)"'’”\]]*\s/s

/**
 * Split `text` into pieces each at most `maxLen` characters, breaking at the most natural
 * boundary that fits (sentence end > clause punctuation > word space > a hard character cut for
 * an unbroken token). Trims pieces and drops empties. Text already within the cap returns as a
 * single piece. Pure and unit-tested; used to fit a sentence under a TTS provider's input cap.
 */
export function splitToMaxLen(text: string, maxLen: number): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest.length > maxLen) {
    const cut = bestCut(rest, maxLen)
    const piece = rest.slice(0, cut).trim()
    // bestCut never returns 0, so this always makes progress; the guard is belt-and-braces.
    out.push(piece || rest.slice(0, maxLen).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

/** Index to cut `s` at, no greater than maxLen, preferring the most natural boundary. */
function bestCut(s: string, maxLen: number): number {
  const window = s.slice(0, maxLen)
  const sentence = SENTENCE_CUT.exec(window)
  if (sentence) return sentence[0].length
  const clause = CLAUSE_CUT.exec(window)
  if (clause) return clause[0].length
  const space = window.lastIndexOf(' ')
  if (space > 0) return space + 1
  // No boundary at all (one very long token): hard-cut at the limit.
  return maxLen
}
