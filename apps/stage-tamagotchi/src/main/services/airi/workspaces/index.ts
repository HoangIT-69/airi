import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow, dialog, shell } from 'electron'

import * as v from 'valibot'

import { workspacesAdd, workspacesList, workspacesRemove, workspacesReveal, workspacesRevealFile } from '../../../../shared/eventa/workspaces'
import { createWorkspaceStore } from './store'

const idSchema = v.object({ id: v.string() })
const pathSchema = v.object({ path: v.pipe(v.string(), v.check(isAbsolute, 'Path must be absolute.')) })

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

  defineInvokeHandler(context, workspacesRevealFile, async (input) => {
    const { path } = v.parse(pathSchema, input)
    // showItemInFolder only selects the file in the file manager. It cannot run an executable.
    if (!(await stat(path).then(info => info.isFile(), () => false)))
      throw new Error('File not found.')
    shell.showItemInFolder(path)
  })
}
