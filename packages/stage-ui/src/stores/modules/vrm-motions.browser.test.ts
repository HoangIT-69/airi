import localforage from 'localforage'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useVrmMotionsStore, VrmMotionValidationError } from './vrm-motions'

const stores: ReturnType<typeof createPinia>[] = []

async function createStore() {
  const pinia = createPinia()
  stores.push(pinia)
  const store = useVrmMotionsStore(pinia)
  await store.load()
  return store
}

beforeEach(async () => {
  await localforage.createInstance({ name: 'airi', storeName: 'vrm-motions' }).clear()
})
afterEach(async () => {
  for (const pinia of stores.splice(0))
    disposePinia(pinia)
  await localforage.createInstance({ name: 'airi', storeName: 'vrm-motions' }).clear()
})

describe('vrm motion presets', () => {
  it('lists the built-in poses before any import', async () => {
    const store = await createStore()

    expect(store.entries).toHaveLength(39)
    expect(store.entries[0]).toMatchObject({ id: 'preset-motion-angry', name: 'angry', preset: true })
    expect(store.entries.find(entry => entry.name === 'vrma_02_greeting')?.description).toBe('Friendly greeting wave')
    expect(store.promptSupplement).toContain('- freestyle-3: Freestyle dance 3')
  })

  it('resolves built-in poses to their remote URLs', async () => {
    const store = await createStore()

    expect(store.urlFor('vrma_03_peace_sign')).toBe('/remote-assets/motions/VRMA_03_peace_sign.vrma')
    expect(store.urlFor('bellydance')).toBe('/remote-assets/motions/BellyDance.vrma')
    expect(store.urlFor('hip-hop')).toBe('/remote-assets/motions/dances/hip-hop.vrma')
    expect(store.urlFor('unknown')).toBeUndefined()
  })

  it('refuses to edit or remove a built-in pose', async () => {
    const store = await createStore()

    await expect(store.remove('preset-motion-angry')).rejects.toEqual(new VrmMotionValidationError('preset'))
    await expect(store.save('preset-motion-angry', { name: 'mad', description: '' })).rejects.toEqual(new VrmMotionValidationError('preset'))
    expect(store.urlFor('angry')).toBe('/remote-assets/motions/Angry.vrma')
  })

  it('keeps an imported pose with a built-in name under a distinct name', async () => {
    const store = await createStore()

    const entry = await store.add(new File(['vrma'], 'Angry.vrma'))

    expect(entry.name).toBe('angry-2')
    expect(store.entries.at(-1)?.id).toBe(entry.id)
    expect(store.urlFor('angry-2')).toMatch(/^blob:/)
    expect(store.urlFor('angry')).toBe('/remote-assets/motions/Angry.vrma')
  })
})
