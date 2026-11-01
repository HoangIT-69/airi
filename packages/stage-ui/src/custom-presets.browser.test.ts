import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CUSTOM_CARD_SEED_KEY, CUSTOM_DEFAULT_DISPLAY_MODEL_ID, seedCustomCards } from './custom-presets'

const card = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: 'Thư Ký',
    first_mes: 'Xin chào',
    extensions: { airi: { modules: { displayModelId: 'preset-vrm-1', speech: { provider: '', model: '', voice_id: '' } } } },
  },
}

function createTarget() {
  return {
    addCard: vi.fn(async () => 'seeded-card'),
    activateCard: vi.fn(async () => true),
  }
}

beforeEach(() => {
  localStorage.removeItem(CUSTOM_CARD_SEED_KEY)
})
afterEach(() => {
  localStorage.removeItem(CUSTOM_CARD_SEED_KEY)
  vi.restoreAllMocks()
})

describe('seedCustomCards', () => {
  it('adds and activates the card with Arcana once per browser', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(async () => Response.json(card))
    const target = createTarget()

    await seedCustomCards(target)
    await seedCustomCards(target)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith('/remote-assets/cards/thu-ky/card.json')
    expect(target.addCard).toHaveBeenCalledTimes(1)
    expect(target.addCard).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'Thư Ký',
        extensions: { airi: { modules: { displayModelId: CUSTOM_DEFAULT_DISPLAY_MODEL_ID, speech: { provider: '', model: '', voice_id: '' } } } },
      }),
    }), 'import')
    expect(target.activateCard).toHaveBeenCalledWith('seeded-card')
    expect(localStorage.getItem(CUSTOM_CARD_SEED_KEY)).toBe('seeded-card')
  })

  it('skips without setting the flag when the network fails, then retries on the next start', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const target = createTarget()

    await seedCustomCards(target)

    expect(target.addCard).not.toHaveBeenCalled()
    expect(localStorage.getItem(CUSTOM_CARD_SEED_KEY)).toBeNull()

    fetchSpy.mockImplementation(async () => Response.json(card))
    await seedCustomCards(target)

    expect(target.addCard).toHaveBeenCalledTimes(1)
  })

  it('skips without setting the flag when the card is not hosted', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(async () => new Response('Not found', { status: 404 }))
    const target = createTarget()

    await seedCustomCards(target)

    expect(target.addCard).not.toHaveBeenCalled()
    expect(target.activateCard).not.toHaveBeenCalled()
    expect(localStorage.getItem(CUSTOM_CARD_SEED_KEY)).toBeNull()
  })
})
