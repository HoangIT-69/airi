import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { describe, expect, it } from 'vitest'

import { collectSessionActivity } from './session-activity'

function mcpCall(id: string, name: string, args: Record<string, unknown>) {
  return { type: 'tool-call' as const, toolCall: { toolCallId: id, toolCallType: 'function' as const, toolName: 'builtIn_mcpCallTool', args: JSON.stringify({ name, arguments: JSON.stringify(args) }) } }
}

function mcpResult(text: string, isError = false) {
  return JSON.stringify({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) })
}

describe('collectSessionActivity', () => {
  it('collects steps newest first, written files, and job ids', () => {
    const messages: ChatHistoryItem[] = [
      { role: 'user', content: 'thêm folder rồi viết tóm tắt' },
      {
        role: 'assistant',
        content: '',
        slices: [
          mcpCall('a', 'knowledge::add_folder', { path: 'D:/docs' }),
          mcpCall('b', 'docs-writer::write_doc', { title: 'Tóm tắt' }),
          mcpCall('c', 'knowledge::search_knowledge', { query: 'x' }),
        ],
        tool_results: [
          { id: 'a', result: mcpResult('Đã thêm D:/docs (slug: docs). Đang index nền: job 1a2b3c4d.') },
          { id: 'b', result: mcpResult('Đã lưu: D:/out/2026-10-12-tom-tat.md') },
        ],
      },
    ]
    const activity = collectSessionActivity(messages)
    expect(activity.steps.map(step => [step.presentation.labelKey, step.state])).toEqual([
      ['search-knowledge', 'executing'],
      ['write-doc', 'done'],
      ['add-folder', 'done'],
    ])
    expect(activity.files).toEqual([{ path: 'D:/out/2026-10-12-tom-tat.md', name: '2026-10-12-tom-tat.md' }])
    expect(activity.jobs.map(job => job.id)).toEqual(['1a2b3c4d'])
  })

  it('ignores failed results for files and jobs, but still lists the failed step', () => {
    const messages: ChatHistoryItem[] = [{
      role: 'assistant',
      content: '',
      slices: [mcpCall('a', 'docs-writer::write_doc', { title: 'x' })],
      tool_results: [{ id: 'a', result: mcpResult('Đã lưu: D:/should-not-count.md', true) }],
    }]
    const activity = collectSessionActivity(messages)
    expect(activity.files).toEqual([])
    expect(activity.steps[0].state).toBe('error')
  })

  it('returns empty lists for a session without tool calls', () => {
    expect(collectSessionActivity([{ role: 'user', content: 'chào' }, { role: 'assistant', content: 'chào bạn', slices: [], tool_results: [] }]))
      .toEqual({ steps: [], files: [], jobs: [] })
  })
})
