import type { VRM } from '@pixiv/three-vrm'

import { VRMCore as Core, VRMHumanoid } from '@pixiv/three-vrm-core'
import { Group, Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { stepArmSpring, useVRMProceduralMotion } from './procedural'
import { createVRMSpringBoneStepper } from './spring-bone'

function createRig(metaVersion: '0' | '1' = '1') {
  const scene = new Group()
  function bone(parent: Object3D, x: number, y: number) {
    const node = new Object3D()
    node.position.set(x, y, 0)
    parent.add(node)
    return { node }
  }
  const hips = bone(scene, 0, 0.9)
  const spine = bone(hips.node, 0, 0.2)
  const chest = bone(spine.node, 0, 0.2)
  const neck = bone(chest.node, 0, 0.2)
  const head = bone(neck.node, 0, 0.1)
  const humanoid = new VRMHumanoid({ hips, spine, chest, neck, head } as never)
  scene.add(humanoid.normalizedHumanBonesRoot)
  const meta = metaVersion === '1'
    ? { metaVersion: '1' as const, name: 'Test rig', authors: ['AIRI'], licenseUrl: 'https://opensource.org/license/mit' }
    : { metaVersion: '0' as const }
  const vrm = new Core({ scene, humanoid, meta: meta as never })
  const group = new Group()
  group.add(scene)
  group.updateMatrixWorld(true)
  return { vrm, head: humanoid.getNormalizedBoneNode('head')! }
}

describe('useVRMProceduralMotion', () => {
  it('does not accumulate offsets on bones the mixer leaves alone', () => {
    const { vrm, head } = createRig()
    const procedural = useVRMProceduralMotion({ breathing: 0, headFollow: 0, speechNod: 0, sway: 2 })
    const rest = head.quaternion.clone()

    for (let i = 0; i < 300; i++) {
      procedural.restore()
      procedural.apply(vrm, 1 / 60)
    }
    procedural.restore()

    expect(head.quaternion.angleTo(rest)).toBeLessThan(1e-6)
  })

  it('turns the head toward a gaze target on the model left', () => {
    const { vrm, head } = createRig()
    const procedural = useVRMProceduralMotion({ breathing: 0, sway: 0, speechNod: 0, headFollow: 1 })
    // VRM 1.0 faces +Z, so +X is the model's left.
    const target = new Vector3(1, 1.5, 1)

    for (let i = 0; i < 120; i++) {
      procedural.restore()
      procedural.apply(vrm, 1 / 60, { gazeTarget: target })
    }

    const forward = new Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new Quaternion()))
    expect(forward.x).toBeGreaterThan(0.2)
  })

  it('blends a pose in and fully out again', () => {
    const { vrm, head } = createRig()
    const procedural = useVRMProceduralMotion({ breathing: 0, headFollow: 0, speechNod: 0, sway: 0 })

    procedural.setPose({ head: [20, 0, 0] }, 0.2)
    for (let i = 0; i < 60; i++) {
      procedural.restore()
      procedural.apply(vrm, 1 / 60)
    }
    expect(head.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.3)

    procedural.clearPose(0.2)
    for (let i = 0; i < 120; i++) {
      procedural.restore()
      procedural.apply(vrm, 1 / 60)
    }
    expect(head.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-3)
  })
})

describe('createVRMSpringBoneStepper', () => {
  it('splits long frames into sub-steps and resets after a hitch', () => {
    const manager = { reset: vi.fn(), update: vi.fn() }
    const vrm = { springBoneManager: manager } as unknown as VRM
    const step = createVRMSpringBoneStepper({ maxStep: 1 / 60, maxSubSteps: 4, resetAfter: 0.25 })

    step(vrm, 1 / 20)
    expect(manager.update).toHaveBeenCalledTimes(3)
    expect(manager.update.mock.calls[0][0]).toBeCloseTo(1 / 60)

    step(vrm, 1)
    expect(manager.reset).toHaveBeenCalledTimes(1)
    expect(manager.update).toHaveBeenCalledTimes(3)
  })

  it('turns a camera push into tail velocity, capped per frame', () => {
    const hairRoot = new Object3D()
    hairRoot.name = 'J_Sec_Hair1_01'
    const prevTail = new Vector3()
    const joint = { bone: hairRoot, center: null, _prevTail: prevTail }
    const manager = { joints: new Set([joint]), reset: vi.fn(), update: vi.fn() }
    const vrm = { springBoneManager: manager } as unknown as VRM
    const step = createVRMSpringBoneStepper()

    step(vrm, 1 / 60, new Vector3(0.005, 0, 0))
    // Lowering the previous tail raises the Verlet velocity toward +X.
    expect(prevTail.x).toBeCloseTo(-0.005)

    step(vrm, 1 / 60, new Vector3(1, 0, 0))
    expect(prevTail.x).toBeCloseTo(-0.017)
  })
})

