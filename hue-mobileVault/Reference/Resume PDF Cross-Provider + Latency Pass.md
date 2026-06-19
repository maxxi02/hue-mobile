# Resume PDF Cross-Provider + Latency Pass

Worked 2026-06-19. Started from a user report that an exported (on-device) build blocked PDF
résumé upload with *"PDF résumés are read by the Anthropic provider. Switch to Anthropic…"*
whenever the active LLM provider wasn't Anthropic. Turned into a small fix + optimize pass.
Pairs with [[Metro unpdf Resolution Fix]] and the [[Phase 3 Build Notes|Phase 3]] resume work.

## "Target role" — not a bug, behaves as designed
The user's `jobTitle` ("hotdog vendor") wasn't echoed back when they asked Hue *"what role am I
applying for?"*. Verified end-to-end that this is **correct behavior**, not a wiring/persistence bug:

- `jobTitle` → injected into the system prompt in **both** modes (`lib/prompts.ts`:
  interviewer + companion branches) → prompt rebuilt from current settings on every request
  (`lib/pipeline.ts` `streamReply`).
- Persistence is sound: `store/settings.ts` `load()` runs on boot, `app/_layout.tsx` blocks
  first paint until `hydrated`, `update()` writes through to expo-secure-store on every edit.
  Old saved objects merge over `DEFAULT_SETTINGS`, so new fields never break.
- **Why it didn't answer:** in **Companion mode** every user message is treated as *the
  interviewer's question* and Hue drafts a first-person answer — it's not a chatbot you can
  query about its own config. `jobTitle` is background context that shapes answers, not
  something Hue recites on demand. See the UX fix below.

## Fix — PDF résumé reading decoupled from the active provider
**Decision:** résumé cleanup is a one-shot background task, so it no longer has to use the live
conversation provider. Only Anthropic accepts native PDF document blocks here (the others go
through the OpenAI chat-completions format, which has no PDF part). So:

- If an **Anthropic API key is configured**, a PDF is read via Anthropic *regardless* of the
  selected provider (`forceAnthropic` option threaded through `cleanResumeFromPdf` →
  `runCleanup` → `completeOnce` in `lib/resume.ts`). The cleaned plain-text summary then feeds
  whatever provider the user actually runs with.
- If **no Anthropic key** exists, keep the honest DOCX/TXT fallback — we still can't reliably
  read PDFs on-device (see [[Open Questions]] / pdf.js-under-Hermes garbling).
- A Groq/Google/etc. user no longer has to switch their whole app to Anthropic; they just need
  an Anthropic key present. `model` defaults to a valid Claude id, so the forced call works
  even if they never touched the Anthropic model field.

Touched: `lib/resume.ts` (PDF branch now gates on `anthropicApiKey`, not `llmProvider`),
`lib/openai-compat.ts` (defensive document-block guard message updated).

## Optimize — per-turn model-resolution round-trip (latency)
Found while reading `lib/openai-compat.ts`: when no model is pinned, `resolveModel()` does a
`GET /models` network round-trip, and `streamOpenAiCompat` runs **once per turn**. So every
reply for a Google/Groq/Mistral/Cohere user with no model selected paid that extra round-trip
*before the completion even started* — pure time-to-first-token cost on each turn.

**Fix:** memoize the resolved model in a module-level `Map` keyed by `provider + key`. Only
successful resolutions are cached (a transient failure retries); a changed key is a natural
cache miss; a user-pinned model bypasses it entirely. Turns 2+ are now free; turn 1 still pays
once (pre-warming it like [[First-Launch Warmup]] is a deferred option).

## UX — Companion-mode empty state
Added a one-line, mode-specific explainer under the empty-state mode label
(`components/chat/EmptyState.tsx` + `app/index.tsx`), since Companion is easy to misread as
"ask Hue a question":

- Companion: *"Speak or type the interviewer's question — Hue drafts an answer for you to say."*
- Interviewer: *"Tap to start and Hue will ask you the first question."*

## Honesty — résumé privacy hint
The Settings résumé hint claimed *"the file itself never leaves the phone."* True for DOCX/TXT
(extracted on-device), **false for PDF** (sent base64 to Anthropic) — and my change makes that
path reachable for more users. Rewrote it to state both cases accurately, noting it still goes
only to the user's own provider, never a Hue backend. Consistent with
[[Architecture - BYO Key No Backend]].

## Deferred (need sign-off — see [[Open Questions]])
**All three done 2026-06-19 in the follow-up [[Latency Caching and Test Infra Pass]]:**
- ~~**Anthropic conversation prompt caching**~~ — tail `cache_control` breakpoint added
  (`lib/anthropic.ts` `withTailCache`), gated on an existing assistant turn.
- ~~**Pre-warm LLM model resolution**~~ — `warmModelResolution()` primed from a `useSession` effect.
- ~~**Test infra + tests**~~ — jest + babel-jest, 23 tests over the extracted pure logic.

## Status
All four changes typecheck clean (`npx tsc --noEmit`). No lint config in the repo. Not committed.
