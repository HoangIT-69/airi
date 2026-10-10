<script setup lang="ts">
import { VrmMotions } from '@proj-airi/stage-ui/components'
</script>

<template>
  <VrmMotions />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.motion.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
