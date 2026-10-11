import type { DragVec3 } from '@proj-airi/stage-shared'

import { accumulateClampedDrag } from '@proj-airi/stage-shared'

/** Share of the model canvas height a breast drag may travel. */
const BUST_MAX_DISTANCE = 0.16
/** Share of the model canvas height a skirt drag may travel, in any direction. */
const SKIRT_MAX_DISTANCE = 1
const DEFAULT_MAX_DISTANCE = 0.08
const BUST_AXIS_SCALE: DragVec3 = { x: 1, y: 1, z: 0 }
const SKIRT_AXIS_SCALE: DragVec3 = { x: 1, y: 1, z: 0 }
const DEFAULT_AXIS_SCALE: DragVec3 = { x: 0.7, y: 0.5, z: 0 }
/** How much of a parameter's authored range a drag may use, centred on the value at grab. */
const PARAMETER_RANGE_FRACTION = 0.35
/** Vertices on the edge of the region still move this much, so the outline does not tear open. */
const EDGE_WEIGHT = 0.35
/** How fast a released offset returns to rest, in 1/seconds. */
const RELEASE_RATE = 14
const SETTLED_DISTANCE = 0.0005
const BUST_ID = /bust|breast|chest|oppai|胸/i
const SKIRT_ID = /skirt|スカート/i

export interface Live2DDrawableBounds {
  x: number
  y: number
  width: number
  height: number
}

/** The drawable list and the canvas-space box of each one. */
export interface Live2DDrawablePicker {
  getDrawableIDs: () => readonly string[]
  getDrawableBounds: (index: number) => Live2DDrawableBounds
}

/**
 * The skirt or chest drawable under a model-canvas point.
 * When several overlap, the smaller one wins.
 */
export function pickLive2DDragDrawable(model: Live2DDrawablePicker, x: number, y: number) {
  const ids = model.getDrawableIDs()
  let bestId: string | undefined
  let bestArea = Number.POSITIVE_INFINITY
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index]
    if (!id || (!BUST_ID.test(id) && !SKIRT_ID.test(id)))
      continue
    const bounds = model.getDrawableBounds(index)
    if (x < bounds.x || x > bounds.x + bounds.width || y < bounds.y || y > bounds.y + bounds.height)
      continue
    const area = Math.abs(bounds.width * bounds.height)
    if (area < bestArea) {
      bestArea = area
      bestId = id
    }
  }
  return bestId
}

type RegionKind = 'bust' | 'skirt' | 'named'
type RegionMode = 'vertices' | 'parameter' | 'none'

/** Cubism core surface the drag writes. Vertex buffers are the live arrays, not copies. */
export interface Live2DRegionCore {
  getDrawableIndex: (id: string) => number
  getDrawableVertices: (index: number) => Float32Array
  getParameterCount: () => number
  getParameterIndex: (id: string) => number
  getParameterValueById: (id: string) => number
  setParameterValueById: (id: string, value: number) => void
  getParameterMaximumValue: (index: number) => number
  getParameterMinimumValue: (index: number) => number
}

export interface Live2DRegionModel {
  pixelsPerUnit: number
  originalHeight: number
  coreModel: Live2DRegionCore
  /** Model canvas bounds of a drawable, used to place the skirt hold point. */
  getDrawableBounds?: (index: number) => Live2DDrawableBounds
}

function regionKind(regionId: string): RegionKind {
  if (BUST_ID.test(regionId))
    return 'bust'
  if (SKIRT_ID.test(regionId))
    return 'skirt'
  return 'named'
}

function limitsFor(kind: RegionKind) {
  if (kind === 'bust')
    return { maxDistance: BUST_MAX_DISTANCE, axisScale: BUST_AXIS_SCALE }
  if (kind === 'skirt')
    return { maxDistance: SKIRT_MAX_DISTANCE, axisScale: SKIRT_AXIS_SCALE }
  return { maxDistance: DEFAULT_MAX_DISTANCE, axisScale: DEFAULT_AXIS_SCALE }
}

