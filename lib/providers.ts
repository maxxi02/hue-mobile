import type { LlmProvider } from './types'

/**
 * One source of truth for how each LLM provider is named in the UI, so the home
 * screen and Settings never disagree (they used to: "Anthropic" vs "Claude"). The
 * label is the user-facing product name; Anthropic's product is Claude.
 */
export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: 'Claude',
  google: 'Gemini',
  groq: 'Groq',
  mistral: 'Mistral',
  cohere: 'Cohere',
}

/** Display order for the provider selector. */
export const PROVIDER_ORDER: LlmProvider[] = ['anthropic', 'google', 'groq', 'mistral', 'cohere']
