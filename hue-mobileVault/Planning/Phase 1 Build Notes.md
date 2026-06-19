# Phase 1 Build Notes

Status log for [[Phased Roadmap|Phase 1 — Mic companion (MVP)]]. Built 2026-06-17.

## What shipped
The companion loop end to end, minus live audio capture:
- **Settings** ([[Architecture - BYO Key No Backend|BYO-key]]): Anthropic key + model, Hue role
  (companion/interviewer), answer style (practice/STAR/live), job title, resume summary, and a
  Deepgram key field for later ASR. Keys persisted via **expo-secure-store** (Android Keystore).
- **System prompts** ported VERBATIM from desktop `pipeline.ts` (`buildCompanionPrompt`,
  `buildInterviewerPrompt`, `HUMAN_VOICE_GUIDANCE`) — see [[Feature Map (Desktop to Mobile)]].
- **Anthropic streaming** over `expo/fetch` (RN's built-in fetch can't stream bodies; `expo/fetch`
  exposes `response.body.getReader()`). Prompt caching on the system block. Abort-based barge-in.
- **VoicePipeline** state machine adapted from desktop: idle → listening → thinking → speaking,
  stale-stream guarding, input sanitization.
- **Session UI**: animated state orb (Reanimated, respects reduce-motion), question + answer cards,
  manual question input.

## Key files
- `lib/types.ts`, `lib/defaults.ts`, `lib/prompts.ts`, `lib/anthropic.ts`, `lib/pipeline.ts`,
  `lib/audioSource.ts`
- `store/settings.ts` (Zustand + secure-store), `hooks/useSession.ts`
- `app/(tabs)/index.tsx` (Session), `app/(tabs)/settings.tsx`, `components/StateOrb.tsx`

## Deviations from the original [[Tech Stack]] (deliberate, Phase 1)
- **Styling: React Native StyleSheet, not NativeWind.** Avoided NativeWind/Tailwind/babel config
  risk for the MVP. Revisit if the UI grows.
- **TanStack Query: deferred.** Nothing in Phase 1 does cache-style data fetching; the LLM call is a
  manual stream. Add when there's a real query surface.
- **Audio input is stubbed behind an `AudioSource` interface** (the abstraction [[Platform - Android First]]
  asked for). `ManualAudioSource` (type the question) is the only live source; `NativeMicAudioSource`
  throws until the native module lands. Flipping `isNativeAudioAvailable()` switches it on.

