let counter = 0

/** Generates a unique-enough id for chat messages (no crypto needed). */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  counter += 1
  return `id-${counter}-${Date.now()}`
}
