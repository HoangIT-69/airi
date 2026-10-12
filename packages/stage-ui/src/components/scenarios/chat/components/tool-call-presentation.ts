/**
 * Presentation helpers that turn raw tool calls into readable chat cards.
 *
 * MCP tools all arrive as `builtIn_mcpCallTool` with `{ name: "<server>::<tool>", arguments: "<json>" }`.
 * These helpers unwrap that envelope, pick a label and an icon, and read the MCP result, whose
 * `isError` flag sits inside a JSON string (see `core-agent/src/runtime/xsai-events.ts`).
 */

const MCP_CALL_TOOL = 'builtIn_mcpCallTool'
const MCP_LIST_TOOLS = 'builtIn_mcpListTools'
const MCP_NAME_SEPARATOR = '::'
const MAX_LABEL_VALUE_CHARS = 60

/** A tool call with the MCP envelope removed. */
export interface UnwrappedToolCall {
  /** MCP server name, for example `knowledge`. Empty for built-in tools. */
  server: string
  /** Tool name, for example `search_knowledge`. */
  tool: string
  /** Parsed arguments. Empty when they are missing or not JSON. */
  args: Record<string, unknown>
}

/** What a tool card shows in its header. */
export interface ToolCallPresentation {
  icon: string
  /** i18n key under `stage.chat.tool-calls.labels`. */
  labelKey: string
  labelParams: Record<string, string>
  /** `server › tool`, or the tool name, for a tooltip and for unknown tools. */
  rawName: string
}

/** A tool result reduced to readable text and an error flag. */
export interface ToolResultPayload {
  isError: boolean
  text: string
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>
  if (typeof value !== 'string')
    return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

/**
 * Removes the MCP envelope from a tool call.
 *
 * Before:
 * - `builtIn_mcpCallTool`, `{"name":"knowledge::search_knowledge","arguments":"{\"query\":\"vrm\"}"}`
 *
 * After:
 * - `{ server: "knowledge", tool: "search_knowledge", args: { query: "vrm" } }`
 */
export function unwrapToolCall(toolName: string, args: string): UnwrappedToolCall {
  const parsed = parseJsonObject(args)
  if (toolName !== MCP_CALL_TOOL)
    return { server: '', tool: toolName, args: parsed }
  const fullName = typeof parsed.name === 'string' ? parsed.name : ''
  const separator = fullName.indexOf(MCP_NAME_SEPARATOR)
  return {
    server: separator === -1 ? '' : fullName.slice(0, separator),
    tool: separator === -1 ? fullName || toolName : fullName.slice(separator + MCP_NAME_SEPARATOR.length),
    args: parseJsonObject(parsed.arguments),
  }
}

// Stands in for a missing argument, so a label never ends with a bare colon.
const MISSING_VALUE = '…'

function shorten(value: unknown): string {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
  const singleLine = text.replace(/\s+/g, ' ').trim()
  if (!singleLine)
    return MISSING_VALUE
  return singleLine.length > MAX_LABEL_VALUE_CHARS ? `${singleLine.slice(0, MAX_LABEL_VALUE_CHARS - 1)}…` : singleLine
}

/** The last path segment, so labels show `report.pdf` instead of a long absolute path. */
function fileName(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/[\\/]+$/, '') : ''
  return shorten(text.split(/[\\/]/).pop() ?? text)
}

interface LabelRule {
  icon: string
  key: string
  params?: (args: Record<string, unknown>) => Record<string, string>
}

const SEARCH_ICON = 'i-solar:magnifer-linear'
const DOCUMENT_ICON = 'i-solar:document-text-linear'
const FOLDER_ICON = 'i-solar:folder-with-files-linear'
const WIKI_ICON = 'i-solar:book-2-linear'
const WRITE_ICON = 'i-solar:pen-new-square-linear'
const GIT_ICON = 'i-solar:code-square-linear'
const STATUS_ICON = 'i-solar:clock-circle-linear'
const MOTION_ICON = 'i-solar:running-linear'
const GENERIC_ICON = 'i-solar:widget-4-linear'

