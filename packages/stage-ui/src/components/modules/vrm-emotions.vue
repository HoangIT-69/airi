<script setup lang="ts">
import { FieldCheckbox, FieldRange, GhostButton, SettingsCard } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { useVrmEmotionsStore, vrmEmotionNames } from '../../stores/modules/vrm-emotions'

const { t } = useI18n()
const store = useVrmEmotionsStore()
const { enabled, strength } = storeToRefs(store)
const formatStrength = (value: number) => `${Math.round(value * 100)}%`
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
  </div>
</template>
