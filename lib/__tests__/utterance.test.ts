import { describe, expect, it } from '@jest/globals'

import { hasSpeechContent, sanitizeUtterance } from '../utterance'

describe('sanitizeUtterance', () => {
  it('collapses runs of whitespace and trims the ends', () => {
    expect(sanitizeUtterance('  hello   world  ')).toBe('hello world')
  })

  it('replaces control characters (NUL, tab, DEL) with spaces', () => {
    const input = `a${String.fromCharCode(0)}b${String.fromCharCode(9)}c${String.fromCharCode(127)}d`
    expect(sanitizeUtterance(input)).toBe('a b c d')
  })

  it('caps length at 4000 characters', () => {
    expect(sanitizeUtterance('x'.repeat(5000))).toHaveLength(4000)
  })

  it('returns an empty string for whitespace-only input', () => {
    expect(sanitizeUtterance('   \n\t  ')).toBe('')
  })
})

describe('hasSpeechContent', () => {
  it('is true when a letter or digit is present', () => {
    expect(hasSpeechContent('hi')).toBe(true)
    expect(hasSpeechContent('42')).toBe(true)
  })

  it('is true for non-Latin scripts', () => {
    expect(hasSpeechContent('こんにちは')).toBe(true)
  })

  it('is false for punctuation-only ASR artifacts', () => {
    expect(hasSpeechContent('...')).toBe(false)
    expect(hasSpeechContent('. .')).toBe(false)
  })

  it('is false for empty or whitespace-only text', () => {
    expect(hasSpeechContent('')).toBe(false)
    expect(hasSpeechContent('   ')).toBe(false)
  })
})
