/** A displacement in the same units the caller drags in. */
export interface DragVec3 {
  x: number
  y: number
  z: number
}

/**
 * Limits for one drag gesture.
 *
 * `axisScale` is applied to each frame's delta before it joins the accumulated
 * offset. `maxDistance` then caps the length of that offset.
 */
export interface DragClamp {
  maxDistance: number
  axisScale?: DragVec3
}

/** The offset after this frame, and the part of the delta the clamp kept. */
export interface ClampedDragStep {
  offset: DragVec3
  applied: DragVec3
}

const UNIT_AXIS: DragVec3 = { x: 1, y: 1, z: 1 }

function lengthOf(value: DragVec3) {
  return Math.hypot(value.x, value.y, value.z)
}

/**
 * Adds `delta` to `offset`, then keeps the result inside a sphere.
 *
 * The returned `applied` vector is the part that still fit. Once the offset sits
 * on the sphere, a further delta along the same direction applies nothing, so a
 * long drag cannot keep stretching the mesh.
 *
 * Does not mutate `offset` or `delta`.
 */
export function accumulateClampedDrag(offset: DragVec3, delta: DragVec3, clamp: DragClamp): ClampedDragStep {
  const axis = clamp.axisScale ?? UNIT_AXIS
  const next = {
    x: offset.x + delta.x * axis.x,
    y: offset.y + delta.y * axis.y,
    z: offset.z + delta.z * axis.z,
  }
  const maxDistance = Math.max(0, clamp.maxDistance)
  const length = lengthOf(next)
  if (length > maxDistance && length > 0) {
    const scale = maxDistance / length
    next.x *= scale
    next.y *= scale
    next.z *= scale
  }
  return {
    offset: next,
    applied: {
      x: next.x - offset.x,
      y: next.y - offset.y,
      z: next.z - offset.z,
    },
  }
}
