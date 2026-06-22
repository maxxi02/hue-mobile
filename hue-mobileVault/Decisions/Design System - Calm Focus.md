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

## 2026-06-23 — Warm Stone typography + Settings UX pass

Two prior moves set the stage: v1.1.0 ported the **Warm Stone** OKLCH palette from
`hue-web` into `constants/theme.ts` (the app, landing page, and extension now share one
color system). This pass closes the remaining gaps so the two products read as one and
fixes the Settings UX complaints.

- **Typography fidelity to hue-web.** Added the editorial voice: **Instrument Serif**
  (display/title — the greeting, About/not-found headings) and **JetBrains Mono** (the
  `overline` eyebrows — section labels, the `HUE` turn label, the new disclosure header).
  Body/labels stay on the system sans to keep the bundle lean. Loaded via
  `@expo-google-fonts/*` through the existing `useFonts` call in `app/_layout.tsx`; family
  names are referenced as strings from `type` tokens (each weight is its own RN family).
- **Resume summary no longer blows out the scroll** (the headline complaint). The
  auto-generated summary now renders as a **3-line tappable preview** that expands to a
  height-capped editor on demand (`ResumeSummaryField` in `app/settings.tsx`). All multiline
  inputs are capped (`maxHeight: 168`) so long text scrolls *inside* the box.
- **Progressive disclosure.** New `components/Collapsible.tsx` (mono header + rotating
  chevron, ease-out, reduce-motion safe) tucks advanced Speech-input fields (Whisper model,
  Deepgram key) out of the default scroll.
- **Consistency.** Provider names unified into `lib/providers.ts` (`PROVIDER_LABELS`/
  `PROVIDER_ORDER`) — home and Settings disagreed before ("Anthropic" vs "Claude"; now
  "Claude" everywhere). Several wall-of-text hints condensed.

Skills applied: `emil-design-eng` (motion/easing) + `ui-ux-pro-max` (RN/shadcn). Gates:
`tsc --noEmit` clean, `jest` 55/55. Not yet run on a device — see below.

## Not yet done

- Phase A/B UI and the Phase C overlay bubble are validated with `tsc --noEmit` (clean) and
  the native module with `:overlay-bubble:compileDebugKotlin` (clean) — but **not yet run on
  a device/emulator**. Verify visually via `pnpm expo run:android` (SDK 56 can't use Expo Go;
  the native module needs a fresh dev build, not a JS reload).
