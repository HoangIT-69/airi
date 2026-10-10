<script setup lang="ts">
import type { VrmMotionEmotion, VrmMotionEntry } from '../../stores/modules/vrm-motions'

import { Button, FieldCheckbox, FieldInput, FieldInputFile, GhostButton, SettingsCard } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useVrmMotionsStore, vrmMotionEmotions, VrmMotionValidationError } from '../../stores/modules/vrm-motions'

const { t } = useI18n()
const store = useVrmMotionsStore()
const { enabled, playOnEmotion, entries, error } = storeToRefs(store)

const files = ref<File[]>()
const importing = ref(false)
const formError = ref('')
const editingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)
const name = ref('')
const description = ref('')
const emotions = ref<VrmMotionEmotion[]>([])

function showError(cause: unknown) {
  formError.value = t(`settings.pages.modules.motion.errors.${cause instanceof VrmMotionValidationError ? cause.code : 'storage'}`)
}

watch(files, async (selected) => {
  if (!selected?.length)
    return
  importing.value = true
  formError.value = ''
  try {
    // One at a time, so name suffixes see the motions imported just before.
    for (const file of selected)
      await store.add(file)
  }
  catch (cause) {
    showError(cause)
  }
  finally {
    importing.value = false
    files.value = undefined
  }
})

function openEditor(entry: VrmMotionEntry) {
  deletingId.value = null
  editingId.value = entry.id
  name.value = entry.name
  description.value = entry.description
  emotions.value = [...entry.emotions]
  formError.value = ''
}

function toggleEmotion(emotion: VrmMotionEmotion) {
  emotions.value = emotions.value.includes(emotion) ? emotions.value.filter(value => value !== emotion) : [...emotions.value, emotion]
}

async function save() {
  if (!editingId.value)
    return
  try {
    await store.save(editingId.value, { name: name.value, description: description.value.trim(), emotions: emotions.value })
    editingId.value = null
  }
  catch (cause) {
    showError(cause)
  }
}

async function remove(id: string) {
  try {
    await store.remove(id)
    deletingId.value = null
  }
  catch (cause) {
    showError(cause)
  }
}
</script>

<template>
  <div :class="['flex flex-col gap-4']">
    <SettingsCard>
      <FieldCheckbox v-model="enabled" :label="t('settings.pages.modules.motion.enable')" :description="t('settings.pages.modules.motion.enable-description')" />
      <FieldCheckbox v-model="playOnEmotion" :label="t('settings.pages.modules.motion.play-on-emotion')" :description="t('settings.pages.modules.motion.play-on-emotion-description')" />
    </SettingsCard>

    <SettingsCard>
      <FieldInputFile
        v-model="files"
        accept=".vrma"
        multiple
        :label="t('settings.pages.modules.motion.import')"
        :description="t('settings.pages.modules.motion.import-description')"
        :placeholder="t('settings.pages.modules.motion.choose-files')"
      />
      <p v-if="importing" :class="['text-sm text-neutral-600 dark:text-neutral-400']">
        {{ t('settings.pages.modules.motion.importing') }}
      </p>
    </SettingsCard>

    <p v-if="formError || error" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
      {{ formError || t('settings.pages.modules.motion.errors.storage') }}
    </p>

    <ul :aria-label="t('settings.pages.modules.motion.library')" :class="['flex flex-col gap-3']">
      <li v-for="entry in entries" :key="entry.id" :class="['flex flex-col gap-3', 'rounded-xl bg-neutral-100 p-4 dark:bg-neutral-900']">
        <form v-if="editingId === entry.id" :class="['flex flex-col gap-3']" @submit.prevent="save">
          <FieldInput v-model="name" :label="t('settings.pages.modules.motion.name')" :description="t('settings.pages.modules.motion.name-description')" />
          <FieldInput v-model="description" :label="t('settings.pages.modules.motion.description-field')" :description="t('settings.pages.modules.motion.description-field-hint')" />
          <fieldset :class="['flex flex-col gap-2']">
            <legend :class="['mb-2 text-sm font-medium']">
              {{ t('settings.pages.modules.motion.emotions') }}
            </legend>
            <div :class="['flex flex-wrap gap-2']">
              <GhostButton v-for="emotion in vrmMotionEmotions" :key="emotion" type="button" :active="emotions.includes(emotion)" :aria-pressed="emotions.includes(emotion)" @click="toggleEmotion(emotion)">
                {{ t(`settings.pages.modules.motion.emotion-labels.${emotion}`) }}
              </GhostButton>
            </div>
          </fieldset>
          <div :class="['flex flex-wrap gap-2']">
            <Button type="submit" color="primary" variant="primary">
              {{ t('settings.pages.modules.motion.save') }}
            </Button>
            <Button type="button" @click="editingId = null">
              {{ t('settings.pages.modules.motion.cancel') }}
            </Button>
          </div>
        </form>
        <template v-else>
          <div :class="['flex flex-wrap items-baseline justify-between gap-2']">
            <code :class="['text-sm font-medium']">{{ entry.name }}</code>
            <div :class="['flex flex-wrap gap-1']">
              <span v-for="emotion in entry.emotions" :key="emotion" :class="['rounded-full bg-neutral-200 px-2 py-1 text-xs dark:bg-neutral-800']">
                {{ t(`settings.pages.modules.motion.emotion-labels.${emotion}`) }}
              </span>
            </div>
          </div>
          <p v-if="entry.description" :class="['text-sm text-neutral-600 dark:text-neutral-400']">
            {{ entry.description }}
          </p>
          <div :class="['flex flex-wrap gap-2']">
            <template v-if="deletingId === entry.id">
              <Button size="sm" @click="deletingId = null">
                {{ t('settings.pages.modules.motion.cancel') }}
              </Button>
              <Button size="sm" color="red" variant="primary" @click="remove(entry.id)">
                {{ t('settings.pages.modules.motion.confirm-delete') }}
              </Button>
            </template>
            <template v-else>
              <Button size="sm" color="primary" variant="primary" @click="store.preview(entry.id)">
                {{ t('settings.pages.modules.motion.preview') }}
              </Button>
              <Button size="sm" @click="openEditor(entry)">
                {{ t('settings.pages.modules.motion.edit') }}
              </Button>
              <Button size="sm" color="red" variant="primary" @click="deletingId = entry.id">
                {{ t('settings.pages.modules.motion.delete') }}
              </Button>
            </template>
          </div>
        </template>
      </li>
    </ul>
    <p v-if="!entries.length" :class="['text-sm text-neutral-600 dark:text-neutral-400']">
      {{ t('settings.pages.modules.motion.empty') }}
    </p>
  </div>
</template>
