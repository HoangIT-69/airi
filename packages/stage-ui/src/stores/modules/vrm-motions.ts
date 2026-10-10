import localforage from 'localforage'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'

/** Emotions the character emits in ACT tokens, which the stage can answer with a motion. */
export const vrmMotionEmotions = ['happy', 'sad', 'angry', 'surprised', 'think', 'curious', 'question', 'awkward', 'neutral'] as const

export type VrmMotionEmotion = typeof vrmMotionEmotions[number]

export interface VrmMotionEntry {
  id: string
  /** Name the character uses in `<|ACT:{"motion":"<name>"}|>`. Lowercase, digits, `-` and `_`. */
  name: string
  /** What the motion shows, read by the character to pick one that fits the reply. */
  description: string
  /** Emotions that play this motion when the reply names no motion. */
  emotions: VrmMotionEmotion[]
  createdAt: number
}

interface StoredVrmMotion extends VrmMotionEntry {
  file: Blob
}

type LibraryEvent
  = | { type: 'changed' }
    | { type: 'preview', id: string }

/**
 * Defaults for the free VRoid Project VRMA pack (booth.pm/en/items/5512385), keyed by file name,
 * so importing the seven files needs no typing.
 */
const KNOWN_FILES: Record<string, Pick<VrmMotionEntry, 'name' | 'description' | 'emotions'>> = {
  vrma_01: { name: 'show-full-body', description: 'Turns around to show the whole outfit', emotions: [] },
  vrma_02: { name: 'greeting', description: 'Friendly greeting wave', emotions: ['neutral'] },
  vrma_03: { name: 'peace-sign', description: 'Cheerful peace sign', emotions: ['happy'] },
  vrma_04: { name: 'shoot', description: 'Playful finger-gun shot', emotions: ['curious'] },
  vrma_05: { name: 'spin', description: 'Happy spin in place', emotions: ['surprised'] },
  vrma_06: { name: 'model-pose', description: 'Strikes a model pose', emotions: [] },
  vrma_07: { name: 'squat', description: 'Squats down and stands up again', emotions: [] },
}

const NAME_PATTERN = /^[a-z0-9][\w-]{0,47}$/
const MAX_FILE_BYTES = 20 * 1024 * 1024

export class VrmMotionValidationError extends Error {
  constructor(readonly code: 'format' | 'size' | 'name' | 'duplicate' | 'missing') {
    super(code)
  }
}

export function toMotionName(value: string) {
  return value.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/[^\w-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 48)
}

/** Fills name, description and emotions for a newly imported file. */
export function defaultsForMotionFile(fileName: string) {
  const base = fileName.replace(/\.vrma$/i, '')
  // The pack ships as `VRMA_03.vrma`; some mirrors rename it `VRMA_03_peace_sign.vrma`.
  const known = KNOWN_FILES[/^vrma_0\d/i.exec(base)?.[0].toLowerCase() ?? '']
  return known ?? { name: toMotionName(base) || 'motion', description: '', emotions: [] as VrmMotionEmotion[] }
}

/**
 * VRMA motions the user imported. IndexedDB owns the files; a broadcast tells other windows
 * (the stage and the settings window are separate in the desktop app) to reload.
 */
