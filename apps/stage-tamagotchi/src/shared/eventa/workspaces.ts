import type { ChatWorkspace } from '@proj-airi/stage-ui/types/workspace'

import { defineInvokeEventa } from '@moeru/eventa'

/** Lists the folders the user granted. */
export const workspacesList = defineInvokeEventa<ChatWorkspace[]>('eventa:invoke:workspaces:list')
/**
 * Opens the native folder picker and grants the chosen folder.
 * Only the user can pick, so the model cannot grant itself a folder through a tool.
 */
export const workspacesAdd = defineInvokeEventa<{ workspaces: ChatWorkspace[], added?: ChatWorkspace }>('eventa:invoke:workspaces:add')
/** Revokes one folder. Files stay on disk. */
export const workspacesRemove = defineInvokeEventa<ChatWorkspace[], { id: string }>('eventa:invoke:workspaces:remove')
/** Shows the folder in the system file manager. */
export const workspacesReveal = defineInvokeEventa<void, { id: string }>('eventa:invoke:workspaces:reveal')
