# Phased Roadmap

Deliver in confirmable phases. Phases 1–3 are pure RN/TS; native Kotlin only appears in
phase 4. See [[Feature Map (Desktop to Mobile)]] for what each piece maps to.

## Phase 1 — Mic companion (MVP) — ✅ verified on-device 2026-06-17 (see [[Phase 1 Build Notes]])
- Scaffold + [[Setup Guide (pnpm)|pnpm setup]] + `.npmrc`. ✅
- Settings screen with API-key fields → expo-secure-store. ✅
- Mic capture → cloud ASR (WebSocket) → Anthropic streaming answer.
  ✅ Anthropic stream (via `expo/fetch`); mic + cloud ASR stubbed behind the
  `AudioSource` interface (manual text input drives the loop until the native
  module lands in a dev build).
- Companion mode only; text answer card; basic state orb. ✅

## Phase 2 — Interviewer mode + voice — ✅ verified on-device 2026-06-17 (see [[Phase 2 Build Notes]])
- Interviewer system prompt (ported in Phase 1); expo-speech TTS. ✅
- Barge-in (abort stream + stop audio when the user talks over a spoken reply). ✅

## Phase 3 — Vision + resume — ⏳ resume half built 2026-06-18 (see [[Phase 3 Build Notes]])
- expo-camera / expo-image-picker → vision LLM (text answer, larger token budget). ⏳ not started.
- expo-document-picker → on-device PDF/DOCX/TXT parse → LLM cleanup → resume summary. ✅ built,
  pending on-device verify. Plus: anti-fabrication grounding, a new `additionalContext` field, and an
  extended human-voice prompt.

## Phase 4 — Android native powers — ⏳ overlay bubble built 2026-06-18 (Kotlin compiles; pending on-device verify)
- MediaProjection system-audio capture (the live-call companion). ⏳ not started.
- SYSTEM_ALERT_WINDOW floating bubble + foreground service. ✅ built — local Expo module
  `modules/overlay-bubble` (Kotlin `OverlayBubbleModule` + `BubbleOverlayService`,
  `WindowManager` `TYPE_APPLICATION_OVERLAY`, drag + tap). Tap deep-links `huemobile://voice`
  to bring the app forward into the new voice mode; permissions/service merge from the
  module's own manifest (no config plugin needed). Toggle in Settings → "Floating bubble".
- FLAG_SECURE stealth; quick-settings tile trigger. ⏳ not started.

### Also shipped this session (UI, pure RN — both platforms)
- **Claude-style chat thread** — Session screen rebuilt as a scrolling transcript +
  bottom composer (`components/chat/*`); `useSession` now exposes `turns` and is provided
  app-wide via `SessionProvider` so the thread and voice mode share one live session.
- **Full-screen voice mode** — `app/voice.tsx` (hero StateOrb + hold-to-talk), opened from
  the composer mic and from the bubble's deep link.

## Phase 5 — On-device models (optional, behind flags)
- onnxruntime-react-native Silero v5 VAD.
- whisper.rn on-device ASR.

Open items that could reorder this: see [[Open Questions]].