export const useVrmMotionsStore = defineStore('vrm-motions', () => {
  const db = localforage.createInstance({ name: 'airi', storeName: 'vrm-motions' })
  const enabled = useLocalStorageManualReset('settings/vrm-motions/enabled', true)
  const playOnEmotion = useLocalStorageManualReset('settings/vrm-motions/play-on-emotion', true)
  /** Spring bone strength, 0 stiff, 1 natural, 2 loose. Stored per device, shared by all windows. */
  const bustPhysics = useLocalStorageManualReset('settings/vrm-motions/physics/bust', 1)
  const hairPhysics = useLocalStorageManualReset('settings/vrm-motions/physics/hair', 1)
  /** How strongly camera movement swings hair and chest, 0 off. */
  const cameraInertia = useLocalStorageManualReset('settings/vrm-motions/physics/camera-inertia', 1)
  const entries = ref<VrmMotionEntry[]>([])
  const error = ref(false)
  const urls = new Map<string, string>()
  const blobs = new Map<string, Blob>()
  const { data, post } = useBroadcastChannel<LibraryEvent, LibraryEvent>({ name: 'airi:vrm-motion-library' })
  const previewRequest = ref<{ id: string, at: number }>()
  let disposed = false

  async function load() {
    try {
      const loaded: StoredVrmMotion[] = []
      await db.iterate<StoredVrmMotion, void>((value) => {
        loaded.push(value)
      })
      if (disposed)
        return
      blobs.clear()
      for (const item of loaded)
        blobs.set(item.id, item.file)
      for (const [id, url] of urls) {
        if (!blobs.has(id)) {
          URL.revokeObjectURL(url)
          urls.delete(id)
        }
      }
      entries.value = loaded
        .map(({ file: _file, ...entry }) => entry)
        .sort((a, b) => a.createdAt - b.createdAt)
      error.value = false
    }
    catch (cause) {
      error.value = true
      throw cause
    }
  }

  function validate(entry: Pick<VrmMotionEntry, 'id' | 'name'>) {
    if (!NAME_PATTERN.test(entry.name))
      throw new VrmMotionValidationError('name')
    if (entries.value.some(other => other.name === entry.name && other.id !== entry.id))
      throw new VrmMotionValidationError('duplicate')
  }

  async function add(file: File, metadata?: Partial<Pick<VrmMotionEntry, 'name' | 'description' | 'emotions'>>) {
    if (!/\.vrma$/i.test(file.name))
      throw new VrmMotionValidationError('format')
    if (file.size > MAX_FILE_BYTES)
      throw new VrmMotionValidationError('size')
    await load()
    const defaults = defaultsForMotionFile(file.name)
    let name = toMotionName(metadata?.name ?? defaults.name)
    // Importing the same pack twice keeps both copies under distinct names.
    for (let suffix = 2; entries.value.some(entry => entry.name === name); suffix++)
      name = `${toMotionName(metadata?.name ?? defaults.name)}-${suffix}`
    const entry: StoredVrmMotion = {
      id: `motion-${crypto.randomUUID()}`,
      name,
      description: metadata?.description ?? defaults.description,
      emotions: [...(metadata?.emotions ?? defaults.emotions)],
      createdAt: Date.now(),
      file,
    }
    validate(entry)
    await db.setItem(entry.id, entry)
    await load()
    post({ type: 'changed' })
    return entry
  }

  async function save(id: string, metadata: Pick<VrmMotionEntry, 'name' | 'description' | 'emotions'>) {
    const stored = await db.getItem<StoredVrmMotion>(id)
    if (!stored)
      throw new VrmMotionValidationError('missing')
    const next = { ...stored, ...metadata, name: toMotionName(metadata.name), emotions: [...metadata.emotions] }
    validate(next)
    await db.setItem(id, next)
    await load()
    post({ type: 'changed' })
  }

  async function remove(id: string) {
    await db.removeItem(id)
    await load()
    post({ type: 'changed' })
  }

  /** Object URL for a motion name, or undefined when the library has no such motion. */
  function urlFor(name: string) {
    const entry = entries.value.find(item => item.name === name)
    if (!entry)
      return undefined
    let url = urls.get(entry.id)
    const blob = blobs.get(entry.id)
    if (!url && blob) {
      url = URL.createObjectURL(blob)
      urls.set(entry.id, url)
    }
    return url
  }

  /** A random motion tagged with this emotion, for replies that name no motion. */
  function pickForEmotion(emotion: string) {
    if (!enabled.value || !playOnEmotion.value)
      return undefined
    const matches = entries.value.filter(entry => (entry.emotions as string[]).includes(emotion))
    return matches[Math.floor(Math.random() * matches.length)]
  }

  /** Asks the stage window to play a motion, from the settings window. */
  function preview(id: string) {
    post({ type: 'preview', id })
    previewRequest.value = { id, at: Date.now() }
  }

  /** Text added to the system prompt so the character can pick a motion for its reply. */
  const promptSupplement = computed(() => {
    if (!enabled.value || entries.value.length === 0)
      return ''
    return [
      'You have a 3D body. You may perform one body motion per reply by writing <|ACT:{"motion":"<name>"}|> where the reply starts, optionally with an emotion in the same token.',
      'Pick the motion that fits what you say. Skip it when nothing fits or the topic is serious. Never invent names.',
      'Motions:',
      ...entries.value.map(entry => `- ${entry.name}: ${entry.description || entry.name}`),
    ].join('\n')
  })

  watch(data, (event) => {
    if (event?.type === 'changed')
      void load().catch(() => {})
    else if (event?.type === 'preview')
      previewRequest.value = { id: event.id, at: Date.now() }
  })
  void load().catch(() => {})

  function resetState() {
    enabled.reset()
    playOnEmotion.reset()
    bustPhysics.reset()
    hairPhysics.reset()
    cameraInertia.reset()
  }

  onScopeDispose(() => {
    disposed = true
    for (const url of urls.values())
      URL.revokeObjectURL(url)
  })

  return { enabled, playOnEmotion, bustPhysics, hairPhysics, cameraInertia, entries, error, previewRequest, promptSupplement, load, add, save, remove, urlFor, pickForEmotion, preview, resetState }
})
