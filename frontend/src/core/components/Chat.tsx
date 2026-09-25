import { useEffect, useRef, useState } from 'react'
import {
  ApiUnavailableError,
  ApiValidationError,
  analyzeText,
  analyzeUrl,
  askChat,
  getLessons,
} from '../api'
import {
  ALREADY_SCAMMED_INTRO,
  ALREADY_SCAMMED_LESSON_ID,
  DANGER_RECOVERY_CHIP,
  buildReplyA,
  classifyInput,
  containsUrl,
  isAlreadyScammedTrigger,
  matchLessons,
  type InputKind,
  type Reply,
} from '../chatEngine'
import { extractText } from '../ocr'
import { decodeQrFromImage } from '../qr'
import { newId } from '../id'
import type { ChatContext, ChatHistoryTurn, Lesson, TextVerdict, UrlVerdict } from '../types'
import type { ChatMessage } from './chatMessage'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { QrScanner } from './QrScanner'

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
  /** Shows the composer's "Escanear código QR" camera button and dialog.
   * PWA only — the extension side panel can't reliably use the camera, so
   * it leaves this unset and only gets QR-from-image (see `handleImage`). */
  enableQrScan?: boolean
  /** Shows the composer's 🎤 dictation button. PWA only — the extension
   * side panel can't reliably get mic permission in an MV3 side panel, so
   * it leaves this unset (see voice-dictation task). */
  enableDictation?: boolean
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

/** True when a text verdict carries no scam evidence at all (safe level, no
 * signals/reasons/urls). A "text"-classified follow-up that lands here
 * (e.g. "decime más sobre eso" after a URL verdict) is conversational, not a
 * new thing to analyze -- see `hasNoEvidence`'s caller in `runAnalysis`. */
