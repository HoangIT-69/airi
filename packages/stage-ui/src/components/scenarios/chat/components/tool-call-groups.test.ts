import type { ChatSlices } from '../../../../types/chat'

import { describe, expect, it } from 'vitest'

import { groupToolCallSlices } from './tool-call-groups'

const text = (value: string): ChatSlices => ({ type: 'text', text: value })
const call = (id: string): ChatSlices => ({ type: 'tool-call', toolCall: { toolCallId: id, toolName: 'x', args: '{}', toolCallType: 'function' } })
const result = (id: string): ChatSlices => ({ type: 'tool-call-result', id, result: 'ok' })

describe('groupToolCallSlices', () => {
  it('groups two or more consecutive calls, even with results between them', () => {
    expect(groupToolCallSlices([text('a'), call('1'), result('1'), call('2'), text('b')])).toEqual([
      { kind: 'slice', index: 0 },
      { kind: 'steps', indices: [1, 3] },
      { kind: 'slice', index: 4 },
    ])
  })

  it('keeps a single call as a plain slice', () => {
    expect(groupToolCallSlices([call('1'), text('done')])).toEqual([
      { kind: 'slice', index: 0 },
      { kind: 'slice', index: 1 },
    ])
  })

  it('starts a new group after text', () => {
    expect(groupToolCallSlices([call('1'), call('2'), text('mid'), call('3'), call('4'), call('5')])).toEqual([
      { kind: 'steps', indices: [0, 1] },
      { kind: 'slice', index: 2 },
      { kind: 'steps', indices: [3, 4, 5] },
    ])
  })

  it('returns nothing for an empty message', () => {
    expect(groupToolCallSlices([])).toEqual([])
  })
})
