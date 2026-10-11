<script setup lang="ts">
import type { VrmEffectsPlacement } from '../../stores/modules/vrm-emotions'

import { Button, FieldCheckbox, FieldRange, GhostButton, SettingsCard } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

import { useVrmEmotionsStore, vrmEmotionNames } from '../../stores/modules/vrm-emotions'
import { useSettings } from '../../stores/settings'

const { t } = useI18n()
const store = useVrmEmotionsStore()
const { enabled, strength, effectsEnabled, effectsPreview, effectsPlacements } = storeToRefs(store)
const { stageModelSelected } = storeToRefs(useSettings())
const formatStrength = (value: number) => `${Math.round(value * 100)}%`
const formatCm = (value: number) => `${value.toFixed(1)} cm`

const placement = computed(() => stageModelSelected.value ? store.placementFor(stageModelSelected.value) : undefined)
const saved = computed(() => Boolean(stageModelSelected.value && effectsPlacements.value[stageModelSelected.value]?.saved))

/** A slider bound to one placement value, shown in centimeters and stored in meters. */
function centimeters(read: (placement: VrmEffectsPlacement) => number, write: (placement: VrmEffectsPlacement, meters: number) => void) {
  return computed({
    get: () => placement.value ? read(placement.value) * 100 : 0,
    set: (value: number) => {
      if (stageModelSelected.value)
        store.updatePlacement(stageModelSelected.value, next => write(next, value / 100))
    },
  })
}

function setOffset(next: VrmEffectsPlacement, axis: 0 | 1 | 2, meters: number) {
  const offset: [number, number, number] = [...next.offset]
  offset[axis] = meters
  next.offset = offset
}

const offsetX = centimeters(p => p.offset[0], (p, m) => setOffset(p, 0, m))
const offsetY = centimeters(p => p.offset[1], (p, m) => setOffset(p, 1, m))
const offsetZ = centimeters(p => p.offset[2], (p, m) => setOffset(p, 2, m))
const blushSpread = centimeters(p => p.blush.spread, (p, m) => {
  p.blush.spread = m
})
const blushHeight = centimeters(p => p.blush.height, (p, m) => {
  p.blush.height = m
})
const blushDepth = centimeters(p => p.blush.depth, (p, m) => {
  p.blush.depth = m
})
const scale = computed({
  get: () => placement.value?.scale ?? 1,
  set: (value: number) => {
    if (stageModelSelected.value) {
      store.updatePlacement(stageModelSelected.value, (next) => {
        next.scale = value
      })
    }
  },
})

function save() {
  if (!stageModelSelected.value)
    return
  store.updatePlacement(stageModelSelected.value, (next) => {
    next.saved = true
  })
  effectsPreview.value = false
}

function reset() {
  if (stageModelSelected.value)
    store.forgetPlacement(stageModelSelected.value)
}

// The preview shows every piece at once, so it must not outlive this page.
onBeforeUnmount(() => {
  effectsPreview.value = false
})
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <SettingsCard>
      <FieldCheckbox v-model="enabled" :label="t('settings.pages.modules.emotion.enable')" :description="t('settings.pages.modules.emotion.enable-description')" />
      <FieldRange v-model="strength" as="div" :min="0" :max="2" :step="0.05" :default-value="1" :format-value="formatStrength" :label="t('settings.pages.modules.emotion.strength')" :description="t('settings.pages.modules.emotion.strength-description')" />
    </SettingsCard>

    <SettingsCard>
      <h2 :class="['text-sm font-medium']">
        {{ t('settings.pages.modules.emotion.preview') }}
      </h2>
      <p :class="['text-sm text-neutral-600 dark:text-neutral-400']">
        {{ t('settings.pages.modules.emotion.preview-description') }}
      </p>
      <div :class="['grid grid-cols-2 gap-2 sm:grid-cols-3']">
        <GhostButton v-for="name in vrmEmotionNames" :key="name" type="button" @click="store.preview(name)">
          {{ t(`settings.pages.modules.emotion.names.${name}`) }}
        </GhostButton>
      </div>
    </SettingsCard>

    <SettingsCard>
      <h2 :class="['text-sm font-medium']">
        {{ t('settings.pages.modules.emotion.effects.title') }}
      </h2>
      <p :class="['text-sm text-neutral-600 dark:text-neutral-400']">
        {{ t('settings.pages.modules.emotion.effects.description') }}
      </p>
      <FieldCheckbox v-model="effectsEnabled" :label="t('settings.pages.modules.emotion.effects.enable')" :description="t('settings.pages.modules.emotion.effects.enable-description')" />
      <p :class="['text-sm', saved ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400']">
        {{ saved ? t('settings.pages.modules.emotion.effects.saved') : t('settings.pages.modules.emotion.effects.not-saved') }}
      </p>
      <FieldCheckbox v-model="effectsPreview" :label="t('settings.pages.modules.emotion.effects.place')" :description="t('settings.pages.modules.emotion.effects.place-description')" />
      <template v-if="effectsPreview && placement">
        <FieldRange v-model="offsetY" as="div" :min="-10" :max="10" :step="0.1" :default-value="0" :format-value="formatCm" :label="t('settings.pages.modules.emotion.effects.up')" />
        <FieldRange v-model="offsetX" as="div" :min="-10" :max="10" :step="0.1" :default-value="0" :format-value="formatCm" :label="t('settings.pages.modules.emotion.effects.left')" />
        <FieldRange v-model="offsetZ" as="div" :min="-10" :max="10" :step="0.1" :default-value="0" :format-value="formatCm" :label="t('settings.pages.modules.emotion.effects.forward')" />
        <FieldRange v-model="scale" as="div" :min="0.4" :max="2.5" :step="0.05" :default-value="1" :format-value="formatStrength" :label="t('settings.pages.modules.emotion.effects.size')" />
        <FieldRange v-model="blushSpread" as="div" :min="1" :max="7" :step="0.1" :default-value="3.4" :format-value="formatCm" :label="t('settings.pages.modules.emotion.effects.blush-spread')" />
        <FieldRange v-model="blushHeight" as="div" :min="-3" :max="10" :step="0.1" :default-value="3.5" :format-value="formatCm" :label="t('settings.pages.modules.emotion.effects.blush-height')" />
        <FieldRange v-model="blushDepth" as="div" :min="3" :max="14" :step="0.1" :default-value="8.2" :format-value="formatCm" :label="t('settings.pages.modules.emotion.effects.blush-depth')" />
        <div :class="['flex gap-2']">
          <Button type="button" @click="save">
            {{ t('settings.pages.modules.emotion.effects.save') }}
          </Button>
          <GhostButton type="button" @click="reset">
            {{ t('settings.pages.modules.emotion.effects.reset') }}
          </GhostButton>
        </div>
      </template>
    </SettingsCard>
  </div>
</template>
