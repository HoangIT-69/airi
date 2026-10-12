import { describe, expect, it } from 'vitest'

import { getAutomaticChatOrigin } from './event-source'

describe('getAutomaticChatOrigin', () => {
  it('marks plugin sources as automatic with the plugin id', () => {
    const source = { id: 'mv0q4e00-wakp4t', kind: 'plugin' as const, plugin: { id: 'proj-airi:claude-code-notify' } }
    expect(getAutomaticChatOrigin(source)).toEqual({ kind: 'automatic', source: 'proj-airi:claude-code-notify' })
    expect(getAutomaticChatOrigin(source, '  airi: xong việc  ')).toEqual({ kind: 'automatic', source: 'proj-airi:claude-code-notify', summary: 'airi: xong việc' })
  })

  it('leaves other sources and missing sources unmarked', () => {
    expect(getAutomaticChatOrigin(undefined)).toBeUndefined()
    expect(getAutomaticChatOrigin({ id: 'stage-web' })).toBeUndefined()
    expect(getAutomaticChatOrigin({ id: 'module', extension: { id: 'ext' } })).toBeUndefined()
  })
})
