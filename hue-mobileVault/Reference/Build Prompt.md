# Build Prompt

Paste this into a **fresh session inside the `hue-mobile` folder** to drive the build.
It encodes [[Tech Stack]], [[Architecture - BYO Key No Backend]], [[Platform - Android First]],
and [[Phased Roadmap]]. When it asks for the desktop prompts/types, point it at the files
listed in [[Feature Map (Desktop to Mobile)]].

````text
Build "Hue Mobile" — the Android companion of an existing Electron desktop app, Hue, a real-time
AI interview assistant. Scaffold the project (a folder `hue-mobile` already exists), then implement
features incrementally. Start by proposing the repo structure and a phase-1 plan, then ask me for
the desktop's system-prompt text before writing feature code.

== PRODUCT ==
Hue is a real-time interview assistant with two modes:
- Companion: incoming speech is the INTERVIEWER's question; Hue drafts a first-person answer for
  the user to say, shown as TEXT (never spoken, so it isn't overheard on the call).
- Interviewer: Hue runs a mock interview, asking ONE question at a time, SPOKEN aloud.
Voice loop: VAD detects an utterance -> ASR transcribes -> LLM streams a reply -> (interviewer
mode only) TTS speaks it. The user speaking over a spoken reply barges in: abort the LLM stream
and stop audio immediately.
Context that shapes answers: job title, resume summary, interview mode (practice/star/live).

== ARCHITECTURE: NO BACKEND, BRING-YOUR-OWN-KEY ==
This mirrors the desktop app exactly. There is NO server, NO auth, NO accounts.
- The user enters their own API keys (Anthropic, and optionally Deepgram/AssemblyAI/Groq/Google/
  Mistral/Cohere) in Settings.
- Store every key in expo-secure-store (Android Keystore). NEVER hardcode any key in the bundle.
- The app calls the providers DIRECTLY using the user's own key (Anthropic streaming over fetch/SSE;
  cloud ASR over WebSocket). Apply Anthropic prompt caching in the request.
- Validate/sanitize all external input: audio, images, resume files, and provider responses.

== STACK (use exactly) ==
- TypeScript, React Native + Expo SDK 52+ (New Architecture), expo-router.
- Package manager: pnpm ONLY. Include an .npmrc with `node-linker=hoist`. Never generate npm or
  yarn lockfiles/commands. Use `pnpm expo install` for Expo/RN-native packages, `pnpm add` for
  pure-JS libs.
- Reanimated 3 + react-native-gesture-handler. Respect reduce-motion; keep focus/accessibility
  intact. Favor few, gentle motions.
- State: Zustand + TanStack Query. Styling: NativeWind (Tailwind).
- Secrets: expo-secure-store.
- Audio: react-native-audio-record (raw PCM streaming to ASR); expo-speech for TTS.
- Vision input: expo-camera + expo-image-picker. Resume: expo-document-picker, parsed on-device.
- On-device (phase 5, behind flags): onnxruntime-react-native (Silero v5 VAD), whisper.rn.
- Build with EAS + expo-dev-client (NOT Expo Go), because of the native modules below.

== PLATFORM: ANDROID-FIRST ==
Target Android only for now. Stub iOS behind a platform abstraction (e.g. an AudioSource
interface); do NOT implement iOS-specific native modules yet. Implement these Android capabilities:
- System/loopback audio (hear the interviewer's voice on a call): a MediaProjection audio-capture
  native module (Android 10 / API 29+). This is the headline companion feature.
- Mic source: echo-cancelled capture.
- Floating overlay bubble over other apps (e.g. during a Zoom/Meet call): SYSTEM_ALERT_WINDOW
  permission + a foreground service so the session survives backgrounding.
- Stealth mode: FLAG_SECURE on the session screen to block screenshots/screen recording.
- Replace desktop global hotkeys with: a quick-settings tile and the floating bubble as triggers.
Declare permissions in app.json/config plugins up front: RECORD_AUDIO, FOREGROUND_SERVICE,
FOREGROUND_SERVICE_MEDIA_PROJECTION, SYSTEM_ALERT_WINDOW, POST_NOTIFICATIONS.

== SYSTEM PROMPTS ==
Port the desktop companion + interviewer system prompts and the "human voice" guidance VERBATIM
(I will paste the text — ask me for it). Keep the companion rules: lead with a complete standalone
first sentence, one natural paragraph, weave in one concrete example, never invent facts, first
person, conversational Philippine-English tone. Build the system prompt from settings the same way.

== SCREENS / UX ==
- Session (home): a state orb (idle/listening/transcribing/thinking/speaking), live transcript of
  the interviewer's question, a streaming answer card, barge-in support. Toggles for mode
  (companion/interviewer) and audio source (mic / system).
- Capture: snap or pick an image of a shared coding/system-design prompt -> vision LLM answer,
  shown as text (larger token budget, never spoken).
- Settings: provider + model pickers, API-key fields (expo-secure-store), TTS voice/speed, job
  title, resume upload + summary, interview mode, stealth toggle, window/theme prefs.
- History: list of past sessions (stored locally on-device).

== DATA TYPES ==
Reuse the desktop's shared TypeScript types where they map: HueSettings, LlmMessage, LlmContentBlock
(text/image), ScreenCapture, streaming delta/done/error events, pipeline states. I can paste these.

== ENGINEERING ==
- Explicitly typed, well-tested code; small focused commits with descriptive messages.
- Phase the work and confirm each phase before moving on:
  (1) scaffold + Settings (keys in secure-store) + mic companion via cloud ASR + Anthropic stream;
  (2) interviewer mode + TTS + barge-in;
  (3) vision capture + on-device resume parse;
  (4) Android system-audio capture + floating overlay + FLAG_SECURE stealth + quick-settings tile;
  (5) optional on-device VAD/ASR behind flags.

Begin: propose the repo structure and the phase-1 task breakdown, then ask me for the desktop
system-prompt text and shared types before writing code.
````
