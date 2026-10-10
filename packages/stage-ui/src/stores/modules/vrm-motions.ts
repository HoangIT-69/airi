import localforage from 'localforage'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'

export interface VrmMotionEntry {
  id: string
  /** Name the character uses in `<|ACT:{"motion":"<name>"}|>`. Lowercase, digits, `-` and `_`. */
  name: string
  /** What the pose shows. Shown on the pose picker and read by the character. */
  description: string
  createdAt: number
}

interface StoredVrmMotion extends VrmMotionEntry {
  file: Blob
}

type LibraryEvent
  = | { type: 'changed' }
    | { type: 'play', id: string }

/**
 * Defaults for the free VRoid Project VRMA pack (booth.pm/en/items/5512385), keyed by file name,
 * so importing the seven files needs no typing.
 */
const KNOWN_FILES: Record<string, Pick<VrmMotionEntry, 'name' | 'description'>> = {
  vrma_01: { name: 'show-full-body', description: 'Turns around to show the whole outfit' },
  vrma_02: { name: 'greeting', description: 'Friendly greeting wave' },
  vrma_03: { name: 'peace-sign', description: 'Cheerful peace sign' },
  vrma_04: { name: 'shoot', description: 'Playful finger-gun shot' },
  vrma_05: { name: 'spin', description: 'Happy spin in place' },
  vrma_06: { name: 'model-pose', description: 'Strikes a model pose' },
  vrma_07: { name: 'squat', description: 'Squats down and stands up again' },
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

/** Fills name and description for a newly imported file. */
export function defaultsForMotionFile(fileName: string) {
  const base = fileName.replace(/\.vrma$/i, '')
  // The pack ships as `VRMA_03.vrma`; some mirrors rename it `VRMA_03_peace_sign.vrma`.
  const known = KNOWN_FILES[/^vrma_0\d/i.exec(base)?.[0].toLowerCase() ?? '']
  return known ?? { name: toMotionName(base) || 'motion', description: '' }
}

/**
 * VRMA poses the user imported. A pose plays only when the user asks for one, from the chat
 * pose picker or in words. IndexedDB owns the files; a broadcast tells other windows (the
 * stage, chat and settings windows are separate in the desktop app) to reload or play.
 */
export const useVrmMotionsStore = defineStore('vrm-motions', () => {
  const db = localforage.createInstance({ name: 'airi', storeName: 'vrm-motions' })
  const enabled = useLocalStorageManualReset('settings/vrm-motions/enabled', true)
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
  /** The latest request to play a pose, from any window. The stage watches it. */
  const playRequest = ref<{ id: string, at: number }>()
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

  async function add(file: File, metadata?: Partial<Pick<VrmMotionEntry, 'name' | 'description'>>) {
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
      createdAt: Date.now(),
      file,
    }
    validate(entry)
    await db.setItem(entry.id, entry)
    await load()
    post({ type: 'changed' })
    return entry
  }

  async function save(id: string, metadata: Pick<VrmMotionEntry, 'name' | 'description'>) {
    const stored = await db.getItem<StoredVrmMotion>(id)
    if (!stored)
      throw new VrmMotionValidationError('missing')
    const next = { ...stored, ...metadata, name: toMotionName(metadata.name) }
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

  /** Asks the stage to play a pose. Works from any window: settings, chat or the stage itself. */
  function requestPlay(id: string) {
    post({ type: 'play', id })
    playRequest.value = { id, at: Date.now() }
  }

  /** Text added to the system prompt, so the character can do a pose the user asks for in words. */
  const promptSupplement = computed(() => {
    if (!enabled.value || entries.value.length === 0)
      return ''
    return [
      'Poses: you have a 3D body with full-body poses. Perform a pose only when the user explicitly asks you to (for example "wave", "do a peace sign", "dance"), by writing <|ACT:{"motion":"<name>"}|> once at the start of your reply.',
      'Never perform a pose on your own initiative. Your emotions are shown separately through ACT emotion tokens. Never invent pose names.',
      'Available poses:',
      ...entries.value.map(entry => `- ${entry.name}: ${entry.description || entry.name}`),
    ].join('\n')
  })

  watch(data, (event) => {
    if (event?.type === 'changed')
      void load().catch(() => {})
    else if (event?.type === 'play')
      playRequest.value = { id: event.id, at: Date.now() }
  })
  void load().catch(() => {})

  function resetState() {
    enabled.reset()
    bustPhysics.reset()
    hairPhysics.reset()
    cameraInertia.reset()
  }

  onScopeDispose(() => {
    disposed = true
    for (const url of urls.values())
      URL.revokeObjectURL(url)
  })

  return { enabled, bustPhysics, hairPhysics, cameraInertia, entries, error, playRequest, promptSupplement, load, add, save, remove, urlFor, requestPlay, resetState }
})
