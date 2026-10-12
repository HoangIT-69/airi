<script setup lang="ts">
import type { ChatHistoryItem } from '../../../../types/chat'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { getChatHistoryItemCopyText } from '../utils'

/** A user turn that a plugin or hook sent, shown as a one-line event instead of a user bubble. */
const props = defineProps<{
  message: ChatHistoryItem
}>()

// Product names of known senders. Unknown plugins show their id.
const SOURCE_NAMES: Record<string, string> = {
  'proj-airi:claude-code-notify': 'Claude Code',
}
// Hook texts start with an instruction in brackets for the model. The notice shows what follows it.
const LEADING_INSTRUCTION = /^\s*\[[^\]]*\]\s*/

const { t } = useI18n()
const expanded = ref(false)

const sourceName = computed(() => {
  const source = props.message.origin?.source ?? ''
  return SOURCE_NAMES[source] ?? source
})
const fullText = computed(() => getChatHistoryItemCopyText(props.message).trim())
const summary = computed(() => props.message.origin?.summary || fullText.value.replace(LEADING_INSTRUCTION, '').split('\n')[0] || fullText.value)
</script>

<template>
  <div class="w-full flex justify-center px-6 py-1">
    <button
      :class="[
        'max-w-full rounded-full px-3 py-1 text-start text-xs',
        'inline-flex items-start gap-1.5',
        'bg-neutral-200/60 text-neutral-600 hover:bg-neutral-200',
        'dark:bg-neutral-800/60 dark:text-neutral-300 dark:hover:bg-neutral-800',
        'focus-visible:outline-2 focus-visible:outline-primary-400',
      ]"
      :aria-expanded="expanded"
      :aria-label="t('stage.chat.notice.label', { source: sourceName })"
      @click="expanded = !expanded"
    >
      <div class="i-solar:bell-linear mt-0.5 shrink-0" />
      <span class="shrink-0 font-semibold">{{ sourceName }}</span>
      <span :class="expanded ? 'whitespace-pre-wrap break-words' : 'truncate'">
        {{ expanded ? fullText : summary }}
      </span>
    </button>
  </div>
</template>
