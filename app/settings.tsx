import { VoiceQuality, type Voice } from 'expo-speech'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { PressableScale } from '@/components/PressableScale'
import { motion, radius, space, type, useTheme } from '@/constants/theme'
import {
  fetchOpenAiModels,
  isOpenAiCompatProvider,
  keyFieldFor,
  modelFieldFor,
} from '@/lib/openai-compat'
import { pickAndParseResume } from '@/lib/resume'
import { listSpeechVoices } from '@/lib/tts'
import type { HueMode, HueSettings, InterviewMode, LlmProvider, MicSensitivity } from '@/lib/types'
import {
  hasOverlayPermission,
  hideBubble,
  requestOverlayPermission,
  showBubble,
} from '@/modules/overlay-bubble'
import { useSettings } from '@/store/settings'

/** Speech-rate presets for the voice control. The middle value matches the default. */
const SPEED_OPTIONS: { value: number; label: string }[] = [
  { value: 0.85, label: 'Slower' },
  { value: 1.05, label: 'Normal' },
  { value: 1.25, label: 'Faster' },
]

/** Display names for the provider chips. */
const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: 'Claude',
  google: 'Gemini',
  groq: 'Groq',
  mistral: 'Mistral',
  cohere: 'Cohere',
}

const PROVIDER_ORDER: LlmProvider[] = ['anthropic', 'google', 'groq', 'mistral', 'cohere']

/** Per-preset guidance for the mic sensitivity control (mirrors MicSensitivity in types.ts). */
const MIC_SENSITIVITY_HINTS: Record<MicSensitivity, string> = {
  low: 'Ignores more background and non-speech noise — best in a noisy room. May miss very soft speech.',
  balanced: 'The default. Good for most rooms.',
  high: 'Picks up quiet or soft speech, but is more likely to react to background noise.',
}

export default function SettingsScreen() {
  const t = useTheme()
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Section title="Model">
          <Label text="Provider" />
          <Chips<LlmProvider>
            value={settings.llmProvider}
            options={PROVIDER_ORDER.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }))}
            onChange={(v) => update({ llmProvider: v })}
          />
          <ProviderConfig settings={settings} update={update} />
        </Section>

        <Section title="Interview">
          <Label text="Hue's role" />
          <Segmented<HueMode>
            value={settings.hueMode}
            options={[
              { value: 'companion', label: 'Companion' },
              { value: 'interviewer', label: 'Interviewer' },
            ]}
            onChange={(v) => update({ hueMode: v })}
          />
          <Hint>
            {settings.hueMode === 'companion'
              ? 'Drafts an answer to the interviewer’s question, shown as text.'
              : 'Runs a mock interview, asking you one question at a time.'}
          </Hint>

          <Label text="Answer style" />
          <Segmented<InterviewMode>
            value={settings.interviewMode}
            options={[
              { value: 'practice', label: 'Practice' },
              { value: 'star', label: 'STAR' },
              { value: 'live', label: 'Live' },
            ]}
            onChange={(v) => update({ interviewMode: v })}
          />

          <Field
            label="Job title"
            value={settings.jobTitle}
            onChangeText={(t2) => update({ jobTitle: t2 })}
            placeholder="e.g. Senior Backend Engineer"
          />
          <ResumeUpload settings={settings} update={update} />
          <Field
            label="Resume summary"
            value={settings.resumeSummary}
            onChangeText={(t2) => update({ resumeSummary: t2 })}
            placeholder="A few lines about your background — Hue grounds answers in this. Upload a file above, or write it yourself."
            multiline
          />
          <Field
            label="Additional context"
            value={settings.additionalContext}
            onChangeText={(t2) => update({ additionalContext: t2 })}
            placeholder="Anything not on the resume — your target company, goals, projects, framing you want Hue to lean on."
            multiline
            hint="Treated as true, just like the resume. Hue draws on it but never invents around it."
          />
        </Section>

        <Section title="Voice">
          <Hint>
            Hue speaks its questions aloud in Interviewer mode (using your device’s speech engine).
            Companion answers stay silent so they’re never overheard.
          </Hint>

          <Label text="Speaking speed" />
          <SpeedControl value={settings.ttsSpeed} onChange={(v) => update({ ttsSpeed: v })} />

          <VoicePicker voice={settings.ttsVoice} onSelect={(v) => update({ ttsVoice: v })} />
        </Section>

        <Section title="Speech input">
          <Hint>
            On an Android dev build, tap once on the home screen to start a hands-free
            conversation — speak naturally and Hue listens, replies, and keeps listening.
            Speech is transcribed by Groq’s hosted Whisper. System/call-audio capture comes in a
            later phase.
          </Hint>
          <Field
            label="Groq API key (speech-to-text)"
            value={settings.groqApiKey}
            onChangeText={(t2) => update({ groqApiKey: t2 })}
            placeholder="gsk_…"
            secureTextEntry
            autoCapitalize="none"
            hint="Stored encrypted on-device. Same key as the Groq LLM provider. Audio is sent only to Groq."
          />
          <Field
            label="Whisper model"
            value={settings.groqAsrModel}
            onChangeText={(t2) => update({ groqAsrModel: t2 })}
            placeholder="whisper-large-v3-turbo"
            autoCapitalize="none"
            hint="Empty = whisper-large-v3-turbo (fastest). Other options: whisper-large-v3, distil-whisper-large-v3-en."
          />
          <Label text="Microphone sensitivity" />
          <Segmented<MicSensitivity>
            value={settings.micSensitivity}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'high', label: 'High' },
            ]}
            onChange={(v) => update({ micSensitivity: v })}
          />
          <Hint>{MIC_SENSITIVITY_HINTS[settings.micSensitivity]}</Hint>

          <Field
            label="Deepgram API key (alternative ASR, later phase)"
            value={settings.deepgramApiKey}
            onChangeText={(t2) => update({ deepgramApiKey: t2 })}
            placeholder="Optional — not used yet"
            secureTextEntry
            autoCapitalize="none"
          />
        </Section>

        {Platform.OS === 'android' && (
          <Section title="Floating bubble">
            <Hint>
              A draggable chat-head that floats over other apps. Tap it during a call to jump
              straight into Hue’s voice mode. Needs the “draw over other apps” permission.
            </Hint>
            <BubbleControl settings={settings} update={update} />
          </Section>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme()
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: t.colors.inkMuted }]}>{title.toUpperCase()}</Text>
      <View style={[styles.sectionCard, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {children}
      </View>
    </View>
  )
}

