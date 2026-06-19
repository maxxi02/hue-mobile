import { describe, expect, it } from '@jest/globals'

import { normalizeReply, REPLY_STOP_SEQUENCES } from '../reply'

describe('normalizeReply', () => {
  it('strips a leading conversational role label', () => {
    expect(normalizeReply('Interviewer: Tell me about yourself.')).toBe('Tell me about yourself.')
    expect(normalizeReply('User: I led the migration.')).toBe('I led the migration.')
  })

  it('strips a leading section/STAR label', () => {
    expect(normalizeReply('Experience: I shipped the payments rewrite.')).toBe(
      'I shipped the payments rewrite.',
    )
    expect(normalizeReply('Example: at Acme, I cut load time by 40%.')).toBe(
      'at Acme, I cut load time by 40%.',
    )
  })

  it('strips stacked leading labels', () => {
    expect(normalizeReply('Interviewer: Answer: So, the hard part was scope.')).toBe(
      'So, the hard part was scope.',
    )
  })

  it('flattens a multi-section block into one paragraph, dropping headers and blank lines', () => {
    const block = [
      'Summary:',
      'I build mobile apps.',
      '',
      'Skills:',
      'React Native, TypeScript, CI.',
      '',
      'Experience:',
      'Led the payments rewrite at Acme.',
    ].join('\n')
    expect(normalizeReply(block)).toBe(
      'I build mobile apps. React Native, TypeScript, CI. Led the payments rewrite at Acme.',
    )
  })

  it('collapses runs of whitespace and blank lines to single spaces', () => {
    expect(normalizeReply('First point.\n\n\nSecond   point.')).toBe('First point. Second point.')
  })

  it('is case-insensitive and tolerates spacing around the colon', () => {
    expect(normalizeReply('answer : done.')).toBe('done.')
    expect(normalizeReply('  RESPONSE:   ready.')).toBe('ready.')
  })

  it('is a no-op once real content leads a single-paragraph answer', () => {
    const answer = 'So, the biggest thing I owned was the billing system.'
    expect(normalizeReply(answer)).toBe(answer)
  })

  it('never strips a label that appears mid-sentence', () => {
    expect(normalizeReply('The end result: we shipped on time.')).toBe(
      'The end result: we shipped on time.',
    )
    expect(normalizeReply('User experience: it matters a lot to me.')).toBe(
      'User experience: it matters a lot to me.',
    )
  })

  it('does not strip a label word that lacks a colon', () => {
    expect(normalizeReply('Experience taught me to ask first.')).toBe(
      'Experience taught me to ask first.',
    )
  })

  it('returns empty string for a header-only chunk', () => {
    expect(normalizeReply('Skills:')).toBe('')
    expect(normalizeReply('  Interviewer:  \n')).toBe('')
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
