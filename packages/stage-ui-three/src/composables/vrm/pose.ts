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

/** One key of a gesture. `t` is in seconds from the gesture start. */
export interface VRMGestureKeyframe {
  t: number
  pose: VRMPoseRotations
}

export interface VRMGesture {
  /** Keys sorted by `t`. A bone missing from a key fades back to the animation at that key. */
  keyframes: readonly VRMGestureKeyframe[]
  /** Seconds to blend the gesture in and out over the animation. */
  blend?: number
}

const ARMS_DOWN: VRMPoseRotations = {
  leftUpperArm: [0, 0, -72],
  rightUpperArm: [0, 0, 72],
  leftLowerArm: [0, -8, 0],
  rightLowerArm: [0, 8, 0],
}

/**
 * Gestures that need no animation file. The character card can ask for them with
 * `<|ACT:{"motion":"wave"}|>`.
 */
export const VRM_BUILTIN_GESTURES: Record<string, VRMGesture> = {
  nod: {
    blend: 0.15,
    keyframes: [
      { t: 0, pose: { head: [0, 0, 0], neck: [0, 0, 0] } },
      { t: 0.18, pose: { head: [12, 0, 0], neck: [4, 0, 0] } },
      { t: 0.38, pose: { head: [-2, 0, 0], neck: [0, 0, 0] } },
      { t: 0.56, pose: { head: [9, 0, 0], neck: [3, 0, 0] } },
      { t: 0.8, pose: { head: [0, 0, 0], neck: [0, 0, 0] } },
    ],
  },
  shake: {
    blend: 0.15,
    keyframes: [
      { t: 0, pose: { head: [0, 0, 0] } },
      { t: 0.15, pose: { head: [2, 16, 0] } },
      { t: 0.4, pose: { head: [2, -16, 0] } },
      { t: 0.62, pose: { head: [2, 11, 0] } },
      { t: 0.85, pose: { head: [0, 0, 0] } },
    ],
  },
  wave: {
    blend: 0.3,
    keyframes: [
      { t: 0, pose: { rightUpperArm: [0, 20, 10], rightLowerArm: [0, 0, -80], rightHand: [0, 0, 0], head: [0, 0, -4] } },
      { t: 0.35, pose: { rightUpperArm: [0, 20, 10], rightLowerArm: [0, 0, -110], rightHand: [0, 0, -10], head: [0, 0, -5] } },
      { t: 0.7, pose: { rightUpperArm: [0, 20, 10], rightLowerArm: [0, 0, -75], rightHand: [0, 0, 10], head: [0, 0, -5] } },
      { t: 1.05, pose: { rightUpperArm: [0, 20, 10], rightLowerArm: [0, 0, -110], rightHand: [0, 0, -10], head: [0, 0, -5] } },
      { t: 1.4, pose: { rightUpperArm: [0, 20, 10], rightLowerArm: [0, 0, -80], rightHand: [0, 0, 0], head: [0, 0, -4] } },
    ],
  },
  bow: {
    blend: 0.35,
    keyframes: [
      { t: 0, pose: { spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], ...ARMS_DOWN } },
      { t: 0.6, pose: { spine: [16, 0, 0], chest: [10, 0, 0], neck: [6, 0, 0], head: [8, 0, 0], ...ARMS_DOWN } },
      { t: 1.3, pose: { spine: [16, 0, 0], chest: [10, 0, 0], neck: [6, 0, 0], head: [8, 0, 0], ...ARMS_DOWN } },
      { t: 1.9, pose: { spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], ...ARMS_DOWN } },
    ],
  },
  think: {
    blend: 0.4,
    keyframes: [
      { t: 0, pose: { head: [-6, 8, 8], rightUpperArm: [0, 45, 62], rightLowerArm: [0, 125, 0], rightHand: [0, 0, -20] } },
      { t: 2.2, pose: { head: [-4, 10, 10], rightUpperArm: [0, 45, 62], rightLowerArm: [0, 125, 0], rightHand: [0, 0, -20] } },
    ],
  },
  cheer: {
    blend: 0.25,
    keyframes: [
      { t: 0, pose: { leftUpperArm: [0, 0, 40], rightUpperArm: [0, 0, -40], leftLowerArm: [0, 0, 30], rightLowerArm: [0, 0, -30], spine: [-4, 0, 0] } },
      { t: 0.3, pose: { leftUpperArm: [0, 0, 60], rightUpperArm: [0, 0, -60], leftLowerArm: [0, 0, 10], rightLowerArm: [0, 0, -10], spine: [-6, 0, 0] } },
      { t: 0.6, pose: { leftUpperArm: [0, 0, 45], rightUpperArm: [0, 0, -45], leftLowerArm: [0, 0, 30], rightLowerArm: [0, 0, -30], spine: [-4, 0, 0] } },
      { t: 0.9, pose: { leftUpperArm: [0, 0, 60], rightUpperArm: [0, 0, -60], leftLowerArm: [0, 0, 10], rightLowerArm: [0, 0, -10], spine: [-6, 0, 0] } },
    ],
  },
  tilt: {
    blend: 0.25,
    keyframes: [
      { t: 0, pose: { head: [0, 0, 0] } },
      { t: 0.35, pose: { head: [-2, 4, 14] } },
      { t: 1.6, pose: { head: [-2, 4, 14] } },
      { t: 2, pose: { head: [0, 0, 0] } },
    ],
  },
}

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

/** Total length of a gesture in seconds. */
export function gestureDuration(gesture: VRMGesture) {
  return gesture.keyframes.at(-1)?.t ?? 0
}
