import type { ChatWorkspace } from '@proj-airi/stage-ui/types/workspace'

import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import * as v from 'valibot'

const fileSchema = v.object({
  version: v.literal(1),
  workspaces: v.array(v.object({
    id: v.string(),
    name: v.string(),
    path: v.string(),
    addedAt: v.number(),
  })),
})

/**
 * Owns the granted-folder list in one JSON file.
 * The custom MCP servers (knowledge, docs-writer) read the same file to decide which folders they may touch.
 */
export function createWorkspaceStore(options: { filePath: string, now?: () => number }) {
  const now = options.now ?? Date.now

  async function list(): Promise<ChatWorkspace[]> {
    let raw: string
    try {
      raw = await readFile(options.filePath, 'utf8')
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return []
      throw error
    }
    return v.parse(fileSchema, JSON.parse(raw)).workspaces
  }

  async function save(workspaces: ChatWorkspace[]) {
    await mkdir(dirname(options.filePath), { recursive: true })
    // Write then rename, so an MCP server never reads a half-written file.
    const temp = `${options.filePath}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify({ version: 1, workspaces }, null, 2)}\n`, 'utf8')
    await rename(temp, options.filePath)
  }

  /** Adds a folder. A folder that is already granted is returned as is. */
  async function add(folder: string): Promise<{ workspaces: ChatWorkspace[], added: ChatWorkspace }> {
    const path = await realpath(folder)
    if (!(await stat(path)).isDirectory())
      throw new Error('Workspace must be a folder.')
    const workspaces = await list()
    const existing = workspaces.find(workspace => workspace.path.toLowerCase() === path.toLowerCase())
    if (existing)
      return { workspaces, added: existing }
    const added = { id: randomUUID(), name: basename(path) || path, path, addedAt: now() }
    const next = [...workspaces, added]
    await save(next)
    return { workspaces: next, added }
  }

  async function remove(id: string): Promise<ChatWorkspace[]> {
    const next = (await list()).filter(workspace => workspace.id !== id)
    await save(next)
    return next
  }

  async function get(id: string): Promise<ChatWorkspace | undefined> {
    return (await list()).find(workspace => workspace.id === id)
  }

  return { list, add, remove, get }
}
