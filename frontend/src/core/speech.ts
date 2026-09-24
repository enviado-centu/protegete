// Thin wrapper around the Web Speech API's SpeechSynthesis so components
// never touch `window.speechSynthesis` directly (easier to test/mock, and
// keeps the "hidden if unsupported" rule in one place).

function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null
  return window.speechSynthesis ?? null
}

export function isSpeechSupported(): boolean {
  return getSynth() !== null && typeof window.SpeechSynthesisUtterance !== 'undefined'
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return (
    voices.find((voice) => voice.lang?.toLowerCase() === 'es-ar') ??
    voices.find((voice) => voice.lang?.toLowerCase().startsWith('es'))
  )
}

/** Speaks `text` aloud, preferring an es-AR voice, then any Spanish voice. */
export function speak(text: string): void {
  const synth = getSynth()
  if (!synth || !text.trim()) return
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = pickVoice(synth.getVoices())
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  } else {
    utterance.lang = 'es-AR'
  }
  synth.speak(utterance)
}

export function stop(): void {
  getSynth()?.cancel()
}
