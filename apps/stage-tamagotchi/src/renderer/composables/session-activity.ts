import type { ToolCallPresentation } from '@proj-airi/stage-ui/components/scenarios/chat'
import type { ChatHistoryItem, ChatSlices } from '@proj-airi/stage-ui/types/chat'

import { createToolCallResultLookup, describeToolCall, parseToolResult, resolveToolCallBlockState, unwrapToolCall } from '@proj-airi/stage-ui/components/scenarios/chat'

/** One tool call of the session, newest first in `SessionActivity.steps`. */
export interface ActivityStep {
  key: string
  presentation: ToolCallPresentation
  state: 'executing' | 'done' | 'error'
}

/** A file a tool wrote, for example a document from `docs-writer`. */
export interface ActivityFile {
  path: string
  name: string
}

/** A background job a tool started, for example an indexing or wiki job of the knowledge server. */
export interface ActivityJob {
  id: string
  presentation: ToolCallPresentation
}

export interface SessionActivity {
  steps: ActivityStep[]
  files: ActivityFile[]
  jobs: ActivityJob[]
}

// Tools from custom/ whose text results name a written file or a job id.
const FILE_TOOLS = new Set(['write_doc'])
const JOB_TOOLS = new Set(['add_folder', 'sync_folders', 'wiki_build'])
// `docs-writer` answers "Đã lưu: <path>". The knowledge server answers "... job 1a2b3c4d ...".
const SAVED_FILE = /^Đã lưu: (.+)$/m
const JOB_ID = /\bjob ([0-9a-f]{8})\b/g
const MAX_STEPS = 50

function sliceList(message: ChatHistoryItem): ChatSlices[] {
  return message.role === 'assistant' && Array.isArray(message.slices) ? message.slices : []
}

/**
 * Collects what the assistant did in one session: tool calls, written files, and background jobs.
 * Only completed results count for files and jobs.
 */
export function collectSessionActivity(messages: ChatHistoryItem[]): SessionActivity {
  const steps: ActivityStep[] = []
  const files = new Map<string, ActivityFile>()
  const jobs = new Map<string, ActivityJob>()

  messages.forEach((message, messageIndex) => {
    if (message.role !== 'assistant')
      return
    const slices = sliceList(message)
    const results = createToolCallResultLookup(slices, message.tool_results)
    slices.forEach((slice, sliceIndex) => {
      if (slice.type !== 'tool-call')
        return
      const { toolName, args } = slice.toolCall
      const result = results.get(sliceIndex)
      const presentation = describeToolCall(toolName, args)
      steps.push({ key: `${messageIndex}-${sliceIndex}`, presentation, state: resolveToolCallBlockState(result) })
      if (!result)
        return
      const payload = parseToolResult(result.result, result.isError)
      if (payload.isError)
        return
      const { tool } = unwrapToolCall(toolName, args)
      const saved = FILE_TOOLS.has(tool) ? SAVED_FILE.exec(payload.text)?.[1]?.trim() : undefined
      if (saved)
        files.set(saved, { path: saved, name: saved.split(/[\\/]/).pop() ?? saved })
      if (JOB_TOOLS.has(tool)) {
        for (const match of payload.text.matchAll(JOB_ID))
          jobs.set(match[1], { id: match[1], presentation })
      }
    })
  })

  return {
    steps: steps.reverse().slice(0, MAX_STEPS),
    files: [...files.values()].reverse(),
    jobs: [...jobs.values()].reverse(),
  }
}
