// Defensive cleanup for the streamed LLM reply. Some models — especially the smaller
// OpenAI-compatible ones — don't just answer in a sentence or two: they format the reply
// as a multi-section block, with role/section headers on their own lines ("Interviewer:",
// "Skills:", "Experience:") and blank lines between them. Rendered as-is, that shows up as
// labels and big vertical gaps in the chat bubble, and read aloud it stalls on the colons.
// Models also sometimes run past their answer into a fake next turn ("...\nUser: ...").
//
// Two layers fix this, and they're complementary:
//   1. REPLY_STOP_SEQUENCES, handed to the provider, halt generation the moment the model
//      opens a new labeled turn — so it can't run away mid-answer, and the reclaimed tokens
//      go to the real reply instead of a hallucinated script.
//   2. normalizeReply() flattens the answer into ONE paragraph: it strips the section/role
//      headers and collapses every run of whitespace (newlines included) to a single space.
//
// Both are scoped to the live answer pipeline (lib/pipeline.ts). The résumé cleanup pass
// deliberately KEEPS its section labels ("Experience:", "Education:") and must not use these.

/**
 * Conversational role labels a model may hallucinate as the start of a *new* turn once it
 * has already answered. Newline-anchored so they only fire between turns, never mid-answer.
 * Capped at four: the OpenAI Chat Completions `stop` field accepts at most four strings,
 * and Anthropic accepts these same four — so one list drives both clients.
 */
export const REPLY_STOP_SEQUENCES = ['\nUser:', '\nInterviewer:', '\nCandidate:', '\nQuestion:']

// Headers a model may put at the start of the reply or at the start of a line: conversational
// roles, the STAR fields, and the résumé/interview section titles ("Skills:", "Experience:")
// it reaches for when it formats an answer as a block instead of a paragraph. A header word
// must be followed immediately by its colon, so real prose ("User experience: it matters") is
// left alone.
const LABELS = [
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
  'Results',
  'Approach',
  'Context',
  'Goal',
  'Goals',
  'Outcome',
  'Experience',
  'Experiences',
  'Example',
  'Skills',
  'Education',
  'Summary',
  'Overview',
  'Background',
  'Projects',
  'Strengths',
  'Weaknesses',
  'Achievements',
  'Highlights',
]
const LABEL_GROUP = `(?:${LABELS.join('|')})`
// A header at the very start of the reply.
const LEADING_LABEL_RE = new RegExp(`^[ \\t]*${LABEL_GROUP}[ \\t]*:[ \\t]*`, 'i')
// A header at the start of any later line. The newline is kept so the boundary survives until
// the whitespace-collapse step turns it into the single space that joins the paragraph.
const LINE_LABEL_RE = new RegExp(`\\n[ \\t]*${LABEL_GROUP}[ \\t]*:[ \\t]*`, 'gi')

/**
 * Flatten a streamed reply into a single clean paragraph: strip the role/section headers the
 * model prepends or puts at line starts, then collapse every whitespace run (newlines and
 * blank lines included) into one space. Safe to call on each cumulative streaming snapshot —
 * it's a pure function of the text so far, and the UI just renders the latest result.
 */
export function normalizeReply(text: string): string {
  let out = text
  // Strip a leading header, repeatedly, so a stacked "Interviewer: Answer: ..." collapses.
  let prev: string
  do {
    prev = out
    out = out.replace(LEADING_LABEL_RE, '')
  } while (out !== prev)
  // Drop headers that begin a later line, leaving the newline as a separator for the collapse.
  out = out.replace(LINE_LABEL_RE, '\n')
  // One paragraph: every run of whitespace becomes a single space.
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * Lighter cleanup for replies whose structure must survive — assessment mode, where answers
 * carry code blocks, lists, and multiple-choice option labels (see lib/pipeline.ts). It strips
 * only a leading role/section header (an "Answer:" the model sometimes prepends) and trims the
 * ends; internal newlines and formatting are left intact, unlike normalizeReply which flattens
 * everything to a single paragraph. Pure function of the text so far — safe per streaming snapshot.
 */
export function stripLeadingLabel(text: string): string {
  let out = text
  let prev: string
  do {
    prev = out
    out = out.replace(LEADING_LABEL_RE, '')
  } while (out !== prev)
  return out.trim()
}
