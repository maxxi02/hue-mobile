import { describe, expect, it } from '@jest/globals'

import { REPLY_STOP_SEQUENCES, sanitizeReply } from '../reply'

describe('sanitizeReply', () => {
  it('strips a leading conversational role label', () => {
    expect(sanitizeReply('Interviewer: Tell me about yourself.')).toBe('Tell me about yourself.')
    expect(sanitizeReply('User: I led the migration.')).toBe('I led the migration.')
  })

  it('strips a leading section/STAR label', () => {
    expect(sanitizeReply('Experience: I shipped the payments rewrite.')).toBe(
      'I shipped the payments rewrite.',
    )
    expect(sanitizeReply('Example: at Acme, I cut load time by 40%.')).toBe(
      'at Acme, I cut load time by 40%.',
    )
  })

  it('strips stacked leading labels', () => {
    expect(sanitizeReply('Interviewer: Answer: So, the hard part was scope.')).toBe(
      'So, the hard part was scope.',
    )
  })

  it('is case-insensitive and tolerates spacing around the colon', () => {
    expect(sanitizeReply('answer : done.')).toBe('done.')
    expect(sanitizeReply('  RESPONSE:   ready.')).toBe('ready.')
  })

  it('is a no-op once real content leads the text', () => {
    const answer = 'So, the biggest thing I owned was the billing system.'
    expect(sanitizeReply(answer)).toBe(answer)
  })

  it('never strips a label that appears mid-sentence', () => {
    expect(sanitizeReply('The end result: we shipped on time.')).toBe(
      'The end result: we shipped on time.',
    )
    expect(sanitizeReply('User experience: it matters a lot to me.')).toBe(
      'User experience: it matters a lot to me.',
    )
  })

  it('does not strip a label word that lacks a colon', () => {
    expect(sanitizeReply('Experience taught me to ask first.')).toBe(
      'Experience taught me to ask first.',
    )
  })

  it('grows monotonically across a streaming prefix (cleaned text only extends)', () => {
    // Each snapshot is the cumulative stream; once a snapshot is cleaned, later cleaned
    // snapshots must start with it — the property the speaker-feed in the pipeline relies on.
    const snapshots = ['Exp', 'Experience:', 'Experience: So,', 'Experience: So, I led it.']
    const cleaned = snapshots.map(sanitizeReply)
    // Final answer is fully de-labeled.
    expect(cleaned[cleaned.length - 1]).toBe('So, I led it.')
    // From the point real content appears, each cleaned snapshot extends the prior one.
    expect(cleaned[3].startsWith(cleaned[2])).toBe(true)
  })
})

describe('REPLY_STOP_SEQUENCES', () => {
  it('fits the OpenAI `stop` limit of four strings', () => {
    expect(REPLY_STOP_SEQUENCES.length).toBeLessThanOrEqual(4)
  })

  it('targets newline-anchored next-turn labels', () => {
    for (const seq of REPLY_STOP_SEQUENCES) {
      expect(seq.startsWith('\n')).toBe(true)
      expect(seq.endsWith(':')).toBe(true)
    }
  })
})
