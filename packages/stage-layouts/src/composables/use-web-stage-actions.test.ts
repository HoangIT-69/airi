import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useModelSwitchAction } from './use-model-switch-action'
import { usePosePickMessage } from './use-pose-pick-message'

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => {}),
  toastError: vi.fn(),
  switchModel: vi.fn(async () => true),
  isVrm: { value: true },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, string>) => params ? `${key}|${params.name}` : key }),
}))

vi.mock('vue-sonner', () => ({ toast: { error: mocks.toastError } }))

vi.mock('@proj-airi/stage-ui/stores/chat', () => ({
  useChatStore: () => ({ send: mocks.send }),
}))

vi.mock('@proj-airi/stage-ui/stores/chat/session-store', async () => {
  const { ref } = await import('vue')
  return { useChatSessionStore: () => ({ activeSessionId: ref('session-1') }) }
})

vi.mock('@proj-airi/stage-ui/composables/use-stage-model-switch', async () => {
  const { computed, ref } = await import('vue')
  const isVrm = ref(true)
  mocks.isVrm = isVrm
  return {
    useStageModelSwitch: () => ({ isVrm: computed(() => isVrm.value), switching: ref(false), switchModel: mocks.switchModel }),
  }
})

beforeEach(() => {
  mocks.send.mockClear()
  mocks.toastError.mockClear()
  mocks.switchModel.mockReset()
  mocks.switchModel.mockResolvedValue(true)
})

/**
 * @example
 * const send = usePosePickMessage({ sending: isSending })
 */
describe('usePosePickMessage', () => {
  it('sends the pose request message to the active session', () => {
    const send = usePosePickMessage({ sending: false })

    send({ name: 'peace-sign' })

    expect(mocks.send).toHaveBeenCalledWith({
      sessionId: 'session-1',
      text: 'settings.pages.modules.motion.picker.message|peace-sign',
    })
  })

  it('does not send while a reply is still generating', () => {
    const sending = ref(true)
    const send = usePosePickMessage({ sending })

    send({ name: 'wave' })
    expect(mocks.send).not.toHaveBeenCalled()

    sending.value = false
    send({ name: 'wave' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
})

/**
 * @example
 * const { label, runModelSwitch } = useModelSwitchAction()
 */
describe('useModelSwitchAction', () => {
  it('labels the button with the family it switches to', () => {
    const { label } = useModelSwitchAction()

    mocks.isVrm.value = true
    expect(label.value).toBe('stage.mobile-tools.switch-to-2d')
    mocks.isVrm.value = false
    expect(label.value).toBe('stage.mobile-tools.switch-to-vrm')
  })

  it('shows no toast when the switch succeeds', async () => {
    const { runModelSwitch } = useModelSwitchAction()

    await runModelSwitch()

    expect(mocks.switchModel).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('shows a toast when no model of the other family exists', async () => {
    mocks.switchModel.mockResolvedValue(false)
    const { runModelSwitch } = useModelSwitchAction()

    await runModelSwitch()

    expect(mocks.toastError).toHaveBeenCalledWith('stage.mobile-tools.no-model-to-switch')
  })
})
