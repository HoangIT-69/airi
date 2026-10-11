import type { ChatWorkspace } from '../../types/workspace'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

/**
 * Mirrors the host's workspace list and remembers which chat session belongs to which workspace.
 * Local storage keeps every window, including the chat leader, on the same values.
 */
export const useChatWorkspaceStore = defineStore('chat-workspaces', () => {
  const workspaces = useLocalStorageManualReset<ChatWorkspace[]>('chat/workspaces/list', [])
  const sessionWorkspaceIds = useLocalStorageManualReset<Record<string, string>>('chat/workspaces/sessions', {})

  /** Replaces the mirror with the host's list and forgets sessions of removed workspaces. */
  function setWorkspaces(next: ChatWorkspace[]) {
    workspaces.value = next
    const known = new Set(next.map(workspace => workspace.id))
    sessionWorkspaceIds.value = Object.fromEntries(
      Object.entries(sessionWorkspaceIds.value).filter(([, workspaceId]) => known.has(workspaceId)),
    )
  }

  function assignSession(sessionId: string, workspaceId: string | undefined) {
    const next = { ...sessionWorkspaceIds.value }
    if (workspaceId)
      next[sessionId] = workspaceId
    else
      delete next[sessionId]
    sessionWorkspaceIds.value = next
  }

  function workspaceForSession(sessionId: string): ChatWorkspace | undefined {
    const workspaceId = sessionWorkspaceIds.value[sessionId]
    return workspaceId ? workspaces.value.find(workspace => workspace.id === workspaceId) : undefined
  }

  function resetState() {
    workspaces.reset()
    sessionWorkspaceIds.reset()
  }

  return { workspaces, sessionWorkspaceIds, setWorkspaces, assignSession, workspaceForSession, resetState }
})
