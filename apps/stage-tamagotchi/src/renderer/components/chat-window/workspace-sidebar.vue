<script setup lang="ts">
import type { ChatSessionMeta } from '@proj-airi/stage-ui/types/chat-session'
import type { ChatWorkspace } from '@proj-airi/stage-ui/types/workspace'

import { errorMessageFrom } from '@moeru/std'
import { extractMessageText } from '@proj-airi/stage-ui/libs/chat-sync/wire-message'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWorkspaces } from '../../composables/use-workspaces'

const { t } = useI18n()
const chat = useChatStore()
const chatSession = useChatSessionStore()
const { sessionMetas, sessionMessages, activeSessionId } = storeToRefs(chatSession)
const { activeCardId } = storeToRefs(useAiriCardStore())
const { userId } = storeToRefs(useAuthStore())
const { workspaces, sessionWorkspaceIds, refresh, pickFolder, remove, reveal, assignSession } = useWorkspaces()

const filterOpen = shallowRef(false)
const filterText = ref('')
const expanded = ref<Record<string, boolean>>({})
const pendingRemoveId = shallowRef<string>()
const creatingIn = shallowRef<string | null>()
const error = shallowRef<string>()

/** Sessions that do not belong to any workspace are grouped under this key. */
const GENERAL = '__general__'

const ownedSessions = computed(() => {
  const effectiveUserId = userId.value || 'local'
  return Object.values(sessionMetas.value)
    .filter(meta => meta.userId === effectiveUserId)
    .sort((first, second) => second.updatedAt - first.updatedAt)
})

const sessionsByGroup = computed(() => {
  const groups: Record<string, ChatSessionMeta[]> = {}
  for (const meta of ownedSessions.value) {
    const workspaceId = sessionWorkspaceIds.value[meta.sessionId]
    const key = workspaceId && workspaces.value.some(workspace => workspace.id === workspaceId) ? workspaceId : GENERAL
    ;(groups[key] ??= []).push(meta)
  }
  return groups
})

const visibleWorkspaces = computed(() => {
  const query = filterText.value.trim().toLowerCase()
  if (!query)
    return workspaces.value
  return workspaces.value.filter(workspace => workspace.name.toLowerCase().includes(query) || workspace.path.toLowerCase().includes(query))
})

function titleFor(meta: ChatSessionMeta): string {
  if (meta.title)
    return meta.title
  for (const message of sessionMessages.value[meta.sessionId] ?? []) {
    // Automatic notices (for example from the Claude Code hook) do not describe the conversation.
    if (message.role !== 'user' || message.origin?.kind === 'automatic')
      continue
    const text = extractMessageText(message).replace(/\s+/g, ' ').trim()
    if (text)
      return text.length > 60 ? `${text.slice(0, 60)}…` : text
  }
  return t('stage.chat.sessions.new-chat-fallback')
}

function isExpanded(key: string) {
  return expanded.value[key] ?? key === sessionWorkspaceIds.value[activeSessionId.value]
}

function toggle(key: string) {
  expanded.value = { ...expanded.value, [key]: !isExpanded(key) }
}

async function run(task: () => Promise<unknown>) {
  error.value = undefined
  try {
    await task()
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t('tamagotchi.stage.chat-window.workspaces.error')
  }
}

function addFolder() {
  return run(async () => {
    const added = await pickFolder()
    if (added) {
      expanded.value = { ...expanded.value, [added.id]: true }
      await newChat(added)
    }
  })
}

async function newChat(workspace?: ChatWorkspace) {
  if (creatingIn.value !== undefined)
    return
  creatingIn.value = workspace?.id ?? null
  try {
    const selectionBeforeCreation = activeSessionId.value
    // Creation runs in the synchronized leader. This window owns its own selection.
    const sessionId = await chatSession.createSession(activeCardId.value || 'default', { setActive: false })
    assignSession(sessionId, workspace?.id)
    if (activeSessionId.value === selectionBeforeCreation)
      await chatSession.setActiveSession(sessionId)
  }
  finally {
    creatingIn.value = undefined
  }
}

function removeWorkspace(workspace: ChatWorkspace) {
  if (pendingRemoveId.value !== workspace.id) {
    pendingRemoveId.value = workspace.id
    return
  }
  pendingRemoveId.value = undefined
  return run(() => remove(workspace.id))
}

// Titles fall back to the first user message, so load the sessions of open groups.
watch(() => [...new Set([...Object.keys(expanded.value), sessionWorkspaceIds.value[activeSessionId.value] ?? ''])].filter(key => key && isExpanded(key)), (keys) => {
  for (const key of keys) {
    for (const meta of sessionsByGroup.value[key] ?? [])
      void chatSession.loadSession(meta.sessionId)
  }
}, { immediate: true })

