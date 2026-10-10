import type { VRMCore, VRMHumanBoneName } from '@pixiv/three-vrm-core'
import type { Object3D, Vector3 } from 'three'

import type { VRMPoseRotations } from './pose'

import { MathUtils, Quaternion, Vector3 as ThreeVector3 } from 'three'

import { getPoseBoneNode, isVRM0, poseRotationToQuaternion } from './pose'

export interface VRMProceduralOptions {
  /** Breathing amplitude in degrees on the spine chain. 0 turns it off. */
  breathing: number
  /** Seconds per breath. */
  breathPeriod: number
  /** Slow head and body sway in degrees. 0 turns it off. */
  sway: number
  /** Share of the gaze direction the head and neck follow, 0 to 1. */
  headFollow: number
  /** Head bob in degrees while speaking. 0 turns it off. */
  speechNod: number
}

export const DEFAULT_VRM_PROCEDURAL_OPTIONS: VRMProceduralOptions = {
  breathing: 1.1,
  breathPeriod: 3.8,
  sway: 1.2,
  headFollow: 0.4,
  speechNod: 3,
}

export interface VRMProceduralFrame {
  /** Where the eyes look, in world space. */
  gazeTarget?: Vector3
  /** Mouth openness from lip sync, 0 to 1. */
  speechLevel?: number
  /**
   * How much of the procedural layer to keep, 0 to 1. A VRMA motion sets 0, so breathing,
   * sway and head follow do not fight the captured motion.
   */
  weight?: number
  /** Extra head and body rotations in degrees, such as an emotion's movement. Added on top. */
  additive?: VRMPoseRotations
}

/** Frame-rate independent exponential approach. */
function damp(current: number, target: number, rate: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-rate * delta))
}

/** Smooth value noise from three sines with unrelated periods. */
function wobble(t: number, seed: number) {
  return (Math.sin(t * 0.31 + seed) * 0.5 + Math.sin(t * 0.73 + seed * 1.7) * 0.3 + Math.sin(t * 1.37 + seed * 2.3) * 0.2)
}

/**
 * Procedural motion on top of the animation mixer: breathing, sway, head follow, speech bob,
 * and held poses.
 *
 * Use when:
 * - The idle VRMA clip is the base and the character should still look alive between motions.
 *
 * Expects:
 * - `restore()` runs before `AnimationMixer.update()`, and `apply()` after it, every frame.
 *   `restore()` puts back the bone rotations from before the last `apply()`, so bones the mixer
 *   does not animate do not accumulate offsets.
 */
