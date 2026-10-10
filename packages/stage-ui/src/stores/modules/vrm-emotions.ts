import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

/** Emotions the VRM stage can show, in display order. Matches `VRM_EMOTION_NAMES` in stage-ui-three. */
export const vrmEmotionNames = ['happy', 'laugh', 'sad', 'surprised', 'angry', 'awkward', 'think', 'curious', 'question', 'relaxed', 'neutral'] as const

export type VrmEmotionName = typeof vrmEmotionNames[number]

/** A strong `happy` from the character plays as a laugh. */
const LAUGH_INTENSITY = 0.8

/**
 * Emotions shown on the VRM model while chatting: a face plus a little head and body movement,
 * played when the character's reply carries an ACT emotion token.
 */
export const useVrmEmotionsStore = defineStore('vrm-emotions', () => {
  const enabled = useLocalStorageManualReset('settings/vrm-emotions/enabled', true)
  /** Scales every emotion, 0 to 2. */
  const strength = useLocalStorageManualReset('settings/vrm-emotions/strength', 1)
  const { data, post } = useBroadcastChannel<{ name: string }, { name: string }>({ name: 'airi:vrm-emotion-preview' })
  /** The latest preview request from the settings window. The stage watches it. */
  const previewRequest = ref<{ name: string, at: number }>()

  /** The preset to play for an ACT emotion from the character. */
  function presetFor(emotion: string, intensity: number) {
    if (emotion === 'happy' && intensity >= LAUGH_INTENSITY)
      return 'laugh'
    return emotion
  }

  function preview(name: VrmEmotionName) {
    post({ name })
    previewRequest.value = { name, at: Date.now() }
  }

  watch(data, (event) => {
    if (event?.name)
      previewRequest.value = { name: event.name, at: Date.now() }
  })

  function resetState() {
    enabled.reset()
    strength.reset()
  }

  return { enabled, strength, previewRequest, presetFor, preview, resetState }
})
