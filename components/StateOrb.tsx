import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { motion } from '@/constants/theme'
import type { PipelineState } from '@/lib/pipeline'

// The session's status orb — Hue's signature element and the only place color lives.
// The orb's hue tells you the pipeline's state; it crossfades between states rather than
// snapping, and breathes with one slow, gentle pulse while a turn is in flight. A soft
// halo makes the color read as a light source, not a flat disc. Reduce-motion users get
// the steady color cue (it still recolors, just without movement).

// The orb is sized by its halo (the outermost ring); the lit core is half that. Default
// is the hero size used on the empty canvas and in voice mode; a smaller `size` drives the
// compact status orb in the session header.
const DEFAULT_HALO = 248

interface StateMeta {
  color: string
  label: string
  /** Whether this state is "working" and should breathe. */
  busy: boolean
}

// Ordered so the animated index crossfades along a pleasant hue sweep between states.
const ORDER: PipelineState[] = [
  'idle',
  'connecting',
  'listening',
  'transcribing',
  'thinking',
  'speaking',
]

const STATES: Record<PipelineState, StateMeta> = {
  idle: { color: '#6B7280', label: 'Idle', busy: false },
  connecting: { color: '#E8A13A', label: 'Connecting', busy: true },
  listening: { color: '#3B82F6', label: 'Listening', busy: false },
  transcribing: { color: '#6366F1', label: 'Transcribing', busy: true },
  thinking: { color: '#9B6CF6', label: 'Thinking', busy: true },
  speaking: { color: '#2FB89A', label: 'Answering', busy: true },
}

const COLORS = ORDER.map((s) => STATES[s].color)
const INPUT = ORDER.map((_, i) => i)

export function orbLabel(state: PipelineState): string {
  return STATES[state].label
}

export function StateOrb({ state, size = DEFAULT_HALO }: { state: PipelineState; size?: number }) {
  const meta = STATES[state]
  const dims = makeDims(size)
  const reduceMotion = useReducedMotion()
  const index = useSharedValue(ORDER.indexOf(state))
  const breathe = useSharedValue(0)

  // Crossfade the color when the state changes.
  useEffect(() => {
    const target = ORDER.indexOf(state)
    index.value = reduceMotion
      ? target
      : withTiming(target, { duration: motion.duration.slow, easing: motion.easing.standard })
  }, [state, reduceMotion, index])

  // One slow breathing pulse while working; rest otherwise.
  useEffect(() => {
    if (meta.busy && !reduceMotion) {
      breathe.value = withRepeat(
        withTiming(1, { duration: 1300, easing: motion.easing.standard }),
        -1,
        true,
      )
    } else {
      cancelAnimation(breathe)
      breathe.value = withTiming(0, { duration: motion.duration.base, easing: motion.easing.out })
    }
    return () => cancelAnimation(breathe)
  }, [meta.busy, reduceMotion, breathe])

  const color = useDerivedValue(() => interpolateColor(index.value, INPUT, COLORS))

  const coreStyle = useAnimatedStyle(() => ({
    backgroundColor: color.value,
    transform: [{ scale: 1 + breathe.value * 0.05 }],
  }))

  // The halo breathes a touch more and fades up — the pulse reads as light radiating out.
  const haloStyle = useAnimatedStyle(() => ({
    backgroundColor: color.value,
    opacity: 0.1 + breathe.value * 0.08,
    transform: [{ scale: 0.78 + breathe.value * 0.12 }],
  }))

  const ringStyle = useAnimatedStyle(() => ({
    backgroundColor: color.value,
    opacity: 0.16 + breathe.value * 0.06,
    transform: [{ scale: 0.94 + breathe.value * 0.06 }],
  }))

  return (
    <View style={dims.wrap}>
      <Animated.View style={[dims.halo, haloStyle]} pointerEvents="none" />
      <Animated.View style={[dims.ring, ringStyle]} pointerEvents="none" />
      <Animated.View
        style={[dims.core, styles.core, coreStyle]}
        accessibilityRole="image"
        accessibilityLabel={`Status: ${meta.label}`}>
        {/* A soft top highlight so the orb reads as lit from above, not flat. */}
        <View style={dims.highlight} pointerEvents="none" />
      </Animated.View>
    </View>
  )
}

/** Size-dependent geometry, derived from the halo size so the orb scales as one piece. */
function makeDims(halo: number) {
  const core = halo / 2
  return {
    wrap: { width: halo, height: halo, alignItems: 'center', justifyContent: 'center' } as const,
    halo: { position: 'absolute', width: halo, height: halo, borderRadius: halo / 2 } as const,
    ring: {
      position: 'absolute',
      width: halo * 0.72,
      height: halo * 0.72,
      borderRadius: halo / 2,
    } as const,
    core: { width: core, height: core, borderRadius: core / 2 } as const,
    highlight: {
      position: 'absolute',
      top: -core * 0.22,
      left: -core * 0.16,
      width: core * 0.9,
      height: core * 0.9,
      borderRadius: core * 0.45,
      backgroundColor: 'rgba(255,255,255,0.16)',
    } as const,
  }
}

const styles = StyleSheet.create({
  core: {
    overflow: 'hidden',
    // A grounding shadow so the orb sits in space.
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
})
