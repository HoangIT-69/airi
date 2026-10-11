import type { Bone, Skeleton } from '@esotericsoftware/spine-webgl'

/** World-space point, y up, in skeleton units. */
export interface SpinePoint {
  x: number
  y: number
}

/**
 * Bones a rig exposes for look-at and soft-body effects.
 *
 * NIKKE-style rigs drive the face through a `head_con` control bone (transform
 * constraints move eyes, nose, mouth and hair with it) and the torso through
 * `chest_con`. Rigs without these bones simply get no look-at.
 */
interface SpineControlBones {
  look?: Bone
  body?: Bone
  head?: Bone
  bust: Bone[]
}

const LOOK_BONE_NAMES = ['head_con', 'face_con', 'look_con', 'look']
const BODY_BONE_NAMES = ['chest_con', 'body_con']
const HEAD_BONE_NAMES = ['head', 'Head', 'face']
const BUST_BONE_PATTERN = /breast|bust|boob|oppai/i

function findFirst(skeleton: Skeleton, names: string[]) {
  for (const name of names) {
    const bone = skeleton.findBone(name)
    if (bone)
      return bone
  }
  return undefined
}

function findBustBones(skeleton: Skeleton) {
  const candidates = skeleton.bones.filter(bone => BUST_BONE_PATTERN.test(bone.data.name))
  // Push only the innermost bust bones (one per side). Moving a shared parent
  // slides the whole chest mesh off the shirt.
  return candidates.filter(bone => !bone.children.some(child => candidates.includes(child)))
}

/** Offsets a bone by a world-space delta after the animation has posed it. */
function nudgeBone(bone: Bone, dx: number, dy: number) {
  if (!bone.parent || (dx === 0 && dy === 0))
    return
  const target = { x: bone.worldX + dx, y: bone.worldY + dy }
  bone.parent.worldToLocal(target as Parameters<Bone['worldToLocal']>[0])
  bone.x = target.x
  bone.y = target.y
}

/**
 * Procedural look-at and bust bounce layered on top of the Spine animation.
 *
 * Use when:
 * - A Spine scene wants the face to follow the cursor and the chest to bounce
 *   when poked, without the rig shipping 4.2 physics.
 *
 * Expects:
 * - `apply()` is called after `AnimationState.apply()` and one
 *   `updateWorldTransform()`, then the caller updates world transforms again.
 */
export function useSpineInteraction(skeleton: Skeleton) {
  const bones: SpineControlBones = {
    look: findFirst(skeleton, LOOK_BONE_NAMES),
    body: findFirst(skeleton, BODY_BONE_NAMES),
    head: findFirst(skeleton, HEAD_BONE_NAMES),
    bust: findBustBones(skeleton),
  }

  // Look target relative to the head, smoothed so the face eases toward the cursor.
  let lookTarget: SpinePoint | undefined
  const look = { x: 0, y: 0 }

  // Damped spring for the bust, offset in skeleton units.
  const bust = { x: 0, y: 0, vx: 0, vy: 0 }
  // Scaled by `apply()` from the rig's height, so small and large rigs bounce alike.
  let bustImpulse = 0

  function headPosition(): SpinePoint | undefined {
    const bone = bones.head ?? bones.look
    return bone ? { x: bone.worldX, y: bone.worldY } : undefined
  }

  function bustPosition(): SpinePoint | undefined {
    if (bones.bust.length === 0)
      return undefined
    const x = bones.bust.reduce((sum, bone) => sum + bone.worldX, 0) / bones.bust.length
    const y = bones.bust.reduce((sum, bone) => sum + bone.worldY, 0) / bones.bust.length
    return { x, y }
  }

  /** Points the face at a world position, or back at the camera when undefined. */
  function setLookTarget(point: SpinePoint | undefined) {
    lookTarget = point
  }

  /** Kicks the bust spring; `strength` 1 is a firm poke. */
  function pokeBust(strength = 1) {
    bust.vy -= bustImpulse * strength
    bust.vx += (Math.random() - 0.5) * bustImpulse * 0.3 * strength
  }

  /** Which body region sits under a world point, for click reactions. */
  function hitTest(point: SpinePoint, radius: number): 'bust' | 'head' | undefined {
    const chest = bustPosition()
    if (chest && Math.hypot(point.x - chest.x, point.y - chest.y) < radius * 1.1)
      return 'bust'
    const head = headPosition()
    if (head && Math.hypot(point.x - head.x, point.y - head.y) < radius * 1.4)
      return 'head'
    return undefined
  }

  /**
   * @param delta Seconds since the last frame.
   * @param size Rig height in skeleton units; look and bounce distances scale with it.
   */
  function apply(delta: number, size: number) {
    // The rig's own constraints move eyes, nose and hair by a fraction of the control
    // bone, which keeps them on the face; pushing those bones directly would not.
    const lookRange = size * 0.035
    bustImpulse = size * 0.15
    const dt = Math.min(delta, 1 / 20)

    if (bones.look) {
      let tx = 0
      let ty = 0
      const head = headPosition()
      if (lookTarget && head) {
        const dx = lookTarget.x - head.x
        const dy = lookTarget.y - head.y
        const distance = Math.hypot(dx, dy)
        // Ease in with distance so a cursor right on the face does not snap the head.
        const reach = Math.min(1, distance / (lookRange * 6))
        if (distance > 1e-3) {
          tx = (dx / distance) * lookRange * reach
          ty = (dy / distance) * lookRange * reach
        }
      }
      const follow = 1 - Math.exp(-dt * 6)
      look.x += (tx - look.x) * follow
      look.y += (ty - look.y) * follow
      nudgeBone(bones.look, look.x, look.y)
      if (bones.body)
        nudgeBone(bones.body, look.x * 0.25, look.y * 0.25)
    }

    if (bones.bust.length > 0) {
      const stiffness = 260
      const damping = 7
      bust.vx += (-stiffness * bust.x - damping * bust.vx) * dt
      bust.vy += (-stiffness * bust.y - damping * bust.vy) * dt
      bust.x += bust.vx * dt
      bust.y += bust.vy * dt
      for (const bone of bones.bust)
        nudgeBone(bone, bust.x, bust.y)
    }
  }

  return {
    hasLook: !!bones.look,
    hasBust: bones.bust.length > 0,
    setLookTarget,
    pokeBust,
    hitTest,
    apply,
  }
}

export type SpineInteraction = ReturnType<typeof useSpineInteraction>
