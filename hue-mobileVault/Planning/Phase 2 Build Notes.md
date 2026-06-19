# Phase 2 Build Notes

Status log for [[Phased Roadmap|Phase 2 — Interviewer mode + voice]]. Built 2026-06-17.

## What shipped
Hue now **speaks its replies aloud in Interviewer mode**. Companion replies stay text-only
(speaking them would talk over the user or be overheard by the real interviewer).

- **`lib/tts.ts` — `SentenceSpeaker`.** The mobile analogue of desktop's `StreamingTTSQueue`
  (`hue-desktop/.../streamingTTS.ts`). Desktop runs Kokoro in a WebGPU worker and plays raw audio
  buffers gaplessly; that doesn't port to a phone, so we lean on the **OS speech engine via
  expo-speech** (`~56.0.3`). expo-speech queues utterances itself, so we feed it **one complete
  sentence at a time** as the LLM reply streams — speaking starts after the first sentence, not the
  whole reply. Sentence chunking is a regex that only fires on terminal punctuation **followed by
  whitespace**, so a decimal ("3.14") or mid-word dot won't split.
- **Pipeline wiring (`lib/pipeline.ts`).** `speakResponses = hueMode === 'interviewer'` (already
  existed) now actually drives audio. A fresh `SentenceSpeaker` per response is fed in `onDelta`;
  on stream end we `finish()` and **stay on the `speaking` state until the engine drains** the last
  sentence, then return to `listening`. `abortResponse()` (barge-in / stop / clear) calls
  `speaker.stop()` → `Speech.stop()`, so audio cuts off instantly alongside the existing stream abort.
- **Settings → new "Voice" section** (`app/(tabs)/settings.tsx`): speaking-speed presets
  (Slower 0.85 / Normal 1.05 / Faster 1.25 → `ttsSpeed`) and a **"Detect voices"** picker that lists
  the device's English voices (`Speech.getAvailableVoicesAsync`, Enhanced-first) → `ttsVoice`. Both
  settings already existed in `HueSettings`; this is the first UI for them.

## Key files
- `lib/tts.ts` (new), `lib/pipeline.ts` (speaker wiring), `app/(tabs)/settings.tsx` (Voice section),
  `app/(tabs)/index.tsx` (mode label), `lib/types.ts` (doc comment).

## Design notes / deviations
- **On-device TTS, not cloud/neural.** No extra API key, works offline, zero added latency budget —
  fits [[Architecture - BYO Key No Backend]]. Trade-off: voice quality is whatever the device ships.
  A cloud/streaming TTS could later slot in behind the same `SentenceSpeaker` shape if wanted.
- **No echo cancellation concern yet.** Desktop worries about Hue's spoken audio leaking into the mic
  (false barge-in). On mobile the input is still push-to-talk (the user holds to talk), so there's no
  always-on mic to pick up the speaker. Revisit when on-device VAD lands ([[Phased Roadmap|Phase 5]]).

## ✅ Verified on real hardware 2026-06-17
Rebuilt the dev client (`pnpm expo run:android`) on TECNO_CI8n and ran the full pass — all green:
1. **Interviewer** role → first question is **spoken aloud**; orb holds on "Answering" until audio finishes.
2. **Barge-in**: talking/typing over a spoken reply cuts the audio immediately.
3. **Companion mode stays silent** — answers are never spoken.
4. Settings → Voice → **Detect voices** lists device voices; picking one + a speed change takes effect next turn.

## Next
- Phase 2 done. Proceed to [[Phased Roadmap|Phase 3]] (vision + resume).
