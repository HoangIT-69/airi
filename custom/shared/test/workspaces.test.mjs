/* eslint-disable test/no-import-node-test, no-restricted-syntax -- custom/ is outside the AIRI Vitest workspace and runs on node --test. Plain Node.js ESM needs file extensions. */
import assert from 'node:assert/strict'

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { createDocsWriterTools } from '../../mcp-docs-writer/tools.mjs'
import { beforeEachTool, createLiveRoots, readWorkspaces } from '../workspaces.mjs'

describe('granted workspaces', () => {
  let root
  let file
  let project

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'airi-ws-'))
    file = join(root, 'workspaces.json')
    project = join(root, 'handbook')
    await mkdir(project)
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads nothing when the file is missing or broken', async () => {
    assert.deepEqual(await readWorkspaces(join(root, 'missing.json')), [])
    await writeFile(join(root, 'broken.json'), '{')
    assert.deepEqual(await readWorkspaces(join(root, 'broken.json')), [])
  })

  it('adds a folder granted later to the same roots array', async () => {
    const { roots, refresh } = createLiveRoots(['D:/static'], file)
    await refresh()
    assert.deepEqual(roots, ['D:/static'])
    await writeFile(file, JSON.stringify({ version: 1, workspaces: [{ id: '1', name: 'handbook', path: project, addedAt: 0 }] }))
    await refresh()
    assert.deepEqual(roots, ['D:/static', project])
  })

  it('refreshes before every tool call', async () => {
    let refreshed = 0
    const tools = beforeEachTool({ echo: { description: '', inputSchema: {}, run: async ({ text }) => `${refreshed}:${text}` } }, async () => {
      refreshed++
    })
    assert.equal(await tools.echo.run({ text: 'a' }), '1:a')
  })

  it('writes a doc into the docs folder of a granted workspace', async () => {
    const tools = createDocsWriterTools(join(root, 'default-docs'), { listWorkspaces: () => readWorkspaces(file) })
    const reply = await tools.write_doc.run({ title: 'Tổng quan', content: '# Tổng quan', workspace: 'handbook' })
    assert.match(reply, /handbook[\\/]docs[\\/]\d{4}-\d{2}-\d{2}-tong-quan\.md$/)
    assert.equal((await readdir(join(project, 'docs'))).length, 1)
    assert.match(await tools.list_docs.run({ workspace: project }), /tong-quan\.md/)
  })

  it('refuses a workspace that was not granted', async () => {
    const tools = createDocsWriterTools(join(root, 'default-docs'), { listWorkspaces: () => readWorkspaces(file) })
    await assert.rejects(tools.write_doc.run({ title: 'x', content: 'y', workspace: 'D:/Windows' }), /chưa được cấp quyền/)
  })
})