export function useVRMProceduralMotion(initialOptions: Partial<VRMProceduralOptions> = {}) {
  const options: VRMProceduralOptions = { ...DEFAULT_VRM_PROCEDURAL_OPTIONS, ...initialOptions }

  const savedBase = new Map<Object3D, Quaternion>()
  let time = 0
  let layerWeight = 1
  let speech = 0
  let headYaw = 0
  let headPitch = 0

  // Static pose
  let poseTargets = new Map<VRMHumanBoneName, VRMPoseRotations[VRMHumanBoneName]>()
  let poseWeight = 0
  let poseWeightGoal = 0
  let poseBlendRate = 8

  const scratchQ = new Quaternion()
  const scratchQ2 = new Quaternion()
  const headPos = new ThreeVector3()
  const localTarget = new ThreeVector3()

  function save(node: Object3D) {
    if (!savedBase.has(node))
      savedBase.set(node, node.quaternion.clone())
  }

  /** Puts back the rotations that `apply()` changed in the last frame. */
  function restore() {
    for (const [node, q] of savedBase)
      node.quaternion.copy(q)
    savedBase.clear()
  }

  /** Multiplies a small local rotation in degrees onto a bone, VRM 1.0 convention. */
  function addRotation(vrm: VRMCore, bone: VRMHumanBoneName, x: number, y: number, z: number) {
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) < 1e-4)
      return
    const node = getPoseBoneNode(vrm, bone)
    if (!node)
      return
    save(node)
    poseRotationToQuaternion([x, y, z], isVRM0(vrm), scratchQ)
    node.quaternion.multiply(scratchQ)
  }

  function applyOverride(vrm: VRMCore, bone: VRMHumanBoneName, q: Quaternion, weight: number) {
    if (weight <= 1e-3)
      return
    const node = getPoseBoneNode(vrm, bone)
    if (!node)
      return
    save(node)
    node.quaternion.slerp(q, MathUtils.clamp(weight, 0, 1))
  }

  function applyHeadFollow(vrm: VRMCore, gazeTarget: Vector3 | undefined, delta: number, weight: number) {
    const head = getPoseBoneNode(vrm, 'head')
    let yaw = 0
    let pitch = 0
    if (gazeTarget && head && options.headFollow > 0) {
      head.getWorldPosition(headPos)
      localTarget.copy(gazeTarget)
      vrm.scene.worldToLocal(localTarget)
      vrm.scene.worldToLocal(headPos)
      localTarget.sub(headPos)
      if (isVRM0(vrm)) {
        localTarget.x = -localTarget.x
        localTarget.z = -localTarget.z
      }
      // Only follow targets in front of the face.
      if (localTarget.z > 0.05) {
        const horizontal = Math.hypot(localTarget.x, localTarget.z)
        yaw = MathUtils.clamp(MathUtils.radToDeg(Math.atan2(localTarget.x, localTarget.z)), -40, 40)
        pitch = MathUtils.clamp(MathUtils.radToDeg(Math.atan2(-localTarget.y, horizontal)), -25, 25)
      }
    }
    headYaw = damp(headYaw, yaw * options.headFollow * weight, 5, delta)
    headPitch = damp(headPitch, pitch * options.headFollow * weight, 5, delta)
    // Split across neck and head the way a person turns: the neck takes a little, the head the rest.
    addRotation(vrm, 'neck', headPitch * 0.3, headYaw * 0.35, 0)
    addRotation(vrm, 'head', headPitch * 0.7, headYaw * 0.65, 0)
  }

  /** Runs after the mixer has written this frame's animated pose. */
  function apply(vrm: VRMCore | undefined, delta: number, frame: VRMProceduralFrame = {}) {
    if (!vrm?.humanoid)
      return
    time += delta
    layerWeight = damp(layerWeight, frame.weight ?? 1, 4, delta)

    poseWeight = damp(poseWeight, poseWeightGoal, poseBlendRate, delta)
    if (poseWeight > 1e-3) {
      const vrm0 = isVRM0(vrm)
      for (const [bone, rotation] of poseTargets) {
        if (!rotation)
          continue
        applyOverride(vrm, bone, poseRotationToQuaternion(rotation, vrm0, scratchQ2), poseWeight)
      }
    }
    else if (poseWeightGoal === 0 && poseTargets.size > 0) {
      poseTargets = new Map()
    }

    const w = layerWeight
    if (options.breathing > 0) {
      const phase = (time / options.breathPeriod) * Math.PI * 2
      // Inhale is a little quicker than exhale.
      const breath = Math.sin(phase) * 0.8 + Math.sin(phase * 2 - 0.6) * 0.2
      const amp = options.breathing * w
      addRotation(vrm, 'spine', -breath * amp * 0.35, 0, 0)
      addRotation(vrm, vrm.humanoid.getNormalizedBoneNode('upperChest') ? 'upperChest' : 'chest', -breath * amp * 0.6, 0, 0)
      addRotation(vrm, 'leftShoulder', 0, 0, breath * amp * 0.5)
      addRotation(vrm, 'rightShoulder', 0, 0, -breath * amp * 0.5)
    }

    if (options.sway > 0) {
      const amp = options.sway * w
      addRotation(vrm, 'spine', 0, wobble(time, 1) * amp * 0.6, wobble(time, 2) * amp * 0.4)
      addRotation(vrm, 'head', wobble(time, 3) * amp * 0.6, wobble(time, 4) * amp, wobble(time, 5) * amp * 0.8)
    }

    applyHeadFollow(vrm, frame.gazeTarget, delta, w)

    if (frame.additive) {
      for (const [bone, rotation] of Object.entries(frame.additive) as [VRMHumanBoneName, VRMPoseRotations[VRMHumanBoneName]][]) {
        if (rotation)
          addRotation(vrm, bone, rotation[0] * w, rotation[1] * w, rotation[2] * w)
      }
    }

    const level = MathUtils.clamp(frame.speechLevel ?? 0, 0, 1)
    speech = damp(speech, level, level > speech ? 18 : 4, delta)
    if (options.speechNod > 0 && speech > 0.01) {
      const bob = speech * options.speechNod
      addRotation(vrm, 'head', bob * (0.55 + 0.45 * Math.sin(time * 5.3)), bob * 0.35 * Math.sin(time * 2.1), bob * 0.25 * Math.sin(time * 1.7 + 1))
      addRotation(vrm, 'chest', bob * 0.15 * Math.sin(time * 5.3 - 0.4), 0, 0)
    }
  }

  /**
   * Holds a pose over the animation until {@link clearPose}. Bones left out keep animating.
   *
   * @param pose - Target rotations per bone.
   * @param blend - Seconds to blend in.
   */
  function setPose(pose: VRMPoseRotations, blend = 0.35) {
    poseTargets = new Map(Object.entries(pose) as [VRMHumanBoneName, VRMPoseRotations[VRMHumanBoneName]][])
    poseWeightGoal = 1
    poseBlendRate = blend > 0 ? 3 / blend : 1000
  }

  function clearPose(blend = 0.35) {
    poseWeightGoal = 0
    poseBlendRate = blend > 0 ? 3 / blend : 1000
  }

  function setOptions(next: Partial<VRMProceduralOptions>) {
    Object.assign(options, next)
  }

  function reset() {
    restore()
    poseTargets = new Map()
    poseWeight = 0
    poseWeightGoal = 0
    headYaw = 0
    headPitch = 0
    speech = 0
  }

  return {
    apply,
    clearPose,
    options,
    reset,
    restore,
    setOptions,
    setPose,
  }
}
