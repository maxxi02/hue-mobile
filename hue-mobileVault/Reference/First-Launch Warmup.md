# First-Launch Warmup

**Built 2026-06-18.** Removes the first-turn lag where the first session after launch sat
on "Connecting" / "Transcribing" longer than later turns. Mobile port of the desktop's
warmup pattern.

## The desktop pattern we ported
Desktop (`hue-desktop`) calls `preloadOnDeviceModel()` (+ `preloadTtsModel()`) from
`reloadConfig()` in `useVoiceMode.ts` the moment saved settings are known, guarded by
`!pipelineRef.current` so it never fires under a live session. It warms the heavy thing —
downloading/initialising on-device Whisper — *before* the user clicks start.

## Why mobile is different
Mobile has **no on-device model**. ASR is **Groq's hosted Whisper** (see
[[Architecture - BYO Key No Backend]], [[Feature Map (Desktop to Mobile)]]). So there's
nothing to download. The first-turn cold costs are instead:

1. **First Groq HTTPS request** — DNS + TLS handshake to `api.groq.com` on the first
   `transcribeWithGroq` upload. This *is* the "loading the transcribe" delay the user saw.
2. **Native recorder init** — the first `prepareToRecordAsync()` spins up Android's
   MediaRecorder/AudioRecord + audio session; later cycles are instant.

We warm exactly those two.

## What we added
- **`warmGroqConnection(apiKey)` (`lib/groq-transcribe.ts`)** — fire-and-forget `GET /models`
  that opens the connection and discards the body (even a 401 warms DNS/TLS). Uses
  **XMLHttpRequest**, the same RN native transport the real upload uses, so the warmed
  socket is the one the upload reuses (`fetch` may pool separately — same reasoning the file
  header gives for the upload itself). Guarded by `warmedForKey`; resets on transport
  failure so a later attempt retries.
- **`warmNativeAudio(recorder)` (`lib/audioSource.ts`)** — `setAudioModeAsync` +
  `prepareToRecordAsync()` → `stop()` on the shared (hook-owned) recorder. `stop()` releases
  the mic immediately so capture is never held at idle. Guarded by `nativeAudioWarmed`.
- **Wiring (`hooks/useSession.ts`)** — an effect keyed on `groqApiKey` + `audioSource` fires
  both warmups when `micCaptureAvailable()` and **no** pipeline is live; re-runs if the key or
  source changes. Mirrors desktop's `reloadConfig` guard exactly.

## Key safety decisions (don't regress these)
- **No mic prompt at launch.** `warmNativeAudio` reads permission with
  **`getRecordingPermissionsAsync()`** (checks *without* prompting) and bails unless already
  granted. The permission dialog stays tied to the user's first explicit tap. First-ever
  launch therefore warms network only — by design.
- **Never `release()` the shared recorder.** Releasing invalidates the `useAudioRecorder`
  instance (its native object becomes invalid until re-prepared) and would break the real
  `arm()`. We only `prepare → stop`; the first `arm()` re-prepares as it would anyway.
- **Never hold the mic at idle.** That's why we `stop()` right after `prepare`, with a
  second best-effort `stop()` in the catch so a failed warm can't leave capture open.
- Both calls are **best-effort and idempotent** — a failed/extra warm just means that one
  turn pays the cold cost as before. Warmup is never a correctness step.

## Gating rationale
Only fires when the device actually captures live mic audio (`micCaptureAvailable`):
Android + `audioSource === 'microphone'`. Manual/typed input ([[Platform - Android First]]'s
Expo-Go path) uses neither the recorder nor Groq ASR, so there's nothing to warm.

## Still to verify on hardware
- First session after a cold launch goes **straight to Listening** (no "Connecting" stall),
  and the **first** utterance transcribes about as fast as later ones.
- No mic-in-use indicator appears at launch (confirms `stop()` releases capture).
- First-ever launch (permission not yet granted) still warms network and does **not** prompt
  for the mic until the first tap.
