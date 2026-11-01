<script setup lang="ts">
import { useStageModelSwitch } from '@proj-airi/stage-ui/composables/use-stage-model-switch'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import ControlButtonTooltip from './control-button-tooltip.vue'
import ControlButton from './control-button.vue'

defineProps<{
  buttonStyle: string
  iconClass: string
}>()

const { t } = useI18n()
const { isVrm, switching, switchModel: switchStageModel } = useStageModelSwitch()

async function switchModel() {
  if (!await switchStageModel())
    toast.error(t('tamagotchi.stage.controls-island.no-model-to-switch'))
}

const label = computed(() => isVrm.value
  ? t('tamagotchi.stage.controls-island.switch-to-2d')
  : t('tamagotchi.stage.controls-island.switch-to-vrm'))
</script>

<template>
  <ControlButtonTooltip side="inward">
    <ControlButton
      v-track-button="{ name: 'controls_island_action', action: isVrm ? 'switch_to_2d_model' : 'switch_to_vrm_model' }"
      :button-style="buttonStyle"
      :aria-label="label"
      :disabled="switching"
      @click="switchModel"
    >
      <div v-if="isVrm" i-solar:gallery-linear :class="iconClass" text="neutral-800 dark:neutral-300" />
      <div v-else i-solar:box-linear :class="iconClass" text="neutral-800 dark:neutral-300" />
    </ControlButton>
    <template #tooltip>
      {{ label }}
    </template>
  </ControlButtonTooltip>
</template>
