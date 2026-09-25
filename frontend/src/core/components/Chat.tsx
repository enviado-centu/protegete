import { useEffect, useRef, useState } from 'react'
import {
  ApiUnavailableError,
  ApiValidationError,
  analyzeText,
  analyzeUrl,
  askChat,
  getLessons,
} from '../api'
import { buildReplyA, classifyInput, matchLessons } from '../chatEngine'
import { extractText } from '../ocr'
import { newId } from '../id'
import type { ChatContext, Lesson } from '../types'
import type { ChatMessage } from './chatMessage'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'

export interface ChatProps {
  initialMessages?: ChatMessage[]
}

const EXAMPLES = [
  {
    label: 'Probar un mensaje falso',
    text: 'URGENTE: Estimado cliente, tu cuenta de Mercado Pago será SUSPENDIDA. Ingresá tu clave en http://mercadopago-reintegros.com',
  },
  {
    label: 'Probar un link sospechoso',
    text: 'bna-homebanking-verificar.xyz',
  },
  {
    label: '¿Cómo me doy cuenta de una estafa?',
    text: '¿Cómo me doy cuenta de una estafa?',
  },
]

const UNREACHABLE_MESSAGE =
  'No pude conectarme al analizador. Probá de nuevo en un momento.'
const INVALID_MESSAGE = 'Ese mensaje no lo pude leer, ¿podés reformularlo?'
const EMPTY_IMAGE_MESSAGE = 'No encontré texto en la imagen.'
const OCR_FAILED_MESSAGE = 'No pude leer la imagen. Probá con otra captura o pegá el texto.'

/**
 * The one shared teaching chat: classifies input, calls layer A
 * (deterministic backend analysis) and, in parallel, layer B (`/api/chat`,
 * additive only). Reused by both the PWA shell and the extension side panel.
 */
export function Chat({ initialMessages = [] }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [lessonsCatalog, setLessonsCatalog] = useState<Lesson[]>([])
  const [lastContext, setLastContext] = useState<ChatContext | null>(null)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the newest message so the composer never covers the
  // latest reply (spec: message list scrolls, composer stays anchored).
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages])

  useEffect(() => {
    let cancelled = false
    getLessons()
      .then((lessons) => {
        if (!cancelled) setLessonsCatalog(lessons)
      })
      .catch(() => {
        // The catalog only enriches URL replies with a matching lesson card;
        // losing it silently keeps the chat usable.
      })
    return () => {
      cancelled = true
    }
  }, [])

  function append(message: ChatMessage) {
    setMessages((prev) => [...prev, message])
  }

  async function runAnalysis(text: string) {
    const kind = classifyInput(text)
    let context: ChatContext | null = lastContext

    try {
      if (kind === 'url') {
        const verdict = await analyzeUrl(text)
        const reply = buildReplyA(verdict, lessonsCatalog)
        context = { level: verdict.level, signals: [] }
        setLastContext(context)
        append({ id: newId(), role: 'assistantA', reply })
      } else if (kind === 'text') {
        const verdict = await analyzeText(text)
        const reply = buildReplyA(verdict, lessonsCatalog)
        context = { level: verdict.level, signals: verdict.signals }
        setLastContext(context)
        append({ id: newId(), role: 'assistantA', reply })
      } else {
        const lessons = matchLessons(text, lessonsCatalog, 3)
        append({ id: newId(), role: 'assistantA', lessons })
      }
    } catch (error) {
      if (error instanceof ApiUnavailableError) {
        setDraft(text)
        append({ id: newId(), role: 'system', text: UNREACHABLE_MESSAGE })
      } else if (error instanceof ApiValidationError) {
        append({ id: newId(), role: 'system', text: INVALID_MESSAGE })
      }
      return
    }

    // Layer B, additive: runs after A resolves, never blocks or errors the
    // conversation (spec §5 — timeout/error means A stands alone).
    try {
      const chatAnswer = await askChat(text, context)
      if (chatAnswer.answer) {
        append({ id: newId(), role: 'assistantB', text: chatAnswer.answer })
      }
    } catch {
      // silent by design
    }
  }

  async function handleSend(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed || busy) return
    append({ id: newId(), role: 'user', text: trimmed })
    setDraft('')
    setBusy(true)
    try {
      await runAnalysis(trimmed)
    } finally {
      setBusy(false)
    }
  }

  async function handleImage(file: Blob) {
    if (busy) return
    append({ id: newId(), role: 'user', text: '🖼️ Imagen enviada' })
    setBusy(true)
    try {
      let text: string
      try {
        text = await extractText(file)
      } catch {
        append({ id: newId(), role: 'system', text: OCR_FAILED_MESSAGE })
        return
      }
      if (!text) {
        append({ id: newId(), role: 'system', text: EMPTY_IMAGE_MESSAGE })
        return
      }
      await runAnalysis(text)
    } finally {
      setBusy(false)
    }
  }

  const showEmptyState = messages.length === 0

  return (
    <div className="chat">
      <div className="chat__scroll" ref={scrollRef}>
        <div className="chat__transcript" role="log" aria-live="polite" aria-label="Conversación">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onChipSelect={handleSend} />
          ))}
        </div>
        {showEmptyState && (
          <div className="chat__empty">
            <p>Pegá un link, un mensaje sospechoso o probá un ejemplo:</p>
            <div className="chat__examples">
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  className="example-btn"
                  onClick={() => handleSend(example.text)}
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        onImage={handleImage}
        disabled={busy}
      />
    </div>
  )
}
