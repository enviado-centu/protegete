// Approximate eTLD+1 ("registrable host") extractor (Feature C, used for
// cross-site password-form / meta-refresh comparisons). Deliberately not a
// full public-suffix-list implementation — just "last two labels", with a
// couple of common Argentine second-level domains recognized as a unit so
// they take the last three labels instead.

const THREE_LABEL_SUFFIXES = new Set(['com.ar', 'gob.ar'])

/**
 * Returns the approximate registrable domain for `hostname`: the last two
 * labels, or the last three when the last two form a known
 * second-level-domain suffix (`com.ar`, `gob.ar`). Case-insensitive. A
 * hostname with two or fewer labels is returned unchanged (lowercased).
 */
export function registrableHost(hostname: string): string {
  const host = hostname.toLowerCase()
  const labels = host.split('.').filter(Boolean)

  if (labels.length <= 2) return host

  const lastTwo = labels.slice(-2).join('.')
  if (THREE_LABEL_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.')
  }

  return lastTwo
}
