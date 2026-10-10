import type { VRM } from '@pixiv/three-vrm'

import { VRMCore as Core, VRMHumanoid } from '@pixiv/three-vrm-core'
import { Group, Object3D, Quaternion, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { useVRMProceduralMotion } from './procedural'
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
})
