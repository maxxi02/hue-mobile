import { Easing } from 'react-native-reanimated'

import { useColorScheme } from '@/components/useColorScheme'

/**
 * Hue's design system — a single source of truth for color, space, type, and motion.
 *
 * Direction: "Warm Stone" — ported from hue-web's OKLCH palette so the app, the
 * landing page, and the browser extension read as one product. The surface is a
 * warm near-monochrome (stone) family, dark by default, and the brand voice is a
 * warm amber. `primary` is the warm-orange filled action; `accent` is the amber
 * used for small interactive affordances (links, selection). The StateOrb keeps its
 * own per-state hues — those signal the pipeline state and are deliberately not the
 * brand accent.
 *
 * The OKLCH source tokens (see hue-web/src/app/globals.css) are converted to hex
 * here because React Native does not support the oklch() color space.
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
  // Warm stone surface — hue-web --background / --card / --muted.
  bg: '#0C0A09',
  surface: '#1C1917',
  surfaceElevated: '#292524',
  border: 'rgba(255,255,255,0.10)', // hue-web --border: oklch(1 0 0 / 10%)
  borderStrong: '#79716B', // hue-web --ring

  ink: '#FAFAF9', // --foreground
  inkMuted: '#A6A09B', // --muted-foreground
  inkFaint: '#8B8580', // dimmer hint; still clears 4.5:1 on bg

  primary: '#BB4D00', // --primary (warm orange)
  onPrimary: '#FFFBEB', // --primary-foreground (cream)

  danger: '#F2555A',
  onDanger: '#FFFFFF',

  accent: '#FE9A00', // --chart-2, the amber accent used throughout hue-web
  accentSoft: 'rgba(254,154,0,0.14)',

  noticeBg: '#1A1510',
  noticeBorder: '#3A2E1C',
  noticeInk: '#E9C98C',

  errorBg: '#1C1416',
  errorBorder: '#43282B',
  errorInk: '#F4A9AC',

  positive: '#43C59E',
}

const light: ThemeColors = {
  // hue-web light mode is white-on-white separated by borders; bg is nudged to a
  // faint warm off-white so cards keep a visible layer on a phone.
  bg: '#FCFAF7',
  surface: '#FFFFFF', // --card
  surfaceElevated: '#F5F5F4', // --muted
  border: '#E7E5E4', // --border
  borderStrong: '#A6A09B', // --ring

  ink: '#0C0A09', // --foreground
  inkMuted: '#6B6560', // a touch darker than --muted-foreground for body labels
  inkFaint: '#79716B', // --muted-foreground; lightest token clearing 4.5:1 on white

  primary: '#BB4D00', // --primary (warm orange)
  onPrimary: '#FFFBEB', // --primary-foreground (cream)

  danger: '#DC2626',
  onDanger: '#FFFFFF',

  accent: '#BB4D00', // darker amber for small-text contrast on light surfaces
  accentSoft: 'rgba(187,77,0,0.10)',

  noticeBg: '#FBF4E6',
  noticeBorder: '#EBD9AE',
  noticeInk: '#7A4E12',

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
