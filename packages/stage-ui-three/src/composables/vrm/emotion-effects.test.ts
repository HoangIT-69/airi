import { describe, expect, it } from 'vitest'

import { DEFAULT_VRM_EFFECTS_CALIBRATION, layoutVRMEffects } from './emotion-effects'

describe('layoutVRMEffects', () => {
  it('puts the blush on both cheeks, in front of the face', () => {
    const blush = layoutVRMEffects(DEFAULT_VRM_EFFECTS_CALIBRATION, false).filter(piece => piece.effect === 'blush')
    expect(blush).toHaveLength(2)
    expect(blush[0].position[0]).toBeCloseTo(-blush[1].position[0])
    expect(blush[0].position[2]).toBeGreaterThan(0)
    expect(blush.every(piece => piece.onSkin)).toBe(true)
  })

  it('moves and scales every mark but the blush with the calibration', () => {
    const moved = layoutVRMEffects({ ...DEFAULT_VRM_EFFECTS_CALIBRATION, offset: [0, 0.02, 0], scale: 2 }, false)
    const base = layoutVRMEffects(DEFAULT_VRM_EFFECTS_CALIBRATION, false)
    const question = (pieces: typeof base) => pieces.find(piece => piece.effect === 'question')!
    expect(question(moved).position[1]).toBeCloseTo(question(base).position[1] * 2 + 0.02)
    expect(question(moved).size).toBeCloseTo(question(base).size * 2)
    expect(moved.find(piece => piece.effect === 'blush')!.position).toEqual(base.find(piece => piece.effect === 'blush')!.position)
  })

  it('turns the layout around for VRM 0.x heads, which face -Z', () => {
    const vrm1 = layoutVRMEffects(DEFAULT_VRM_EFFECTS_CALIBRATION, false)
    const vrm0 = layoutVRMEffects(DEFAULT_VRM_EFFECTS_CALIBRATION, true)
    expect(vrm0[0].position).toEqual([-vrm1[0].position[0], vrm1[0].position[1], -vrm1[0].position[2]])
  })
})
