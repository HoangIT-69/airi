<script setup lang="ts">
import type { DisplayModel } from '@proj-airi/stage-ui/stores/display-models'

import { DisplayModelFormat, useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { useLocalStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import ControlButtonTooltip from './control-button-tooltip.vue'
import ControlButton from './control-button.vue'

defineProps<{
  buttonStyle: string
  iconClass: string
}>()

const { t } = useI18n()
const settingsStore = useSettings()
const displayModelsStore = useDisplayModelsStore()
const { stageModelSelected, stageModelRenderer } = storeToRefs(settingsStore)

// The last model picked in each family, so one click flips between the two the user actually uses.
const lastFlatModelId = useLocalStorage('settings/stage/model-switch/last-2d', '')
const lastVrmModelId = useLocalStorage('settings/stage/model-switch/last-vrm', '')

const isVrm = computed(() => stageModelRenderer.value === 'vrm')
const switching = ref(false)

watch([stageModelSelected, stageModelRenderer], ([id, renderer]) => {
  if (!id)
    return
  if (renderer === 'vrm')
    lastVrmModelId.value = id
  else if (renderer === 'live2d' || renderer === 'spine')
    lastFlatModelId.value = id
}, { immediate: true })

const flatFormats = [DisplayModelFormat.SpineZip, DisplayModelFormat.Live2dZip]

function pickFallback(models: DisplayModel[], formats: DisplayModelFormat[]) {
  // Prefer the user's own imports over the bundled presets, newest first.
  const candidates = models.filter(model => formats.includes(model.format))
  return candidates.find(model => model.type === 'file') ?? candidates[0]
}

async function switchModel() {
  if (switching.value)
    return
  switching.value = true
  try {
    await displayModelsStore.loadDisplayModelsFromIndexedDB()
    const models = displayModelsStore.displayModels
    const wantVrm = !isVrm.value
    const formats = wantVrm ? [DisplayModelFormat.VRM] : flatFormats
    const rememberedId = wantVrm ? lastVrmModelId.value : lastFlatModelId.value
    const remembered = models.find(model => model.id === rememberedId && formats.includes(model.format))
    const target = remembered ?? pickFallback(models, formats)

    if (!target) {
      toast.error(t('tamagotchi.stage.controls-island.no-model-to-switch'))
      return
    }

    stageModelSelected.value = target.id
  }
  finally {
    switching.value = false
  }
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
