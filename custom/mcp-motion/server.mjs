#!/usr/bin/env node
// MCP server (stdio) that creates VRMA motions, plus a loopback HTTP server that serves them to AIRI.

import process from 'node:process'

import { createReadStream, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

// eslint-disable-next-line no-restricted-syntax -- Plain Node.js ESM needs the file extension.
import { startMcpServer } from '../shared/mcp-stdio.mjs'
// eslint-disable-next-line no-restricted-syntax -- Plain Node.js ESM needs the file extension.
import { createMotionTools, isMotionName } from './tools.mjs'

const SERVER_INFO = { name: 'motion', version: '1.0.0' }
const MOTIONS_DIR = resolve(process.env.MOTIONS_DIR ?? process.argv[2] ?? 'mai-motions')
const HTTP_PORT = Number(process.env.MOTION_HTTP_PORT ?? 8790)
const PUBLIC_BASE_URL = `http://127.0.0.1:${HTTP_PORT}/motions`

mkdirSync(MOTIONS_DIR, { recursive: true })

/** Serves GET /motions/<name>.vrma. Only names the tools could have written are reachable. */
const http = createServer(async (req, res) => {
  const headers = { 'Access-Control-Allow-Origin': '*' }
  const match = /^\/motions\/([^/]+)\.vrma$/.exec(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET' })
    res.end()
    return
  }
  if (req.method !== 'GET' || !match || !isMotionName(decodeURIComponent(match[1]))) {
    res.writeHead(404, headers)
    res.end()
    return
  }
  const file = join(MOTIONS_DIR, `${decodeURIComponent(match[1])}.vrma`)
  try {
    const info = await stat(file)
    res.writeHead(200, { ...headers, 'Content-Type': 'model/gltf-binary', 'Content-Length': info.size, 'Cache-Control': 'no-cache' })
    createReadStream(file).pipe(res)
  }
  catch {
    res.writeHead(404, headers)
    res.end()
  }
})

http.on('error', (error) => {
  // Another AIRI window may already serve the same folder. The MCP tools still work.
  process.stderr.write(`[${SERVER_INFO.name}] HTTP server not started: ${error.message}\n`)
})
http.listen(HTTP_PORT, '127.0.0.1')

startMcpServer({
  info: SERVER_INFO,
  tools: createMotionTools({
    motionsDir: MOTIONS_DIR,
    publicBaseUrl: PUBLIC_BASE_URL,
    textToVrmaUrl: (process.env.TEXT_TO_VRMA_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, ''),
    textToVrmaToken: process.env.TEXT_TO_VRMA_TOKEN,
    defaultEngine: process.env.TEXT_TO_VRMA_ENGINE ?? 'claude',
  }),
})

// The HTTP server keeps the process alive. Close it when AIRI closes the MCP pipe, so the
// process exits once running tool calls finish.
process.stdin.on('end', () => http.close())

process.stderr.write(`[${SERVER_INFO.name}] motions dir: ${MOTIONS_DIR}, serving ${PUBLIC_BASE_URL}\n`)