## ⚠️ Runtime change: Expo Go does NOT work — use a dev build
SDK 56 is newer than the public Expo Go binary, so it refuses the project ("requires a newer version
of Expo Go"). This was always coming — the native phases (mic, MediaProjection, overlay) need a dev
client regardless (see [[Tech Stack]] "Why not Expo Go").

**Local dev build (no Mac, no EAS account needed** — the dev machine already has Android SDK + JDK 21
+ a device on `adb`):
```powershell
pnpm expo run:android            # one-time: prebuild + Gradle + install dev client to the phone
pnpm expo start --dev-client     # subsequent sessions: just the JS dev server
```
`expo run:android` generated the native `android/` directory (gitignored). Set
`android.package = com.huemobile.app` in app.json so prebuild doesn't prompt.

### ⚠️ Windows path-length saga (CMake/ninja) — THREE fixes were needed
The first `pnpm expo run:android` on Windows hit a cascade of path-length failures in the
native C++ build. All three fixes below are required together; none alone is enough.

**1. Relocate the pnpm virtual store** (fixes the deep per-package object paths, ~288 chars).
pnpm's default `node_modules/.pnpm/<pkg>@<ver>_<32-char-hash>/node_modules/<pkg>/…` is huge.
In `.npmrc`:
```
virtual-store-dir=C:/.pn
virtual-store-dir-max-length=40
```
then `rm -rf node_modules && pnpm install`. Store moves to `C:\.pn\react-n_<hash>\…`.
After this, regenerate the native project (`rm -rf android`) so autolinking re-resolves to the
new store path, else Gradle errors "projectDirectory … does not exist".

**2. Enable Windows long paths** (the app-level codegen mirror path is ~378 chars — no amount of
store/root shortening fits that under 260). As Administrator:
```powershell
New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -Value 1 -PropertyType DWORD -Force
```
plus `git config --global core.longpaths true`.

**3. Use CMake 3.31.6 (ninja 1.12.1), not the AGP-default 3.22.1 (ninja 1.10.2).** The OS flag in
(2) does nothing unless the *tool* is long-path-aware; ninja added that in 1.12. Install and pin:
```powershell
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" "cmake;3.31.6"
```
and in `android/local.properties`:
```
cmake.dir=C:\\Users\\proja\\AppData\\Local\\Android\\Sdk\\cmake\\3.31.6
```
Then `android\gradlew.bat --stop`, clear `.cxx` dirs, and rebuild.

**Result:** `BUILD SUCCESSFUL`, dev-client APK installed to the phone. Keep all three — any teammate
on Windows hits this exact wall.

## Added later: Groq cloud ASR client (`lib/groq-transcribe.ts`)
First real transcription backend, ahead of the native recorder. Groq's hosted Whisper
(`/audio/transcriptions`, OpenAI audio wire format) reuses the **same base URL + account key**
as the Groq LLM client (`lib/openai-compat.ts`) — one key, two services. Unlike the desktop app,
which runs Whisper on-device via transformers.js (`hue/src/workers/whisper.worker.ts`), mobile can't
bundle that, so we go hosted.
- `transcribeWithGroq(apiKey, model, clip, opts, signal)` — multipart POST of a **Blob** (standards
  FormData, so it works under `expo/fetch`'s WinterCG impl and is testable without a device, rather
  than RN's `{ uri }` append trick). Own 20s timeout + chained caller abort (stop/barge-in), no
  key in any error, friendly 401/429/413 messages — mirrors `streamOpenAiCompat`.
- It's a **batch** endpoint (one finished utterance → text), not a live stream. Default model
  `whisper-large-v3-turbo` (latency over last-point accuracy). New setting `groqAsrModel` (empty =
  default), parallel to `groqModel`. Upload is RN's global `fetch` + FormData `{ uri, name, type }`
  (streams the file from disk; no in-memory copy, no expo/fetch needed for a one-shot JSON response).

## Added: native mic recorder, push-to-talk (`expo-audio`)
Wires Groq ASR end-to-end. Installed **expo-audio** (`~56.0.12`) + its config plugin (mic permission
string in app.json). Because Groq Whisper is batch (no on-device VAD yet), the UX is **push-to-talk**:
hold a button → record → release → transcribe.
- `MicRecordAudioSource` (a new `PushToTalkSource`) drives record/stop + transcription behind the
  AudioSource abstraction the vault asked for. expo-audio has **no public imperative recorder
  constructor** (`AudioRecorder` is a type-only export; `new AudioModule.AudioRecorder` is internal),
  so the recorder is created by `useAudioRecorder` in `useSession` (React owns its native lifecycle)
  and **injected** into the source. HIGH_QUALITY preset → `.m4a` (audio/mp4), which Groq accepts.
- `VoicePipeline` gains `beginRecording()` / `endRecording()` and emits the `transcribing` state
  while the upload is in flight. Typed questions now inject through any source, so the text fallback
  works even in mic mode.
- Session UI shows a **Hold to talk** button (`onPressIn`/`onPressOut`) when `pushToTalkAvailable`
  (Android + `audioSource === 'microphone'`); the text input stays as a fallback. Settings “Speech
  input” section now takes the Groq key (independent of the LLM provider) + Whisper model.
- `isNativeAudioAvailable()` is now `Platform.OS === 'android'` (iOS stays stubbed per
  [[Platform - Android First]]; 'system'/loopback still throws — phase 4).
- ✅ **Verified on real hardware 2026-06-17** (TECNO_CI8n, `pnpm expo run:android` dev client):
  mic permission prompt → hold-to-talk → Groq transcript → streamed Anthropic answer all work, the
  m4a `{ uri }` upload uploads cleanly, and the typed fallback drives the same loop.

## Next
- ✅ Phase 1 verified on-device (mic→Groq→answer round trip, typed fallback). Done.
- [[Phased Roadmap|Phase 2]] (interviewer TTS + barge-in) — also built and verified, see [[Phase 2 Build Notes]].