function signedAxis(offset: DragVec3, kind: RegionKind) {
  if (kind === 'bust')
    return offset.y
  // A skirt follows whichever way the hand actually moved, including straight up.
  if (kind === 'skirt')
    return Math.abs(offset.y) >= Math.abs(offset.x) ? offset.y : offset.x
  return Math.abs(offset.x) >= Math.abs(offset.y) ? offset.x : offset.y
}

/**
 * Adds the clamped offset onto the pose Cubism just wrote.
 *
 * Canvas +y is down. The live vertex buffer is Cubism's own space, +y up,
 * so the vertical part is flipped and both axes are divided by `pixelsPerUnit`.
 */
function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value))
}

/**
 * The grabbed canvas point, expressed in the vertex buffer.
 *
 * Drawable bounds are model canvas, +y down. Cubism vertices are +y up, so the
 * vertical fraction is flipped. The result is the hold: that vertex follows the hand.
 */
function holdInVertexSpace(vertices: Float32Array, bounds: Live2DDrawableBounds, grab: { x: number, y: number }) {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let index = 0; index < vertices.length; index += 2) {
    minX = Math.min(minX, vertices[index]!)
    maxX = Math.max(maxX, vertices[index]!)
    minY = Math.min(minY, vertices[index + 1]!)
    maxY = Math.max(maxY, vertices[index + 1]!)
  }
  const across = bounds.width !== 0 ? clampUnit((grab.x - bounds.x) / bounds.width) : 0.5
  const down = bounds.height !== 0 ? clampUnit((grab.y - bounds.y) / bounds.height) : 0.5
  return {
    x: minX + across * (maxX - minX),
    y: maxY - down * (maxY - minY),
  }
}

function offsetVertices(vertices: Float32Array, pixelX: number, pixelY: number, pixelsPerUnit: number, hold?: { x: number, y: number }) {
  const unit = pixelsPerUnit > 0 ? pixelsPerUnit : 1
  const rawX = pixelX / unit
  const rawY = -pixelY / unit
  const count = vertices.length / 2
  if (count < 1)
    return
  let centerX = hold?.x ?? 0
  let centerY = hold?.y ?? 0
  if (!hold) {
    for (let index = 0; index < vertices.length; index += 2) {
      centerX += vertices[index]!
      centerY += vertices[index + 1]!
    }
    centerX /= count
    centerY /= count
  }
  let radius = 0
  for (let index = 0; index < vertices.length; index += 2) {
    radius = Math.max(radius, Math.hypot(vertices[index]! - centerX, vertices[index + 1]! - centerY))
  }
  for (let index = 0; index < vertices.length; index += 2) {
    const distance = Math.hypot(vertices[index]! - centerX, vertices[index + 1]! - centerY)
    const along = radius > 1e-8 ? Math.min(1, distance / radius) : 0
    const weight = EDGE_WEIGHT + (1 - EDGE_WEIGHT) * (1 - along)
    vertices[index]! += rawX * weight
    vertices[index + 1]! += rawY * weight
  }
}

function vertexBufferIsLive(core: Live2DRegionCore, index: number) {
  const first = core.getDrawableVertices(index)
  const second = core.getDrawableVertices(index)
  return first === second && first.length >= 2
}

/**
 * Drags one Live2D region by id.
 *
 * The id is a drawable id when the core returns a live vertex buffer, and a
 * parameter id otherwise. The offset is reapplied after every model update
 * because Cubism rebuilds vertices from parameters each frame.
 */
