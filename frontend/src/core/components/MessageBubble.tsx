import { useState } from 'react'
import type { ChatMessage } from './chatMessage'
import { VerdictCard } from './VerdictCard'
import { LessonCard } from './LessonCard'
import { QuickChips } from './QuickChips'
import { isSpeechSupported, speak } from '../speech'

export interface MessageBubbleProps {
  message: ChatMessage
  onChipSelect: (chip: string) => void
}

function spokenTextFor(message: ChatMessage): string {
  if (message.reply) {
    const { word, summary, reasons, lessons } = message.reply
    const lessonText = lessons.map((lesson) => `${lesson.title}. ${lesson.what_to_do}`).join(' ')
    return [word, summary, ...reasons, lessonText].filter(Boolean).join('. ')
  }
  if (message.lessons) {
    const lessonText = message.lessons
      .map((lesson) => `${lesson.title}. ${lesson.how_to_spot}. ${lesson.what_to_do}`)
      .join(' ')
    // A lessons-only bubble can also carry intro text (e.g. the already-
    // scammed guide's "Tranqui, actuemos rápido…" sentence) -- read it
    // first so 🔊 Escuchar covers the full bubble, not just the lessons.
    return [message.text, lessonText].filter(Boolean).join('. ')
  }
  return message.text ?? ''
}

const TEST_ID: Partial<Record<ChatMessage['role'], string>> = {
  assistantB: 'assistant-b',
}

/** One chat bubble: user text, layer A verdict/lessons, layer B answer, or a
 * system notice (e.g. backend unreachable). Every assistant bubble gets an
 * optional 🔊 Escuchar button (hidden when Web Speech isn't supported). */
export function MessageBubble({ message, onChipSelect }: MessageBubbleProps) {
  const [speaking, setSpeaking] = useState(false)
  const isAssistant = message.role === 'assistantA' || message.role === 'assistantB'

  function handleSpeak() {
    const text = spokenTextFor(message)
    if (!text) return
    speak(text)
    setSpeaking(true)
    window.setTimeout(() => setSpeaking(false), 300)
  }

  return (
    <div className={`bubble bubble--${message.role}`} data-testid={TEST_ID[message.role]}>
      {message.text && <p className="bubble__text">{message.text}</p>}
      {message.reply && (
        <>
          <VerdictCard
            level={message.reply.level}
            word={message.reply.word}
            icon={message.reply.icon}
            summary={message.reply.summary}
            reasons={message.reply.reasons}
          />
          {message.reply.lessons.map((lesson) => (
            <LessonCard key={lesson.id} lesson={lesson} />
          ))}
          <QuickChips chips={message.reply.chips} onSelect={onChipSelect} />
        </>
      )}
      {message.lessons && message.lessons.length > 0 && message.role === 'assistantB' && (
        <details className="bubble__more-lessons">
          <summary>Aprendé más</summary>
          {message.lessons.map((lesson) => (
            <LessonCard key={lesson.id} lesson={lesson} />
          ))}
        </details>
      )}
      {message.lessons && message.lessons.length > 0 && message.role !== 'assistantB' &&
        message.lessons.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} />)}
      {message.chips && <QuickChips chips={message.chips} onSelect={onChipSelect} />}
      {isAssistant && isSpeechSupported() && (
        <button
          type="button"
          className="bubble__listen"
          onClick={handleSpeak}
          aria-pressed={speaking}
        >
          <span aria-hidden="true">🔊</span> Escuchar
        </button>
      )}
    </div>
  )
}
