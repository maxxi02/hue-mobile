# Latency, Caching & Test-Infra Pass

Worked 2026-06-19, immediately after the [[Resume PDF Cross-Provider + Latency Pass]].
Cleared the three **Deferred (need sign-off)** items from that note plus the dead-code
follow-up from [[Phase 3 Build Notes]]. All four land together; typecheck + the new test
suite + an Android export all pass (see Status).

## 1. Pre-warm LLM model resolution (turn-1 latency)
The previous pass memoized `resolveModel()` so turns 2+ skip the `GET /models` round-trip,
but turn 1 still paid it inline before the first reply streamed. Now we warm it ahead of the
first tap, the model-resolution analog of the Groq/native-audio warmups in [[First-Launch Warmup]].

- **`warmModelResolution(provider, apiKey, requested)` (`lib/openai-compat.ts`)** — best-effort,
  idempotent; primes `resolvedModelCache` and swallows failures (the real turn retries). No-op
  when a model is pinned or the cache is already warm.
- **Wiring (`hooks/useSession.ts`)** — a new effect keyed on the *active* provider + its key +
  its model fires the warm when no pipeline is live. **Not** gated on mic capture (typed input
  hits the LLM too). Anthropic needs no warm — its model is free text, no `/models` listing.

## 2. Anthropic tail prompt caching (turn-2+ cost + latency)
Before, only the system prompt carried a `cache_control` breakpoint. Added a **second**
breakpoint on the **last message** so the growing transcript is cached and re-read from cache
on the next turn (`lib/anthropic.ts` `withTailCache`).

- Gated on the conversation **already having an assistant turn** — i.e. a real ongoing chat —
  so a one-shot call (the résumé PDF cleanup, whose single message carries a large base64 PDF)
  never pays a wasteful cache **write**. Turn 1 has no assistant turn yet, so it's skipped too;
  nothing worth caching there beyond the system prompt.
- Safe for short chats: Anthropic ignores a breakpoint whose prefix is under the model's
  minimum cacheable size. Two breakpoints total (system + tail), well under the limit of 4.

## 3. Test infra + pure-logic tests (was: no jest setup)
First tests in the repo. Deliberately **no jest-expo / RN preset** — it would drag the whole
native module graph in to exercise a few string functions. Instead:

- **`jest.config.js`** — `babel-jest` with an **inline** Babel config (`configFile:false`,
  `babelrc:false`) so Jest never touches an Expo/Metro Babel config. `@babel/preset-typescript`
  strips types; `@babel/preset-env` targets the running Node. `testEnvironment: node`.
- **Extracted the pure logic into RN-free modules** so it's importable without mocks:
  - `lib/utterance.ts` ← `sanitizeUtterance`, `hasSpeechContent` (out of `lib/pipeline.ts`).
    `sanitizeUtterance`'s control-char strip now uses `\p{Cc}` (covers C0/C1 + DEL) instead of an
    embedded literal control-byte range — same intent, cleaner source.
  - `lib/resume-text.ts` ← `resolveFileType`, `docxXmlToText`, `decodeXmlEntities`,
    `normalizeWhitespace` (out of `lib/resume.ts`; `extractDocxText`/`clampSummary` stay — they
    touch fflate / settings caps). `ResumeFileType` now lives here and is re-exported from `resume.ts`.
  - `buildSystemPrompt` (`lib/prompts.ts`) was already RN-free.
- **23 tests across 3 suites** (`lib/__tests__/`): utterance sanitize/speech-detection,
  résumé file-type routing + DOCX-XML/entity decoding + whitespace, and prompt assembly
  (companion vs interviewer, context injection, STAR). `@jest/globals` added as an explicit
  devDep so both Jest and `tsc` resolve it under the relocated pnpm store.
- Run with `pnpm test`.

## 4. Removed the dead unpdf / pdf.js plumbing
The on-device pdf.js path was abandoned in [[Phase 3 Build Notes]] (garbled text under Hermes →
LLM-native PDF). Nothing imported it anymore, and it stays dead regardless of the on-device
LLM-native verify (the fallback if that fails is DOCX/TXT-only, never a return to unpdf), so it
was safe to delete now. Removed:

- `lib/pdfExtractor.ts`, `lib/pdfPolyfills.ts` (unused).
- The `unpdf` alias block + `mjs` sourceExt + `resolveRequest` in `metro.config.js` (kept the
  pnpm `nodeModulesPaths` fallback — that's unrelated and still required). See [[Metro unpdf Resolution Fix]] — now reverted.
- `babel.config.js` entirely. Its only job was neutralizing pdf.js's `import.meta`; with unpdf
  gone, Expo auto-applies `babel-preset-expo` and no custom config is needed.
- Deps: `unpdf`, `@babel/plugin-syntax-import-meta`. (`babel-preset-expo` kept as an explicit
  devDep — harmless insurance for pnpm hoisting, per [[Phase 1 Build Notes]].)

## Status
- `npx tsc --noEmit` clean.
- `pnpm test` → 23 passed, 3 suites.
- `npx expo export --platform android` → **1585** modules → Hermes `.hbc` (was 1594 with unpdf;
  the drop confirms unpdf is out of the bundle, and a clean Hermes compile confirms the build
  no longer needs the `import.meta` Babel plugin).
- Not committed at time of writing → committed as the session's final commit.

## Still open
- **Desktop `HUMAN_VOICE_GUIDANCE` sync** — mobile's extended copy still diverges from desktop;
  separate repo, separate commit. See [[Open Questions]].
- **On-device verify of the LLM-native PDF path** — still a device task (Anthropic key → real
  name lands). Independent of the dead-code removal above.
