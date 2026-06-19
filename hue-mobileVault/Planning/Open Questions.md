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
- **On-device PDF parsing viability** — does pdf.js-via-unpdf actually extract text from real resume
  PDFs under Hermes (with the `import.meta` babel stub + [[Phase 3 Build Notes|pdfPolyfills]])? If it
  produces garbage/empty on normal text PDFs, fall back to LLM-native PDF (Claude reads it) or
  DOCX/TXT-only. Verify on-device before trusting it.
- **Desktop human-voice sync** — mobile's `HUMAN_VOICE_GUIDANCE` was extended with more blader/humanizer
  rules and now diverges from desktop's verbatim copy. Sync desktop, or let them drift?
