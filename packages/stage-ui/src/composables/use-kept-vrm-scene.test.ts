import type { StageModelRenderer } from '../stores/settings/stage-model'

import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'

import { useKeptVrmScene } from './use-kept-vrm-scene'

function setup(initial: { renderer: StageModelRenderer, keepAlive: boolean }) {
  const renderer = ref<StageModelRenderer>(initial.renderer)
  const modelId = ref(initial.renderer === 'vrm' ? 'preset-vrm-arcana' : 'preset-spine-c583')
  const modelSrc = ref<string | undefined>(initial.renderer === 'vrm' ? '/remote-assets/arcana.vrm' : '/remote-assets/c583.zip')
  const keepAlive = ref(initial.keepAlive)
  const scene = useKeptVrmScene({ renderer, modelId, modelSrc, keepAlive })

  async function select(nextRenderer: StageModelRenderer, id: string, src: string | undefined) {
    renderer.value = nextRenderer
    modelId.value = id
    modelSrc.value = src
    await nextTick()
  }

  return { ...scene, keepAlive, select }
}

/**
 * @example
 * const { mounted, model } = useKeptVrmScene({ renderer, modelId, modelSrc, keepAlive })
 */
describe('useKeptVrmScene', () => {
  it('keeps the VRM scene mounted on the last VRM after switching to Spine', async () => {
    const scene = setup({ renderer: 'vrm', keepAlive: true })
    expect(scene.active.value).toBe(true)
    expect(scene.model.value).toEqual({ id: 'preset-vrm-arcana', src: '/remote-assets/arcana.vrm' })

    await scene.select('spine', 'preset-spine-c583', '/remote-assets/c583.zip')

    expect(scene.active.value).toBe(false)
    expect(scene.mounted.value).toBe(true)
    expect(scene.model.value).toEqual({ id: 'preset-vrm-arcana', src: '/remote-assets/arcana.vrm' })
  })

  it('unmounts the VRM scene on switch when keep-alive is off (phones)', async () => {
    const scene = setup({ renderer: 'vrm', keepAlive: false })

    await scene.select('spine', 'preset-spine-c583', '/remote-assets/c583.zip')

    expect(scene.mounted.value).toBe(false)
  })

  it('does not mount a VRM scene before any VRM was shown', () => {
    const scene = setup({ renderer: 'spine', keepAlive: true })

    expect(scene.mounted.value).toBe(false)
    expect(scene.model.value).toBeUndefined()
  })

  it('follows a newly selected VRM model', async () => {
    const scene = setup({ renderer: 'vrm', keepAlive: true })

    await scene.select('vrm', 'display-model-other', 'blob:other')

    expect(scene.model.value).toEqual({ id: 'display-model-other', src: 'blob:other' })
  })

  it('releases a kept scene when keep-alive turns off while another renderer is on stage', async () => {
    const scene = setup({ renderer: 'vrm', keepAlive: true })
    await scene.select('spine', 'preset-spine-c583', '/remote-assets/c583.zip')
    expect(scene.mounted.value).toBe(true)

    scene.keepAlive.value = false
    await nextTick()

    expect(scene.mounted.value).toBe(false)
  })
})
