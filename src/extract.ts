/**
 * Dependency-free readable-text extraction.
 *
 * Deliberately regex based: no DOM library, no jsdom. Good enough to hand a
 * model the prose of a documentation page, and honest about what it dropped.
 */

export interface ExtractOptions {
  maxChars?: number
  /** Charset taken from the Content-Type header, when present. */
  charset?: string
}

export interface ExtractedPage {
  title: string
  text: string
  /** Total characters seen before truncation. */
  totalChars: number
  truncated: boolean
  charset: string
}

const DROP_BLOCKS = /<(script|style|noscript|svg|canvas|template|nav|footer|header|aside|form|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi
const COMMENT = /<!--[\s\S]*?-->/g
const BLOCK_TAGS = /<\/?(p|div|section|article|main|li|ul|ol|h[1-6]|tr|td|th|br|table|blockquote|pre)\b[^>]*>/gi

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  ldquo: '“',
  rdquo: '”',
}

/** Decode the handful of entities that actually appear in prose. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
}

/** Sniff `<meta charset>` / `charset=` out of the first bytes of a document. */
export function sniffCharset(head: string, contentType?: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')
  if (fromHeader?.[1]) return fromHeader[1].toLowerCase()
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)
  if (fromMeta?.[1]) return fromMeta[1].toLowerCase()
  const fromEquiv = /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)
  if (fromEquiv?.[1]) return fromEquiv[1].toLowerCase()
  return 'utf-8'
}

/** Decode bytes with the given charset, falling back to UTF-8. */
export function decodeBody(bytes: Uint8Array, charset: string): string {
  const normalized = /^(gb2312|gbk|gb18030)$/i.test(charset) ? 'gb18030' : charset
  try {
    return new TextDecoder(normalized).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function pickMainRegion(html: string): string {
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)
  if (article?.[1] && article[1].trim().length > 200) return article[1]
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)
  if (main?.[1] && main[1].trim().length > 200) return main[1]
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  return body?.[1] ?? html
}

function pickTitle(html: string): string {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (title?.[1]) return decodeEntities(title[1].replace(/\s+/g, ' ').trim())
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return h1?.[1] ? decodeEntities(h1[1].replace(/<[^>]+>/g, '').trim()) : ''
}

/** Extract readable prose, truncating to `maxChars`. */
export function extractReadable(html: string, options: ExtractOptions = {}): ExtractedPage {
  const maxChars = options.maxChars ?? 6000
  const title = pickTitle(html)
  let region = pickMainRegion(html)
  region = region.replace(COMMENT, ' ').replace(DROP_BLOCKS, ' ')
  region = region.replace(BLOCK_TAGS, '\n')
  region = region.replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(region)
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const totalChars = text.length
  return {
    title,
    text: totalChars > maxChars ? text.slice(0, maxChars) : text,
    totalChars,
    truncated: totalChars > maxChars,
    charset: options.charset ?? 'utf-8',
  }
}
