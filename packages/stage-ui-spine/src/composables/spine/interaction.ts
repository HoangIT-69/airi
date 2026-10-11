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
  eye?: Bone
  mouth?: Bone
  bust: Bone[]
  /** Swinging hair bones per side (tails held or tied at the head), shallowest first. */
  hair: Record<SpineSide, Bone[]>
}

/** Left or right of the character, as she sees it. */
export type SpineSide = 'l' | 'r'

/** Body regions a pointer can touch. */
export type SpineTouchRegion = 'bust' | 'head' | 'cheek' | 'hair'

const LOOK_BONE_NAMES = ['head_con', 'face_con', 'look_con', 'look']
const BODY_BONE_NAMES = ['chest_con', 'body_con']
const HEAD_BONE_NAMES = ['head', 'Head', 'face']
const BUST_BONE_PATTERN = /breast|bust|boob|oppai/i
const HAIR_TAIL_PATTERN = /ponytail|twintail|tail_hair|hair_tail/i

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

function findHairBones(skeleton: Skeleton): Record<SpineSide, Bone[]> {
  // Anchors such as `ponytail_l_hand` stay put; everything hanging below them swings.
  const tails = skeleton.bones.filter(bone => HAIR_TAIL_PATTERN.test(bone.data.name) && !/hand|root|base/i.test(bone.data.name))
  const side = (bone: Bone): SpineSide => /(?:^|_)r(?:_|$)|right/i.test(bone.data.name) ? 'r' : 'l'
  return {
    l: tails.filter(bone => side(bone) === 'l'),
    r: tails.filter(bone => side(bone) === 'r'),
  }
}

/** Number of swinging ancestors, so rotation spreads evenly down a chain. */
function chainDepth(bone: Bone, members: Set<Bone>) {
  let depth = 0
  for (let node = bone.parent; node && members.has(node as Bone); node = node.parent)
    depth++
  return depth
}

/** Shortest distance from a point to any bone of a chain, each bone a segment from its parent. */
function distanceToChain(point: SpinePoint, bones: Bone[]) {
  let best = Number.POSITIVE_INFINITY
  for (const bone of bones) {
    const ax = bone.parent?.worldX ?? bone.worldX
    const ay = bone.parent?.worldY ?? bone.worldY
    const abx = bone.worldX - ax
    const aby = bone.worldY - ay
    const lengthSq = abx * abx + aby * aby
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((point.x - ax) * abx + (point.y - ay) * aby) / lengthSq)) : 0
    best = Math.min(best, Math.hypot(point.x - (ax + abx * t), point.y - (ay + aby * t)))
  }
  return best
}

/** Local transforms as the animation left them, restored before the next frame's apply. */
type TouchedBones = Map<Bone, { x: number, y: number, rotation: number }>

function remember(touched: TouchedBones, bone: Bone) {
  if (!touched.has(bone))
    touched.set(bone, { x: bone.x, y: bone.y, rotation: bone.rotation })
}

