import { type ReactNode } from 'react'
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { motion } from '@/constants/theme'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

interface Props extends Omit<PressableProps, 'style'> {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  /** How far to scale down on press. Subtle by default (Emil: 0.95–0.98). */
  pressedScale?: number
}

/**
 * A Pressable that scales down slightly while held — instant tactile feedback so the
 * UI feels like it's listening. The release springs back with a strong ease-out.
 * Honors reduce-motion (no scale, opacity dip only). Use for every pressable surface.
 */
export function PressableScale({
  children,
  style,
  pressedScale = 0.97,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: Props) {
  const reduceMotion = useReducedMotion()
  const scale = useSharedValue(1)
  const opacity = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }))

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => {
        if (!reduceMotion) {
          scale.value = withTiming(pressedScale, {
            duration: motion.duration.press,
            easing: motion.easing.out,
          })
        }
        opacity.value = withTiming(0.92, { duration: motion.duration.press })
        onPressIn?.(e)
      }}
      onPressOut={(e: GestureResponderEvent) => {
        scale.value = withTiming(1, {
          duration: motion.duration.fast,
          easing: motion.easing.out,
        })
        opacity.value = withTiming(1, { duration: motion.duration.fast })
        onPressOut?.(e)
      }}
      style={[style, animatedStyle]}>
      {children}
    </AnimatedPressable>
  )
}
