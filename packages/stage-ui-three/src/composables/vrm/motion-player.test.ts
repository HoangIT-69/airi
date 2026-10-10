import { VRMCore as Core, VRMHumanoid } from '@pixiv/three-vrm-core'
import { AnimationClip, AnimationMixer, Group, Object3D, QuaternionKeyframeTrack } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createVRMMotionPlayer } from './motion-player'

const motionClips = new Map<string, AnimationClip>()

vi.mock('./animation', () => ({
  loadVRMAnimation: async (url: string) => url,
  clipFromVRMAnimation: async (_vrm: unknown, url: string) => motionClips.get(url)?.clone(),
}))

function createRig() {
  const scene = new Group()
  function bone(parent: Object3D, name: string, y: number) {
    const node = new Object3D()
    node.name = name
    node.position.set(0, y, 0)
    parent.add(node)
    return { node }
  }
  const hips = bone(scene, 'hips', 0.9)
  const spine = bone(hips.node, 'spine', 0.2)
  const head = bone(spine.node, 'head', 0.4)
  const leftUpperArm = bone(spine.node, 'leftUpperArm', 0.3)
  const humanoid = new VRMHumanoid({ hips, spine, head, leftUpperArm } as never)
  scene.add(humanoid.normalizedHumanBonesRoot)
  const vrm = new Core({ scene, humanoid, meta: { metaVersion: '1', name: 'Test rig', authors: ['AIRI'], licenseUrl: 'https://opensource.org/license/mit' } })
  const node = (name: 'head' | 'leftUpperArm') => humanoid.getNormalizedBoneNode(name)!
  return { vrm, scene, head: node('head'), arm: node('leftUpperArm') }
}

function rotationTrack(target: Object3D, x: number, duration: number) {
  const s = Math.sin(x / 2)
  const c = Math.cos(x / 2)
  return new QuaternionKeyframeTrack(`${target.name}.quaternion`, [0, duration], [s, 0, 0, c, s, 0, 0, c])
}

describe('createVRMMotionPlayer', () => {
  it('keeps bones the motion leaves out on the idle animation, then returns to idle', async () => {
    const { vrm, scene, head, arm } = createRig()
    const mixer = new AnimationMixer(scene)
    const idleClip = new AnimationClip('idle', 2, [rotationTrack(head, 0, 2), rotationTrack(arm, -1.2, 2)])
    const idle = mixer.clipAction(idleClip)
    idle.play()
    motionClips.set('nod.vrma', new AnimationClip('nod', 0.5, [rotationTrack(head, 0.4, 0.5)]))

    const player = createVRMMotionPlayer(vrm, mixer, idle)
    const done = vi.fn()
    void player.play('nod.vrma', { fadeIn: 0.1, fadeOut: 0.1 }).then(done)
    await vi.waitFor(() => expect(player.isPlaying).toBe(true))

    for (let i = 0; i < 20; i++)
      mixer.update(1 / 60)
    // Head follows the motion; the arm stays on idle instead of drifting to the bind pose.
    expect(head.quaternion.x).toBeCloseTo(Math.sin(0.2), 2)
    expect(arm.quaternion.x).toBeCloseTo(Math.sin(-0.6), 2)

    for (let i = 0; i < 60; i++)
      mixer.update(1 / 60)
    expect(player.isPlaying).toBe(false)
    await vi.waitFor(() => expect(done).toHaveBeenCalled())
    expect(head.quaternion.x).toBeCloseTo(0, 2)

    player.dispose()
  })

  it('rejects when the file holds no animation', async () => {
    const { vrm, scene } = createRig()
    const mixer = new AnimationMixer(scene)
    const idle = mixer.clipAction(new AnimationClip('idle', 1, []))
    const player = createVRMMotionPlayer(vrm, mixer, idle)

    await expect(player.play('missing.vrma')).rejects.toThrow('No VRM animation')
  })
})