/** A rig with arms hanging down, the way an idle clip leaves them. */
function createArmRig() {
  const scene = new Group()
  function bone(parent: Object3D, x: number, y: number) {
    const node = new Object3D()
    node.position.set(x, y, 0)
    parent.add(node)
    return { node }
  }
  const hips = bone(scene, 0, 0.9)
  const spine = bone(hips.node, 0, 0.2)
  const chest = bone(spine.node, 0, 0.2)
  const neck = bone(chest.node, 0, 0.2)
  const head = bone(neck.node, 0, 0.1)
  const leftShoulder = bone(chest.node, 0.05, 0.15)
  const leftUpperArm = bone(leftShoulder.node, 0.1, 0)
  const leftLowerArm = bone(leftUpperArm.node, 0.25, 0)
  const leftHand = bone(leftLowerArm.node, 0.25, 0)
  const rightShoulder = bone(chest.node, -0.05, 0.15)
  const rightUpperArm = bone(rightShoulder.node, -0.1, 0)
  const rightLowerArm = bone(rightUpperArm.node, -0.25, 0)
  const rightHand = bone(rightLowerArm.node, -0.25, 0)
  const humanoid = new VRMHumanoid({ hips, spine, chest, neck, head, leftShoulder, leftUpperArm, leftLowerArm, leftHand, rightShoulder, rightUpperArm, rightLowerArm, rightHand } as never)
  scene.add(humanoid.normalizedHumanBonesRoot)
  const vrm = new Core({ scene, humanoid, meta: { metaVersion: '1', name: 'Arm rig', authors: ['AIRI'], licenseUrl: 'https://opensource.org/license/mit' } as never })
  const group = new Group()
  group.add(scene)
  group.updateMatrixWorld(true)
  const node = (name: Parameters<typeof humanoid.getNormalizedBoneNode>[0]) => humanoid.getNormalizedBoneNode(name)!
  const leftArm = node('leftUpperArm')
  const rightArm = node('rightUpperArm')
  // Arms down from the T-pose, as in the pose.ts example.
  const hangLeft = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -70 * Math.PI / 180)
  const hangRight = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 70 * Math.PI / 180)
  leftArm.quaternion.copy(hangLeft)
  rightArm.quaternion.copy(hangRight)
  return { vrm, leftArm, rightArm, leftElbow: node('leftLowerArm'), hangLeft, hangRight }
}

/** World direction an upper arm points along: local +X on the left, -X on the right. */
function armDirection(arm: Object3D, side: 1 | -1) {
  arm.updateWorldMatrix(true, false)
  return new Vector3(side, 0, 0).transformDirection(arm.matrixWorld)
}

describe('arm motion', () => {
  it('swings the arms with breathing without accumulating offsets', () => {
    const { vrm, leftArm, hangLeft } = createArmRig()
    const procedural = useVRMProceduralMotion({ breathing: 1.1, sway: 0, headFollow: 0, speechNod: 0, armSwing: 3, armInertia: 0 })
    let largest = 0
    for (let i = 0; i < 400; i++) {
      procedural.restore()
      procedural.apply(vrm, 1 / 60)
      largest = Math.max(largest, leftArm.quaternion.angleTo(hangLeft))
    }
    expect(largest).toBeGreaterThan(0.02)
    expect(largest).toBeLessThan(0.2)
    procedural.restore()
    expect(leftArm.quaternion.angleTo(hangLeft)).toBeLessThan(1e-6)
  })

  it('never bends the elbow backward', () => {
    const { vrm, leftElbow } = createArmRig()
    const procedural = useVRMProceduralMotion({ breathing: 1.1, sway: 0, headFollow: 0, speechNod: 0, armSwing: 6, armInertia: 0 })
    for (let i = 0; i < 600; i++) {
      procedural.restore()
      procedural.apply(vrm, 1 / 60)
      // Left elbow flexes with local -y, so the quaternion y must not turn positive.
      expect(leftElbow.quaternion.y).toBeLessThanOrEqual(1e-9)
    }
  })

  it('lets the arms trail a moving camera, then springs back', () => {
    const { vrm, leftArm, rightArm, hangLeft, hangRight } = createArmRig()
    const procedural = useVRMProceduralMotion({ breathing: 0, sway: 0, headFollow: 0, speechNod: 0, armSwing: 0, armInertia: 9 })
    const step = new Vector3(0.02, 0, 0)
    for (let i = 0; i < 30; i++) {
      procedural.restore()
      procedural.apply(vrm, 1 / 60, { cameraMove: step })
    }
    const leftDir = armDirection(leftArm, 1)
    const rightDir = armDirection(rightArm, -1)
    // The camera orbits toward the model's left, so one hand swings forward and the other back.
    expect(Math.sign(leftDir.z)).not.toBe(Math.sign(rightDir.z))
    expect(Math.abs(leftDir.z)).toBeGreaterThan(0.05)

    for (let i = 0; i < 360; i++) {
      procedural.restore()
      procedural.apply(vrm, 1 / 60)
    }
    expect(leftArm.quaternion.angleTo(hangLeft)).toBeLessThan(0.01)
    expect(rightArm.quaternion.angleTo(hangRight)).toBeLessThan(0.01)
  })
})

describe('stepArmSpring', () => {
  it('overshoots once released and settles', () => {
    const spring = { angle: 10, velocity: 0 }
    let lowest = 10
    for (let i = 0; i < 60; i++) {
      stepArmSpring(spring, 0, 1 / 60)
      lowest = Math.min(lowest, spring.angle)
    }
    expect(lowest).toBeLessThan(-1)
    for (let i = 0; i < 300; i++)
      stepArmSpring(spring, 0, 1 / 60)
    expect(Math.abs(spring.angle)).toBeLessThan(0.05)
  })

  it('stays stable at a low frame rate', () => {
    const spring = { angle: 10, velocity: 0 }
    for (let i = 0; i < 40; i++)
      stepArmSpring(spring, 0, 1 / 8)
    expect(Math.abs(spring.angle)).toBeLessThan(0.5)
  })
})
