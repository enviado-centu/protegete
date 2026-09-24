import type { Lesson } from '../types'
import type { Reply } from '../chatEngine'

export type ChatRole = 'user' | 'assistantA' | 'assistantB' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  /** Plain text content (user messages, system notices, layer B answers). */
  text?: string
  /** Layer A verdict reply (URL/text analysis). */
  reply?: Reply
  /** Layer A lesson-only reply (free question with no verdict attached). */
  lessons?: Lesson[]
}
