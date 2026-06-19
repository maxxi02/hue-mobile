# Tech Stack

Chosen to reuse the desktop app's TypeScript/React mental model, types, and system
prompts as directly as possible. See [[Architecture - BYO Key No Backend]] for why
there's no server, and [[Platform - Android First]] for the platform scope.

| Concern | Choice |
|---|---|
| Language / framework | TypeScript + React Native (Expo SDK 52+, New Architecture) |
| Navigation | expo-router |
| Animation | Reanimated 3 + react-native-gesture-handler (respect reduce-motion; gentle motions) |
| State | Zustand + TanStack Query |
| Styling | NativeWind (Tailwind) |
| Secrets | expo-secure-store (Android Keystore) — the **only** security layer needed |
| LLM | Direct provider calls with the user's own key. Anthropic streaming over fetch/SSE + prompt caching; OpenAI-compatible (Google/Groq/Mistral/Cohere); Ollama optional |
| Cloud ASR | Deepgram / AssemblyAI / Groq streaming over WebSocket (user's own key) |
| On-device ASR (phase 5) | whisper.rn (whisper.cpp) — transformers.js won't run well in RN |
| VAD (phase 5) | onnxruntime-react-native running Silero v5 (same model as desktop) |
| TTS | expo-speech (system TTS) by default |
| Audio I/O | react-native-audio-record (raw PCM streaming) |
| Vision input | expo-camera + expo-image-picker |
| Resume | expo-document-picker, parsed on-device |
| Build | EAS Build + expo-dev-client (NOT Expo Go — native modules required) |
| Package manager | pnpm only — see [[Setup Guide (pnpm)]] |

## Why not Expo Go
whisper.rn, onnxruntime-react-native, and the Android MediaProjection / overlay modules
are native code, so a custom dev client is required.
