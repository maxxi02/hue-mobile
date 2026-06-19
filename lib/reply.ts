// Defensive cleanup for the streamed LLM reply. Some models — especially the smaller
// OpenAI-compatible ones — don't just answer: they continue the transcript. They prefix
// the reply with a role/section label ("Interviewer:", "Experience:", "Example:") or spill
// past their answer into a fake next turn ("...my answer.\nUser: ...\nInterviewer: ..."),
// imagining the rest of the conversation. Left alone, those labels show up in the chat
// bubble and get read aloud by the TTS engine, and the runaway turn eats the token budget
// so the real answer is truncated mid-sentence.
//
// Two layers fix this, and they're complementary:
//   1. REPLY_STOP_SEQUENCES, handed to the provider, halt generation the moment the model
//      opens a new labeled turn — so it can't run away mid-answer, and the reclaimed tokens
//      go to the real reply instead of a hallucinated script.
//   2. sanitizeReply() strips a label the model prepends to its answer, which a stop
//      sequence can't catch because it sits at the very START, not after a newline.
//
// Both are scoped to the live answer pipeline (lib/pipeline.ts). The résumé cleanup pass
// deliberately KEEPS section labels ("Experience:", "Education:") and must not use these.

/**
 * Conversational role labels a model may hallucinate as the start of a *new* turn once it
 * has already answered. Newline-anchored so they only fire between turns, never mid-answer.
 * Capped at four: the OpenAI Chat Completions `stop` field accepts at most four strings,
 * and Anthropic accepts these same four — so one list drives both clients.
 */
export const REPLY_STOP_SEQUENCES = ['\nUser:', '\nInterviewer:', '\nCandidate:', '\nQuestion:']

// Labels a model may prepend to the answer itself: conversational roles plus the
// section/STAR headers the prompt already asks it to avoid. Matched only at the very start
// of the reply (anchored ^), case-insensitively, and stripped repeatedly so a stacked
// "Interviewer: Answer: ..." collapses to the real text. A label word must be followed
// immediately by its colon, so real prose ("User experience: it matters") is left alone.
const LEADING_LABELS = [
  'Interviewer',
  'User',
  'Candidate',
  'Assistant',
  'Hue',
  'Question',
  'Answer',
  'Response',
  'Reply',
  'Situation',
  'Task',
  'Action',
  'Result',
  'Experience',
  'Example',
]
const LEADING_LABEL_RE = new RegExp(`^\\s*(?:${LEADING_LABELS.join('|')})\\s*:\\s*`, 'i')

/**
 * Strip role/section labels the model prepended to its reply. Anchored at the start, so it
 * only ever removes a leading prefix and never touches a label that legitimately appears
 * mid-sentence ("the end result: we shipped"). Safe to call on each cumulative streaming
 * snapshot: it only ever shortens a leading prefix, and once real content leads the text it
 * becomes a no-op — so the cleaned text grows monotonically with the stream.
 */
export function sanitizeReply(text: string): string {
  let out = text
  let prev: string
  do {
    prev = out
    out = out.replace(LEADING_LABEL_RE, '')
  } while (out !== prev)
  return out
}