/** Labels by tool name. Names come from the custom MCP servers in `custom/` and from built-in tools. */
const LABEL_RULES: Record<string, LabelRule> = {
  search_knowledge: { icon: SEARCH_ICON, key: 'search-knowledge', params: args => ({ query: shorten(args.query) }) },
  read_document: { icon: DOCUMENT_ICON, key: 'read-file', params: args => ({ file: fileName(args.path) }) },
  read_file: { icon: DOCUMENT_ICON, key: 'read-file', params: args => ({ file: fileName(args.path) }) },
  list_documents: { icon: DOCUMENT_ICON, key: 'list-documents' },
  list_dir: { icon: FOLDER_ICON, key: 'list-dir', params: args => ({ file: fileName(args.path) }) },
  list_projects: { icon: FOLDER_ICON, key: 'list-projects' },
  find_files: { icon: SEARCH_ICON, key: 'find-files', params: args => ({ query: shorten(args.query) }) },
  add_folder: { icon: FOLDER_ICON, key: 'add-folder', params: args => ({ file: fileName(args.path) }) },
  sync_folders: { icon: FOLDER_ICON, key: 'sync-folders' },
  list_folders: { icon: FOLDER_ICON, key: 'list-folders' },
  remove_folder: { icon: FOLDER_ICON, key: 'remove-folder', params: args => ({ file: fileName(args.path) }) },
  index_status: { icon: STATUS_ICON, key: 'index-status' },
  wiki_build: { icon: WIKI_ICON, key: 'wiki-build', params: args => ({ folder: fileName(args.folder) }) },
  wiki_search: { icon: WIKI_ICON, key: 'wiki-search', params: args => ({ query: shorten(args.query) }) },
  wiki_read_page: { icon: WIKI_ICON, key: 'wiki-read', params: args => ({ page: shorten(args.slug) }) },
  wiki_write_page: { icon: WRITE_ICON, key: 'wiki-write', params: args => ({ page: shorten(args.title ?? args.slug) }) },
  wiki_replace_text: { icon: WRITE_ICON, key: 'wiki-write', params: args => ({ page: shorten(args.slug) }) },
  write_doc: { icon: WRITE_ICON, key: 'write-doc', params: args => ({ title: shorten(args.title) }) },
  list_docs: { icon: DOCUMENT_ICON, key: 'list-docs' },
  git_status: { icon: GIT_ICON, key: 'git-status', params: args => ({ project: shorten(args.project) }) },
  git_log: { icon: GIT_ICON, key: 'git-log', params: args => ({ project: shorten(args.project) }) },
  git_diff: { icon: GIT_ICON, key: 'git-diff', params: args => ({ project: shorten(args.project) }) },
  create_motion: { icon: MOTION_ICON, key: 'create-motion', params: args => ({ name: shorten(args.name) }) },
  generate_motion: { icon: MOTION_ICON, key: 'create-motion', params: args => ({ name: shorten(args.name) }) },
  list_motions: { icon: MOTION_ICON, key: 'list-motions' },
  [MCP_LIST_TOOLS]: { icon: GENERIC_ICON, key: 'list-tools' },
}

/** Chooses the icon and label for a tool card. Unknown tools get a generic label with their name. */
export function describeToolCall(toolName: string, args: string): ToolCallPresentation {
  const call = unwrapToolCall(toolName, args)
  const rawName = call.server ? `${call.server} › ${call.tool}` : call.tool
  const rule = LABEL_RULES[call.tool]
  if (!rule)
    return { icon: GENERIC_ICON, labelKey: 'generic', labelParams: { name: rawName }, rawName }
  return { icon: rule.icon, labelKey: rule.key, labelParams: rule.params?.(call.args) ?? {}, rawName }
}

function textOfContent(content: unknown): string | undefined {
  if (!Array.isArray(content))
    return undefined
  return content
    .map(part => part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
}

/**
 * Reads a tool result. MCP results are `{ content: [{ type: "text", text }], isError? }`, often
 * stored as a JSON string. Other results are shown as they are.
 */
export function parseToolResult(result: unknown, isError = false): ToolResultPayload {
  if (result == null)
    return { isError, text: '' }
  const payload = typeof result === 'string' ? parseJsonObject(result) : result
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    const contentText = textOfContent(record.content)
    if (contentText !== undefined)
      return { isError: isError || record.isError === true, text: contentText.trim() }
  }
  if (typeof result === 'string')
    return { isError, text: result.trim() }
  return { isError, text: JSON.stringify(result, null, 2) }
}
