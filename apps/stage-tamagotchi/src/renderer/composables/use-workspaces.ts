import type { ChatWorkspace } from '@proj-airi/stage-ui/types/workspace'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useChatWorkspaceStore } from '@proj-airi/stage-ui/stores/chat/workspace-store'
import { storeToRefs } from 'pinia'

import { workspacesAdd, workspacesList, workspacesRemove, workspacesReveal } from '../../shared/eventa/workspaces'

/** Reads and changes the granted folders through the main process, then mirrors them for the chat leader. */
export function useWorkspaces() {
  const store = useChatWorkspaceStore()
  const { workspaces, sessionWorkspaceIds } = storeToRefs(store)
  const listWorkspaces = useElectronEventaInvoke(workspacesList)
  const addWorkspace = useElectronEventaInvoke(workspacesAdd)
  const removeWorkspace = useElectronEventaInvoke(workspacesRemove)
  const revealWorkspace = useElectronEventaInvoke(workspacesReveal)

  async function refresh() {
    store.setWorkspaces(await listWorkspaces())
  }

  /** Opens the folder picker. Returns the new or already granted workspace, or nothing when cancelled. */
  async function pickFolder(): Promise<ChatWorkspace | undefined> {
    const result = await addWorkspace()
    store.setWorkspaces(result.workspaces)
    return result.added
  }

  async function remove(id: string) {
    store.setWorkspaces(await removeWorkspace({ id }))
  }

  async function reveal(id: string) {
    await revealWorkspace({ id })
  }

  return {
    workspaces,
    sessionWorkspaceIds,
    refresh,
    pickFolder,
    remove,
    reveal,
    assignSession: store.assignSession,
  }
}
