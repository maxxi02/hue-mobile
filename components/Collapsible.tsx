import { SymbolView } from 'expo-symbols'
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { motion, space, type, useTheme, type Theme } from '@/constants/theme'

// A progressive-disclosure section: a tappable header (mono eyebrow + chevron) that
// reveals its children. Used to tuck advanced, rarely-touched settings out of the
// default scroll so the page stays short. The chevron rotates with a gentle ease-out
// (snapped under reduce-motion); the content fades in on open and is unmounted on close
// — an instant, snappy collapse, per the "exits are fast" principle.

interface Props {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}

export function Collapsible({ title, children, defaultOpen = false }: Props) {
  const t = useTheme()
  const styles = makeStyles(t)
  const reduceMotion = useReducedMotion()
  const [open, setOpen] = useState(defaultOpen)
  const rot = useSharedValue(defaultOpen ? 1 : 0)

  const toggle = () => {
    const next = !open
    setOpen(next)
    rot.value = reduceMotion
      ? next
        ? 1
        : 0
      : withTiming(next ? 1 : 0, {
          duration: motion.duration.fast,
          easing: motion.easing.out,
        })
  }

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value * 90}deg` }],
  }))

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.6 }]}>
        <Text style={styles.title}>{title.toUpperCase()}</Text>
        <Animated.View style={chevronStyle}>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            tintColor={t.colors.inkMuted}
            size={18}
          />
        </Animated.View>
      </Pressable>

      {open && (
        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(motion.duration.base).easing(motion.easing.out)}
          style={styles.body}>
          {children}
        </Animated.View>
      )}
    </View>
  )
}

function makeStyles(t: Theme) {
  const c = t.colors
  return StyleSheet.create({
    wrap: { gap: space.lg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
    },
    title: { ...type.overline, color: c.inkMuted },
    body: { gap: space.lg },
  })
}
