export const PAYLOAD_PREVIEW_THRESHOLD_BYTES = 1024

export type PayloadContentType = 'empty' | 'json' | 'html' | 'xml' | 'text' | 'base64'

export type PayloadEncoding = 'plain' | 'base64'

export type PayloadHeaders = Record<string, string | undefined> | null | undefined

export interface PayloadFormatInput {
  body?: string | null
  headers?: PayloadHeaders
  mimeType?: string | null
  encoding?: PayloadEncoding | null
}

export interface PayloadFormatResult {
  kind: PayloadContentType
  formatted: string | undefined
  decoded: boolean
  decodedKind?: Exclude<PayloadContentType, 'empty' | 'base64'>
}

export interface PayloadContentSelectionInput {
  preview?: string
  full?: string
  expanded: boolean
}

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

export function detectPayloadContentType(input: PayloadFormatInput): PayloadContentType {
  const body = normalizeBody(input.body)
  if (!body) {
    return 'empty'
  }

  if (input.encoding === 'base64') {
    return 'base64'
  }

  const contentType = getContentType(input)

  if (contentType.includes('json')) {
    return 'json'
  }

  if (contentType.includes('html')) {
    return 'html'
  }

  if (contentType.includes('xml') || contentType.includes('svg')) {
    return 'xml'
  }

  if (isExplicitTextContentType(contentType)) {
    return 'text'
  }

  if (looksLikeJson(body)) {
    return 'json'
  }

  if (looksLikeHtml(body)) {
    return 'html'
  }

  if (looksLikeXml(body)) {
    return 'xml'
  }

  if (looksLikeBase64(body)) {
    return 'base64'
  }

  return 'text'
}

export function detectRequestPayloadType(input: PayloadFormatInput) {
  return detectPayloadContentType(input)
}

export function detectResponsePayloadType(input: PayloadFormatInput) {
  return detectPayloadContentType(input)
}

export function formatPayload(input: PayloadFormatInput): PayloadFormatResult {
  const body = input.body ?? undefined
  const kind = detectPayloadContentType(input)

  if (!body || kind === 'empty') {
    return {
      kind,
      formatted: undefined,
      decoded: false,
    }
  }

  if (kind === 'base64') {
    const decodedText = decodeBase64ToText(body)
    if (decodedText && isProbablyText(decodedText)) {
      const decodedKind = detectPayloadContentType({
        ...input,
        body: decodedText,
        encoding: 'plain',
      })
      const safeDecodedKind = decodedKind === 'empty' || decodedKind === 'base64' ? 'text' : decodedKind

      return {
        kind,
        formatted: formatByKind(safeDecodedKind, decodedText),
        decoded: true,
        decodedKind: safeDecodedKind,
      }
    }

    return {
      kind,
      formatted: wrapBase64Lines(body),
      decoded: false,
    }
  }

  return {
    kind,
    formatted: formatByKind(kind, body),
    decoded: false,
  }
}

export function formatRequestPayload(input: PayloadFormatInput) {
  return formatPayload(input)
}

export function formatResponsePayload(input: PayloadFormatInput) {
  return formatPayload(input)
}

export function isPayloadOverPreviewThreshold(
  content?: string | null,
  thresholdBytes = PAYLOAD_PREVIEW_THRESHOLD_BYTES,
) {
  if (!content) {
    return false
  }

  return getByteLength(content) > thresholdBytes
}

export function buildPayloadPreview(
  content?: string | null,
  thresholdBytes = PAYLOAD_PREVIEW_THRESHOLD_BYTES,
) {
  if (!content) {
    return content ?? undefined
  }

  if (!isPayloadOverPreviewThreshold(content, thresholdBytes)) {
    return content
  }

  const preview = sliceTextByBytes(content, thresholdBytes)
  const remainingBytes = Math.max(0, getByteLength(content) - getByteLength(preview))
  return `${preview}\n\n...[preview truncated, ${remainingBytes} more bytes]`
}

export function selectPayloadContent(input: PayloadContentSelectionInput) {
  if (input.expanded) {
    return input.full ?? input.preview
  }

  return input.preview ?? input.full
}

function formatByKind(kind: Exclude<PayloadContentType, 'empty' | 'base64'>, body: string) {
  switch (kind) {
    case 'json':
      return formatJson(body)
    case 'html':
      return formatMarkup(body)
    case 'xml':
      return formatMarkup(body)
    case 'text':
    default:
      return normalizeLineEndings(body)
  }
}

