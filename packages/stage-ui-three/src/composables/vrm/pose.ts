import type { VRMCore, VRMHumanBoneName } from '@pixiv/three-vrm-core'
import type { Object3D } from 'three'

import { Euler, MathUtils, Quaternion } from 'three'

/**
 * A bone rotation in degrees, as Euler angles in XYZ order.
 *
 * Angles use the VRM 1.0 normalized rig: the model faces +Z, its left side is +X.
 * - head `[+x]` looks down, `[+y]` turns to the model's left.
 * - leftUpperArm `[0, 0, -70]` and rightUpperArm `[0, 0, 70]` lower the arms from the T-pose.
 *
 * VRM 0.x models are converted on apply, so one pose works for both.
 */
export type VRMPoseRotation = readonly [x: number, y: number, z: number]

/** Rotations for some humanoid bones. Bones that are left out keep their animated rotation. */
export type VRMPoseRotations = Partial<Record<VRMHumanBoneName, VRMPoseRotation>>

const scratchEuler = new Euler()

/** Converts a pose rotation to a normalized-bone quaternion for this model. */
export function poseRotationToQuaternion(rotation: VRMPoseRotation, isVRM0: boolean, target = new Quaternion()) {
  scratchEuler.set(
    MathUtils.degToRad(rotation[0]),
    MathUtils.degToRad(rotation[1]),
    MathUtils.degToRad(rotation[2]),
    'XYZ',
  )
  target.setFromEuler(scratchEuler)
  // VRM 0.x faces -Z, so its normalized rig is the VRM 1.0 rig turned 180° around Y.
  // three-vrm-animation applies the same flip to VRMA rotation tracks.
  if (isVRM0) {
    target.x = -target.x
    target.z = -target.z
  }
  return target
}

export function isVRM0(vrm: VRMCore) {
  return vrm.meta?.metaVersion === '0'
}

export function getPoseBoneNode(vrm: VRMCore, bone: VRMHumanBoneName): Object3D | null {
  return vrm.humanoid?.getNormalizedBoneNode(bone) ?? null
}