onMounted(() => run(refresh))
</script>

<template>
  <aside
    data-testid="workspace-sidebar"
    :class="[
      'h-full w-60 flex shrink-0 flex-col border-r',
      'border-neutral-200 bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900/70',
    ]"
  >
    <div :class="['flex items-center gap-1 px-3 pb-1 pt-3']">
      <span :class="['flex-1 text-xs font-semibold tracking-wide uppercase text-neutral-500 dark:text-neutral-400']">
        {{ t('tamagotchi.stage.chat-window.workspaces.title') }}
      </span>
      <button
        :class="[
          'h-7 w-7 flex items-center justify-center rounded-md transition-colors',
          filterOpen ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' : 'text-neutral-400 hover:bg-neutral-200 hover:text-primary-500 dark:hover:bg-neutral-800',
        ]"
        :title="t('tamagotchi.stage.chat-window.workspaces.filter')"
        :aria-label="t('tamagotchi.stage.chat-window.workspaces.filter')"
        :aria-pressed="filterOpen"
        @click="filterOpen = !filterOpen; filterOpen || (filterText = '')"
      >
        <div class="i-solar:filter-outline" />
      </button>
      <button
        :class="['h-7 w-7 flex items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-primary-500 dark:hover:bg-neutral-800']"
        :title="t('tamagotchi.stage.chat-window.workspaces.add')"
        :aria-label="t('tamagotchi.stage.chat-window.workspaces.add')"
        @click="addFolder"
      >
        <div class="i-solar:folder-with-files-outline" />
      </button>
    </div>

    <div v-if="filterOpen" :class="['px-3 pb-2']">
      <input
        v-model="filterText"
        type="search"
        :placeholder="t('tamagotchi.stage.chat-window.workspaces.filter-placeholder')"
        :class="[
          'w-full rounded-md border px-2 py-1 text-sm outline-none',
          'border-neutral-200 bg-white focus:border-primary-400 dark:border-neutral-700 dark:bg-neutral-950',
        ]"
      >
    </div>

    <div :class="['min-h-0 flex-1 overflow-y-auto px-2 pb-3']">
      <div
        v-if="workspaces.length === 0"
        :class="['mx-1 my-3 flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center text-xs text-neutral-500 border-neutral-300 dark:border-neutral-700']"
      >
        <div class="i-solar:folder-open-outline size-6 text-neutral-400" />
        <span>{{ t('tamagotchi.stage.chat-window.workspaces.empty') }}</span>
        <button :class="['rounded-md bg-primary-500 px-2.5 py-1 text-white hover:bg-primary-600']" @click="addFolder">
          {{ t('tamagotchi.stage.chat-window.workspaces.add') }}
        </button>
      </div>

      <ul :class="['m-0 list-none p-0']">
        <li v-for="workspace in visibleWorkspaces" :key="workspace.id" :class="['mb-0.5']">
          <div
            :class="['group flex items-center gap-1 rounded-md pr-1 hover:bg-neutral-200/70 dark:hover:bg-neutral-800/70']"
            @mouseleave="pendingRemoveId === workspace.id && (pendingRemoveId = undefined)"
          >
            <button
              :class="['min-w-0 flex flex-1 items-center gap-1.5 px-1.5 py-1.5 text-left text-sm']"
              :title="workspace.path"
              :aria-expanded="isExpanded(workspace.id)"
              @click="toggle(workspace.id)"
            >
              <div
                :class="[
                  'size-3.5 shrink-0 text-neutral-400 transition-transform i-solar:alt-arrow-right-linear',
                  isExpanded(workspace.id) ? 'rotate-90' : '',
                ]"
              />
              <div :class="['size-4 shrink-0 text-amber-500', isExpanded(workspace.id) ? 'i-solar:folder-open-bold-duotone' : 'i-solar:folder-bold-duotone']" />
              <span :class="['truncate font-medium']">{{ workspace.name }}</span>
            </button>
            <button
              :class="['h-6 w-6 flex shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 hover:text-primary-500 group-hover:opacity-100']"
              :title="t('tamagotchi.stage.chat-window.workspaces.new-chat')"
              :aria-label="t('tamagotchi.stage.chat-window.workspaces.new-chat')"
              @click="newChat(workspace)"
            >
              <div class="i-solar:pen-new-square-outline" />
            </button>
            <button
              :class="['h-6 w-6 flex shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 hover:text-primary-500 group-hover:opacity-100']"
              :title="t('tamagotchi.stage.chat-window.workspaces.reveal')"
              :aria-label="t('tamagotchi.stage.chat-window.workspaces.reveal')"
              @click="run(() => reveal(workspace.id))"
            >
              <div class="i-solar:square-top-down-outline" />
            </button>
            <button
              :class="[
                'h-6 flex shrink-0 items-center justify-center rounded text-red-500 hover:bg-red-500/10',
                pendingRemoveId === workspace.id ? 'px-1.5 text-xs opacity-100' : 'w-6 opacity-0 group-hover:opacity-100',
              ]"
              :title="t('tamagotchi.stage.chat-window.workspaces.remove')"
              :aria-label="t('tamagotchi.stage.chat-window.workspaces.remove')"
              @click="removeWorkspace(workspace)"
            >
              <span v-if="pendingRemoveId === workspace.id">{{ t('tamagotchi.stage.chat-window.workspaces.confirm-remove') }}</span>
              <div v-else class="i-solar:close-circle-outline" />
            </button>
          </div>

          <ul v-if="isExpanded(workspace.id)" :class="['m-0 ml-5 list-none border-l border-neutral-200 p-0 pl-1.5 dark:border-neutral-800']">
            <li v-for="meta in sessionsByGroup[workspace.id] ?? []" :key="meta.sessionId">
              <button
                :class="[
                  'w-full truncate rounded-md px-2 py-1 text-left text-sm',
                  meta.sessionId === activeSessionId
                    ? 'bg-primary-100/80 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200'
                    : 'text-neutral-600 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-800/70',
                ]"
                :aria-current="meta.sessionId === activeSessionId ? 'true' : undefined"
                @click="chatSession.setActiveSession(meta.sessionId)"
              >
                {{ titleFor(meta) }}
              </button>
            </li>
            <li>
              <button
                :class="['w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-200/70 hover:text-primary-500 dark:hover:bg-neutral-800/70']"
                :disabled="creatingIn !== undefined"
                @click="newChat(workspace)"
              >
                <div class="i-solar:add-circle-outline" />
                {{ t('tamagotchi.stage.chat-window.workspaces.new-chat') }}
              </button>
            </li>
          </ul>
        </li>
      </ul>

      <div v-if="(sessionsByGroup[GENERAL] ?? []).length > 0" :class="['mt-3']">
        <button
          :class="['w-full flex items-center gap-1.5 px-1.5 py-1 text-left text-xs font-semibold tracking-wide uppercase text-neutral-500 dark:text-neutral-400']"
          :aria-expanded="isExpanded(GENERAL)"
          @click="toggle(GENERAL)"
        >
          <div :class="['size-3.5 transition-transform i-solar:alt-arrow-right-linear', isExpanded(GENERAL) ? 'rotate-90' : '']" />
          {{ t('tamagotchi.stage.chat-window.workspaces.general') }}
        </button>
        <ul v-if="isExpanded(GENERAL)" :class="['m-0 list-none p-0']">
          <li v-for="meta in sessionsByGroup[GENERAL]" :key="meta.sessionId" :class="['group flex items-center']">
            <button
              :class="[
                'min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-sm',
                meta.sessionId === activeSessionId
                  ? 'bg-primary-100/80 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200'
                  : 'text-neutral-600 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-800/70',
              ]"
              @click="chatSession.setActiveSession(meta.sessionId)"
            >
              {{ titleFor(meta) }}
            </button>
            <button
              :class="['h-6 w-6 flex shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 hover:text-red-500 group-hover:opacity-100']"
              :title="t('stage.chat.sessions.delete')"
              :aria-label="t('stage.chat.sessions.delete')"
              @click="chat.deleteSession(meta.sessionId)"
            >
              <div class="i-solar:trash-bin-trash-outline" />
            </button>
          </li>
        </ul>
      </div>
    </div>

    <p v-if="error" role="alert" :class="['m-0 border-t px-3 py-2 text-xs text-red-500 border-neutral-200 dark:border-neutral-800']">
      {{ error }}
    </p>

    <div :class="['border-t p-2 border-neutral-200 dark:border-neutral-800']">
      <button
        :class="['w-full flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-800/70']"
        :disabled="creatingIn !== undefined"
        @click="newChat()"
      >
        <div class="i-solar:chat-round-line-outline" />
        {{ t('tamagotchi.stage.chat-window.workspaces.new-general-chat') }}
      </button>
    </div>
  </aside>
</template>