function hasNoEvidence(verdict: TextVerdict): boolean {
  return (
    verdict.level === 'safe' &&
    verdict.signals.length === 0 &&
    verdict.reasons.length === 0 &&
    verdict.urls.length === 0
  )
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

// Quishing = phishing delivered via a QR code (scammers paste a fake QR
// sticker over a real one on a poster, table tent or invoice). Every
// non-safe verdict that came from a scanned QR gets this extra sentence and
// the fake_qr lesson, on top of its normal reasons/lessons.
const QUISHING_WARNING =
  'Ojo: este enlace vino de un código QR. Los estafadores pegan QR falsos sobre carteles, mesas o facturas.'
const QR_NOT_FOUND_MESSAGE =
  'No encontramos un código QR en esa foto. Probá con otra imagen o pegá el link directamente.'
const QR_EMPTY_MESSAGE = 'El código QR no tenía contenido para analizar.'

// Content types a QR code can carry besides a URL or plain text: these are
// shown as a short descriptive message instead of being sent to the
// analyze pipeline (spec: no backend call needed for them).
const QR_INFO_RE = /^(wifi:|tel:|begin:vcard|mailto:|smsto:)/i

type QrContentKind = 'url' | 'info' | 'text'

function classifyQrContent(content: string): QrContentKind {
  if (QR_INFO_RE.test(content)) return 'info'
  return classifyInput(content) === 'url' ? 'url' : 'text'
}

function describeQrInfo(content: string): string {
  if (/^wifi:/i.test(content)) {
    return 'Este código QR tiene los datos de una red Wi-Fi. Fijate que sea una red que reconocés antes de conectarte.'
  }
  if (/^tel:/i.test(content)) {
    return 'Este código QR abre una llamada telefónica. Fijate que el número sea de quien dice ser antes de llamar.'
  }
  if (/^begin:vcard/i.test(content)) {
    return 'Este código QR tiene un contacto para guardar. Revisá los datos antes de agregarlo a tu agenda.'
  }
  if (/^mailto:/i.test(content)) {
    return 'Este código QR abre un correo para enviar. Fijate a quién se lo vas a mandar antes de enviarlo.'
  }
  return 'Este código QR envía un mensaje de texto. Fijate a qué número antes de enviarlo.'
}

function withFakeQrLesson(lessons: Lesson[], catalog: Lesson[]): Lesson[] {
  if (lessons.some((lesson) => lesson.id === 'fake_qr')) return lessons
  const fakeQr = catalog.find((lesson) => lesson.id === 'fake_qr')
  return fakeQr ? [...lessons, fakeQr] : lessons
}

/** Decorates a layer-A reply with the quishing warning + fake_qr lesson,
 * but only when the content came from a scanned QR AND the verdict isn't
 * safe (a safe QR needs no extra warning). */
function decorateQrReply(reply: Reply, qrOrigin: boolean | undefined, catalog: Lesson[]): Reply {
  if (!qrOrigin || reply.level === 'safe') return reply
  return {
    ...reply,
    reasons: [...reply.reasons, QUISHING_WARNING],
    lessons: withFakeQrLesson(reply.lessons, catalog),
  }
}

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
  enableQrScan = false,
  enableDictation = false,
}: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [lessonsCatalog, setLessonsCatalog] = useState<Lesson[]>([])
  const [lastContext, setLastContext] = useState<ChatContext | null>(initialContext)
  const [history, setHistory] = useState<ChatHistoryTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [busyPhase, setBusyPhase] = useState<BusyPhase>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
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

  async function runAnalysis(
    text: string,
    options?: { qrOrigin?: boolean; forceKind?: InputKind },
  ) {
    setBusyPhase('analyzing')
    const kind = options?.forceKind ?? classifyInput(text)

    if (kind === 'question') {
      await runQuestion(text)
      return
    }

    let context: ChatContext | null = lastContext

    try {
      if (kind === 'url') {
        const verdict = await analyzeUrl(text)
        const reply = decorateQrReply(buildReplyA(verdict, lessonsCatalog), options?.qrOrigin, lessonsCatalog)
        context = contextFromUrlVerdict(verdict)
        setLastContext(context)
        append({ id: newId(), role: 'assistantA', reply })
      } else {
        const verdict = await analyzeText(text)
        // A "text"-classified message with an ongoing conversation and no
        // URL of its own is ambiguous: it could be a new scam sample to
        // analyze, or a plain follow-up question the classifier's keyword
        // list didn't catch (e.g. "decime más sobre eso"). When the backend
        // finds no evidence at all, treat it as the latter: keep the
        // existing grounded context and route to layer B instead of
        // showing an empty "Parece seguro" card and losing the
        // conversation's topic.
        if (context !== null && !containsUrl(text) && hasNoEvidence(verdict)) {
          await runQuestion(text)
          return
        }
        const reply = decorateQrReply(buildReplyA(verdict, lessonsCatalog), options?.qrOrigin, lessonsCatalog)
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

  /** Appends the deterministic "already scammed" recovery guide (spec: layer
   * A, no LLM). Shown as a plain assistant bubble (intro text + the
   * `already_scammed` lesson card, always expanded -- unlike a layer-B
   * answer's lessons, which collapse under "Aprendé más"). */
  function appendAlreadyScammedGuide() {
    const lessons = lessonsCatalog.filter((lesson) => lesson.id === ALREADY_SCAMMED_LESSON_ID)
    append({ id: newId(), role: 'assistantA', text: ALREADY_SCAMMED_INTRO, lessons })
  }

  async function handleSend(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed || busy) return
    append({ id: newId(), role: 'user', text: trimmed })
    setDraft('')

    // The "already scammed" trigger (typed phrase, or the danger verdict's
    // recovery chip) takes precedence over normal URL/text analysis and
    // needs no backend call. A message that ALSO contains a URL still gets
    // the guide first, then keeps the existing analysis pipeline running for
    // that link -- simplest correct behavior, not a merged/custom reply.
    if (isAlreadyScammedTrigger(trimmed) || trimmed === DANGER_RECOVERY_CHIP) {
      appendAlreadyScammedGuide()
      if (!containsUrl(trimmed)) return
    }

    setBusy(true)
    try {
      await runAnalysis(trimmed)
    } finally {
      setBusy(false)
      setBusyPhase(null)
    }
  }

  /** Given already-decoded QR content, appends the user bubble and routes
   * it: a URL/plain-text payload goes through the normal analyze pipeline
   * (decorated with the quishing warning on a non-safe verdict); a
   * structured payload (wifi/tel/vcard/mailto/sms) gets a short descriptive
   * message instead, with no backend call. Callers own the busy state. */
  async function handleQrDecoded(content: string) {
    const trimmed = content.trim()
    if (!trimmed) {
      append({ id: newId(), role: 'system', text: QR_EMPTY_MESSAGE })
      return
    }
    append({ id: newId(), role: 'user', text: `📷 QR: ${trimmed}` })
    const kind = classifyQrContent(trimmed)
    if (kind === 'info') {
      append({ id: newId(), role: 'system', text: describeQrInfo(trimmed) })
      return
    }
    await runAnalysis(trimmed, { qrOrigin: true, forceKind: kind })
  }

  /** Called by the QrScanner dialog after a successful live camera scan. */
  async function handleQrScanResult(content: string) {
    setScannerOpen(false)
    if (busy) return
    setBusy(true)
    try {
      await handleQrDecoded(content)
    } finally {
      setBusy(false)
      setBusyPhase(null)
    }
  }

  /** Called by the QrScanner dialog's own "Subir foto del QR" fallback
   * button (distinct from the composer's general image picker below): the
   * user explicitly said this photo is of a QR, so a decode miss is
   * reported as "no QR found" rather than silently falling back to OCR. */
  async function handleQrFallbackImage(file: Blob) {
    setScannerOpen(false)
    if (busy) return
    setBusy(true)
    setBusyPhase('ocr')
    try {
      const content = await decodeQrFromImage(file)
      if (content) {
        await handleQrDecoded(content)
      } else {
        append({ id: newId(), role: 'system', text: QR_NOT_FOUND_MESSAGE })
      }
    } finally {
      setBusy(false)
      setBusyPhase(null)
    }
  }

  async function handleImage(file: Blob) {
    if (busy) return
    setBusy(true)
    setBusyPhase('ocr')
    try {
      // The composer's image picker/paste is shared by OCR and QR-from-image
      // (PWA + extension both get QR-from-image, spec §T9-4): try decoding a
      // QR first, and only fall back to OCR when the picture isn't a QR.
      const qrContent = await decodeQrFromImage(file)
      if (qrContent) {
        await handleQrDecoded(qrContent)
        return
      }

      append({ id: newId(), role: 'user', text: '🖼️ Imagen enviada' })
      let text: string
      try {
        text = await extractText(file)
      } catch (error) {
        // `?debug=1` surfaces the underlying OCR error so on-device failures
        // can be diagnosed without remote devtools.
        const debug = typeof window !== 'undefined' && window.location.search.includes('debug=1')
        const detail = debug ? ` [${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}]` : ''
        append({ id: newId(), role: 'system', text: OCR_FAILED_MESSAGE + detail })
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
        enableQrScan={enableQrScan}
        onOpenScanner={() => setScannerOpen(true)}
        enableDictation={enableDictation}
      />
      {scannerOpen && (
        <QrScanner
          onResult={handleQrScanResult}
          onClose={() => setScannerOpen(false)}
          onFallbackImage={handleQrFallbackImage}
        />
      )}
    </div>
  )
}
