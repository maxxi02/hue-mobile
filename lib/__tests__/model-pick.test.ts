import { describe, expect, it } from '@jest/globals'

import { pickDefaultModel } from '../model-pick'

// Real-ish Groq listing (alphabetically sorted, the way fetchOpenAiModels returns it). The
// alphabetically-first id is `allam-2-7b` — the model the old auto-pick chose, which produced
// the garbled, fragmented interview replies this test guards against.
const GROQ_MODELS = [
  'allam-2-7b',
  'compound-beta',
  'compound-beta-mini',
  'deepseek-r1-distill-llama-70b',
  'gemma2-9b-it',
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'meta-llama/llama-guard-4-12b',
  'whisper-large-v3',
  'whisper-large-v3-turbo',
]

describe('pickDefaultModel', () => {
  it('does not auto-pick the alphabetically-first id (the allam-2-7b regression)', () => {
    expect(pickDefaultModel('groq', GROQ_MODELS)).not.toBe('allam-2-7b')
  })

  it('picks the preferred Groq chat model when present', () => {
    expect(pickDefaultModel('groq', GROQ_MODELS)).toBe('llama-3.3-70b-versatile')
  })

  it('prefers Groq gpt-oss-120b (most capable) over llama, matching the namespaced id', () => {
    const models = [...GROQ_MODELS, 'openai/gpt-oss-20b', 'openai/gpt-oss-120b']
    expect(pickDefaultModel('groq', models)).toBe('openai/gpt-oss-120b')
  })

  it('falls back to the next preferred model when the top one is gone', () => {
    const models = GROQ_MODELS.filter((m) => m !== 'llama-3.3-70b-versatile')
    expect(pickDefaultModel('groq', models)).toBe('llama-3.1-8b-instant')
  })

  it('never auto-picks a non-chat model (whisper/guard) on the fallback path', () => {
    // No preferred family present; only auxiliary models plus one generic chat id.
    const models = ['whisper-large-v3', 'meta-llama/llama-guard-4-12b', 'deepseek-r1-distill-llama-70b']
    const picked = pickDefaultModel('groq', models)
    expect(picked).toBe('deepseek-r1-distill-llama-70b')
    expect(picked).not.toMatch(/whisper|guard/)
  })

  it('matches preferred models by substring (namespace / version suffix)', () => {
    expect(pickDefaultModel('google', ['models/gemini-2.5-flash-latest', 'text-embedding-004'])).toBe(
      'models/gemini-2.5-flash-latest',
    )
  })

  it('skips embedding-only providers down to the chat model', () => {
    expect(pickDefaultModel('mistral', ['mistral-embed', 'mistral-large-latest'])).toBe(
      'mistral-large-latest',
    )
  })

  it('returns undefined for an empty list', () => {
    expect(pickDefaultModel('groq', [])).toBeUndefined()
  })

  it('last-resort returns the first id when everything looks non-chat', () => {
    // Degenerate listing: every entry is an auxiliary model. Still send something.
    expect(pickDefaultModel('cohere', ['embed-english-v3.0', 'rerank-v3.5'])).toBe('embed-english-v3.0')
  })
})
