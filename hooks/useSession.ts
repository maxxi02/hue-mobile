import { useAudioRecorder } from 'expo-audio'
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  ASR_RECORDING_OPTIONS,
  createAudioSource,
  micCaptureAvailable,
  warmNativeAudio,
} from '@/lib/audioSource'
import { warmGroqConnection } from '@/lib/groq-transcribe'
import { VoicePipeline, type PipelineState } from '@/lib/pipeline'
import { useSettings } from '@/store/settings'

// React binding for the VoicePipeline. Owns ONE pipeline instance and mirrors its
// callbacks into render state. It's provided once at the app root (SessionProvider) so the
// chat thread and the full-screen voice mode share a single live session — a turn taken in
// voice mode shows up in the thread, and vice versa. Consume it with useSession().

/** One message in the conversation thread (Claude-style transcript). */
export interface Turn {
  id: string
  /** 'user' = the interviewer's question (companion) / the user's answer (interviewer mode). */
  role: 'user' | 'assistant'
  text: string
}

export interface SessionView {
  state: PipelineState
  /** The interviewer's transcribed/typed question for the current turn. */
  question: string
  /** Hue's streaming answer (cumulative). */
  answer: string
  /** The full conversation as an ordered list of turns (drives the chat thread). */
  turns: Turn[]
  error: string | null
  active: boolean
  /** True when this device captures live audio (hands-free mic) rather than typed input only. */
  micAvailable: boolean
  start: () => Promise<void>
  stop: () => Promise<void>
  /** Submit a typed question (always available, even alongside the mic). */
  ask: (text: string) => void
  clear: () => void
}

function useSessionState(): SessionView {
  const settings = useSettings((s) => s.settings)

  // One recorder for the screen's lifetime (the hook owns its native lifecycle); the mic
  // AudioSource borrows it. Uses the ASR-tuned 16 kHz mono preset (small clips = faster
  // upload to Groq, no accuracy loss) rather than HIGH_QUALITY. Metering is enabled so the
  // hands-free source can detect speech onset and trailing silence (VAD). Harmless on
  // platforms without live capture — it idles.
  const recorder = useAudioRecorder({ ...ASR_RECORDING_OPTIONS, isMeteringEnabled: true })

  const [state, setState] = useState<PipelineState>('idle')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [error, setError] = useState<string | null>(null)

  // Id of the assistant turn currently streaming. null means the next assistant delta
  // begins a fresh turn (set whenever a new user turn arrives, or at session start).
  const streamingTurnId = useRef<string | null>(null)

  const pipelineRef = useRef<VoicePipeline | null>(null)
  // Keep the latest settings in a ref so the pipeline is rebuilt with current values
  // on each start() without re-running this effect for every keystroke in Settings.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // Same pattern for the recorder so start() can read the latest without re-creating.
  const recorderRef = useRef(recorder)
  recorderRef.current = recorder

  // Tear the pipeline down if the component unmounts mid-session.
  useEffect(() => {
    return () => {
      void pipelineRef.current?.stop()
      pipelineRef.current = null
    }
  }, [])

  // Warm the slow parts of the first turn before the user's first tap — the mobile analog
  // of the desktop's preloadOnDeviceModel() call from reloadConfig(). There's no on-device
  // model to download here, so the cold costs we pay ahead of time are the first Groq TLS
  // handshake (warmGroqConnection) and the native recorder init (warmNativeAudio). Only
  // meaningful when this device actually captures live mic audio; manual/typed input needs
  // neither. Re-runs if the Groq key or audio source changes, and is skipped while a session
  // is live — the running pipeline already owns the mic and the connection. Both calls are
  // best-effort and idempotent, so a stray extra invocation is harmless.
  const groqKey = settings.groqApiKey
  const audioSourceSetting = settings.audioSource
  useEffect(() => {
    if (pipelineRef.current || !micCaptureAvailable(settingsRef.current)) return
    warmGroqConnection(groqKey)
    void warmNativeAudio(recorderRef.current)
  }, [groqKey, audioSourceSetting])

  const start = useCallback(async () => {
    if (pipelineRef.current) return
    setError(null)
    setQuestion('')
    setAnswer('')
    setTurns([])
    streamingTurnId.current = null
    const current = settingsRef.current
    const source = createAudioSource(current, recorderRef.current)
    const pipeline = new VoicePipeline(current, source, {
      onStateChange: setState,
      onUserTranscript: (text) => {
        setQuestion(text)
        setAnswer('')
        // A new user turn ends any streaming assistant turn; append and arm a fresh one.
        streamingTurnId.current = null
        setTurns((prev) => [...prev, { id: makeTurnId(), role: 'user', text }])
      },
      onAssistantText: (text) => {
        setAnswer(text)
        setTurns((prev) => upsertAssistantTurn(prev, streamingTurnId, text))
      },
      onError: setError,
    })
    pipelineRef.current = pipeline
    await pipeline.start()
  }, [])

  const stop = useCallback(async () => {
    const pipeline = pipelineRef.current
    pipelineRef.current = null
    await pipeline?.stop()
    setState('idle')
  }, [])

  const ask = useCallback((text: string) => {
    setError(null)
    pipelineRef.current?.submitManualQuestion(text)
  }, [])

  const clear = useCallback(() => {
    pipelineRef.current?.clearHistory()
    setQuestion('')
    setAnswer('')
    setTurns([])
    streamingTurnId.current = null
    setError(null)
  }, [])

  return {
    state,
    question,
    answer,
    turns,
    error,
    active: state !== 'idle',
    micAvailable: micCaptureAvailable(settings),
    start,
    stop,
    ask,
    clear,
  }
}

const SessionContext = createContext<SessionView | null>(null)

/**
 * Owns the single app-wide session and provides it to the tree. Mount once at the root so
 * the live pipeline survives tab switches and the voice modal opening/closing.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const value = useSessionState()
  return createElement(SessionContext.Provider, { value }, children)
}

/** Read the shared session. Must be used under a <SessionProvider>. */
export function useSession(): SessionView {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used within a SessionProvider')
  return value
}

let turnCounter = 0
/** Monotonic, collision-free key for a thread turn (FlatList needs a stable id). */
function makeTurnId(): string {
  turnCounter += 1
  return `t${turnCounter}`
}

/**
 * Fold a cumulative assistant delta into the thread. The streaming reply arrives as the
 * whole text each time, so we update the in-flight assistant turn in place; the first
 * delta of a reply (streamingTurnId === null) appends a new turn and remembers its id.
 */
function upsertAssistantTurn(
  prev: Turn[],
  streamingTurnId: { current: string | null },
  text: string,
): Turn[] {
  if (streamingTurnId.current === null) {
    const id = makeTurnId()
    streamingTurnId.current = id
    return [...prev, { id, role: 'assistant', text }]
  }
  const id = streamingTurnId.current
  return prev.map((turn) => (turn.id === id ? { ...turn, text } : turn))
}
