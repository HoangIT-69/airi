<script setup lang="ts">
import type { VrmMotionEntry } from '../../../../stores/modules/vrm-motions'

import { DropdownMenu, GhostButton } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from 'reka-ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useVrmMotionsStore } from '../../../../stores/modules/vrm-motions'

const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** A pose was picked. The stage already plays it. The caller can also send a chat message. */
  (e: 'pick', entry: VrmMotionEntry): void
  /** The user wants to import or edit poses. */
  (e: 'manage'): void
}>()

const { t } = useI18n()
const store = useVrmMotionsStore()
const { entries, enabled } = storeToRefs(store)
const open = ref(false)

const itemClasses = [
  'w-full flex cursor-pointer select-none flex-col items-start rounded-lg px-3 py-1.5 text-left outline-none',
  'data-[highlighted]:bg-neutral-100 dark:data-[highlighted]:bg-neutral-700/60',
]

function pick(entry: VrmMotionEntry) {
  store.requestPlay(entry.id)
  emit('pick', entry)
}
</script>

<template>
  <!-- The menu renders in a portal, so a composer with overflow-hidden does not clip it. -->
  <div v-if="enabled" :class="['relative']">
    <DropdownMenu
      v-model:open="open"
      :modal="false"
      side="top"
      align="start"
      :disabled="props.disabled"
      :content-class="['w-64 max-w-[calc(100vw-1rem)]']"
    >
      <template #trigger>
        <GhostButton
          size="unset"
          :class="['size-9']"
          :title="t('settings.pages.modules.motion.picker.open')"
          :aria-label="t('settings.pages.modules.motion.picker.open')"
          :active="open"
          :disabled="props.disabled"
        >
          <span :class="['i-solar:running-round-bold-duotone h-5 w-5']" />
        </GhostButton>
      </template>
      <DropdownMenuLabel :class="['px-3 pb-1 pt-2 text-xs font-medium text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.modules.motion.picker.title') }}
      </DropdownMenuLabel>
      <div :class="['max-h-72 overflow-y-auto pb-1']">
        <DropdownMenuItem
          v-for="entry in entries"
          :key="entry.id"
          :class="itemClasses"
          @select="pick(entry)"
        >
          <span :class="['text-sm font-medium text-neutral-800 dark:text-neutral-100']">{{ entry.name }}</span>
          <span v-if="entry.description" :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ entry.description }}</span>
        </DropdownMenuItem>
      </div>
      <p v-if="!entries.length" :class="['px-3 pb-3 text-sm text-neutral-600 dark:text-neutral-400']">
        {{ t('settings.pages.modules.motion.picker.empty') }}
      </p>
      <DropdownMenuSeparator :class="['my-1 h-px bg-neutral-200 dark:bg-neutral-700']" />
      <DropdownMenuItem
        :class="[itemClasses, 'text-sm text-primary-600 dark:text-primary-400']"
        @select="emit('manage')"
      >
        {{ t('settings.pages.modules.motion.picker.manage') }}
      </DropdownMenuItem>
    </DropdownMenu>
  </div>
</template>