export function createLive2DRegionDrag(modelHeight: () => number) {
  let regionId: string | undefined
  let offset: DragVec3 = { x: 0, y: 0, z: 0 }
  let dragging = false
  let releasing = false
  let mode: RegionMode | undefined
  let parameterBase: number | undefined
  /** Where the hand closed, in model canvas pixels. The skirt vertex there is the hold. */
  let grab: { x: number, y: number } | undefined

  function height() {
    const value = modelHeight()
    return Number.isFinite(value) && value > 0 ? value : 1
  }

  function clearOffset() {
    offset = { x: 0, y: 0, z: 0 }
    dragging = false
    releasing = false
    parameterBase = undefined
    grab = undefined
  }

  function resolve(model: Live2DRegionModel) {
    if (!regionId || mode)
      return
    const drawableIndex = model.coreModel.getDrawableIndex(regionId)
    if (drawableIndex >= 0 && vertexBufferIsLive(model.coreModel, drawableIndex)) {
      mode = 'vertices'
      return
    }
    const parameterIndex = model.coreModel.getParameterIndex(regionId)
    mode = parameterIndex >= 0 && parameterIndex < model.coreModel.getParameterCount()
      ? 'parameter'
      : 'none'
  }

  function stepRelease(deltaSeconds: number) {
    const keep = Math.exp(-RELEASE_RATE * Math.max(0, deltaSeconds))
    offset = { x: offset.x * keep, y: offset.y * keep, z: 0 }
    if (Math.hypot(offset.x, offset.y) < SETTLED_DISTANCE)
      clearOffset()
  }

  return {
    get regionId() {
      return regionId
    },
    setRegion(id: string | null) {
      regionId = id || undefined
      mode = undefined
      clearOffset()
    },
    begin(model: Live2DRegionModel, at?: { x: number, y: number }) {
      if (!regionId)
        return
      dragging = true
      releasing = false
      grab = at
      resolve(model)
      if (mode === 'parameter')
        parameterBase = model.coreModel.getParameterValueById(regionId)
    },
    /** `dx` and `dy` are in model canvas pixels, +y down. */
    pointerDelta(dx: number, dy: number) {
      if (!regionId || !dragging)
        return
      const step = accumulateClampedDrag(
        offset,
        { x: dx / height(), y: dy / height(), z: 0 },
        limitsFor(regionKind(regionId)),
      )
      offset = step.offset
    },
    release() {
      dragging = false
      releasing = Math.hypot(offset.x, offset.y) >= SETTLED_DISTANCE
    },
    /** Call from `beforeModelUpdate`, so a parameter id deforms with this frame. */
    writeParameter(model: Live2DRegionModel) {
      if (!regionId || (!dragging && !releasing))
        return
      resolve(model)
      if (mode !== 'parameter')
        return
      if (parameterBase === undefined)
        parameterBase = model.coreModel.getParameterValueById(regionId)
      const index = model.coreModel.getParameterIndex(regionId)
      const minimum = model.coreModel.getParameterMinimumValue(index)
      const maximum = model.coreModel.getParameterMaximumValue(index)
      const limits = limitsFor(regionKind(regionId))
      const span = (maximum - minimum) * PARAMETER_RANGE_FRACTION * 0.5
      const t = limits.maxDistance > 0 ? signedAxis(offset, regionKind(regionId)) / limits.maxDistance : 0
      const next = Math.min(maximum, Math.max(minimum, parameterBase + t * span))
      model.coreModel.setParameterValueById(regionId, next)
    },
    /** Call after `internalModel.update`. Steps the release spring, then offsets vertices. */
    afterUpdate(model: Live2DRegionModel, deltaSeconds: number) {
      if (!regionId)
        return
      resolve(model)
      if (releasing) {
        const base = parameterBase
        const id = regionId
        stepRelease(deltaSeconds)
        if (mode === 'parameter' && !releasing && id && base !== undefined)
          model.coreModel.setParameterValueById(id, base)
      }
      if (!regionId || mode !== 'vertices' || (!dragging && !releasing))
        return
      const index = model.coreModel.getDrawableIndex(regionId)
      if (index < 0)
        return
      const canvas = height()
      const vertices = model.coreModel.getDrawableVertices(index)
      const bounds = grab ? model.getDrawableBounds?.(index) : undefined
      const hold = grab && bounds ? holdInVertexSpace(vertices, bounds, grab) : undefined
      offsetVertices(
        vertices,
        offset.x * canvas,
        offset.y * canvas,
        model.pixelsPerUnit,
        hold,
      )
    },
  }
}
