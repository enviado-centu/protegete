import type { Lesson } from '../types'

export interface LessonCardProps {
  lesson: Lesson
}

/** Icon + title + "Cómo darte cuenta" + example + "Qué hacer" (spec §4b). */
export function LessonCard({ lesson }: LessonCardProps) {
  return (
    <article className="lesson-card">
      <h3>
        <span aria-hidden="true">{lesson.icon}</span> {lesson.title}
      </h3>
      <p>
        <strong>Cómo darte cuenta:</strong> {lesson.how_to_spot}
      </p>
      <p className="lesson-card__example">
        <strong>Ejemplo:</strong> {lesson.example}
      </p>
      <p>
        <strong>Qué hacer:</strong> {lesson.what_to_do}
      </p>
    </article>
  )
}
