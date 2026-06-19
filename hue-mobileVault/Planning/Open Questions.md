# Open Questions

Unresolved decisions to revisit. Update as they're answered.

- **On-device model viability** — will whisper.rn + Silero VAD run acceptably on mid-range
  Android, or should [[Phased Roadmap|phase 5]] stay cloud-only? Benchmark before committing.
- **Default cloud ASR provider** — desktop defaults to Deepgram. **Groq Whisper is now the only
  implemented mobile ASR** (the mic recorder hardcodes it; `cloudAsrProvider` is vestigial until a
  second backend exists). Decide: wire `cloudAsrProvider` to actually switch backends (add
  Deepgram/AssemblyAI), or drop the setting and commit to Groq for mobile? See [[Phase 1 Build Notes]].
- **Paid/hosted tier** — if Hue Mobile ever becomes a product where we pay for inference, the
  [[Architecture - BYO Key No Backend]] decision flips (backend + auth needed). Not now.
- **iOS timeline** — when (if) to lift the iOS stub. Note the hard limits: no system-audio
  capture, no cross-app overlay (see [[Platform - Android First]]).
- **TTS quality** — is expo-speech (system TTS) good enough for interviewer mode, or do we want
  a cloud/neural TTS option later?
- **Phone-mirror** — drop entirely, or keep a "cast to a second device" mode?
- ~~**On-device PDF parsing viability**~~ — **Resolved (2026-06-19): two-path PDF.** With an
  Anthropic key, PDFs are read natively by Anthropic (accurate) regardless of the selected provider
  ([[Resume PDF Cross-Provider + Latency Pass]]). **Without** an Anthropic key, PDFs are now extracted
  on-device via pdf.js (`unpdf`) and cleaned through the configured provider (Groq/etc.) — restored as
  an explicit, user-chosen fallback in [[Resume PDF On-Device Fallback]]. Caveat: the on-device read
  garbles subsetted-font PDFs under Hermes (no CMap data), so the UI nudges the user to verify; DOCX/TXT
  or an Anthropic key remain the accurate routes.
- **Desktop human-voice sync** — mobile's `HUMAN_VOICE_GUIDANCE` was extended with more blader/humanizer
  rules and now diverges from desktop's verbatim copy. Sync desktop, or let them drift? (Still open —
  it's a separate repo / separate commit.)
- ~~**Anthropic conversation prompt caching**~~ — **Done (2026-06-19, [[Latency Caching and Test Infra Pass]]).**
  Added a second `cache_control` breakpoint on the conversation tail (`lib/anthropic.ts` `withTailCache`),
  gated on there already being an assistant turn so one-shot calls (the résumé PDF cleanup) don't pay a
  wasteful cache write.
- ~~**Pre-warm LLM model resolution**~~ — **Done (2026-06-19, [[Latency Caching and Test Infra Pass]]).**
  `warmModelResolution()` primes the resolved-model cache from a new `useSession` effect, so turn 1 no
  longer pays the `GET /models` round-trip.
- ~~**Test infra**~~ — **Done (2026-06-19, [[Latency Caching and Test Infra Pass]]).** jest + babel-jest
  (no jest-expo); pure logic extracted to `lib/utterance.ts` + `lib/resume-text.ts`; 23 tests across
  `resolveFileType`, `docxXmlToText`, `sanitizeUtterance`/`hasSpeechContent`, `buildSystemPrompt`. Run `pnpm test`.
