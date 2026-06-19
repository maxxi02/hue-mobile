# Design System — "Calm Focus"

The mobile UI redesign (2026-06-18). Replaces the per-screen ad-hoc `palette()`
duplication with one shared design system.

## Direction

**Calm Focus, dark-first (both themes supported).** Hue runs *live* during high-stakes
interviews, so the UI is a near-monochrome, low-noise surface that gets out of the way.
The one place color lives is the **StateOrb** — the app is named for its hue, and the orb
earns it. A single restrained accent (periwinkle dark / indigo light) is allowed for small
interactive affordances (links, selection) so the UI stays usable without competing with
the orb.

Chosen over "Vivid Signal" (one brand hue drenching surfaces) and "Warm Editorial"
(light-first, serif). See the chat decision on 2026-06-18.

## Foundation

- **`constants/theme.ts`** — the single source of truth. Color ramps (contrast-checked:
  body & hint text both clear 4.5:1), `space`, `radius`, `type` scale, and `motion` tokens
  (Emil-style strong ease-out curves + short durations). `useTheme()` hook for screens,
  `getColors(scheme)` for non-hook contexts (navigation config).
- **`components/PressableScale.tsx`** — every pressable scales to 0.97 on press
  (ease-out, reduce-motion safe). Tactile feedback was previously absent.
- **`components/Button.tsx`** — the app's one button: `primary | danger | secondary | ghost`.

## Motion (applied Emil Kowalski principles)

- Buttons scale on press; release is snappy (180ms ease-out).
- Q/A cards enter with a gentle `FadeInDown` spring; gated behind `useReducedMotion`.
- StateOrb **crossfades** its color between states (was a hard snap) and breathes one slow
  pulse only while working; reduce-motion keeps the color cue, drops movement.
- Settings segmented control has a **sliding selection indicator** (was instant).

## What changed, file by file

- `StateOrb.tsx` — layered halo + ring + lit core, animated color via `interpolateColor`.
- `app/(tabs)/index.tsx`, `app/(tabs)/settings.tsx` — rebuilt on tokens.
- `app/(tabs)/_layout.tsx`, `app/_layout.tsx` — tab bar + navigation chrome themed.
- `app/modal.tsx` → repurposed as a themed "About" screen (was Expo template filler).
- `app/+not-found.tsx` — themed.
- Now unused (Expo template leftovers, left in place, safe to delete later):
  `constants/Colors.ts`, `components/Themed.tsx`, `components/EditScreenInfo.tsx`,
  `components/StyledText.tsx`.

## 2026-06-18 — Claude-mobile redesign (chat thread + voice mode)

The Session screen moved from the single orb + Q/A cards to a **Claude-style chat thread**:
a scrolling transcript of `MessageBubble`s (interviewer question right, Hue answer
full-width) over a pinned **Composer** (rounded field + mic/send). The orb stays the
signature element — it shrinks to a compact status orb in the header (`StateOrb` gained a
`size` prop) and goes full-size on the empty canvas and in the new full-screen **voice
mode** (`app/voice.tsx`, hold-to-talk). Still tokens-only, still reduce-motion gated; the
orb remains the only color. New surfaces live in `components/chat/`.

## Not yet done

- Phase A/B UI and the Phase C overlay bubble are validated with `tsc --noEmit` (clean) and
  the native module with `:overlay-bubble:compileDebugKotlin` (clean) — but **not yet run on
  a device/emulator**. Verify visually via `pnpm expo run:android` (SDK 56 can't use Expo Go;
  the native module needs a fresh dev build, not a JS reload).
