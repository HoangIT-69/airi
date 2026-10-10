<script setup lang="ts">
import type { VrmMotionEntry } from '../../../../stores/modules/vrm-motions'

import { GhostButton } from '@proj-airi/ui'
import { onClickOutside } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useVrmMotionsStore } from '../../../../stores/modules/vrm-motions'

const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** A pose was picked. The stage already plays it; the caller may also send a chat message. */
  (e: 'pick', entry: VrmMotionEntry): void
  /** The user wants to import or edit poses. */
  (e: 'manage'): void
}>()

const { t } = useI18n()
const store = useVrmMotionsStore()
const { entries, enabled } = storeToRefs(store)
const open = ref(false)
const container = useTemplateRef<HTMLElement>('container')

onClickOutside(container, () => {
  open.value = false
})

function pick(entry: VrmMotionEntry) {
  open.value = false
  store.requestPlay(entry.id)
  emit('pick', entry)
}
</script>

<template>
  <div v-if="enabled" ref="container" :class="['relative']">
    <GhostButton
      size="unset"
      :class="['size-9']"
      :title="t('settings.pages.modules.motion.picker.open')"
      :aria-label="t('settings.pages.modules.motion.picker.open')"
      :aria-expanded="open"
      :active="open"
      :disabled="props.disabled"
      @click="open = !open"
    >
      <span :class="['i-solar:running-round-bold-duotone h-5 w-5']" />
    </GhostButton>
    <div
      v-if="open"
      role="menu"
      :aria-label="t('settings.pages.modules.motion.picker.title')"
      :class="[
        'absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-xl',
        'border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900',
      ]"
    >
      <div :class="['px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.pages.modules.motion.picker.title') }}
      </div>
      <ul :class="['max-h-72 overflow-y-auto pb-1']">
        <li v-for="entry in entries" :key="entry.id">
          <button
            type="button"
            role="menuitem"
            :class="[
              'w-full flex flex-col items-start px-3 py-1.5 text-left',
              'hover:bg-neutral-100 focus-visible:bg-neutral-100 dark:hover:bg-neutral-800 dark:focus-visible:bg-neutral-800 outline-none',
            ]"
            @click="pick(entry)"
          >
            <span :class="['text-sm font-medium text-neutral-800 dark:text-neutral-100']">{{ entry.name }}</span>
            <span v-if="entry.description" :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ entry.description }}</span>
          </button>
        </li>
      </ul>
      <p v-if="!entries.length" :class="['px-3 pb-3 text-sm text-neutral-600 dark:text-neutral-400']">
        {{ t('settings.pages.modules.motion.picker.empty') }}
      </p>
      <button
        type="button"
        :class="['w-full border-t border-neutral-200 px-3 py-2 text-left text-sm text-primary-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-primary-400 dark:hover:bg-neutral-800']"
        @click="open = false; emit('manage')"
      >
        {{ t('settings.pages.modules.motion.picker.manage') }}
      </button>
    </div>
  </div>
</template>
