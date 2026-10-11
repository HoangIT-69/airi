<script setup lang="ts">
import type { Emotion } from '../../constants/emotions'

import { Screen } from '@proj-airi/ui'
import { ref, watch } from 'vue'

import SpineCanvas from './spine/Canvas.vue'
import SpineModel from './spine/Model.vue'

const props = withDefaults(defineProps<{
  /** Scene painted inside the canvas, behind the model. */
  backgroundUrl?: string | null
  modelSrc?: string
  modelId?: string
  paused?: boolean
  premultipliedAlpha?: boolean
  defaultMixDuration?: number
  idleAnimationEnabled?: boolean
  maxFps?: number
  renderScale?: number
  cursorPosition?: { x: number, y: number }
  nowSpeaking?: boolean
  interactive?: boolean
}>(), {
  paused: false,
  premultipliedAlpha: true,
  defaultMixDuration: 0.2,
  idleAnimationEnabled: true,
  maxFps: 0,
  renderScale: 1,
  nowSpeaking: false,
  interactive: true,
})

const emit = defineEmits<{
  (e: 'error', error: Error): void
  (e: 'poke', region: 'bust' | 'head' | 'cheek'): void
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })
const componentStateCanvas = defineModel<'pending' | 'loading' | 'mounted'>('canvasState', { default: 'pending' })
const componentStateModel = defineModel<'pending' | 'loading' | 'mounted'>('modelState', { default: 'pending' })
const modelFailed = ref(false)
watch(() => [props.modelSrc, props.modelId], () => {
  modelFailed.value = false
})

const canvasRef = ref<InstanceType<typeof SpineCanvas>>()
const modelRef = ref<InstanceType<typeof SpineModel>>()

watch([componentStateModel, componentStateCanvas], () => {
  componentState.value = (!modelFailed.value && componentStateModel.value === 'mounted' && componentStateCanvas.value === 'mounted')
    ? 'mounted'
    : 'loading'
})

function reportModelError(error: Error) {
  modelFailed.value = true
  componentState.value = 'loading'
  emit('error', error)
}

defineExpose({
  canvasElement: () => canvasRef.value?.canvasElement(),
  captureFrame: () => canvasRef.value?.captureFrame(),
  setEmotion: (emotion: Emotion, intensity?: number) => modelRef.value?.setEmotion(emotion, intensity),
  pokeBust: () => modelRef.value?.pokeBust(),
  listAnimations: () => modelRef.value?.listAnimations() ?? [],
  listSkins: () => modelRef.value?.listSkins() ?? [],
})
</script>

<template>
  <Screen v-slot="{ width, height }" relative>
    <SpineCanvas
      ref="canvasRef"
      v-slot="{ canvas }"
      v-model:state="componentStateCanvas"
      :width="width"
      :height="height"
      :resolution="renderScale"
    >
      <SpineModel
        ref="modelRef"
        v-model:state="componentStateModel"
        :background-url="backgroundUrl"
        :model-src="modelSrc"
        :model-id="modelId"
        :canvas="canvas"
        :width="width"
        :height="height"
        :resolution="renderScale"
        :paused="paused"
        :premultiplied-alpha="premultipliedAlpha"
        :default-mix-duration="defaultMixDuration"
        :idle-animation-enabled="idleAnimationEnabled"
        :max-fps="maxFps"
        :cursor-position="cursorPosition"
        :now-speaking="nowSpeaking"
        :interactive="interactive"
        @error="reportModelError"
        @poke="emit('poke', $event)"
      />
    </SpineCanvas>
  </Screen>
</template>