function Label({ text }: { text: string }) {
  const t = useTheme()
  return <Text style={[styles.label, { color: t.colors.ink }]}>{text}</Text>
}

function Hint({ children }: { children: React.ReactNode }) {
  const t = useTheme()
  return <Text style={[styles.hint, { color: t.colors.inkMuted }]}>{children}</Text>
}

function Field({
  label,
  hint,
  multiline,
  ...input
}: {
  label: string
  hint?: string
  multiline?: boolean
} & React.ComponentProps<typeof TextInput>) {
  const t = useTheme()
  return (
    <View style={styles.field}>
      <Label text={label} />
      <TextInput
        {...input}
        multiline={multiline}
        placeholderTextColor={t.colors.inkMuted}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { color: t.colors.ink, backgroundColor: t.colors.surfaceElevated, borderColor: t.colors.border },
        ]}
      />
      {hint ? <Hint>{hint}</Hint> : null}
    </View>
  )
}

/**
 * "Upload resume" control. Picks a PDF/DOCX/TXT and turns it into a cleaned summary via the
 * configured LLM (DOCX/TXT extracted on-device, PDF read natively by the LLM — see
 * lib/resume.ts), writing the result into the Resume summary field below. Shows progress,
 * the result, or a friendly error.
 */
function ResumeUpload({
  settings,
  update,
}: {
  settings: HueSettings
  update: (patch: Partial<HueSettings>) => Promise<void>
}) {
  const t = useTheme()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function onUpload() {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const result = await pickAndParseResume(settings)
      if (!result) return // user cancelled the picker
      await update({ resumeSummary: result.summary })
      // A light nudge to verify — the LLM read is accurate but not infallible, so let the
      // user catch anything off before it feeds answers.
      const verifyNote = ' Give it a quick read and fix anything off below.'
      setStatus(
        result.raw
          ? `Loaded “${result.fileName}” as raw text — couldn’t run the cleanup pass (check your API key). Edit it below.${verifyNote}`
          : `Loaded and summarized “${result.fileName}”. Review it below.${verifyNote}`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.field}>
      <Label text="Resume file" />
      <PressableScale
        onPress={onUpload}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Upload resume"
        style={[styles.outlineBtn, { borderColor: t.colors.border, backgroundColor: t.colors.surfaceElevated }]}>
        {busy ? (
          <ActivityIndicator size="small" color={t.colors.accent} />
        ) : (
          <Text style={[styles.outlineBtnText, { color: t.colors.ink }]}>
            Upload resume (PDF, DOCX, TXT)
          </Text>
        )}
      </PressableScale>
      {status ? <Text style={[styles.hint, { color: t.colors.accent }]}>{status}</Text> : null}
      {error ? <Text style={[styles.hint, { color: t.colors.danger }]}>{error}</Text> : null}
      <Hint>
        Read on your device and summarized with your LLM — the file itself never leaves the phone.
      </Hint>
    </View>
  )
}