function formatJson(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return normalizeLineEndings(body)
  }
}

function formatMarkup(body: string) {
  const normalized = normalizeLineEndings(body).replace(/>\s*</g, '>\n<')
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const formatted: string[] = []
  let depth = 0

  for (const line of lines) {
    const shouldDecreaseBeforePrint = isClosingTag(line)
    if (shouldDecreaseBeforePrint) {
      depth = Math.max(depth - 1, 0)
    }

    formatted.push(`${'  '.repeat(depth)}${line}`)

    if (shouldIncreaseAfterPrint(line)) {
      depth += 1
    }
  }

  return formatted.join('\n')
}

function shouldIncreaseAfterPrint(line: string) {
  if (isXmlDeclaration(line) || isCommentLike(line) || isClosingTag(line) || isInlineElement(line)) {
    return false
  }

  const tagName = getTagName(line)
  if (!tagName) {
    return false
  }

  return !isSelfClosingTag(line) && !VOID_HTML_TAGS.has(tagName)
}

function isClosingTag(line: string) {
  return /^<\//.test(line)
}

function isSelfClosingTag(line: string) {
  return /\/>$/.test(line)
}

function isInlineElement(line: string) {
  const match = line.match(/^<([A-Za-z][\w:-]*)(?:\s[^>]*)?>.*<\/\1>$/)
  return Boolean(match)
}

function isXmlDeclaration(line: string) {
  return /^<\?xml\b/i.test(line) || /^<!doctype\b/i.test(line)
}

function isCommentLike(line: string) {
  return /^<!--/.test(line) || /^<!\[CDATA\[/.test(line)
}

function getTagName(line: string) {
  const match = line.match(/^<([A-Za-z][\w:-]*)\b/)
  return match?.[1]?.toLowerCase()
}

function looksLikeJson(body: string) {
  if (!/^[\[{]/.test(body)) {
    return false
  }

  try {
    JSON.parse(body)
    return true
  } catch {
    return false
  }
}

function looksLikeHtml(body: string) {
  return /^<!doctype html\b/i.test(body) || /^<html\b/i.test(body) || /<(head|body|div|span|main|section)\b/i.test(body)
}

function looksLikeXml(body: string) {
  return /^<\?xml\b/i.test(body) || /^<([A-Za-z][\w:-]*)(?:\s[^>]*)?>[\s\S]*<\/\1>$/.test(body)
}

function looksLikeBase64(body: string) {
  const normalized = body.replace(/\s+/g, '')
  if (normalized.length < 16 || normalized.length % 4 !== 0) {
    return false
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return false
  }

  const decoded = decodeBase64ToText(normalized)
  return Boolean(decoded && isProbablyText(decoded))
}

function decodeBase64ToText(value: string) {
  try {
    const normalized = value.replace(/\s+/g, '')
    const binary = atob(normalized)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

function isProbablyText(value: string) {
  if (!value) {
    return false
  }

  let controlCount = 0
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlCount += 1
    }
  }

  return controlCount / value.length < 0.05
}

function wrapBase64Lines(value: string) {
  const normalized = value.replace(/\s+/g, '')
  return normalized.replace(/(.{76})/g, '$1\n')
}

function getContentType(input: PayloadFormatInput) {
  if (input.mimeType) {
    return input.mimeType.toLowerCase()
  }

  const headers = input.headers
  if (!headers) {
    return ''
  }

  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')
  return entry?.[1]?.toLowerCase() ?? ''
}

function isExplicitTextContentType(contentType: string) {
  return (
    contentType.startsWith('text/') ||
    contentType.includes('javascript') ||
    contentType.includes('x-www-form-urlencoded') ||
    contentType.includes('graphql') ||
    contentType.includes('css')
  )
}

function normalizeBody(body?: string | null) {
  return body?.trim() ?? ''
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, '\n')
}

function getByteLength(value: string) {
  return new TextEncoder().encode(value).length
}

function sliceTextByBytes(value: string, maxBytes: number) {
  let result = ''

  for (const char of value) {
    const next = result + char
    if (getByteLength(next) > maxBytes) {
      break
    }
    result = next
  }

  return result
}
