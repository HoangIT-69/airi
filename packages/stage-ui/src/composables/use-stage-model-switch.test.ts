import type { DisplayModel } from '../stores/display-models'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { DisplayModelFormat } from '../stores/display-models'
import { pickSwitchTarget, useStageModelSwitch } from './use-stage-model-switch'

const settingsMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
const displayModelsMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn(async () => undefined),
    iterate: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    setItem: vi.fn(async (_key: string, value: unknown) => value),
  },
}))

vi.mock('../stores/settings', () => ({
  useSettings: () => settingsMock.value,
}))

vi.mock('../stores/display-models', async (importOriginal) => {
  const original = await importOriginal<typeof import('../stores/display-models')>()
  return { ...original, useDisplayModelsStore: () => displayModelsMock.value }
})

function urlModel(id: string, format: DisplayModelFormat): DisplayModel {
  return { id, format, type: 'url', url: `https://example.test/${id}`, name: id, importedAt: 1 }
}

function fileModel(id: string, format: DisplayModelFormat): DisplayModel {
  return { id, format, type: 'file', file: new File([], `${id}.bin`), name: id, importedAt: 2 }
}

const presetVrm = urlModel('preset-vrm-1', DisplayModelFormat.VRM)
const presetLive2d = urlModel('preset-live2d-1', DisplayModelFormat.Live2dZip)
const importedVrm = fileModel('display-model-vrm', DisplayModelFormat.VRM)
const importedSpine = fileModel('display-model-spine', DisplayModelFormat.SpineZip)

/**
 * @example
 * pickSwitchTarget(models, true, 'display-model-vrm')
 */
describe('pickSwitchTarget', () => {
  it('returns the remembered model of the target family', () => {
    const models = [presetVrm, importedVrm, presetLive2d, importedSpine]

    expect(pickSwitchTarget(models, true, 'preset-vrm-1')).toBe(presetVrm)
    expect(pickSwitchTarget(models, false, 'preset-live2d-1')).toBe(presetLive2d)
  })

  it('ignores a remembered id from the other family', () => {
    const models = [presetVrm, importedSpine]

    expect(pickSwitchTarget(models, true, 'display-model-spine')).toBe(presetVrm)
  })

  it('prefers a user import over a preset when nothing is remembered', () => {
    expect(pickSwitchTarget([presetVrm, importedVrm], true, '')).toBe(importedVrm)
  })

  it('treats both Spine and Live2D as the 2D family', () => {
    expect(pickSwitchTarget([presetVrm, importedSpine], false, '')).toBe(importedSpine)
    expect(pickSwitchTarget([presetVrm, presetLive2d], false, '')).toBe(presetLive2d)
  })

  it('returns undefined when the target family has no model', () => {
    expect(pickSwitchTarget([presetVrm, importedVrm], false, '')).toBeUndefined()
    expect(pickSwitchTarget([], true, '')).toBeUndefined()
  })

  it('falls back when the remembered model was deleted', () => {
    expect(pickSwitchTarget([presetVrm], true, 'display-model-gone')).toBe(presetVrm)
  })
})

/**
 * @example
 * const { switchModel } = useStageModelSwitch()
 */
describe('useStageModelSwitch', () => {
  const stageModelSelected = ref('')
  const stageModelRenderer = ref<string>('vrm')
  const stageModelSelectedDisplayModel = ref<DisplayModel | undefined>()
  const loadDisplayModelsFromIndexedDB = vi.fn(async () => {})

  beforeEach(() => {
    globalThis.localStorage?.clear()
    stageModelSelected.value = 'preset-vrm-1'
    stageModelRenderer.value = 'vrm'
    stageModelSelectedDisplayModel.value = presetVrm
    loadDisplayModelsFromIndexedDB.mockClear()
    settingsMock.value = { stageModelSelected, stageModelRenderer, stageModelSelectedDisplayModel }
    displayModelsMock.value = { displayModels: [presetVrm, presetLive2d, importedSpine], loadDisplayModelsFromIndexedDB }
  })

  it('switches from VRM to the newest 2D import and back to the remembered VRM', async () => {
    const { isVrm, switchModel } = useStageModelSwitch()
    expect(isVrm.value).toBe(true)

    await expect(switchModel()).resolves.toBe(true)
    expect(loadDisplayModelsFromIndexedDB).toHaveBeenCalled()
    expect(stageModelSelected.value).toBe('display-model-spine')

    stageModelRenderer.value = 'spine'
    stageModelSelectedDisplayModel.value = importedSpine
    await nextTick()

    await expect(switchModel()).resolves.toBe(true)
    expect(stageModelSelected.value).toBe('preset-vrm-1')
  })

  it('reports false and keeps the selection when the other family is empty', async () => {
    displayModelsMock.value = { displayModels: [presetVrm], loadDisplayModelsFromIndexedDB }
    const { switchModel } = useStageModelSwitch()

    await expect(switchModel()).resolves.toBe(false)
    expect(stageModelSelected.value).toBe('preset-vrm-1')
  })

  it('ignores a second click while a switch is running', async () => {
    let release: () => void = () => {}
    loadDisplayModelsFromIndexedDB.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    const { switching, switchModel } = useStageModelSwitch()

    const first = switchModel()
    expect(switching.value).toBe(true)
    await expect(switchModel()).resolves.toBe(true)
    expect(loadDisplayModelsFromIndexedDB).toHaveBeenCalledTimes(1)

    release()
    await first
    expect(switching.value).toBe(false)
  })
})