/**
 * The floating-bubble toggle. Flipping it on checks (and, if needed, requests) the overlay
 * permission, then starts the native foreground service that renders the bubble; flipping it
 * off stops the service. Android-only — gated by the caller.
 */
function BubbleControl({
  settings,
  update,
}: {
  settings: HueSettings
  update: (patch: Partial<HueSettings>) => Promise<void>
}) {
  const t = useTheme()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function toggle(next: boolean) {
    setBusy(true)
    setNote('')
    try {
      if (next) {
        const granted = hasOverlayPermission() || (await requestOverlayPermission())
        if (!granted) {
          setNote('Permission to draw over other apps is needed to show the bubble.')
          return
        }
        await showBubble()
        await update({ bubbleEnabled: true })
      } else {
        await hideBubble()
        await update({ bubbleEnabled: false })
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not update the floating bubble.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.field}>
      <View style={styles.inlineRow}>
        <Text style={[styles.inlineCurrent, { color: t.colors.ink }]}>Show floating bubble</Text>
        <Switch
          value={settings.bubbleEnabled}
          onValueChange={toggle}
          disabled={busy}
          trackColor={{ false: t.colors.border, true: t.colors.accent }}
          thumbColor={t.colors.surface}
          accessibilityLabel="Show floating bubble"
        />
      </View>
      {note ? <Text style={[styles.hint, { color: t.colors.danger }]}>{note}</Text> : null}
    </View>
  )
}

/** A segmented control whose selection indicator slides between options. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const t = useTheme()
  const reduceMotion = useReducedMotion()
  const [trackW, setTrackW] = useState(0)
  const n = options.length
  const pad = 3
  const segW = trackW > 0 ? (trackW - pad * 2) / n : 0
  const activeIndex = Math.max(0, options.findIndex((o) => o.value === value))
  const x = useSharedValue(0)

  useEffect(() => {
    const target = pad + segW * activeIndex
    x.value = reduceMotion
      ? target
      : withTiming(target, { duration: motion.duration.base, easing: motion.easing.out })
  }, [activeIndex, segW, reduceMotion, x])

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: segW,
  }))

  return (
    <View
      style={[styles.segmented, { backgroundColor: t.colors.bg, borderColor: t.colors.border }]}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
      {trackW > 0 && (
        <Animated.View
          style={[
            styles.segIndicator,
            { backgroundColor: t.colors.surfaceElevated, borderColor: t.colors.borderStrong },
            indicatorStyle,
          ]}
          pointerEvents="none"
        />
      )}
      {options.map((o) => {
        const active = o.value === value
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={styles.segment}>
            <Text
              style={[styles.segmentText, { color: active ? t.colors.ink : t.colors.inkMuted }]}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Wrapping pill selector — lays out across rows, for the 5 providers. */
function Chips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const t = useTheme()
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <PressableScale
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              {
                borderColor: active ? t.colors.accent : t.colors.border,
                backgroundColor: active ? t.colors.accentSoft : 'transparent',
              },
            ]}>
            <Text style={[styles.chipText, { color: active ? t.colors.ink : t.colors.inkMuted }]}>
              {o.label}
            </Text>
          </PressableScale>
        )
      })}
    </View>
  )
}

/**
 * The API-key + model controls for whichever provider is selected. Anthropic gets a
 * free-text model field (no public /models listing in this BYO setup); the four
 * OpenAI-compatible providers get a "Detect models" button + picker.
 */
