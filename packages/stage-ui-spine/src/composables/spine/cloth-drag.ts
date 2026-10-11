import type { DragVec3 } from '@proj-airi/stage-shared'

import { accumulateClampedDrag } from '@proj-airi/stage-shared'

/** Share of the rig height a breast drag may travel. */
export const SPINE_BUST_REACH = 0.14
/** Share of the rig height a skirt drag may travel. Up is the long axis. */
export const SPINE_SKIRT_REACH = 0.7
/**
 * Cumulative curl at depth 1..4 when the skirt is pulled fully up, in degrees.
 * Depth 1 flips the cloth off the hips. Later joints follow, so the hem does not spiral.
 */
const SKIRT_CUMULATIVE = [85, 125, 150, 165]
/** Extra curl from a full sideways pull, in degrees, same sign for every panel. */
const SKIRT_SWAY = 12

export type SpineClothRegion = 'bust' | 'skirt'

export function clothClamp(region: SpineClothRegion, size: number) {
  const height = Number.isFinite(size) && size > 0 ? size : 1
  if (region === 'bust')
    return { maxDistance: height * SPINE_BUST_REACH, axisScale: { x: 1, y: 1, z: 0 } }
  return { maxDistance: height * SPINE_SKIRT_REACH, axisScale: { x: 0.35, y: 1, z: 0 } }
}

/** Adds one frame of movement and keeps the cloth inside its reach. */
export function stepClothOffset(offset: DragVec3, dx: number, dy: number, region: SpineClothRegion, size: number) {
  return accumulateClampedDrag(offset, { x: dx, y: dy, z: 0 }, clothClamp(region, size))
}

/** Joint delta at this depth. Depth 0 is the waist pivot. */
function skirtJointShare(depth: number) {
  if (depth <= 0)
    return 0
  const index = Math.min(depth, SKIRT_CUMULATIVE.length) - 1
  const here = SKIRT_CUMULATIVE[index]
  const prev = index === 0 ? 0 : SKIRT_CUMULATIVE[index - 1]
  return here - prev
}

/**
 * Local rotation added to one skirt joint, in degrees.
 *
 * Depth 0 is the waist pivot and stays put. The first cloth joint takes most of
 * the flip so the panel rises off the hips. The sign does not depend on rest
 * rotation, so neighboring panels cannot scissor a shared mesh. `restRotation`
 * is accepted and ignored on purpose.
 */
export function skirtJointRotation(depth: number, pull: number, restRotation = 0) {
  if (!Number.isFinite(restRotation))
    return 0
  const share = skirtJointShare(depth)
  if (share === 0)
    return 0
  return Math.min(1, Math.max(0, pull)) * share
}

/** Sideways curl, same sign and same depth share as {@link skirtJointRotation}. `pullX` is -1..1. */
export function skirtJointSway(depth: number, pullX: number, restRotation = 0) {
  if (!Number.isFinite(restRotation))
    return 0
  const share = skirtJointShare(depth)
  if (share === 0)
    return 0
  const total = SKIRT_CUMULATIVE[SKIRT_CUMULATIVE.length - 1]
  const amount = Math.max(-1, Math.min(1, pullX)) * SKIRT_SWAY
  return amount * (share / total)
}

/**
 * Extra motion on top of the clamped breast offset.
 *
 * Pulling up adds lift and spreads the breasts outward, and the bone tips
 * rotate with the drag, so the gesture reads as peeling rather than sliding.
 */
export function bustPeel(offset: DragVec3, maxDistance: number) {
  const cap = Math.max(maxDistance, 1e-6)
  const lift = Math.max(0, offset.y)
  const outward = Math.min(cap * 0.5, lift * 0.7 + Math.abs(offset.x) * 0.2)
  const rotation = Math.min(1, Math.hypot(offset.x, lift) / cap) * 26
  const extraLift = Math.min(cap * 0.35, lift * 0.2)
  return { outward, rotation, extraLift }
}
