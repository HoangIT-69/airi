<script setup lang="ts">
import { ContainerError } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatToolCallShell from './tool-call-shell.vue'

import { createToolResultError } from './tool-call-display'
import { describeToolCall, parseToolResult, unwrapToolCall } from './tool-call-presentation'

const props = defineProps<{
  toolCallId: string
  toolName: string
  args: string
  state?: 'executing' | 'done' | 'error'
  result?: unknown
}>()

const emit = defineEmits<{
  (e: 'toolCallRerun', payload: { toolCallId: string, toolName: string, args: string }): void
}>()

// Long results stay readable in a chat bubble. The full text is still in the stored message.
const MAX_RESULT_CHARS = 4000

const { t } = useI18n()

const presentation = computed(() => describeToolCall(props.toolName, props.args))
const label = computed(() => t(`stage.chat.tool-calls.labels.${presentation.value.labelKey}`, presentation.value.labelParams))
const resultPayload = computed(() => parseToolResult(props.result))
const resultError = computed(() => props.state === 'error' ? createToolResultError(resultPayload.value.text || props.result) : undefined)
const resultText = computed(() => {
  const text = resultPayload.value.text
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text
})

const formattedArgs = computed(() => {
  const unwrapped = unwrapToolCall(props.toolName, props.args)
  if (Object.keys(unwrapped.args).length > 0)
    return JSON.stringify(unwrapped.args, null, 2)
  try {
    return JSON.stringify(JSON.parse(props.args), null, 2).trim()
  }
  catch {
    return props.args
  }
})

function emitToolCallRerun() {
  emit('toolCallRerun', {
    toolCallId: props.toolCallId,
    toolName: props.toolName,
    args: props.args,
  })
}
</script>

<template>
  <ChatToolCallShell
    :tool-name="presentation.rawName"
    :state="state"
    :label="label"
    :icon="presentation.icon"
  >
    <template #actions>
      <button
        aria-label="Re-run tool call"
        :class="[
          'h-6 w-6 shrink-0 rounded-md',
          'inline-flex items-center justify-center',
          'text-primary-700/70 hover:bg-primary-200/70 hover:text-primary-800',
          'dark:text-primary-100/70 dark:hover:bg-primary-800/70 dark:hover:text-primary-50',
        ]"
        @click.stop="emitToolCallRerun"
      >
        <div class="i-solar:refresh-bold text-sm" />
      </button>
    </template>

    <div class="flex flex-col gap-2">
      <ContainerError
        v-if="resultError"
        :error="resultError"
        :include-stack="false"
        :show-feedback-button="false"
        height-preset="auto"
      />
      <div v-else-if="state === 'done' && resultText">
        <div class="mb-1 text-xs op-60">
          {{ t('stage.chat.tool-calls.result') }}
        </div>
        <div class="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">
          {{ resultText }}
        </div>
      </div>
      <div>
        <div class="mb-1 text-xs op-60">
          {{ t('stage.chat.tool-calls.arguments') }}
        </div>
        <div class="whitespace-pre-wrap break-words text-xs font-mono">
          {{ formattedArgs }}
        </div>
      </div>
    </div>
  </ChatToolCallShell>
</template>
