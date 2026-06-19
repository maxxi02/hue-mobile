import { type ReactNode } from 'react'
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native'

import { PressableScale } from '@/components/PressableScale'
import { radius, space, useTheme, type Theme } from '@/constants/theme'

type Variant = 'primary' | 'danger' | 'secondary' | 'ghost'

interface Props {
  label: string
  onPress?: () => void
  variant?: Variant
  disabled?: boolean
  /** Optional leading node (e.g. a spinner). */
  leading?: ReactNode
  style?: StyleProp<ViewStyle>
  accessibilityHint?: string
}

/** The app's one button. Tactile (scales on press), themed, with four calm variants. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  leading,
  style,
  accessibilityHint,
}: Props) {
  const t = useTheme()
  const v = variantStyle(t, variant)

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      style={[
        styles.base,
        { backgroundColor: v.bg, borderColor: v.border, borderWidth: v.borderWidth },
        disabled && styles.disabled,
        style,
      ]}>
      {leading}
      <Text style={[styles.label, { color: v.fg }]}>{label}</Text>
    </PressableScale>
  )
}

function variantStyle(t: Theme, variant: Variant) {
  const c = t.colors
  switch (variant) {
    case 'primary':
      return { bg: c.primary, fg: c.onPrimary, border: 'transparent', borderWidth: 0 }
    case 'danger':
      return { bg: c.danger, fg: c.onDanger, border: 'transparent', borderWidth: 0 }
    case 'secondary':
      return { bg: c.surfaceElevated, fg: c.ink, border: c.border, borderWidth: 1 }
    case 'ghost':
      return { bg: 'transparent', fg: c.inkMuted, border: 'transparent', borderWidth: 0 }
  }
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    borderRadius: radius.lg,
  },
  label: { fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.45 },
})
