import { Link } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import { PressableScale } from '@/components/PressableScale'
import { StateOrb } from '@/components/StateOrb'
import { radius, space, type, useTheme, type Theme } from '@/constants/theme'
import type { PipelineState } from '@/lib/pipeline'

// The thread's resting state before the first turn: a centered greeting over a small
// StateOrb, the active mode, and — if no API key is set yet — a tappable notice that
// routes to Settings. Mirrors Claude mobile's calm empty canvas.

interface Props {
  state: PipelineState
  modeLabel: string
  /** One line setting expectations for what the user's input means in the active mode. */
  modeHint: string
  hasKey: boolean
  providerLabel: string
}

export function EmptyState({ state, modeLabel, modeHint, hasKey, providerLabel }: Props) {
  const t = useTheme()
  const styles = makeStyles(t)

  return (
    <View style={styles.wrap}>
      <StateOrb state={state} />
      <Text style={styles.greeting}>Ready when you are</Text>
      <Text style={styles.modeLabel}>{modeLabel}</Text>
      <Text style={styles.modeHint}>{modeHint}</Text>

      {!hasKey && (
        <Link href="/settings" asChild>
          <PressableScale style={styles.notice} accessibilityRole="button">
            <View style={styles.dot} />
            <Text style={styles.noticeText}>
              No {providerLabel} API key yet. Tap to add one in Settings before you start.
            </Text>
          </PressableScale>
        </Link>
      )}
    </View>
  )
}

function makeStyles(t: Theme) {
  const c = t.colors
  return StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
    greeting: { ...type.title, color: c.ink, marginTop: space.sm },
    modeLabel: { ...type.caption, color: c.inkMuted, textAlign: 'center' },
    modeHint: {
      ...type.caption,
      color: c.inkFaint,
      textAlign: 'center',
      marginTop: space.xs,
      marginHorizontal: space.xl,
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      marginTop: space.xl,
      marginHorizontal: space.xl,
      padding: space.lg,
      borderRadius: radius.md,
      borderWidth: 1,
      backgroundColor: c.noticeBg,
      borderColor: c.noticeBorder,
    },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.noticeInk },
    noticeText: { ...type.caption, color: c.noticeInk, flex: 1 },
  })
}
