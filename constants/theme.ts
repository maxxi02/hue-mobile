import { Easing } from 'react-native-reanimated'

import { useColorScheme } from '@/components/useColorScheme'

/**
 * Hue's design system — a single source of truth for color, space, type, and motion.
 *
 * Direction: "Calm Focus". Hue runs live during high-stakes interviews, so the UI
 * stays a near-monochrome, low-noise surface that gets out of the way. The one place
 * color lives is the StateOrb — the app is named for its hue, and the orb earns it.
 * A single restrained accent is allowed for small interactive affordances (links,
 * selection) so the UI stays usable without ever competing with the orb.
 *
 * Contrast: every text token is checked against the surface it sits on. Body text
 * clears 4.5:1; muted/hint text clears 4.5:1 too (used for real copy, not just chrome).
 */

type Scheme = 'light' | 'dark'

export interface ThemeColors {
  /** App background — the furthest-back surface. */
  bg: string
  /** Default card / grouped surface. */
  surface: string
  /** A surface that sits above `surface` (selected pills, nested rows). */
  surfaceElevated: string
  /** Hairline divider / card border. */
  border: string
  /** Stronger border for focus / emphasis. */
  borderStrong: string

  /** Primary text. */
  ink: string
  /** Secondary text — labels, captions; still fully readable. */
  inkMuted: string
  /** Tertiary text — hints; the lightest token that still clears 4.5:1. */
  inkFaint: string

  /** Filled primary action (Start session). Near-mono on purpose. */
  primary: string
  /** Text/icon on top of `primary`. */
  onPrimary: string

  /** Destructive / stop. Used as a state signal, kept calm. */
  danger: string
  onDanger: string

  /** The single restrained accent for small interactive affordances. */
  accent: string
  /** A low-opacity wash of the accent for selection backgrounds. */
  accentSoft: string

  /** Quiet notice surface (no API key yet). */
  noticeBg: string
  noticeBorder: string
  noticeInk: string

  /** Quiet error surface. */
  errorBg: string
  errorBorder: string
  errorInk: string

  /** A faint positive tint for the answer label / success accents. */
  positive: string
}

const dark: ThemeColors = {
  bg: '#0A0B0D',
  surface: '#131519',
  surfaceElevated: '#1B1E24',
  border: '#24282F',
  borderStrong: '#333944',

  ink: '#F3F5F8',
  inkMuted: '#A4ADB9',
  inkFaint: '#7F8896',

  primary: '#F3F5F8',
  onPrimary: '#0A0B0D',

  danger: '#F2555A',
  onDanger: '#FFFFFF',

  accent: '#8FA0FF',
  accentSoft: 'rgba(143,160,255,0.14)',

  noticeBg: '#16181D',
  noticeBorder: '#2C313A',
  noticeInk: '#D7C9A0',

  errorBg: '#1C1416',
  errorBorder: '#43282B',
  errorInk: '#F4A9AC',

  positive: '#43C59E',
}

const light: ThemeColors = {
  bg: '#FAFBFC',
  surface: '#FFFFFF',
  surfaceElevated: '#F4F6F8',
  border: '#E5E8EC',
  borderStrong: '#D2D7DE',

  ink: '#14161A',
  inkMuted: '#5A6472',
  inkFaint: '#6B7480',

  primary: '#14161A',
  onPrimary: '#FAFBFC',

  danger: '#DC2626',
  onDanger: '#FFFFFF',

  accent: '#4F5BD5',
  accentSoft: 'rgba(79,91,213,0.10)',

  noticeBg: '#FBF7EA',
  noticeBorder: '#ECE0BE',
  noticeInk: '#7A5B12',

  errorBg: '#FDF1F1',
  errorBorder: '#F6D4D4',
  errorInk: '#B42318',

  positive: '#0E9F77',
}

const palettes: Record<Scheme, ThemeColors> = { light, dark }

/** Spacing scale (px). Use these instead of ad-hoc numbers so rhythm stays consistent. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const

/** Corner radii. */
export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const

/** Type scale — sizes paired with their natural line heights. */
export const type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700' as const },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyLg: { fontSize: 17, lineHeight: 26, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  /** Small tracked label (section headers, status eyebrow). */
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 1.2 },
} as const

/**
 * Motion tokens. Emil Kowalski's principles applied to Reanimated:
 * strong custom ease-out curves, short durations, ease-out for entrances.
 */
export const motion = {
  duration: {
    press: 130,
    fast: 180,
    base: 240,
    slow: 320,
  },
  easing: {
    /** Strong ease-out — entrances, press release. cubic-bezier(0.23,1,0.32,1). */
    out: Easing.bezier(0.23, 1, 0.32, 1),
    /** Strong ease-in-out — on-screen movement. cubic-bezier(0.77,0,0.175,1). */
    inOut: Easing.bezier(0.77, 0, 0.175, 1),
    /** Gentle standard ease — color/opacity shifts. */
    standard: Easing.inOut(Easing.ease),
  },
} as const

export interface Theme {
  scheme: Scheme
  colors: ThemeColors
  space: typeof space
  radius: typeof radius
  type: typeof type
  motion: typeof motion
}

/** The active theme for the current system color scheme. */
export function useTheme(): Theme {
  const scheme = (useColorScheme() ?? 'dark') as Scheme
  return { scheme, colors: palettes[scheme], space, radius, type, motion }
}

/** Theme for an explicit scheme — for non-hook contexts (navigation config). */
export function getColors(scheme: Scheme): ThemeColors {
  return palettes[scheme]
}
