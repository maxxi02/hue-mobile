import { useRouter } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { useEffect, useRef } from 'react'
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  FadeIn,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/Button'
import { PressableScale } from '@/components/PressableScale'
import { EmptyState } from '@/components/chat/EmptyState'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { StateOrb, orbLabel } from '@/components/StateOrb'
import { motion, radius, space, type, useTheme, type Theme } from '@/constants/theme'
import { useSession } from '@/hooks/useSession'
import { isOpenAiCompatProvider, keyFieldFor } from '@/lib/openai-compat'
import type { HueSettings, LlmProvider } from '@/lib/types'
import { useSettings } from '@/store/settings'

// The home screen IS the voice feature — no separate tab or full-screen orb route. The
// top bar reads as Hue's live state (with a settings shortcut beside it); the conversation
// thread fills the middle; and a single tap-to-talk control docks at the bottom, driving
// the hands-free pipeline (listen → transcribe → reply → listen again).

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  google: 'Gemini',
  groq: 'Groq',
  mistral: 'Mistral',
  cohere: 'Cohere',
}

/** The API key the active provider needs to start a session. */
function activeProviderKey(s: HueSettings): string {
  const p = s.llmProvider
  return isOpenAiCompatProvider(p) ? (s[keyFieldFor(p)] as string) : s.anthropicApiKey
}

export default function HomeScreen() {
  const t = useTheme()
  const styles = makeStyles(t)
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  const session = useSession()
  const insets = useSafeAreaInsets()
  const providerLabel = useSettings((s) => PROVIDER_LABELS[s.settings.llmProvider])
  const hasKey = useSettings((s) => activeProviderKey(s.settings).trim().length > 0)
  const hasGroqKey = useSettings((s) => s.settings.groqApiKey.trim().length > 0)
  const mode = useSettings((s) => s.settings.hueMode)
  const scrollRef = useRef<ScrollView>(null)
  const active = session.active

  const modeLabel =
    mode === 'companion'
      ? 'Companion · answers shown as text'
      : 'Interviewer · asks you questions aloud'

  // The talk control crossfades between its inviting "start" fill and a quieter recessed
  // "end" surface as the session turns on/off. A gentle color shift only — the orb carries
  // the live motion — and it snaps for reduce-motion users.
  const activeT = useSharedValue(active ? 1 : 0)
  useEffect(() => {
    activeT.value = reduceMotion
      ? active
        ? 1
        : 0
      : withTiming(active ? 1 : 0, {
          duration: motion.duration.base,
          easing: motion.easing.standard,
        })
  }, [active, reduceMotion, activeT])

  const talkButtonStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(activeT.value, [0, 1], [t.colors.primary, t.colors.surfaceElevated]),
    borderColor: interpolateColor(activeT.value, [0, 1], [t.colors.primary, t.colors.border]),
  }))

  const toggle = () => {
    if (active) void session.stop()
    else void session.start()
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <StateOrb state={session.state} size={34} />
        <Text style={styles.headerLabel}>{orbLabel(session.state)}</Text>
        <View style={styles.headerSpacer} />
        {session.turns.length > 0 && (
          <Button
            label="Clear"
            variant="ghost"
            onPress={session.clear}
            style={styles.headerButton}
            accessibilityHint="Clears the conversation and history"
          />
        )}
        <PressableScale
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          accessibilityHint="Opens model, interview, and voice settings"
          style={styles.iconButton}>
          <SymbolView
            name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
            tintColor={t.colors.ink}
            size={24}
          />
        </PressableScale>
      </View>

      {session.turns.length === 0 ? (
        <EmptyState
          state={session.state}
          modeLabel={modeLabel}
          hasKey={hasKey}
          providerLabel={providerLabel}
        />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: !reduceMotion })}>
          {session.turns.map((turn) => (
            <MessageBubble key={turn.id} turn={turn} />
          ))}
        </ScrollView>
      )}

      {session.error && (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(t.motion.duration.fast)}
          style={styles.error}>
          <Text style={styles.errorText}>{session.error}</Text>
        </Animated.View>
      )}

      <View style={[styles.dock, { paddingBottom: insets.bottom + space.lg }]}>
        {!hasKey ? (
          <Text style={styles.hint}>Add an API key in Settings to start talking.</Text>
        ) : (
          <>
            <PressableScale
              onPress={toggle}
              accessibilityRole="button"
              accessibilityLabel={active ? 'End voice conversation' : 'Start voice conversation'}
              accessibilityHint={
                active
                  ? 'Ends the hands-free voice session'
                  : 'Starts a hands-free voice conversation; speak naturally and Hue replies'
              }
              accessibilityState={{ selected: active }}
              // PressableScale renders an Animated.Pressable, so the animated style is valid
              // at runtime; its style prop is just typed to the plain ViewStyle shape.
              style={[styles.talkButton, talkButtonStyle] as StyleProp<ViewStyle>}>
              <SymbolView
                name={
                  active
                    ? { ios: 'stop.fill', android: 'stop', web: 'stop' }
                    : { ios: 'mic.fill', android: 'mic', web: 'mic' }
                }
                tintColor={active ? t.colors.ink : t.colors.onPrimary}
                size={34}
              />
            </PressableScale>
            <Text style={styles.talkLabel}>{active ? 'Tap to end' : 'Tap to start'}</Text>
            {!hasGroqKey && !session.micAvailable ? (
              <Text style={styles.hint}>
                Voice capture needs the dev build’s mic and a Groq key — add one in Settings.
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  )
}

function makeStyles(t: Theme) {
  const c = t.colors
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerLabel: { ...type.label, color: c.inkMuted },
    headerSpacer: { flex: 1 },
    // Shrink the shared Button to a compact header control (it pads for full-width by default).
    headerButton: { paddingVertical: space.sm, paddingHorizontal: space.lg, borderRadius: radius.md },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },

    thread: { flex: 1 },
    threadContent: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },

    error: {
      marginHorizontal: space.lg,
      marginBottom: space.sm,
      padding: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      backgroundColor: c.errorBg,
      borderColor: c.errorBorder,
    },
    errorText: { ...type.caption, color: c.errorInk },

    dock: {
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.xl,
      paddingTop: space.lg,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.bg,
    },
    talkButton: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      // backgroundColor + borderColor are animated in talkButtonStyle: an inviting filled
      // "start" disc crossfades to a quiet recessed "end" surface while the session is live.
    },
    talkLabel: { ...type.label, color: c.ink },
    hint: { ...type.caption, color: c.inkFaint, textAlign: 'center' },
  })
}
