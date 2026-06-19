# Platform — Android First

**Decision:** Target Android first. Stub iOS behind a platform abstraction (e.g. an
`AudioSource` interface); don't implement iOS-specific native modules yet.

## Why Android first
Android can fully replicate the desktop's live-call companion experience; iOS can't, and
it's also buildable locally on the user's Windows machine (no Mac needed).

| Capability | Android | iOS |
|---|---|---|
| System / loopback audio (hear the interviewer on a call) | ✅ MediaProjection audio capture (API 29+) | ❌ sandbox forbids capturing other apps' audio (mic only) |
| Floating overlay over other apps (bubble during Zoom/Meet) | ✅ `SYSTEM_ALERT_WINDOW` + foreground service | ❌ no cross-app overlay |
| Stealth (hide from screenshots/recording) | ✅ `FLAG_SECURE` | ⚠️ best-effort |
| Global hotkeys replacement | Quick-settings tile + the bubble | Action button / Siri Shortcut (later) |

## Required Android permissions (declare up front in app.json / config plugins)
`RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`,
`SYSTEM_ALERT_WINDOW`, `POST_NOTIFICATIONS`.

## Native code needed
Only [[Phased Roadmap|phase 4]] (MediaProjection + overlay) needs Kotlin. Phases 1–3 are
pure RN/TS. See [[Feature Map (Desktop to Mobile)]] and [[Open Questions]] for the iOS timeline.
