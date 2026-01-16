const FALLBACK_HREF = '#'

type AllowedProtocol = 'http:' | 'https:'

function hasScheme(input: string): boolean {
  // RFC3986 scheme: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(input)
}

function isProtocolRelative(input: string): boolean {
  return input.startsWith('//')
}

function isRelativeUrl(input: string): boolean {
  // Allow typical app-relative forms.
  return (
    input.startsWith('/') ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    (!hasScheme(input) && !isProtocolRelative(input))
  )
}

/**
 * Defensive URL sanitizer for link/href values.
 *
 * - Allows relative URLs as-is.
 * - Allows only http/https for absolute URLs.
 * - Rejects javascript:, data:, vbscript:, and protocol-relative URLs.
 */
export function safeExternalHref(candidate: string | null | undefined): string {
  const raw = String(candidate ?? '').trim()
  if (!raw) return FALLBACK_HREF

  // Keep anchors and relative links.
  if (raw.startsWith('#')) return raw
  if (isRelativeUrl(raw)) return raw

  // Explicitly reject protocol-relative URLs.
  if (isProtocolRelative(raw)) return FALLBACK_HREF

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return FALLBACK_HREF
  }

  const protocol = url.protocol as AllowedProtocol
  if (protocol !== 'http:' && protocol !== 'https:') return FALLBACK_HREF

  // Avoid credentials-in-URL.
  if (url.username || url.password) return FALLBACK_HREF

  return url.toString()
}

/**
 * A `react-markdown`-compatible URL transformer.
 *
 * ReactMarkdown expects a string return value; returning an empty string removes the link.
 */
export function safeMarkdownUrlTransform(url: string): string {
  const safe = safeExternalHref(url)
  return safe === FALLBACK_HREF ? '' : safe
}
