import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow, dialog, shell } from 'electron'

import * as v from 'valibot'

import { workspacesAdd, workspacesList, workspacesRemove, workspacesReveal } from '../../../../shared/eventa/workspaces'
import { createWorkspaceStore } from './store'

const idSchema = v.object({ id: v.string() })

/**
 * Registers the granted-folder service.
 * The list lives at `%APPDATA%/airi-custom/workspaces.json`, next to the knowledge index, so the custom MCP servers can read it.
 */
export function setupWorkspaces(context: ReturnType<typeof createContext>['context']) {
  const store = createWorkspaceStore({ filePath: join(app.getPath('appData'), 'airi-custom', 'workspaces.json') })

  defineInvokeHandler(context, workspacesList, () => store.list())

  defineInvokeHandler(context, workspacesAdd, async () => {
    const owner = BrowserWindow.getFocusedWindow()
    const options = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    const folder = selection.filePaths[0]
    if (selection.canceled || !folder)
      return { workspaces: await store.list() }
    return store.add(folder)
  })

  defineInvokeHandler(context, workspacesRemove, input => store.remove(v.parse(idSchema, input).id))

  defineInvokeHandler(context, workspacesReveal, async (input) => {
    const workspace = await store.get(v.parse(idSchema, input).id)
    if (!workspace)
      throw new Error('Workspace not found.')
    const failure = await shell.openPath(workspace.path)
    if (failure)
      throw new Error(failure)
  })
}
