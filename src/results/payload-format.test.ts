import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PAYLOAD_PREVIEW_THRESHOLD_BYTES,
  buildPayloadPreview,
  detectRequestPayloadType,
  detectResponsePayloadType,
  formatRequestPayload,
  formatResponsePayload,
  isPayloadOverPreviewThreshold,
  selectPayloadContent,
} from './payload-format.ts'

test('格式化请求体 JSON 并识别类型', () => {
  const body = '{"user":"alice","roles":["admin"]}'

  assert.equal(
    detectRequestPayloadType({
      body,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }),
    'json',
  )

  const result = formatRequestPayload({
    body,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })

  assert.equal(result.kind, 'json')
  assert.equal(result.decoded, false)
  assert.equal(
    result.formatted,
    '{\n  "user": "alice",\n  "roles": [\n    "admin"\n  ]\n}',
  )
})

test('格式化响应体 HTML 并识别类型', () => {
  const body = '<html><body><main><h1>Hello</h1></main></body></html>'

  assert.equal(
    detectResponsePayloadType({
      body,
      mimeType: 'text/html; charset=utf-8',
    }),
    'html',
  )

  const result = formatResponsePayload({
    body,
    mimeType: 'text/html; charset=utf-8',
  })

  assert.equal(result.kind, 'html')
  assert.equal(
    result.formatted,
    '<html>\n  <body>\n    <main>\n      <h1>Hello</h1>\n    </main>\n  </body>\n</html>',
  )
})

test('格式化响应体 XML 并识别类型', () => {
  const body = '<?xml version="1.0"?><root><item id="1">A</item><item id="2">B</item></root>'

  assert.equal(
    detectResponsePayloadType({
      body,
      mimeType: 'application/xml',
    }),
    'xml',
  )

  const result = formatResponsePayload({
    body,
    mimeType: 'application/xml',
  })

  assert.equal(result.kind, 'xml')
  assert.equal(
    result.formatted,
    '<?xml version="1.0"?>\n<root>\n  <item id="1">A</item>\n  <item id="2">B</item>\n</root>',
  )
})

test('格式化 base64 响应体并保留原始类型信息', () => {
  const body = 'eyJvayI6dHJ1ZSwibmVzdGVkIjp7ImNvdW50IjoyfX0='

  assert.equal(
    detectResponsePayloadType({
      body,
      encoding: 'base64',
      mimeType: 'application/json',
    }),
    'base64',
  )

  const result = formatResponsePayload({
    body,
    encoding: 'base64',
    mimeType: 'application/json',
  })

  assert.equal(result.kind, 'base64')
  assert.equal(result.decoded, true)
  assert.equal(result.decodedKind, 'json')
  assert.equal(
    result.formatted,
    '{\n  "ok": true,\n  "nested": {\n    "count": 2\n  }\n}',
  )
})

test('无明确结构时按纯文本处理', () => {
  const body = 'plain response body'

  assert.equal(detectResponsePayloadType({ body }), 'text')

  const result = formatResponsePayload({ body })

  assert.equal(result.kind, 'text')
  assert.equal(result.formatted, body)
})

test('超过 1KB 阈值时提供预览并支持展开切换', () => {
  const full = '中'.repeat(600)

  assert.equal(PAYLOAD_PREVIEW_THRESHOLD_BYTES, 1024)
  assert.equal(isPayloadOverPreviewThreshold(full), true)

  const preview = buildPayloadPreview(full)

  assert.ok(preview)
  assert.notEqual(preview, full)
  assert.match(preview ?? '', /\.\.\.\[preview truncated/)
  assert.equal(selectPayloadContent({ preview, full, expanded: false }), preview)
  assert.equal(selectPayloadContent({ preview, full, expanded: true }), full)
})

test('未超过阈值时直接选择完整内容', () => {
  const full = 'short text'
  const preview = buildPayloadPreview(full)

  assert.equal(isPayloadOverPreviewThreshold(full), false)
  assert.equal(preview, full)
  assert.equal(selectPayloadContent({ preview, full, expanded: false }), full)
})
