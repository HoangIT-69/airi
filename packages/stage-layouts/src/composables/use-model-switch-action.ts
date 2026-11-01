import { useStageModelSwitch } from '@proj-airi/stage-ui/composables/use-stage-model-switch'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

/** Label, state, and click handler for the web "switch between VRM and 2D model" control. */
export function useModelSwitchAction() {
  const { t } = useI18n()
  const { isVrm, switching, switchModel } = useStageModelSwitch()

  const label = computed(() => isVrm.value
    ? t('stage.mobile-tools.switch-to-2d')
    : t('stage.mobile-tools.switch-to-vrm'))

  async function runModelSwitch() {
    if (!await switchModel())
      toast.error(t('stage.mobile-tools.no-model-to-switch'))
  }

  return { isVrm, switching, label, runModelSwitch }
}
