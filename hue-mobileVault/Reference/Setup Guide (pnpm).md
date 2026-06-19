# Setup Guide (pnpm)

Package manager is **pnpm only**. See [[Tech Stack]] for the full dependency rationale.

## ⚠️ pnpm + Expo gotcha (do this first)
Expo/Metro and RN native autolinking don't understand pnpm's default symlinked
`node_modules`. Add an `.npmrc` at the project root **before installing**:

```
node-linker=hoist
```

If you ever hit "unable to resolve / package not found", it's almost always this —
confirm `.npmrc` exists and re-run `pnpm install`.

## Commands

```powershell
# one-time tooling
pnpm add -g eas-cli supabase   # supabase optional; not used in v1

# (project already scaffolded at hue-mobile; .npmrc added)

# install the stack
pnpm expo install expo-router expo-secure-store expo-camera expo-image-picker expo-document-picker expo-speech expo-av expo-dev-client
pnpm add zustand @tanstack/react-query nativewind tailwindcss react-native-audio-record
pnpm expo install react-native-reanimated react-native-gesture-handler

# Android dev-client build (cloud — no Mac needed)
eas login
eas build:configure
eas build --profile development --platform android
pnpm expo start --dev-client   # live reload onto the installed dev APK
```

## Install rules
- `pnpm expo install` for Expo/RN-native packages (pins SDK-compatible versions).
- `pnpm add` for pure-JS libs (zustand, supabase-js, etc.).
- Never generate npm/yarn lockfiles or commands.
