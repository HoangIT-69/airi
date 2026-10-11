import type { Live2DRegionCore, Live2DRegionModel } from './drag-region'

import { describe, expect, it } from 'vitest'

import { createLive2DRegionDrag, pickLive2DDragDrawable } from './drag-region'

const REST = Float32Array.from([-1, 0, 1, 0, 0, 0])

function liveModel(vertices: Float32Array): Live2DRegionModel {
  const core: Live2DRegionCore = {
    getDrawableIndex: id => id === 'ArtMeshSkirt' ? 0 : -1,
    getDrawableVertices: () => vertices,
    getParameterCount: () => 0,
    getParameterIndex: () => -1,
    getParameterValueById: () => 0,
    setParameterValueById: () => {},
    getParameterMaximumValue: () => 0,
    getParameterMinimumValue: () => 0,
  }
  return { pixelsPerUnit: 1, originalHeight: 1000, coreModel: core }
}

describe('createLive2DRegionDrag', () => {
  it('caps a skirt drag and ignores a further pull in the same direction', () => {
    const vertices = REST.slice()
    const model = liveModel(vertices)
    const drag = createLive2DRegionDrag(() => 1000)
    drag.setRegion('ArtMeshSkirt')
    drag.begin(model)
    drag.pointerDelta(5000, 0)
    drag.afterUpdate(model, 1 / 60)
    const held = vertices[4]
    vertices.set(REST)
    drag.pointerDelta(5000, 0)
    drag.afterUpdate(model, 1 / 60)

    expect(held).toBeCloseTo(1000)
    expect(vertices[4]).toBeCloseTo(1000)
  })

  it('moves a skirt as far up as sideways', () => {
    const sideways = REST.slice()
    const vertical = REST.slice()
    const sidewaysDrag = createLive2DRegionDrag(() => 1000)
    const verticalDrag = createLive2DRegionDrag(() => 1000)
    sidewaysDrag.setRegion('ArtMeshSkirt')
    verticalDrag.setRegion('ArtMeshSkirt')
    sidewaysDrag.begin(liveModel(sideways))
    verticalDrag.begin(liveModel(vertical))
    sidewaysDrag.pointerDelta(100, 0)
    verticalDrag.pointerDelta(0, 100)
    sidewaysDrag.afterUpdate(liveModel(sideways), 1 / 60)
    verticalDrag.afterUpdate(liveModel(vertical), 1 / 60)

    expect(Math.abs(vertical[5]!)).toBeCloseTo(Math.abs(sideways[4]!))
  })

  it('writes a parameter when the vertex buffer is only a copy', () => {
    let value = 0
    const core: Live2DRegionCore = {
      getDrawableIndex: () => 0,
      getDrawableVertices: () => REST.slice(),
      getParameterCount: () => 1,
      getParameterIndex: () => 0,
      getParameterValueById: () => value,
      setParameterValueById: (_id, next) => {
        value = next
      },
      getParameterMinimumValue: () => -30,
      getParameterMaximumValue: () => 30,
    }
    const model: Live2DRegionModel = { pixelsPerUnit: 1, originalHeight: 1000, coreModel: core }
    const drag = createLive2DRegionDrag(() => 1000)
    drag.setRegion('ParamBustY')
    drag.begin(model)
    drag.pointerDelta(0, 5000)
    drag.writeParameter(model)

    expect(value).toBeCloseTo(10.5)
    expect(value).toBeLessThan(30)
  })

  it('holds the grabbed skirt point and lets the far side lag', () => {
    const vertices = REST.slice()
    const model = liveModel(vertices)
    model.getDrawableBounds = () => ({ x: 0, y: 0, width: 2, height: 2 })
    const drag = createLive2DRegionDrag(() => 1000)
    drag.setRegion('ArtMeshSkirt')
    drag.begin(model, { x: 0, y: 1 })
    drag.pointerDelta(100, 0)
    drag.afterUpdate(model, 1 / 60)

    const left = vertices[0]! - REST[0]!
    const right = vertices[2]! - REST[2]!
    expect(left).toBeCloseTo(100)
    expect(right).toBeLessThan(left)
  })

  it('moves a skirt parameter when the hand pulls upward', () => {
    let value = 0
    const core: Live2DRegionCore = {
      getDrawableIndex: () => 0,
      getDrawableVertices: () => REST.slice(),
      getParameterCount: () => 1,
      getParameterIndex: () => 0,
      getParameterValueById: () => value,
      setParameterValueById: (_id, next) => {
        value = next
      },
      getParameterMinimumValue: () => -30,
      getParameterMaximumValue: () => 30,
    }
    const model: Live2DRegionModel = { pixelsPerUnit: 1, originalHeight: 1000, coreModel: core }
    const drag = createLive2DRegionDrag(() => 1000)
    drag.setRegion('ArtMeshSkirt')
    drag.begin(model)
    drag.pointerDelta(0, -5000)
    drag.writeParameter(model)

    expect(value).toBeCloseTo(-10.5)
  })

  it('springs a released offset back toward rest', () => {
    const vertices = REST.slice()
    const model = liveModel(vertices)
    const drag = createLive2DRegionDrag(() => 1000)
    drag.setRegion('ArtMeshSkirt')
    drag.begin(model)
    drag.pointerDelta(100, 0)
    drag.release()
    drag.afterUpdate(model, 0.05)
    const mid = vertices[4]!
    vertices.set(REST)
    drag.afterUpdate(model, 1)

    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(100)
    expect(vertices[4]).toBeCloseTo(0)
  })
})

describe('pickLive2DDragDrawable', () => {
  const ids = ['ArtMeshSkirt', 'ArtMeshBust', 'ArtMeshHair']
  const bounds = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 10, y: 10, width: 20, height: 20 },
    { x: 0, y: 0, width: 5, height: 5 },
  ]
  const model = {
    getDrawableIDs: () => ids,
    getDrawableBounds: (index: number) => bounds[index]!,
  }

  it('picks the smaller skirt or chest drawable and ignores the rest', () => {
    expect(pickLive2DDragDrawable(model, 15, 15)).toBe('ArtMeshBust')
    expect(pickLive2DDragDrawable(model, 80, 80)).toBe('ArtMeshSkirt')
    expect(pickLive2DDragDrawable(model, 2, 2)).toBe('ArtMeshSkirt')
    expect(pickLive2DDragDrawable(model, 200, 200)).toBeUndefined()
  })
})
