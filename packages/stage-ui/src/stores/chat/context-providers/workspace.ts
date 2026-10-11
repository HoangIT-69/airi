import type { ContextMessage } from '../../../types/chat'
import type { ChatWorkspace } from '../../../types/workspace'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

const WORKSPACE_CONTEXT_ID = 'system:airi-workspace'

/**
 * Tells the model which granted folder the current conversation works in.
 * Returns a "no workspace" note when other workspaces exist, so a stale folder never carries over between sessions.
 */
export function createWorkspaceContext(workspace: ChatWorkspace | undefined, workspaceCount: number): ContextMessage | null {
  if (!workspace && workspaceCount === 0)
    return null

  const text = workspace
    ? [
        `This conversation belongs to the workspace "${workspace.name}" at the folder ${workspace.path}.`,
        'The user granted access to this folder. Your job here is documentation and knowledge work, not writing code:',
        'index the folder into the knowledge base, search it, write docs, and build the wiki and knowledge graph.',
        'When knowledge tools are available, add the folder with add_folder before searching it, and pass this folder path to tools that take one.',
        'Stay inside this folder unless the user names another granted workspace.',
      ].join(' ')
    : 'This conversation is not tied to a workspace. Ask the user to pick or add a workspace before working on files.'

  return {
    id: nanoid(),
    contextId: WORKSPACE_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    metadata: {
      source: { id: WORKSPACE_CONTEXT_ID },
    },
    text,
    createdAt: Date.now(),
  }
}
