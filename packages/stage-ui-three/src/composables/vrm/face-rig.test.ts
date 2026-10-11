import type { VRMCore } from '@pixiv/three-vrm-core'

import { VRMExpressionManager } from '@pixiv/three-vrm-core'
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three'
import { describe, expect, it } from 'vitest'

import { useVRMEmotion } from './emotion'
import { inspectVRMFace, registerARKitExpression, splitMouthShapes } from './face-rig'

/** A face mesh with the given morph targets, as a VRM 0.x export lays them out. */
function createFace(morphs: string[]) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))
  geometry.morphAttributes.position = morphs.map(() => new Float32BufferAttribute([0, 0, 0], 3))
  const mesh = new Mesh(geometry)
  mesh.updateMorphTargets()
  mesh.morphTargetDictionary = Object.fromEntries(morphs.map((name, index) => [name, index]))
  mesh.morphTargetInfluences = morphs.map(() => 0)
  const scene = new Group()
  scene.add(mesh)
  const vrm = { scene, expressionManager: new VRMExpressionManager() } as unknown as VRMCore
  return { vrm, mesh }
}

function influence(mesh: Mesh, name: string) {
  return mesh.morphTargetInfluences![mesh.morphTargetDictionary![name]]
}

describe('inspectVRMFace', () => {
  it('finds ARKit blendshapes the VRM does not declare', () => {
    const { vrm } = createFace(['====arkit====', 'browInnerUp', 'mouthSmileLeft', 'Joy'])
    const inventory = inspectVRMFace(vrm)
    expect(inventory.arkit).toEqual(['browInnerUp', 'mouthSmileLeft'])
  })

  it('matches other spellings of the same blendshape', () => {
    const { vrm } = createFace(['MouthSmile_Left'])
    expect(inspectVRMFace(vrm).arkit).toEqual(['mouthSmileLeft'])
  })
})

describe('registerARKitExpression', () => {
  it('plays ARKit weights through setValue and skips missing shapes', () => {
    const { vrm, mesh } = createFace(['browInnerUp', 'eyeWideLeft'])
    const inventory = inspectVRMFace(vrm)
    const name = registerARKitExpression(vrm, inventory, 'emotion:surprised', { browInnerUp: 0.6, eyeWideLeft: 0.8, jawOpen: 0.35 })

    vrm.expressionManager!.setValue(name!, 0.5)
    vrm.expressionManager!.update()

    expect(influence(mesh, 'browInnerUp')).toBeCloseTo(0.3)
    expect(influence(mesh, 'eyeWideLeft')).toBeCloseTo(0.4)
  })

  it('registers nothing when the model has none of the shapes', () => {
    const { vrm } = createFace(['Joy'])
    expect(registerARKitExpression(vrm, inspectVRMFace(vrm), 'emotion:x', { jawOpen: 1 })).toBeUndefined()
  })
})

describe('splitMouthShapes', () => {
  it('keeps smiles with the face and moves jaw shapes to the mouth group', () => {
    expect(splitMouthShapes({ mouthSmileLeft: 0.6, jawOpen: 0.3, browInnerUp: 0.2 })).toEqual({
      face: { mouthSmileLeft: 0.6, browInnerUp: 0.2 },
      mouth: { jawOpen: 0.3 },
    })
  })
})

describe('useVRMEmotion on an ARKit face', () => {
  const shapes = ['browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'eyeWideLeft', 'eyeWideRight', 'jawOpen', 'mouthFunnel', 'mouthSmileLeft', 'mouthSmileRight', 'cheekSquintLeft', 'cheekSquintRight', 'eyeSquintLeft', 'eyeSquintRight']

  function run(emotion: ReturnType<typeof useVRMEmotion>, vrm: VRMCore, seconds: number, options?: { skipVisemes?: boolean }) {
    for (let t = 0; t < seconds; t += 1 / 60) {
      emotion.update(1 / 60, options)
      vrm.expressionManager!.update()
    }
  }

  it('shows surprise with wide eyes on a model that has no surprised expression', () => {
    const { vrm, mesh } = createFace(shapes)
    const emotion = useVRMEmotion(vrm)
    emotion.play('surprised', 1)
    run(emotion, vrm, 0.5)
    expect(influence(mesh, 'eyeWideLeft')).toBeGreaterThan(0.7)
    expect(influence(mesh, 'jawOpen')).toBeGreaterThan(0.3)
  })

  it('reaches the new face in about 200 ms', () => {
    const { vrm, mesh } = createFace(shapes)
    const emotion = useVRMEmotion(vrm)
    emotion.play('surprised', 1)
    run(emotion, vrm, 0.1)
    const halfway = influence(mesh, 'eyeWideLeft')
    run(emotion, vrm, 0.25)
    expect(halfway).toBeGreaterThan(0.1)
    expect(halfway).toBeLessThan(0.7)
    expect(influence(mesh, 'eyeWideLeft')).toBeGreaterThan(0.72)
  })

  it('turns the jaw down while speaking, but keeps the smile', () => {
    const { vrm, mesh } = createFace(shapes)
    const emotion = useVRMEmotion(vrm)
    emotion.play('laugh', 1)
    run(emotion, vrm, 0.6)
    const smile = influence(mesh, 'mouthSmileLeft')
    run(emotion, vrm, 0.6, { skipVisemes: true })
    expect(influence(mesh, 'jawOpen')).toBeLessThan(0.15)
    expect(influence(mesh, 'mouthSmileLeft')).toBeCloseTo(smile, 1)
  })

  it('blinks less far while the smile squints', () => {
    const { vrm } = createFace(shapes)
    const emotion = useVRMEmotion(vrm)
    emotion.play('happy', 1)
    run(emotion, vrm, 0.5)
    expect(emotion.blinkState.amplitude).toBeLessThan(1)
    expect(emotion.blinkState.suppress).toBe(false)
  })
})

describe('laugh motion', () => {
  it('moves the head smoothly, without frame-to-frame jolts', () => {
    const { vrm } = createFace([])
    const emotion = useVRMEmotion(vrm)
    emotion.play('laugh', 1)
    let previous = 0
    let previousStep = 0
    let largestJolt = 0
    for (let frame = 0; frame < 180; frame++) {
      emotion.update(1 / 60)
      const head = emotion.body.head?.[0] ?? 0
      const step = head - previous
      // A jolt is a sudden change of speed, which a fast shake does every few frames.
      if (frame > 1)
        largestJolt = Math.max(largestJolt, Math.abs(step - previousStep))
      previousStep = step
      previous = head
    }
    // The old 5 Hz head shake changed speed by about 0.7 degrees per frame.
    expect(largestJolt).toBeLessThan(0.2)
  })

  it('hands the head over from the last emotion instead of snapping', () => {
    const { vrm } = createFace([])
    const emotion = useVRMEmotion(vrm)
    emotion.play('sad', 1)
    for (let t = 0; t < 2; t += 1 / 60)
      emotion.update(1 / 60)
    const before = emotion.body.head?.[0] ?? 0
    emotion.play('surprised', 1)
    emotion.update(1 / 60)
    expect(Math.abs((emotion.body.head?.[0] ?? 0) - before)).toBeLessThan(1)
  })
})
