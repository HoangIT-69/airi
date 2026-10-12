<script setup lang="ts">
import { Collapsible } from '@proj-airi/ui'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

/** Properties for the collapsible list that groups several tool calls of one turn. */
const props = defineProps<{
  count: number
  /** True while any call in the list has no result yet. */
  running: boolean
  /** True when any call in the list failed. */
  failed: boolean
}>()

defineSlots<{
  default: (props: Record<string, never>) => unknown
}>()

const { t } = useI18n()

// Open while the assistant works, folded once every step is done, like other agent UIs.
const open = ref(props.running)
watch(() => props.running, (running) => {
  open.value = running
})
</script>

<template>
  <Collapsible
    v-model="open"
    :class="[
      'w-full rounded-lg border border-primary-200/60 px-2 py-1 dark:border-primary-800/60',
      'flex flex-col items-start',
    ]"
  >
    <template #trigger="{ visible, setVisible }">
      <button
        :class="[
          'min-h-6 w-full text-start text-xs',
          'inline-flex items-center gap-1',
          'text-primary-700/80 dark:text-primary-100/80',
        ]"
        :aria-expanded="visible"
        @click="setVisible(!visible)"
      >
        <div v-if="running" class="i-eos-icons:loading shrink-0 op-60" />
        <div v-else-if="failed" class="i-solar:danger-circle-bold-duotone shrink-0 text-red-500" />
        <div v-else class="i-solar:checklist-minimalistic-linear shrink-0 op-70" />
        <span class="flex-1 truncate">
          {{ running ? t('stage.chat.tool-calls.steps.running', { count }) : t('stage.chat.tool-calls.steps.done', { count }) }}
        </span>
        <div :class="[visible ? 'i-solar:alt-arrow-up-linear' : 'i-solar:alt-arrow-down-linear', 'shrink-0 op-60']" />
      </button>
    </template>
    <div class="mt-1 w-full flex flex-col gap-1 border-l-2 border-primary-200/70 pl-2 dark:border-primary-800/70">
      <slot />
    </div>
  </Collapsible>
</template>