/** Offsets a bone by a world-space delta after the animation has posed it. */
function nudgeBone(touched: TouchedBones, bone: Bone, dx: number, dy: number) {
  if (!bone.parent || (dx === 0 && dy === 0))
    return
  remember(touched, bone)
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
 * - `reset()` runs before `AnimationState.apply()`; `apply()` runs after it and one
 *   `updateWorldTransform()`, then the caller updates world transforms again.
 */
export function useSpineInteraction(skeleton: Skeleton) {
  const bones: SpineControlBones = {
    look: findFirst(skeleton, LOOK_BONE_NAMES),
    body: findFirst(skeleton, BODY_BONE_NAMES),
    head: findFirst(skeleton, HEAD_BONE_NAMES),
    eye: findFirst(skeleton, ['eye', 'eyes']),
    mouth: findFirst(skeleton, ['mouth']),
    bust: findBustBones(skeleton),
    hair: findHairBones(skeleton),
  }

  // Bones the last apply() changed. A bone no animation keys keeps whatever it was
  // given, so offsets would pile up frame after frame without this.
  const touched: TouchedBones = new Map()

  /** Puts back the local transforms apply() changed; call before AnimationState.apply(). */
  function reset() {
    for (const [bone, local] of touched) {
      bone.x = local.x
      bone.y = local.y
      bone.rotation = local.rotation
    }
    touched.clear()
  }

  // Rotation per bone is the side's swing angle divided by the deepest chain, so the
  // tips bend furthest and the roots barely move.
  const hairDepth = new Map<Bone, number>()
  const hairMaxDepth: Record<SpineSide, number> = { l: 1, r: 1 }
  for (const side of ['l', 'r'] as const) {
    const members = new Set(bones.hair[side])
    for (const bone of bones.hair[side]) {
      const depth = chainDepth(bone, members)
      hairDepth.set(bone, depth)
      hairMaxDepth[side] = Math.max(hairMaxDepth[side], depth + 1)
    }
  }
  // Swing angle in degrees per side: follows the drag while held, then sways back.
  const swing: Record<SpineSide, { angle: number, velocity: number, target?: number }> = {
    l: { angle: 0, velocity: 0 },
    r: { angle: 0, velocity: 0 },
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

  /**
   * Which body region sits under a world point.
   *
   * @param size Rig height in skeleton units; the regions scale with it.
   */
  function hitTest(point: SpinePoint, size: number): { region: SpineTouchRegion, side?: SpineSide } | undefined {
    const eye = bones.eye
    const mouth = bones.mouth
    if (eye && mouth) {
      // Cheeks sit beside the nose, between eye and mouth height.
      const cheek = { x: (eye.worldX + mouth.worldX) / 2, y: (eye.worldY + mouth.worldY) / 2 }
      if (Math.hypot(point.x - cheek.x, point.y - cheek.y) < size * 0.035)
        return { region: 'cheek' }
      // The crown is above the eyes along the face's own up direction.
      const upX = eye.worldX - mouth.worldX
      const upY = eye.worldY - mouth.worldY
      const length = Math.hypot(upX, upY) || 1
      const crown = { x: eye.worldX + upX / length * size * 0.06, y: eye.worldY + upY / length * size * 0.06 }
      if (Math.hypot(point.x - crown.x, point.y - crown.y) < size * 0.06)
        return { region: 'head' }
    }
    const chest = bustPosition()
    if (chest && Math.hypot(point.x - chest.x, point.y - chest.y) < size * 0.075)
      return { region: 'bust' }
    for (const side of ['l', 'r'] as const) {
      if (bones.hair[side].length > 0 && distanceToChain(point, bones.hair[side]) < size * 0.03)
        return { region: 'hair', side }
    }
    const head = headPosition()
    if (!eye && head && Math.hypot(point.x - head.x, point.y - head.y) < size * 0.1)
      return { region: 'head' }
    return undefined
  }

  /**
   * Bends one side's hair toward a horizontal drag.
   *
   * @param offset Drag distance in skeleton units, positive to the right; undefined releases it.
   */
  function dragHair(side: SpineSide, offset: number | undefined, size: number) {
    // Hanging hair rotated counter-clockwise swings its tip to the right.
    swing[side].target = offset === undefined
      ? undefined
      : Math.max(-40, Math.min(40, offset / size * 160))
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
      nudgeBone(touched, bones.look, look.x, look.y)
      if (bones.body)
        nudgeBone(touched, bones.body, look.x * 0.25, look.y * 0.25)
    }

    for (const side of ['l', 'r'] as const) {
      const state = swing[side]
      const target = state.target ?? 0
      // Held: stiff and damped so the hair tracks the cursor. Released: soft so it sways.
      const stiffness = state.target === undefined ? 70 : 220
      const damping = state.target === undefined ? 3.5 : 26
      state.velocity += (stiffness * (target - state.angle) - damping * state.velocity) * dt
      state.angle += state.velocity * dt
      if (Math.abs(state.angle) < 0.01 && Math.abs(state.velocity) < 0.01)
        continue
      const perBone = state.angle / hairMaxDepth[side]
      for (const bone of bones.hair[side]) {
        remember(touched, bone)
        bone.rotation += perBone * (0.5 + (hairDepth.get(bone) ?? 0) / hairMaxDepth[side])
      }
    }

    if (bones.bust.length > 0) {
      // Soft enough that a poke swings visibly a few times before settling.
      const stiffness = 160
      const damping = 5
      bust.vx += (-stiffness * bust.x - damping * bust.vx) * dt
      bust.vy += (-stiffness * bust.y - damping * bust.vy) * dt
      bust.x += bust.vx * dt
      bust.y += bust.vy * dt
      for (const bone of bones.bust)
        nudgeBone(touched, bone, bust.x, bust.y)
    }
  }

  return {
    hasLook: !!bones.look,
    hasBust: bones.bust.length > 0,
    hasHair: bones.hair.l.length + bones.hair.r.length > 0,
    reset,
    setLookTarget,
    pokeBust,
    dragHair,
    hitTest,
    apply,
  }
}

export type SpineInteraction = ReturnType<typeof useSpineInteraction>
