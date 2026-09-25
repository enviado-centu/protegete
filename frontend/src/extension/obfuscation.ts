// Heuristic detector for obfuscated inline <script> content (Feature C, page
// signal `obfuscated_js`). Pure and side-effect free: takes plain text,
// returns a boolean. Never logs or otherwise surfaces the analyzed text —
// callers must not either (see pageProbeCollect.ts).

const FROM_CHAR_CODE_RE = /String\.fromCharCode/g
const HEX_ESCAPE_RE = /\\x[0-9a-fA-F]{2}/g
// Matches a single- or double-quoted string literal with no embedded
// unescaped quote of the same kind.
const STRING_LITERAL_RE = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g
const BASE64_LIKE_RE = /^[A-Za-z0-9+/=]+$/
const HEX_LIKE_RE = /^[0-9a-fA-F]+$/
const MIN_ENCODED_LITERAL_LENGTH = 1000
const MIN_HEX_ESCAPE_COUNT = 40
const MIN_FROM_CHAR_CODE_COUNT = 3

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

function hasLongEncodedLiteral(text: string): boolean {
  let match: RegExpExecArray | null
  STRING_LITERAL_RE.lastIndex = 0
  while ((match = STRING_LITERAL_RE.exec(text))) {
    const content = match[1] ?? match[2] ?? ''
    if (
      content.length >= MIN_ENCODED_LITERAL_LENGTH &&
      (BASE64_LIKE_RE.test(content) || HEX_LIKE_RE.test(content))
    ) {
      return true
    }
  }
  return false
}

/**
 * Fires true when `scriptText` (an inline <script>'s textContent) matches
 * one of a fixed set of obfuscation heuristics: eval()+atob() together,
 * heavy String.fromCharCode use, a spam of \xNN hex escapes, document.write
 * combined with unescape, or a single very long base64/hex-looking string
 * literal. Deliberately conservative to avoid flagging ordinary dense
 * minified code (short variable names, no long encoded literals).
 */
export function scoreObfuscation(scriptText: string): boolean {
  if (scriptText.includes('eval(') && scriptText.includes('atob(')) return true
  if (countMatches(scriptText, FROM_CHAR_CODE_RE) >= MIN_FROM_CHAR_CODE_COUNT) return true
  if (countMatches(scriptText, HEX_ESCAPE_RE) >= MIN_HEX_ESCAPE_COUNT) return true
  if (scriptText.includes('document.write(') && scriptText.includes('unescape(')) return true
  if (hasLongEncodedLiteral(scriptText)) return true
  return false
}
