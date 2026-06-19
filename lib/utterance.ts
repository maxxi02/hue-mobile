// Pure, dependency-free helpers for turning a raw transcribed/typed utterance into a
// safe LLM turn. Kept out of pipeline.ts (which pulls in the RN audio/TTS stack) so the
// logic can be unit-tested in isolation without mocking native modules.

/**
 * Clean a transcribed/typed utterance before it becomes an LLM turn: strip control
 * characters, collapse whitespace, and cap length so a paste-bomb can't blow up the
 * request. (Security baseline: validate/sanitize all external input.) \p{Cc} covers the
 * C0/C1 control ranges (incl. NUL and DEL) without embedding literal control bytes here.
 */
export function sanitizeUtterance(text: string): string {
  return text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)
}

/**
 * Whether an utterance carries actual speech rather than a non-speech ASR artifact. We
 * require at least one letter or digit in any script (\p{L}/\p{N}); a transcript that is
 * only punctuation, symbols, or whitespace — Whisper's signature output for silence/noise —
 * has none and is dropped. Deliberately narrow: it filters the empty/punctuation case the
 * user hit without risking real (if short) words.
 */
export function hasSpeechContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}
