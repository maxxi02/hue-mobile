import { describe, expect, it } from '@jest/globals'

import { splitToMaxLen, takeSentence } from '../tts-chunk'

describe('takeSentence', () => {
  it('peels the first complete sentence and returns the rest', () => {
    const r = takeSentence('Tell me about yourself. Then we continue')
    expect(r).toEqual({ sentence: 'Tell me about yourself.', rest: 'Then we continue' })
  })

  it('returns null until terminal punctuation is followed by more input', () => {
    // No trailing whitespace yet — the sentence may still be growing (or it's a decimal).
    expect(takeSentence('What is your experience')).toBeNull()
    expect(takeSentence('The figure was 3.14')).toBeNull()
  })

  it('keeps trailing closing quotes/brackets with the sentence', () => {
    const r = takeSentence('She said "go." Next bit')
    expect(r?.sentence).toBe('She said "go."')
  })

  it('handles CJK terminal punctuation', () => {
    const r = takeSentence('こんにちは。 次')
    expect(r?.sentence).toBe('こんにちは。')
  })
})

describe('splitToMaxLen', () => {
  it('returns text within the cap unchanged as a single piece', () => {
    expect(splitToMaxLen('A short sentence.', 200)).toEqual(['A short sentence.'])
  })

  it('keeps every piece within the cap', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const pieces = splitToMaxLen(long, 50)
    expect(pieces.length).toBeGreaterThan(1)
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(50)
    // Round-trips to the same words (whitespace-normalized), nothing dropped.
    expect(pieces.join(' ').split(/\s+/)).toEqual(long.split(/\s+/))
  })

  it('prefers a sentence boundary, then a clause boundary, over a bare word break', () => {
    const text = 'First part is here. Second, with a clause, keeps going past the limit somewhat.'
    const pieces = splitToMaxLen(text, 40)
    // The first cut should land at the sentence end, not mid-clause.
    expect(pieces[0]).toBe('First part is here.')
  })

  it('breaks at a word space when there is no punctuation to use', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta'
    const pieces = splitToMaxLen(text, 20)
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(20)
      expect(p).not.toMatch(/^\s|\s$/) // trimmed
    }
  })

  it('hard-cuts a single unbroken token longer than the cap', () => {
    const pieces = splitToMaxLen('x'.repeat(45), 20)
    expect(pieces).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(5)])
  })

  it('drops empties and trims', () => {
    expect(splitToMaxLen('   ', 200)).toEqual([])
  })
})
