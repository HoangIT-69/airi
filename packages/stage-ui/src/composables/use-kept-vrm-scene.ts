import type { MaybeRefOrGetter } from 'vue'

import type { StageModelRenderer } from '../stores/settings/stage-model'

import { computed, ref, shallowRef, toValue, watch } from 'vue'

export interface KeptVrmSceneModel {
  id: string
  src: string | undefined
}

export interface UseKeptVrmSceneOptions {
  renderer: MaybeRefOrGetter<StageModelRenderer>
  modelId: MaybeRefOrGetter<string>
  modelSrc: MaybeRefOrGetter<string | undefined>
  /** Phones free the scene instead, because two WebGL contexts and a VRM cost too much memory there. */
  keepAlive: MaybeRefOrGetter<boolean>
}

/**
 * Keeps the VRM scene mounted after the stage switches to another renderer.
 * Switching back then skips the download, parse, texture upload, and shader compile of the VRM.
 */
export function useKeptVrmScene(options: UseKeptVrmSceneOptions) {
  const active = computed(() => toValue(options.renderer) === 'vrm')
  const kept = ref(false)
  /** The VRM the scene shows. It stays on the last VRM while another renderer is on stage. */
  const model = shallowRef<KeptVrmSceneModel>()

  watch(
    [active, () => toValue(options.modelId), () => toValue(options.modelSrc), () => toValue(options.keepAlive)],
    ([isActive, id, src, keepAlive]) => {
      if (isActive) {
        model.value = { id, src }
        kept.value = keepAlive
        return
      }
      if (!keepAlive)
        kept.value = false
    },
    { immediate: true },
  )

  const mounted = computed(() => active.value || kept.value)

  return { active, mounted, model }
}
