import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'

import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three'

/** Normalized VRM humanoid regions that can produce a user interaction. */
export const VRM_INTERACTION_TARGETS = [
  'head',
  'headPat',
  'cheek',
  'chest',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftFoot',
  'rightFoot',
] as const

/** Identifies the normalized humanoid region hit by a pointer interaction. */
export type VrmInteractionTarget = (typeof VRM_INTERACTION_TARGETS)[number]

const COLLIDER_NAME_PREFIX = 'vrm_interaction_'
const MAX_MODEL_SCALE = 1.5
const MIN_MODEL_SCALE = 0.65
const REFERENCE_MODEL_HEIGHT = 1.6

interface ColliderDefinition {
  target: VrmInteractionTarget
  /** Humanoid bones tried in order; the first the model has wins. */
  bones: readonly VRMHumanBoneName[]
  size: readonly [number, number, number]
  offset: readonly [number, number, number]
}

const COLLIDER_DEFINITIONS: readonly ColliderDefinition[] = [
  { target: 'head', bones: ['head'], size: [0.22, 0.25, 0.25], offset: [0, 0.05, 0] },
  { target: 'chest', bones: ['upperChest', 'chest'], size: [0.26, 0.16, 0.14], offset: [0, 0, 0.07] },
  { target: 'leftUpperArm', bones: ['leftUpperArm'], size: [0.2, 0.34, 0.2], offset: [0, -0.17, 0] },
  { target: 'leftLowerArm', bones: ['leftLowerArm'], size: [0.17, 0.3, 0.17], offset: [0, -0.15, 0] },
  { target: 'leftHand', bones: ['leftHand'], size: [0.2, 0.2, 0.2], offset: [0.06, 0, 0] },
  { target: 'rightUpperArm', bones: ['rightUpperArm'], size: [0.2, 0.34, 0.2], offset: [0, -0.17, 0] },
  { target: 'rightLowerArm', bones: ['rightLowerArm'], size: [0.17, 0.3, 0.17], offset: [0, -0.15, 0] },
  { target: 'rightHand', bones: ['rightHand'], size: [0.2, 0.2, 0.2], offset: [-0.06, 0, 0] },
  { target: 'leftFoot', bones: ['leftFoot'], size: [0.15, 0.15, 0.25], offset: [0, -0.05, -0.08] },
  { target: 'rightFoot', bones: ['rightFoot'], size: [0.15, 0.15, 0.25], offset: [0, -0.05, -0.08] },
]

export interface VrmInteractionColliderSet {
  /** Invisible Three.js meshes used only by the interaction raycaster. */
  readonly colliders: readonly Mesh[]
  /** Removes the meshes from their bones and releases their GPU resources. */
  dispose: () => void
}

function getModelScale(vrm: VRM) {
  const bounds = new Box3().setFromObject(vrm.scene)
  const size = new Vector3()
  bounds.getSize(size)
  if (!Number.isFinite(size.y) || size.y <= 0)
    return 1
  return Math.min(MAX_MODEL_SCALE, Math.max(MIN_MODEL_SCALE, size.y / REFERENCE_MODEL_HEIGHT))
}

/** Creates model-relative invisible hit regions attached to normalized VRM bones. */
export function createVrmInteractionColliders(vrm: VRM): VrmInteractionColliderSet {
  const material = new MeshBasicMaterial({ visible: false })
  const scale = getModelScale(vrm)
  const colliders: Mesh[] = []

  for (const definition of COLLIDER_DEFINITIONS) {
    const boneNode = definition.bones
      .map(bone => vrm.humanoid?.getNormalizedBoneNode(bone))
      .find(node => !!node)
    if (!boneNode)
      continue

    const geometry = new BoxGeometry(
      definition.size[0] * scale,
      definition.size[1] * scale,
      definition.size[2] * scale,
    )
    const collider = new Mesh(geometry, material)
    collider.name = `${COLLIDER_NAME_PREFIX}${definition.target}`
    collider.position.set(
      definition.offset[0] * scale,
      definition.offset[1] * scale,
      definition.offset[2] * scale,
    )
    boneNode.add(collider)
    colliders.push(collider)
  }

  let disposed = false
  return {
    colliders,
    dispose() {
      if (disposed)
        return
      disposed = true
      for (const collider of colliders) {
        collider.removeFromParent()
        collider.geometry.dispose()
      }
      material.dispose()
      colliders.length = 0
    },
  }
}

/**
 * Normalizes a collider object name into an interaction target.
 *
 * Before:
 * - "vrm_interaction_leftUpperArm"
 *
 * After:
 * - "leftUpperArm"
 */
export function getVrmInteractionTargetFromObjectName(name: string): VrmInteractionTarget | null {
  if (!name.startsWith(COLLIDER_NAME_PREFIX))
    return null
  const target = name.slice(COLLIDER_NAME_PREFIX.length)
  return (VRM_INTERACTION_TARGETS as readonly string[]).includes(target)
    ? target as VrmInteractionTarget
    : null
}

export function isClickLikePointerGesture(
  start: { x: number, y: number },
  end: { x: number, y: number },
  maxDistance = 8,
): boolean {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return dx * dx + dy * dy <= maxDistance * maxDistance
}
