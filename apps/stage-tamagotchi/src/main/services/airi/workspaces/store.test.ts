import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createWorkspaceStore } from './store'

describe('createWorkspaceStore', () => {
  let root: string
  let filePath: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'airi-workspaces-'))
    filePath = join(root, 'config', 'workspaces.json')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('starts empty when the file does not exist', async () => {
    expect(await createWorkspaceStore({ filePath }).list()).toEqual([])
  })

  it('adds a folder once and writes the file the MCP servers read', async () => {
    const folder = join(root, 'Docs Project')
    await mkdir(folder)
    const store = createWorkspaceStore({ filePath, now: () => 42 })

    const first = await store.add(folder)
    const second = await store.add(folder)

    expect(first.added).toMatchObject({ name: 'Docs Project', addedAt: 42 })
    expect(second.added.id).toBe(first.added.id)
    expect(second.workspaces).toHaveLength(1)
    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    expect(saved).toEqual({ version: 1, workspaces: [first.added] })
  })

  it('refuses a file', async () => {
    const file = join(root, 'note.md')
    await writeFile(file, '# note')
    await expect(createWorkspaceStore({ filePath }).add(file)).rejects.toThrow('folder')
  })

  it('removes a workspace by id', async () => {
    const folder = join(root, 'a')
    await mkdir(folder)
    const store = createWorkspaceStore({ filePath })
    const { added } = await store.add(folder)

    expect(await store.remove(added.id)).toEqual([])
    expect(await store.list()).toEqual([])
  })
})
