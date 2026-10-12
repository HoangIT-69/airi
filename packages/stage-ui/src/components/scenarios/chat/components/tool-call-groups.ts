import type { ChatSlices } from '../../../../types/chat'

/** One rendered item: a single slice, or a run of tool calls shown as one step list. */
export type ChatSliceGroup
  = | { kind: 'slice', index: number }
    | { kind: 'steps', indices: number[] }

// A single tool call stays a plain card. Two or more in a row become a step list.
const MIN_STEPS = 2

/**
 * Groups consecutive tool calls of one assistant message, so a multi-step turn reads as one block.
 * Result slices between calls do not break a run, because they render nothing on their own.
 *
 * Before:
 * - text, tool-call, tool-call-result, tool-call, text
 *
 * After:
 * - slice 0, steps [1, 3], slice 4
 */
export function groupToolCallSlices(slices: ChatSlices[]): ChatSliceGroup[] {
  const groups: ChatSliceGroup[] = []
  let run: number[] = []
  const flush = () => {
    if (run.length >= MIN_STEPS)
      groups.push({ kind: 'steps', indices: run })
    else
      groups.push(...run.map(index => ({ kind: 'slice' as const, index })))
    run = []
  }
  for (const [index, slice] of slices.entries()) {
    if (slice.type === 'tool-call') {
      run.push(index)
      continue
    }
    if (slice.type === 'tool-call-result')
      continue
    flush()
    groups.push({ kind: 'slice', index })
  }
  flush()
  return groups
}
