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
import type { ChatContext, ChatHistoryTurn, Lesson, TextVerdict, UrlVerdict } from '../types'
import type { ChatMessage } from './chatMessage'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'

export interface ChatProps {
  initialMessages?: ChatMessage[]
  /** Notified whenever the conversation goes from empty to non-empty (or
   * back). Lets a host layout (e.g. the extension side panel) collapse a
   * top area once the chat is in use. */
  onHasMessagesChange?: (hasMessages: boolean) => void
  /** Evidence already known before the first message (e.g. the extension
   * side panel's current-tab verdict), used to ground layer-B answers to a
   * plain "¿por qué es peligroso?" with no prior analysis in this chat. */
  initialContext?: ChatContext | null
  /** Identifies which page/tab `initialContext` belongs to. Changing this
   * (e.g. the user switched tabs) resets the grounded conversation history
   * and re-seeds `lastContext` from the new `initialContext`, so an old
   * page's evidence never leaks into a new page's answers. */
  contextKey?: string
}

const MAX_HISTORY_TURNS = 6
const MAX_HISTORY_TEXT_LENGTH = 600

function truncateForHistory(text: string): string {
  return text.length > MAX_HISTORY_TEXT_LENGTH ? text.slice(0, MAX_HISTORY_TEXT_LENGTH) : text
}

function pushHistory(history: ChatHistoryTurn[], turn: ChatHistoryTurn): ChatHistoryTurn[] {
  const next = [...history, { role: turn.role, text: truncateForHistory(turn.text) }]
  return next.length > MAX_HISTORY_TURNS ? next.slice(next.length - MAX_HISTORY_TURNS) : next
}

function contextFromUrlVerdict(verdict: UrlVerdict): ChatContext {
  return {
    level: verdict.level,
    category: verdict.category,
    url: verdict.url,
    reasons: verdict.reasons,
    signals: verdict.rules.map((rule) => ({ id: rule.id, evidence: '' })),
  }
}

function contextFromTextVerdict(verdict: TextVerdict): ChatContext {
  return {
    level: verdict.level,
    category: verdict.category,
    reasons: verdict.reasons,
    signals: verdict.signals,
  }
}

type BusyPhase = 'ocr' | 'analyzing' | null

const STATUS_TEXT: Record<Exclude<BusyPhase, null>, string> = {
  ocr: 'Leyendo la imagen…',
  analyzing: 'Analizando…',
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
export function Chat({
  initialMessages = [],
  onHasMessagesChange,
  initialContext = null,
  contextKey,
}: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [lessonsCatalog, setLessonsCatalog] = useState<Lesson[]>([])
  const [lastContext, setLastContext] = useState<ChatContext | null>(initialContext)
  const [history, setHistory] = useState<ChatHistoryTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [busyPhase, setBusyPhase] = useState<BusyPhase>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // The tab/page changed (or a fresh verdict for it arrived): re-seed the
  // grounded context from the new evidence and drop the old page's short
  // conversation memory, so a stale page's evidence never grounds an answer
  // about the new one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLastContext(initialContext)
    setHistory([])
  }, [contextKey])

  // Auto-scroll to the newest message (or status bubble) so the composer
  // never covers the latest reply (spec: message list scrolls, composer
  // stays anchored).
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, busyPhase])

  useEffect(() => {
    onHasMessagesChange?.(messages.length > 0)
    // Only the transition matters to the host layout; re-running on every
    // render of an unstable callback is harmless (cheap boolean update).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length])

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

  /** A free question with no new verdict to compute: layer B (grounded in
   * whatever verdict/history is already known, e.g. the current page) runs
   * FIRST and becomes the main reply, with the matching lesson cards
   * collapsed under "Aprendé más" underneath it. Only when layer B fails or
   * times out do the lesson cards show on their own, as before. */
  async function runQuestion(text: string) {
    let answer: string | null = null
    try {
      const chatAnswer = await askChat(text, lastContext, history)
      answer = chatAnswer.answer
    } catch {
      answer = null
    }

    const lessons = matchLessons(text, lessonsCatalog, 3)
    if (answer) {
      append({ id: newId(), role: 'assistantB', text: answer, lessons })
      setHistory((prev) => pushHistory(pushHistory(prev, { role: 'user', text }), { role: 'assistant', text: answer as string }))
    } else {
      append({ id: newId(), role: 'assistantA', lessons })
    }
  }

  async function runAnalysis(text: string) {
    setBusyPhase('analyzing')
    const kind = classifyInput(text)

    if (kind === 'question') {
      await runQuestion(text)
      return
    }

    let context: ChatContext | null = lastContext

    try {
      if (kind === 'url') {
        const verdict = await analyzeUrl(text)
        const reply = buildReplyA(verdict, lessonsCatalog)
        context = contextFromUrlVerdict(verdict)
        setLastContext(context)
        append({ id: newId(), role: 'assistantA', reply })
      } else {
        const verdict = await analyzeText(text)
        const reply = buildReplyA(verdict, lessonsCatalog)
        context = contextFromTextVerdict(verdict)
        setLastContext(context)
        append({ id: newId(), role: 'assistantA', reply })
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
      const chatAnswer = await askChat(text, context, history)
      if (chatAnswer.answer) {
        const answer = chatAnswer.answer
        append({ id: newId(), role: 'assistantB', text: answer })
        setHistory((prev) => pushHistory(pushHistory(prev, { role: 'user', text }), { role: 'assistant', text: answer }))
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
      setBusyPhase(null)
    }
  }

  async function handleImage(file: Blob) {
    if (busy) return
    append({ id: newId(), role: 'user', text: '🖼️ Imagen enviada' })
    setBusy(true)
    setBusyPhase('ocr')
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
      setBusyPhase(null)
    }
  }

  const showEmptyState = messages.length === 0

  return (
    <div className="chat">
      <div className="chat__scroll thin-scroll" ref={scrollRef}>
        <div className="chat__transcript" role="log" aria-live="polite" aria-label="Conversación">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onChipSelect={handleSend} />
          ))}
          {busyPhase && (
            <p className="bubble bubble--system chat__status" role="status" aria-live="polite">
              {STATUS_TEXT[busyPhase]}
            </p>
          )}
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
