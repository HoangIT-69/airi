import { describe, expect, it } from 'vitest'

import { createWorkspaceContext } from './workspace'

const workspace = { id: 'w1', name: 'handbook', path: 'D:/docs/handbook', addedAt: 0 }

describe('createWorkspaceContext', () => {
  it('omits the context when the user has no workspaces', () => {
    expect(createWorkspaceContext(undefined, 0)).toBeNull()
  })

  it('names the folder of the current session', () => {
    const context = createWorkspaceContext(workspace, 1)
    expect(context?.contextId).toBe('system:airi-workspace')
    expect(context?.text).toContain('"handbook"')
    expect(context?.text).toContain('D:/docs/handbook')
  })

  it('replaces an older folder with a note when the session has none', () => {
    const context = createWorkspaceContext(undefined, 2)
    expect(context?.contextId).toBe('system:airi-workspace')
    expect(context?.text).toContain('not tied to a workspace')
  })
})
