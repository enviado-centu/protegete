import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  DICTATION_GENERIC_ERROR_MESSAGE,
  DICTATION_NO_SPEECH_MESSAGE,
  DICTATION_PERMISSION_DENIED_MESSAGE,
  isDictationSupported,
  startDictation,
} from './dictation'

/** A minimal fake SpeechRecognition: records the configured options and
 * lets a test fire onresult/onerror/onend manually, the same shape the
 * dictation.ts wrapper depends on. */
function fakeRecognition() {
  return {
    lang: '',
    interimResults: false,
    continuous: true,
    start: vi.fn(),
    stop: vi.fn(),
    onresult: null as ((event: unknown) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    onend: null as (() => void) | null,
  }
}

function installFakeRecognition() {
  const instance = fakeRecognition()
  const Ctor = vi.fn(() => instance)
  ;(window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = Ctor
  return instance
}

function resultEvent(transcript: string, isFinal: boolean) {
  return { results: [{ 0: { transcript }, isFinal, length: 1 }] }
}

describe('dictation', () => {
  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  })

  test('isDictationSupported is false when neither constructor exists', () => {
    expect(isDictationSupported()).toBe(false)
  })

  test('isDictationSupported is true when SpeechRecognition exists', () => {
    installFakeRecognition()
    expect(isDictationSupported()).toBe(true)
  })

  test('isDictationSupported is true when only webkitSpeechRecognition exists', () => {
    const instance = fakeRecognition()
    ;(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = vi.fn(
      () => instance,
    )
    expect(isDictationSupported()).toBe(true)
  })

  test('startDictation configures es-AR, interim results, and non-continuous, then starts', () => {
    const instance = installFakeRecognition()
    startDictation({ onText: vi.fn(), onEnd: vi.fn(), onError: vi.fn() })

    expect(instance.lang).toBe('es-AR')
    expect(instance.interimResults).toBe(true)
    expect(instance.continuous).toBe(false)
    expect(instance.start).toHaveBeenCalled()
  })

  test('onresult forwards the latest transcript and isFinal flag', () => {
    const instance = installFakeRecognition()
    const onText = vi.fn()
    startDictation({ onText, onEnd: vi.fn(), onError: vi.fn() })

    instance.onresult?.(resultEvent('hola como', false))
    expect(onText).toHaveBeenCalledWith('hola como', false)

    instance.onresult?.(resultEvent('hola como estas', true))
    expect(onText).toHaveBeenCalledWith('hola como estas', true)
  })

  test('stop() calls recognition.stop()', () => {
    const instance = installFakeRecognition()
    const stopDictation = startDictation({ onText: vi.fn(), onEnd: vi.fn(), onError: vi.fn() })

    stopDictation()
    expect(instance.stop).toHaveBeenCalled()
  })

  test('onend forwards to the caller', () => {
    const instance = installFakeRecognition()
    const onEnd = vi.fn()
    startDictation({ onText: vi.fn(), onEnd, onError: vi.fn() })

    instance.onend?.()
    expect(onEnd).toHaveBeenCalled()
  })

  test('maps not-allowed and service-not-allowed to the permission message', () => {
    const instance = installFakeRecognition()
    const onError = vi.fn()
    startDictation({ onText: vi.fn(), onEnd: vi.fn(), onError })

    instance.onerror?.({ error: 'not-allowed' })
    expect(onError).toHaveBeenCalledWith(DICTATION_PERMISSION_DENIED_MESSAGE)

    instance.onerror?.({ error: 'service-not-allowed' })
    expect(onError).toHaveBeenCalledWith(DICTATION_PERMISSION_DENIED_MESSAGE)
  })

  test('maps no-speech to the "No te escuché" message', () => {
    const instance = installFakeRecognition()
    const onError = vi.fn()
    startDictation({ onText: vi.fn(), onEnd: vi.fn(), onError })

    instance.onerror?.({ error: 'no-speech' })
    expect(onError).toHaveBeenCalledWith(DICTATION_NO_SPEECH_MESSAGE)
  })

  test('maps any other error to the generic message', () => {
    const instance = installFakeRecognition()
    const onError = vi.fn()
    startDictation({ onText: vi.fn(), onEnd: vi.fn(), onError })

    instance.onerror?.({ error: 'network' })
    expect(onError).toHaveBeenCalledWith(DICTATION_GENERIC_ERROR_MESSAGE)
  })

  test('reports the generic error and returns a no-op stop when unsupported', () => {
    const onError = vi.fn()
    const stopDictation = startDictation({ onText: vi.fn(), onEnd: vi.fn(), onError })

    expect(onError).toHaveBeenCalledWith(DICTATION_GENERIC_ERROR_MESSAGE)
    expect(() => stopDictation()).not.toThrow()
  })
})
