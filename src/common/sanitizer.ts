const SENSITIVE_TOKENS = ['password', 'token', 'authorization', 'cookie', 'secret', 'phone', 'idcard']

export function shouldMaskKey(key: string | undefined | null) {
  if (!key) {
    return false
  }

  const lowered = key.toLowerCase()
  return SENSITIVE_TOKENS.some((token) => lowered.includes(token))
}

export function maskValue(value: string | undefined | null) {
  if (!value) {
    return value ?? undefined
  }

  if (value.length <= 6) {
    return '*'.repeat(value.length)
  }

  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

export function sanitizeHeaders(headers: Record<string, unknown> | undefined) {
  if (!headers) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (shouldMaskKey(key)) {
        return [key, '***']
      }

      return [key, String(value)]
    }),
  )
}

export function mergeHeaders(
  currentHeaders?: Record<string, string>,
  nextHeaders?: Record<string, string>,
) {
  if (!currentHeaders && !nextHeaders) {
    return undefined
  }

  return {
    ...(currentHeaders ?? {}),
    ...(nextHeaders ?? {}),
  }
}

export function truncateBody(body: string | undefined, maxLength = 1_000_000) {
  if (!body) {
    return { body, truncated: false }
  }

  if (body.length <= maxLength) {
    return { body, truncated: false }
  }

  return {
    body: `${body.slice(0, maxLength)}\n\n...[truncated ${body.length - maxLength} chars]`,
    truncated: true,
  }
}

export function isProbablyTextMimeType(mimeType?: string) {
  if (!mimeType) {
    return true
  }

  const lowered = mimeType.toLowerCase()
  return (
    lowered.startsWith('text/') ||
    lowered.includes('json') ||
    lowered.includes('xml') ||
    lowered.includes('javascript') ||
    lowered.includes('svg') ||
    lowered.includes('form-urlencoded')
  )
}
