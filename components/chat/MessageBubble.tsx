import { StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated'

import { radius, space, type, useTheme, type Theme } from '@/constants/theme'
import type { Turn } from '@/hooks/useSession'

// One turn in the conversation thread, styled like Claude mobile: the interviewer's
// question sits right-aligned in a quiet bubble; Hue's answer runs full-width on the
// page with a small label, so the draft reads like prose you can lift. Entrances use the
// app's gentle FadeInDown spring and are dropped under reduce-motion.

export function MessageBubble({ turn }: { turn: Turn }) {
  const t = useTheme()
  const styles = makeStyles(t)
  const reduceMotion = useReducedMotion()
  const entering = reduceMotion
    ? undefined
    : FadeInDown.springify().damping(20).stiffness(180)

  if (turn.role === 'user') {
    return (
      <Animated.View entering={entering} style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText} selectable>
            {turn.text}
          </Text>
        </View>
      </Animated.View>
    )
  }

  return (
    <Animated.View entering={entering} style={styles.assistantRow}>
      <Text style={styles.assistantLabel}>HUE</Text>
      <Text style={styles.assistantText} selectable>
        {turn.text}
      </Text>
    </Animated.View>
  )
}

function makeStyles(t: Theme) {
  const c = t.colors
  return StyleSheet.create({
    userRow: { alignItems: 'flex-end' },
    userBubble: {
      maxWidth: '88%',
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      backgroundColor: c.surfaceElevated,
      borderColor: c.border,
    },
    userText: { ...type.body, color: c.ink },

    assistantRow: { alignItems: 'stretch', gap: space.xs },
    assistantLabel: { ...type.overline, color: c.inkMuted },
    assistantText: { ...type.bodyLg, color: c.ink },
  })
}
