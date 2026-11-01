import type { DisplayModel } from '../stores/display-models'

import { useLocalStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { DisplayModelFormat, useDisplayModelsStore } from '../stores/display-models'
import { useSettings } from '../stores/settings'

/** Formats the switch treats as the 2D family. */
export const FLAT_MODEL_FORMATS: readonly DisplayModelFormat[] = [DisplayModelFormat.SpineZip, DisplayModelFormat.Live2dZip]

/**
 * Picks the model to show after a switch.
 * The model last used in the target family wins. Otherwise the newest user import, then a preset.
 */
export function pickSwitchTarget(models: DisplayModel[], wantVrm: boolean, rememberedId: string): DisplayModel | undefined {
  const formats = wantVrm ? [DisplayModelFormat.VRM] : FLAT_MODEL_FORMATS
  const candidates = models.filter(model => formats.includes(model.format))
  return candidates.find(model => model.id === rememberedId)
    ?? candidates.find(model => model.type === 'file')
    ?? candidates[0]
}

/**
 * One-click switch between the VRM model and the 2D (Spine or Live2D) model the user last used.
 * Shared by the desktop controls island and the web toolbars.
 */
export function useStageModelSwitch() {
  const settingsStore = useSettings()
  const displayModelsStore = useDisplayModelsStore()
  const { stageModelSelected, stageModelRenderer, stageModelSelectedDisplayModel } = storeToRefs(settingsStore)

  const lastFlatModelId = useLocalStorage('settings/stage/model-switch/last-2d', '')
  const lastVrmModelId = useLocalStorage('settings/stage/model-switch/last-vrm', '')

  const isVrm = computed(() => stageModelRenderer.value === 'vrm')
  const switching = ref(false)

  // Read the family from the loaded model itself: the selected id changes before
  // the renderer catches up, so pairing those two would file a model under the wrong family.
  watch(stageModelSelectedDisplayModel, (model) => {
    if (!model)
      return
    if (model.format === DisplayModelFormat.VRM)
      lastVrmModelId.value = model.id
    else if (FLAT_MODEL_FORMATS.includes(model.format))
      lastFlatModelId.value = model.id
  }, { immediate: true })

  /** Returns false when no model of the other family exists. */
  async function switchModel(): Promise<boolean> {
    if (switching.value)
      return true
    switching.value = true
    try {
      await displayModelsStore.loadDisplayModelsFromIndexedDB()
      const wantVrm = !isVrm.value
      const target = pickSwitchTarget(
        displayModelsStore.displayModels,
        wantVrm,
        wantVrm ? lastVrmModelId.value : lastFlatModelId.value,
      )
      if (!target)
        return false
      stageModelSelected.value = target.id
      return true
    }
    finally {
      switching.value = false
    }
  }

  return { isVrm, switching, switchModel }
}
