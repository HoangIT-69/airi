import { describe, expect, it } from 'vitest'

import { accumulateClampedDrag } from './drag-clamp'

function lengthOf(value: { x: number, y: number, z: number }) {
  return Math.hypot(value.x, value.y, value.z)
}

describe('accumulateClampedDrag', () => {
  it('cuts an offset that would pass the maximum distance', () => {
    const step = accumulateClampedDrag(
      { x: 0.08, y: 0, z: 0 },
      { x: 0.05, y: 0, z: 0 },
      { maxDistance: 0.09 },
    )

    expect(lengthOf(step.offset)).toBeCloseTo(0.09)
    expect(step.offset.x).toBeCloseTo(0.09)
    expect(step.applied.x).toBeCloseTo(0.01)
  })

  it('keeps a locked axis at zero', () => {
    const step = accumulateClampedDrag(
      { x: 0, y: 0, z: 0 },
      { x: 0.02, y: 0.5, z: 0.04 },
      { maxDistance: 0.09, axisScale: { x: 1, y: 0, z: 0.25 } },
    )

    expect(step.offset.y).toBe(0)
    expect(step.applied.y).toBe(0)
    expect(step.offset.z).toBeCloseTo(0.01)
  })

  it('does not grow when the next delta continues past the limit', () => {
    const first = accumulateClampedDrag(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { maxDistance: 0.04 },
    )
    const second = accumulateClampedDrag(
      first.offset,
      { x: 1, y: 0, z: 0 },
      { maxDistance: 0.04 },
    )

    expect(lengthOf(first.offset)).toBeCloseTo(0.04)
    expect(lengthOf(second.offset)).toBeCloseTo(0.04)
    expect(second.applied.x).toBeCloseTo(0)
    expect(second.applied.y).toBeCloseTo(0)
    expect(second.applied.z).toBeCloseTo(0)
  })
})
