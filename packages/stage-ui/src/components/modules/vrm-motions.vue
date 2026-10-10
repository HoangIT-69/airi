<script setup lang="ts">
import type { VrmMotionEntry } from '../../stores/modules/vrm-motions'

import { Button, FieldCheckbox, FieldInput, FieldInputFile, FieldRange, SettingsCard } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useVrmMotionsStore, VrmMotionValidationError } from '../../stores/modules/vrm-motions'

const { t } = useI18n()
const store = useVrmMotionsStore()
const { enabled, bustPhysics, hairPhysics, cameraInertia, entries, error } = storeToRefs(store)
const formatStrength = (value: number) => `${Math.round(value * 100)}%`

const files = ref<File[]>()
const importing = ref(false)
const formError = ref('')
const editingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)
const name = ref('')
const description = ref('')

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
  formError.value = ''
}

async function save() {
  if (!editingId.value)
    return
  try {
    await store.save(editingId.value, { name: name.value, description: description.value.trim() })
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
    </SettingsCard>

    <SettingsCard>
      <h2 :class="['text-sm font-medium']">
        {{ t('settings.pages.modules.motion.physics.title') }}
      </h2>
      <FieldRange v-model="bustPhysics" as="div" :min="0" :max="2" :step="0.05" :default-value="1" :format-value="formatStrength" :label="t('settings.pages.modules.motion.physics.bust')" :description="t('settings.pages.modules.motion.physics.bust-description')" />
      <FieldRange v-model="hairPhysics" as="div" :min="0" :max="2" :step="0.05" :default-value="1" :format-value="formatStrength" :label="t('settings.pages.modules.motion.physics.hair')" :description="t('settings.pages.modules.motion.physics.hair-description')" />
      <FieldRange v-model="cameraInertia" as="div" :min="0" :max="3" :step="0.05" :default-value="1" :format-value="formatStrength" :label="t('settings.pages.modules.motion.physics.camera')" :description="t('settings.pages.modules.motion.physics.camera-description')" />
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
          <code :class="['text-sm font-medium']">{{ entry.name }}</code>
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
              <Button size="sm" color="primary" variant="primary" @click="store.requestPlay(entry.id)">
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
