function cleanText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function summarizeElementText(element: Element | null) {
  if (!element) {
    return undefined
  }

  return cleanText((element as HTMLElement).innerText || element.textContent || '')
}

export function buildStableSelector(element: Element | null): string | undefined {
  if (!element) {
    return undefined
  }

  const htmlElement = element as HTMLElement
  const testId = htmlElement.getAttribute('data-testid')
  if (testId) {
    return `[data-testid="${testId}"]`
  }

  if (htmlElement.id) {
    return `#${CSS.escape(htmlElement.id)}`
  }

  const name = htmlElement.getAttribute('name')
  if (name) {
    return `${element.tagName.toLowerCase()}[name="${name}"]`
  }

  const ariaLabel = htmlElement.getAttribute('aria-label')
  if (ariaLabel) {
    return `${element.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`
  }

  const parts: string[] = []
  let current: Element | null = element

  while (current && current !== document.body && parts.length < 4) {
    const tag = current.tagName.toLowerCase()
    const className = cleanText((current as HTMLElement).className || '').split(' ').filter(Boolean)[0]
    const part = className ? `${tag}.${CSS.escape(className)}` : tag
    parts.unshift(part)
    current = current.parentElement
  }

  return parts.join(' > ')
}

