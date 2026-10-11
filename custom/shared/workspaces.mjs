// The folders the user granted in AIRI's chat sidebar (Workspaces).
// AIRI's main process owns `%APPDATA%/airi-custom/workspaces.json`. The custom servers only read it.
// Adding a folder needs the native folder picker, so the model cannot grant itself access.

import process from 'node:process'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Folder shared by AIRI and the custom servers (knowledge index, workspace list). */
export const APP_DIR = join(process.env.APPDATA ?? join(process.env.HOME ?? '.', '.config'), 'airi-custom')

/** Path of the workspace list. `WORKSPACES_FILE` overrides it, mostly for tests. */
export function workspacesFile(env = process.env) {
  return env.WORKSPACES_FILE ?? join(APP_DIR, 'workspaces.json')
}

/** Reads the granted workspaces. A missing or broken file means none. */
export async function readWorkspaces(filePath) {
  try {
    const data = JSON.parse(await readFile(filePath, 'utf8'))
    if (!Array.isArray(data?.workspaces))
      return []
    return data.workspaces.filter(workspace => typeof workspace?.path === 'string' && typeof workspace?.name === 'string')
  }
  catch {
    return []
  }
}

/**
 * Returns a roots array that holds the static roots plus the granted workspaces.
 * The array is changed in place by `refresh`, so modules that captured it see new folders.
 */
export function createLiveRoots(staticRoots, filePath) {
  const roots = [...staticRoots]
  async function refresh() {
    const workspaceRoots = (await readWorkspaces(filePath)).map(workspace => workspace.path)
    const next = [...new Set([...staticRoots, ...workspaceRoots])]
    roots.splice(0, roots.length, ...next)
    return roots
  }
  return { roots, refresh }
}

/** Runs `before` ahead of every tool call, for example to refresh the roots. */
export function beforeEachTool(tools, before) {
  return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, {
    ...tool,
    async run(args) {
      await before()
      return tool.run(args)
    },
  }]))
}
