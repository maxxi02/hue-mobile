// Pure, dependency-free model-selection logic. Kept out of openai-compat.ts (which imports
// expo/fetch and so can't load under the RN-free Jest setup) so the choice of default model
// can be unit-tested in isolation — same split as lib/utterance.ts vs lib/pipeline.ts.

import type { OpenAiCompatProvider } from './types'

// Preferred default chat models per provider, best first. When the user hasn't pinned a
// model, auto-pick walks this list and takes the first id the provider currently lists
// (substring, case-insensitive, so a date/size/version suffix like `-versatile` or a
// `meta-llama/` namespace still matches). This replaces the old "alphabetically-first id"
// heuristic, which on Groq resolved to `allam-2-7b` — a small Arabic/English model that
// answered English interview prompts as fragmented, off-task word-salad. Lists are
// intentionally short and family-level so they survive the providers rotating exact ids;
// when none match we fall back to the first non-auxiliary id (see pickDefaultModel).
// For Groq we lead with `gpt-oss-120b` (matches the listed `openai/gpt-oss-120b`, not the
// smaller 20b) — Groq's most capable production chat model per their model docs — then fall
// back to the Llama family if the account/region doesn't list it.
const PREFERRED_MODELS: Record<OpenAiCompatProvider, string[]> = {
  groq: ['gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3', 'llama'],
  google: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash', 'gemini'],
  mistral: ['mistral-large', 'mistral-medium', 'mistral-small', 'open-mistral', 'mistral'],
  cohere: ['command-r-plus', 'command-r', 'command-a', 'command'],
}

// Listed models that are NOT general chat-completion models and must never be auto-picked
// for a reply: speech-to-text (whisper), text-to-speech, embeddings, rerankers, safety
// classifiers (llama-guard / prompt-guard), and Groq's tool-only "compound" agents. Used as
// a denylist for the fallback path so we don't, say, POST an interview question to a Whisper
// ASR endpoint. Matched case-insensitively against the model id.
const NON_CHAT_MODEL_RE = /whisper|tts|text-to-speech|embed|rerank|guard|moderation|compound/i

/**
 * Choose which model to call when the user hasn't pinned one. Pure and exported so it can be
 * unit-tested without hitting the network. We first drop the obvious non-chat models
 * (whisper/embeddings/guard/etc.) so a broad preference like "llama" can't accidentally match
 * `llama-guard`; then (1) take the first PREFERRED_MODELS entry the provider still lists, or
 * (2) the first remaining chat model. If filtering leaves nothing — a provider that only
 * lists auxiliary models — fall back to the raw first id so we still send *something* rather
 * than fail. Returns undefined only for an empty list.
 */
export function pickDefaultModel(
  provider: OpenAiCompatProvider,
  models: string[],
): string | undefined {
  if (models.length === 0) return undefined
  const chatModels = models.filter((id) => !NON_CHAT_MODEL_RE.test(id))
  const candidates = chatModels.length > 0 ? chatModels : models
  for (const pref of PREFERRED_MODELS[provider]) {
    const hit = candidates.find((id) => id.toLowerCase().includes(pref.toLowerCase()))
    if (hit) return hit
  }
  return candidates[0]
}
