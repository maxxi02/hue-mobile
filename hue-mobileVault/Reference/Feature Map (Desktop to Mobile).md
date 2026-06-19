# Feature Map — Desktop → Mobile

Maps each hue-desktop capability to its Hue Mobile equivalent. Desktop sources of truth:
- Voice loop + system prompts: `..\..\..\hue-desktop\src\renderer\src\lib\pipeline.ts`
- Shared types/settings: `..\..\..\hue-desktop\src\shared\types.ts`

| Desktop capability | Mobile equivalent |
|---|---|
| Voice loop (VAD → ASR → LLM stream → TTS) | Same loop; cloud ASR first, on-device in [[Phased Roadmap\|phase 5]] |
| Companion mode (text answer to interviewer's question) | Same — text only, never spoken |
| Interviewer mode (mock interview, spoken) | Same — expo-speech TTS |
| Barge-in (user talks over reply → abort) | Same — abort LLM stream + stop audio |
| Mic source (echo-cancelled) | getUserMedia-equivalent capture |
| System / loopback audio | Android MediaProjection only — see [[Platform - Android First]] |
| Multi-provider LLM + prompt caching | Direct calls, user's key — see [[Architecture - BYO Key No Backend]] |
| Screen-capture vision (coding prompt) | expo-camera / expo-image-picker → vision LLM (text answer, bigger token budget) |
| Resume parse (PDF/DOCX) | expo-document-picker + on-device parsing |
| Global hotkeys | Quick-settings tile + floating bubble |
| Stealth mode (contentProtection) | Android `FLAG_SECURE` |
| Floating always-on-top overlay + tray | Android `SYSTEM_ALERT_WINDOW` bubble + foreground service |
| Phone mirror (LAN SSE to phone) | Mostly obsolete — the phone *is* the device |
| Encrypted secret storage (safeStorage) | expo-secure-store |
| Settings (model, voice, opacity, job title, mode) | Same Settings screen; reuse `HueSettings` type |

## Reusable types to port
`HueSettings`, `LlmMessage`, `LlmContentBlock` (text/image), `ScreenCapture`, the streaming
delta/done/error events, and the pipeline state union — all from desktop `src/shared/types.ts`.

## System prompts to port verbatim
The companion + interviewer prompts and the "human voice" guidance in
`pipeline.ts` (`buildCompanionPrompt`, `buildInterviewerPrompt`, `HUMAN_VOICE_GUIDANCE`).
