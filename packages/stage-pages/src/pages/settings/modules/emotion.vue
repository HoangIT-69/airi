<script setup lang="ts">
import { VrmEmotions } from '@proj-airi/stage-ui/components'
</script>

<template>
  <VrmEmotions />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.emotion.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
