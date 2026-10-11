<script setup lang="ts">
import { ChatSessionsDrawer } from '@proj-airi/stage-ui/components'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useLocalStorage, useWindowSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatSpeechMuteButton from '../components/chat-window/chat-speech-mute-button.vue'
import ChatWindowStyleMenu from '../components/chat-window/chat-window-style-menu.vue'
import WorkspaceSidebar from '../components/chat-window/workspace-sidebar.vue'
import InteractiveArea from '../components/InteractiveArea.vue'
import WindowTitleBar from '../components/Window/TitleBar.vue'
import ChatPageShell from './chat-page-shell.vue'

import { useChatDraftHandover } from '../composables/use-chat-draft-handover'

const { activeCard } = storeToRefs(useAiriCardStore())
const sessionsDrawerOpen = shallowRef(false)
const interactiveArea = useTemplateRef<InstanceType<typeof InteractiveArea>>('interactive-area')

useChatDraftHandover(interactiveArea)

const { t } = useI18n()
const { width } = useWindowSize()
const sidebarPreferred = useLocalStorage('chat/workspaces/sidebar-open', true)
// A narrow window keeps the whole width for the conversation.
const sidebarOpen = computed(() => sidebarPreferred.value && width.value >= 560)
</script>

<template>
  <ChatPageShell>
    <WindowTitleBar
      :title="activeCard?.name || 'AIRI'"
      icon="i-solar:chat-line-bold"
      @title-click="sessionsDrawerOpen = true"
    >
      <template #actions>
        <button
          data-testid="workspace-sidebar-toggle"
          :class="[
            'h-7 w-7 flex items-center justify-center rounded-md outline-none transition-colors',
            sidebarOpen
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300'
              : 'text-neutral-400 hover:bg-neutral-200 hover:text-primary-500 dark:text-neutral-500 dark:hover:bg-neutral-800',
          ]"
          :title="t('tamagotchi.stage.chat-window.workspaces.toggle')"
          :aria-label="t('tamagotchi.stage.chat-window.workspaces.toggle')"
          :aria-pressed="sidebarOpen"
          @click="sidebarPreferred = !sidebarOpen"
        >
          <div class="i-solar:sidebar-minimalistic-outline" />
        </button>
        <ChatSpeechMuteButton />
        <ChatWindowStyleMenu />
      </template>
    </WindowTitleBar>
    <div class="h-full w-full flex">
      <WorkspaceSidebar v-if="sidebarOpen" />
      <div class="h-full min-w-0 flex-1">
        <InteractiveArea
          ref="interactive-area"
          class="interaction-area block"
          h-full w-full transition="opacity duration-250"
        />
      </div>
    </div>
    <ChatSessionsDrawer v-model="sessionsDrawerOpen" />
  </ChatPageShell>
</template>

<route lang="yaml">
meta:
  layout: stage
</route>
