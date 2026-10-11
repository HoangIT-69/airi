import { describe, expect, it } from 'vitest'

import { bustPeel, clothClamp, skirtJointRotation, skirtJointSway, stepClothOffset } from './cloth-drag'

const REST = { x: 0, y: 0, z: 0 }

describe('stepClothOffset', () => {
  it('lets a skirt rise to its ceiling and then ignores more upward pull', () => {
    const size = 1000
    let offset = REST
    for (let frame = 0; frame < 8; frame++)
      offset = stepClothOffset(offset, 0, 200, 'skirt', size).offset
    const held = offset.y
    offset = stepClothOffset(offset, 0, 200, 'skirt', size).offset

    expect(clothClamp('skirt', size).maxDistance).toBeCloseTo(size * 0.7)
    expect(held).toBeCloseTo(clothClamp('skirt', size).maxDistance)
    expect(offset.y).toBeCloseTo(held)
  })

  it('moves a breast sideways and upward', () => {
    const step = stepClothOffset(REST, 40, 30, 'bust', 1000)

    expect(step.offset.x).toBeCloseTo(40)
    expect(step.offset.y).toBeCloseTo(30)
  })
})

describe('skirtJointRotation', () => {
  it('flips the belt panel up and keeps curling through the hem', () => {
    expect(skirtJointRotation(0, 1)).toBe(0)
    const waist = skirtJointRotation(1, 1)
    expect(waist).toBeGreaterThan(70)
    let hem = 0
    for (let depth = 1; depth <= 4; depth++)
      hem += skirtJointRotation(depth, 1)
    expect(hem).toBeGreaterThan(waist)
    expect(skirtJointRotation(1, 2)).toBeCloseTo(waist)
    expect(skirtJointSway(0, 1)).toBe(0)
    expect(Math.abs(skirtJointSway(1, 1))).toBeLessThan(waist)
  })

  it('gives neighboring panels the same rotation so the shared mesh does not tear', () => {
    const left = skirtJointRotation(2, 1, -84.9) + skirtJointSway(2, 0.4, -84.9)
    const right = skirtJointRotation(2, 1, -92.3) + skirtJointSway(2, 0.4, -92.3)

    expect(left).toBeGreaterThan(0)
    expect(right).toBeCloseTo(left)
  })
})

describe('bustPeel', () => {
  it('spreads and rotates a breast when it is lifted', () => {
    const peel = bustPeel({ x: 0, y: 80, z: 0 }, 140)

    expect(peel.outward).toBeGreaterThan(0)
    expect(peel.extraLift).toBeGreaterThan(0)
    expect(peel.rotation).toBeGreaterThan(0)
  })

  it('adds no outward peel while the breast is still at rest', () => {
    const peel = bustPeel({ x: 0, y: 0, z: 0 }, 140)

    expect(peel.outward).toBe(0)
    expect(peel.rotation).toBe(0)
  })
})
