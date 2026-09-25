// Thin wrapper around the Web Speech API's SpeechRecognition so components
// never touch `window.SpeechRecognition` directly (easier to test/mock, and
// keeps the "hidden if unsupported" rule in one place). Mirrors the style of
// speech.ts (the read-aloud wrapper).

// The Web Speech recognition API isn't part of TypeScript's DOM lib, so the
// minimal shape actually used here is declared locally.
interface SpeechRecognitionErrorEvent extends Event {
  error: string
}

interface SpeechRecognitionAlternative {
  transcript: string
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike
}

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const win = window as WindowWithSpeechRecognition
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null
}

export function isDictationSupported(): boolean {
  return getRecognitionConstructor() !== null
}

export interface StartDictationOptions {
  /** Called with the recognized text every time a result arrives (interim
   * or final) -- the caller decides whether to show interim text live. */
  onText: (text: string, isFinal: boolean) => void
  /** Called once recognition has fully stopped, for any reason (explicit
   * stop, a natural end after the final result, or an error). */
  onEnd: () => void
  /** Called with a ready-to-show Spanish error message. */
  onError: (message: string) => void
}

export const DICTATION_PERMISSION_DENIED_MESSAGE =
  'No pudimos usar el micrófono. Revisá los permisos del navegador.'
export const DICTATION_NO_SPEECH_MESSAGE = 'No te escuché, probá de nuevo.'
export const DICTATION_GENERIC_ERROR_MESSAGE = 'No se pudo usar el dictado. Probá de nuevo.'

function messageForError(error: string): string {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return DICTATION_PERMISSION_DENIED_MESSAGE
  }
  if (error === 'no-speech') return DICTATION_NO_SPEECH_MESSAGE
  return DICTATION_GENERIC_ERROR_MESSAGE
}

/** Starts one dictation session (lang es-AR, interim results delivered
 * live, not continuous -- stops after the first recognized phrase) and
 * returns a `stop()` function the caller can use to end it early. */
export function startDictation({ onText, onEnd, onError }: StartDictationOptions): () => void {
  const Recognition = getRecognitionConstructor()
  if (!Recognition) {
    onError(DICTATION_GENERIC_ERROR_MESSAGE)
    return () => {}
  }

  const recognition = new Recognition()
  recognition.lang = 'es-AR'
  recognition.interimResults = true
  recognition.continuous = false

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1]
    const text = result?.[0]?.transcript ?? ''
    onText(text, Boolean(result?.isFinal))
  }
  recognition.onerror = (event) => {
    onError(messageForError(event.error))
  }
  recognition.onend = () => {
    onEnd()
  }

  recognition.start()
  return () => recognition.stop()
}
