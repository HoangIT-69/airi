import { describe, expect, it } from 'vitest'

import { describeToolCall, parseToolResult, unwrapToolCall } from './tool-call-presentation'

function mcpArgs(name: string, args: Record<string, unknown>) {
  return JSON.stringify({ name, arguments: JSON.stringify(args) })
}

describe('unwrapToolCall', () => {
  it('removes the MCP envelope and parses the nested arguments', () => {
    expect(unwrapToolCall('builtIn_mcpCallTool', mcpArgs('knowledge::search_knowledge', { query: 'vrm' })))
      .toEqual({ server: 'knowledge', tool: 'search_knowledge', args: { query: 'vrm' } })
  })

  it('keeps built-in tools as they are', () => {
    expect(unwrapToolCall('image_journal', '{"mode":"bg"}')).toEqual({ server: '', tool: 'image_journal', args: { mode: 'bg' } })
  })

  it('tolerates missing or broken JSON', () => {
    expect(unwrapToolCall('builtIn_mcpCallTool', 'not json')).toEqual({ server: '', tool: 'builtIn_mcpCallTool', args: {} })
    expect(unwrapToolCall('builtIn_mcpCallTool', JSON.stringify({ name: 'x::y', arguments: '{' }))).toEqual({ server: 'x', tool: 'y', args: {} })
  })
})

describe('describeToolCall', () => {
  it('labels known MCP tools with their main argument', () => {
    const presentation = describeToolCall('builtIn_mcpCallTool', mcpArgs('knowledge::search_knowledge', { query: 'kiến trúc' }))
    expect(presentation).toEqual({
      icon: 'i-solar:magnifer-linear',
      labelKey: 'search-knowledge',
      labelParams: { query: 'kiến trúc' },
      rawName: 'knowledge › search_knowledge',
    })
  })

  it('shows only the file name of a path', () => {
    const presentation = describeToolCall('builtIn_mcpCallTool', mcpArgs('knowledge::read_document', { path: 'D:\\docs\\specs\\login.pdf' }))
    expect(presentation.labelParams).toEqual({ file: 'login.pdf' })
  })

  it('shortens long values to one line', () => {
    const presentation = describeToolCall('builtIn_mcpCallTool', mcpArgs('knowledge::search_knowledge', { query: `dòng một\n${'x'.repeat(100)}` }))
    expect(presentation.labelParams.query.length).toBe(60)
    expect(presentation.labelParams.query).not.toContain('\n')
    expect(presentation.labelParams.query.endsWith('…')).toBe(true)
  })

  it('falls back to a generic label with the server and tool name', () => {
    expect(describeToolCall('builtIn_mcpCallTool', mcpArgs('weather::forecast', {})))
      .toMatchObject({ labelKey: 'generic', labelParams: { name: 'weather › forecast' } })
    expect(describeToolCall('play_chess', '{}')).toMatchObject({ labelKey: 'generic', labelParams: { name: 'play_chess' } })
  })
})

describe('parseToolResult', () => {
  it('reads MCP text content and its error flag from a JSON string', () => {
    const stored = JSON.stringify({ content: [{ type: 'text', text: 'Lỗi: bị chặn' }], isError: true })
    expect(parseToolResult(stored)).toEqual({ isError: true, text: 'Lỗi: bị chặn' })
  })

  it('joins several text parts and skips non-text parts', () => {
    const result = { content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }] }
    expect(parseToolResult(result)).toEqual({ isError: false, text: 'a\nb' })
  })

  it('keeps the outer error flag and plain strings', () => {
    expect(parseToolResult('timeout', true)).toEqual({ isError: true, text: 'timeout' })
    expect(parseToolResult(undefined)).toEqual({ isError: false, text: '' })
  })

  it('pretty-prints other objects', () => {
    expect(parseToolResult({ ok: true })).toEqual({ isError: false, text: '{\n  "ok": true\n}' })
  })
})