function ProviderConfig({
  settings,
  update,
}: {
  settings: HueSettings
  update: (patch: Partial<HueSettings>) => Promise<void>
}) {
  const provider = settings.llmProvider

  if (provider === 'anthropic') {
    return (
      <>
        <Field
          label="Anthropic API key"
          value={settings.anthropicApiKey}
          onChangeText={(t2) => update({ anthropicApiKey: t2 })}
          placeholder="sk-ant-…"
          secureTextEntry
          autoCapitalize="none"
          hint="Stored encrypted on-device (Android Keystore). Never sent anywhere but Anthropic."
        />
        <Field
          label="Model"
          value={settings.model}
          onChangeText={(t2) => update({ model: t2 })}
          placeholder="claude-opus-4-8"
          autoCapitalize="none"
        />
      </>
    )
  }

  // OpenAI-compatible providers (Google / Groq / Mistral / Cohere).
  const keyField = keyFieldFor(provider)
  const modelField = modelFieldFor(provider)
  const apiKey = settings[keyField] as string
  const model = settings[modelField] as string

  return (
    <>
      <Field
        label={`${PROVIDER_LABELS[provider]} API key`}
        value={apiKey}
        onChangeText={(t2) => update({ [keyField]: t2 } as Partial<HueSettings>)}
        placeholder="Paste your API key"
        secureTextEntry
        autoCapitalize="none"
        hint={
          provider === 'groq'
            ? 'Stored encrypted on-device. Reused for Groq cloud ASR. Never sent anywhere but Groq.'
            : `Stored encrypted on-device (Android Keystore). Never sent anywhere but ${PROVIDER_LABELS[provider]}.`
        }
      />
      <ModelPicker
        provider={provider}
        apiKey={apiKey}
        model={model}
        onSelect={(m) => update({ [modelField]: m } as Partial<HueSettings>)}
      />
    </>
  )
}

/** "Detect models" button that lists the provider's models and lets the user pick one. */
function ModelPicker({
  provider,
  apiKey,
  model,
  onSelect,
}: {
  provider: LlmProvider
  apiKey: string
  model: string
  onSelect: (model: string) => void
}) {
  const t = useTheme()
  const [models, setModels] = useState<string[]>([])
  const [detecting, setDetecting] = useState(false)
  const [note, setNote] = useState('')

  async function detect() {
    if (!isOpenAiCompatProvider(provider)) return
    if (!apiKey.trim()) {
      setNote('Enter your API key first.')
      return
    }
    setDetecting(true)
    setNote('')
    const found = await fetchOpenAiModels(provider, apiKey)
    setModels(found)
    setNote(found.length === 0 ? 'No models found — check your API key and try again.' : '')
    setDetecting(false)
  }

  return (
    <View style={styles.field}>
      <Label text="Model" />
      <View style={styles.inlineRow}>
        <Text style={[styles.inlineCurrent, { color: t.colors.ink }]} numberOfLines={1}>
          {model || 'Auto — first available'}
        </Text>
        <PressableScale
          onPress={detect}
          disabled={detecting}
          accessibilityRole="button"
          accessibilityLabel="Detect models"
          style={[styles.inlineBtn, { borderColor: t.colors.border, backgroundColor: t.colors.surfaceElevated }]}>
          {detecting ? (
            <ActivityIndicator size="small" color={t.colors.accent} />
          ) : (
            <Text style={[styles.inlineBtnText, { color: t.colors.ink }]}>Detect models</Text>
          )}
        </PressableScale>
      </View>

      {models.length > 0 ? (
        <View style={[styles.pickerList, { borderColor: t.colors.border }]}>
          <PickerRow label="Auto — first available" selected={model === ''} onPress={() => onSelect('')} />
          {models.map((m) => (
            <PickerRow key={m} label={m} selected={m === model} onPress={() => onSelect(m)} />
          ))}
        </View>
      ) : null}

      <Hint>{note || 'Empty = use the provider’s first available model.'}</Hint>
    </View>
  )
}

function PickerRow({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  const t = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.pickerItem,
        pressed && { backgroundColor: t.colors.surfaceElevated },
      ]}>
      <Text style={[styles.pickerItemText, { color: t.colors.ink }]} numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Text style={[styles.pickerCheck, { color: t.colors.accent }]}>✓</Text> : null}
    </Pressable>
  )
}

