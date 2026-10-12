<script setup lang="ts">
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { parseToolResult } from '@proj-airi/stage-ui/components/scenarios/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { electronMcpCallTool } from '../../../shared/eventa'
import { workspacesRevealFile } from '../../../shared/eventa/workspaces'
import { collectSessionActivity } from '../../composables/session-activity'

/** Right-hand panel of the chat window: tool steps, written files, and background jobs of the active chat. */

const STATE_ICONS = {
  executing: 'i-eos-icons:loading op-60',
  done: 'i-solar:check-circle-bold-duotone text-emerald-500',
  error: 'i-solar:danger-circle-bold-duotone text-red-500',
} as const

const { t } = useI18n()
const { sessionMessages, activeSessionId } = storeToRefs(useChatSessionStore())
const { streamingMessage } = storeToRefs(useChatStreamStore())
const callMcpTool = useElectronEventaInvoke(electronMcpCallTool)
const revealFile = useElectronEventaInvoke(workspacesRevealFile)

const jobStatus = ref<Record<string, string>>({})
const error = ref('')

const activity = computed(() => {
  const messages: ChatHistoryItem[] = [...(sessionMessages.value[activeSessionId.value] ?? [])]
  // The reply being written is not stored yet. Show its steps while they run.
  if (streamingMessage.value?.slices?.length)
    messages.push(streamingMessage.value as ChatHistoryItem)
  return collectSessionActivity(messages)
})
const isEmpty = computed(() => activity.value.steps.length === 0)

function stepLabel(labelKey: string, params: Record<string, string>) {
  return t(`stage.chat.tool-calls.labels.${labelKey}`, params)
}

async function run(task: () => Promise<unknown>) {
  error.value = ''
  try {
    await task()
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('tamagotchi.stage.chat-window.activity.error')
  }
}

function refreshJob(id: string) {
  return run(async () => {
    const result = await callMcpTool({ name: 'knowledge::index_status', arguments: { jobId: id } })
    jobStatus.value = { ...jobStatus.value, [id]: parseToolResult(result, result.isError).text }
  })
}
</script>

<template>
  <aside
    data-testid="activity-panel"
    :class="[
      'h-full w-72 shrink-0 flex flex-col gap-3 overflow-y-auto p-3 text-sm',
      'border-l border-neutral-200 bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-900/60',
    ]"
  >
    <h2 class="text-xs text-neutral-500 font-semibold tracking-wide uppercase dark:text-neutral-400">
      {{ t('tamagotchi.stage.chat-window.activity.title') }}
    </h2>

    <p v-if="error" role="alert" class="text-xs text-red-500">
      {{ error }}
    </p>

    <p v-if="isEmpty" class="text-xs text-neutral-500 dark:text-neutral-400">
      {{ t('tamagotchi.stage.chat-window.activity.empty') }}
    </p>

    <section v-if="activity.jobs.length" class="flex flex-col gap-1">
      <h3 class="text-xs text-neutral-500 font-medium dark:text-neutral-400">
        {{ t('tamagotchi.stage.chat-window.activity.jobs') }}
      </h3>
      <div
        v-for="job in activity.jobs"
        :key="job.id"
        class="flex flex-col gap-1 rounded-md bg-white/70 p-2 dark:bg-neutral-800/60"
      >
        <div class="flex items-center gap-1.5">
          <div :class="[job.presentation.icon, 'shrink-0 op-70']" />
          <span class="min-w-0 flex-1 truncate text-xs">{{ stepLabel(job.presentation.labelKey, job.presentation.labelParams) }}</span>
          <button
            :class="[
              'h-6 w-6 flex shrink-0 items-center justify-center rounded',
              'text-neutral-500 hover:bg-neutral-200 hover:text-primary-500 dark:hover:bg-neutral-700',
              'focus-visible:outline-2 focus-visible:outline-primary-400',
            ]"
            :title="t('tamagotchi.stage.chat-window.activity.refresh')"
            :aria-label="t('tamagotchi.stage.chat-window.activity.refresh')"
            @click="refreshJob(job.id)"
          >
            <div class="i-solar:refresh-linear" />
          </button>
        </div>
        <code class="text-xs op-60">job {{ job.id }}</code>
        <p v-if="jobStatus[job.id]" class="whitespace-pre-wrap break-words text-xs">
          {{ jobStatus[job.id] }}
        </p>
      </div>
    </section>

    <section v-if="activity.files.length" class="flex flex-col gap-1">
      <h3 class="text-xs text-neutral-500 font-medium dark:text-neutral-400">
        {{ t('tamagotchi.stage.chat-window.activity.files') }}
      </h3>
      <button
        v-for="file in activity.files"
        :key="file.path"
        :class="[
          'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-xs',
          'bg-white/70 hover:bg-primary-50 dark:bg-neutral-800/60 dark:hover:bg-neutral-800',
          'focus-visible:outline-2 focus-visible:outline-primary-400',
        ]"
        :title="`${t('tamagotchi.stage.chat-window.activity.reveal')}: ${file.path}`"
        :aria-label="`${t('tamagotchi.stage.chat-window.activity.reveal')}: ${file.name}`"
        @click="run(() => revealFile({ path: file.path }))"
      >
        <div class="i-solar:document-text-linear shrink-0 op-70" />
        <span class="min-w-0 flex-1 truncate">{{ file.name }}</span>
        <div class="i-solar:folder-open-linear shrink-0 op-50" />
      </button>
    </section>

    <section v-if="activity.steps.length" class="flex flex-col gap-1">
      <h3 class="text-xs text-neutral-500 font-medium dark:text-neutral-400">
        {{ t('tamagotchi.stage.chat-window.activity.steps') }}
      </h3>
      <ol class="flex flex-col gap-0.5">
        <li
          v-for="step in activity.steps"
          :key="step.key"
          class="flex items-center gap-1.5 px-1 py-0.5 text-xs"
          :title="step.presentation.rawName"
        >
          <div :class="[STATE_ICONS[step.state], 'shrink-0']" />
          <div :class="[step.presentation.icon, 'shrink-0 op-60']" />
          <span class="min-w-0 flex-1 truncate">{{ stepLabel(step.presentation.labelKey, step.presentation.labelParams) }}</span>
        </li>
      </ol>
    </section>
  </aside>
</template>
