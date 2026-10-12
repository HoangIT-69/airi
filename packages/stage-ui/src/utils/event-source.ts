import type { MetadataEventSource } from '@proj-airi/server-sdk'

import type { ChatMessageOrigin } from '../types/chat'

interface EventSourcePayload {
  source?: string
  metadata?: { source?: MetadataEventSource }
}

/**
 * Returns a human-readable source label for extension identities.
 *
 * Use when:
 * - UI stores need to display or compare websocket event sources
 * - Protocol metadata may come from extension, module, or kit peers
 *
 * Expects:
 * - `source` is a protocol metadata identity from server-shared/server-sdk
 *
 * Returns:
 * - A stable label, preferring extension-scoped module ids
 */
export function getMetadataSourceLabel(source?: MetadataEventSource) {
  if (!source)
    return undefined

  if ('extension' in source) {
    return `${source.extension.id}:${source.id}`
  }

  return source.id
}

function formatMetadataSource(source?: MetadataEventSource) {
  if (!source)
    return undefined

  return getMetadataSourceLabel(source)
}

export function getEventSourceKey(event: EventSourcePayload, fallback = 'unknown') {
  return (
    formatMetadataSource(event.metadata?.source)
    ?? event.source
    ?? fallback
  )
}

/**
 * Marks a user turn as automatic when a plugin sent it, for example the Claude Code notify hook.
 *
 * Use when:
 * - An `input:text` event becomes a chat turn and the chat must show it as a notice
 *
 * Returns:
 * - `{ kind: 'automatic', source: <plugin id>, summary? }` for plugin sources, otherwise `undefined`
 */
export function getAutomaticChatOrigin(source?: MetadataEventSource, summary?: string): ChatMessageOrigin | undefined {
  if (!source || !('kind' in source) || source.kind !== 'plugin')
    return undefined
  const text = summary?.trim()
  return { kind: 'automatic', source: source.plugin.id, ...(text ? { summary: text } : {}) }
}
