import type { VRMCore } from '@pixiv/three-vrm-core'

import { MathUtils, Object3D, Vector3 } from 'three'

import { randomSaccadeInterval } from './utils/eye-motions'

/**
 * Eye gaze that follows a focus point smoothly and adds small idle saccades.
 *
 * Use when:
 * - The eye target comes from the cursor or the camera and jumps in steps.
 *
 * Expects:
 * - {@link update} runs every frame before `vrm.lookAt.update()`.
 *
 * Returns:
 * - {@link target}: the smoothed world-space point, which the head follow reads.
 */
export function useVRMGaze(options: { followRate?: number, saccadeDegrees?: number } = {}) {
  const followRate = options.followRate ?? 10
  const saccadeDegrees = options.saccadeDegrees ?? 2.2

  const focus = new Vector3(0, 1.4, -100)
  const target = new Vector3().copy(focus)
  const saccade = new Vector3()
  const eyeWorld = new Vector3()
  const scratch = new Vector3()
  let hasTarget = false
  let stillFor = 0
  let nextSaccadeIn = 1
  let sinceSaccade = 0

  function ensureLookAtTarget(vrm: VRMCore) {
    if (!vrm.lookAt)
      return undefined
    if (!vrm.lookAt.target) {
      // Same type mismatch as useIdleEyeSaccades: @pmndrs/pointer-events augments Object3D.
      vrm.lookAt.target = new Object3D() as unknown as Object3D
    }
    return vrm.lookAt.target
  }

  /** Sets where the character should look, in world space. */
  function setFocus(point: { x: number, y: number, z: number }, options?: { instant?: boolean }) {
    if (focus.distanceToSquared(scratch.set(point.x, point.y, point.z)) > 1e-6)
      stillFor = 0
    focus.copy(scratch)
    if (options?.instant || !hasTarget) {
      target.copy(focus)
      hasTarget = true
    }
  }

  function pickSaccade(vrm: VRMCore) {
    // Saccades only while the focus rests: a moving cursor already moves the eyes.
    if (stillFor < 0.6) {
      saccade.set(0, 0, 0)
      return
    }
    const head = vrm.humanoid?.getNormalizedBoneNode('head')
    head?.getWorldPosition(eyeWorld)
    const distance = head ? Math.max(0.3, eyeWorld.distanceTo(target)) : 1
    // Most saccades land back near the focus; some drift a little further.
    const reach = Math.random() < 0.35 ? 0 : saccadeDegrees
    const radius = distance * Math.tan(MathUtils.degToRad(reach))
    saccade.set(MathUtils.randFloatSpread(2) * radius, MathUtils.randFloatSpread(1.2) * radius, 0)
  }

  function update(vrm: VRMCore | undefined, delta: number) {
    if (!vrm)
      return
    stillFor += delta
    sinceSaccade += delta
    target.lerp(focus, 1 - Math.exp(-followRate * delta))

    if (sinceSaccade >= nextSaccadeIn) {
      sinceSaccade = 0
      nextSaccadeIn = randomSaccadeInterval() / 1000
      pickSaccade(vrm)
    }
    if (stillFor < 0.6)
      saccade.multiplyScalar(Math.exp(-12 * delta))

    const lookAtTarget = ensureLookAtTarget(vrm)
    lookAtTarget?.position.copy(target).add(saccade)
  }

  return {
    setFocus,
    target,
    update,
  }
}