/** Speed preset selector. Highlights the preset nearest the stored numeric rate. */
function SpeedControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const nearest = SPEED_OPTIONS.reduce((best, o) =>
    Math.abs(o.value - value) < Math.abs(best.value - value) ? o : best,
  )
  return (
    <Segmented
      value={nearest.label}
      options={SPEED_OPTIONS.map((o) => ({ value: o.label, label: o.label }))}
      onChange={(label) => {
        const opt = SPEED_OPTIONS.find((o) => o.label === label)
        if (opt) onChange(opt.value)
      }}
    />
  )
}

/** "Detect voices" button that lists the device's English voices and lets the user pick one. */
function VoicePicker({ voice, onSelect }: { voice: string; onSelect: (identifier: string) => void }) {
  const t = useTheme()
  const [voices, setVoices] = useState<Voice[]>([])
  const [detecting, setDetecting] = useState(false)
  const [note, setNote] = useState('')

  async function detect() {
    setDetecting(true)
    setNote('')
    try {
      const found = await listSpeechVoices()
      setVoices(found)
      setNote(found.length === 0 ? 'No voices reported by this device.' : '')
    } catch {
      setNote('Could not load voices on this device.')
    } finally {
      setDetecting(false)
    }
  }

  const current = voices.find((v) => v.identifier === voice)

  return (
    <View style={styles.field}>
      <Label text="Voice" />
      <View style={styles.inlineRow}>
        <Text style={[styles.inlineCurrent, { color: t.colors.ink }]} numberOfLines={1}>
          {current ? voiceLabel(current) : voice ? voice : 'Default — system voice'}
        </Text>
        <PressableScale
          onPress={detect}
          disabled={detecting}
          accessibilityRole="button"
          accessibilityLabel="Detect voices"
          style={[styles.inlineBtn, { borderColor: t.colors.border, backgroundColor: t.colors.surfaceElevated }]}>
          {detecting ? (
            <ActivityIndicator size="small" color={t.colors.accent} />
          ) : (
            <Text style={[styles.inlineBtnText, { color: t.colors.ink }]}>Detect voices</Text>
          )}
        </PressableScale>
      </View>

      {voices.length > 0 ? (
        <View style={[styles.pickerList, { borderColor: t.colors.border }]}>
          <PickerRow label="Default — system voice" selected={voice === ''} onPress={() => onSelect('')} />
          {voices.map((v) => (
            <PickerRow
              key={v.identifier}
              label={voiceLabel(v)}
              selected={v.identifier === voice}
              onPress={() => onSelect(v.identifier)}
            />
          ))}
        </View>
      ) : null}

      <Hint>{note || 'Empty = your device’s default voice.'}</Hint>
    </View>
  )
}

/** A voice's display name, tagged when it's an enhanced/high-quality voice. */
function voiceLabel(v: Voice): string {
  const enhanced = v.quality === VoiceQuality.Enhanced
  return `${v.name} (${v.language})${enhanced ? ' · Enhanced' : ''}`
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.xxl, paddingBottom: space.xxxl + space.lg },
  section: { gap: space.sm },
  sectionTitle: { ...type.overline, marginLeft: space.xs },
  sectionCard: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.lg },
  field: { gap: space.sm },
  label: { ...type.label },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    ...type.body,
  },
  inputMultiline: { minHeight: 92, textAlignVertical: 'top' },
  hint: { ...type.caption, fontSize: 12, lineHeight: 17 },

  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 3,
    position: 'relative',
  },
  segIndicator: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  segment: { flex: 1, paddingVertical: space.md, alignItems: 'center', zIndex: 1 },
  segmentText: { ...type.label },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderWidth: 1, borderRadius: radius.pill },
  chipText: { ...type.label },

  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  inlineCurrent: { flex: 1, ...type.body },
  inlineBtn: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    minWidth: 112,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineBtnText: { ...type.label },
  outlineBtn: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: { ...type.label },

  pickerList: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  pickerItemText: { flex: 1, ...type.body, fontSize: 14 },
  pickerCheck: { fontSize: 16, fontWeight: '700', marginLeft: space.sm },
})
