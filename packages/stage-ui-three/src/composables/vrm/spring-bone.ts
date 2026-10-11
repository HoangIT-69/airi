import type { VRM, VRMSpringBoneJoint, VRMSpringBoneJointSettings } from '@pixiv/three-vrm'
import type { DragVec3 } from '@proj-airi/stage-shared'
import type { Object3D } from 'three'

import { VRMSpringBoneJoint as SpringBoneJoint } from '@pixiv/three-vrm'
import { accumulateClampedDrag } from '@proj-airi/stage-shared'
import { MathUtils, Matrix4, Vector3 } from 'three'

/** Multipliers on the model's own spring bone settings. 1 keeps the authored value. */
export interface VRMSpringBoneGroupTuning {
  stiffness?: number
  drag?: number
  /** Added to the authored gravity power, because many models author 0. */
  gravityAdd?: number
}

export interface VRMSpringBoneTuning {
  all?: VRMSpringBoneGroupTuning
  hair?: VRMSpringBoneGroupTuning
  bust?: VRMSpringBoneGroupTuning
  skirt?: VRMSpringBoneGroupTuning
}

/**
 * Softer than most VRoid exports, which author hair stiffness around 0.85 with no gravity,
 * so hair barely moves during idle.
 */
export const VRM_SPRING_BONE_NATURAL: VRMSpringBoneTuning = {
  hair: { stiffness: 0.7, drag: 0.9, gravityAdd: 0.05 },
  bust: { stiffness: 0.6, drag: 1.2 },
  skirt: { stiffness: 0.85, gravityAdd: 0.05 },
}

/** Physics strength per group: 0 is stiff, 1 the natural default, 2 very loose. */
export interface VRMPhysicsStrength {
  bust: number
  hair: number
}

/** Interpolates 0 → 1 → 2 through three anchor values. */
function anchored(strength: number, stiff: number, natural: number, loose: number) {
  const s = MathUtils.clamp(strength, 0, 2)
  return s <= 1 ? MathUtils.lerp(stiff, natural, s) : MathUtils.lerp(natural, loose, s - 1)
}

/** Builds spring bone tuning from two strength sliders. Strength 1 equals {@link VRM_SPRING_BONE_NATURAL}. */
export function createVRMSpringBoneTuning(strength: VRMPhysicsStrength): VRMSpringBoneTuning {
  return {
    hair: {
      stiffness: anchored(strength.hair, 1.6, 0.7, 0.4),
      drag: anchored(strength.hair, 2, 0.9, 0.7),
      gravityAdd: anchored(strength.hair, 0, 0.05, 0.1),
    },
    bust: {
      stiffness: anchored(strength.bust, 2.5, 0.6, 0.25),
      drag: anchored(strength.bust, 4, 1.2, 0.5),
      gravityAdd: anchored(strength.bust, 0, 0, 0.03),
    },
    skirt: VRM_SPRING_BONE_NATURAL.skirt,
  }
}

const HAIR = /hair|kami|髪/i
const BUST = /bust|breast|oppai|胸/i
const SKIRT = /skirt|スカート/i

const authored = new WeakMap<VRMSpringBoneJoint, Pick<VRMSpringBoneJointSettings, 'dragForce' | 'gravityPower' | 'stiffness'>>()

function groupOf(bone: Object3D): keyof VRMSpringBoneTuning | undefined {
  // The joint bone itself is often a numbered segment, so also check its ancestors.
  for (let node: Object3D | null = bone; node; node = node.parent) {
    if (HAIR.test(node.name))
      return 'hair'
    if (BUST.test(node.name))
      return 'bust'
    if (SKIRT.test(node.name))
      return 'skirt'
  }
  return undefined
}

/**
 * Applies tuning on top of the authored spring bone settings. Calling it again replaces the
 * previous tuning instead of stacking, so it is safe on cached model instances.
 */
export function applyVRMSpringBoneTuning(vrm: VRM, tuning: VRMSpringBoneTuning) {
  const manager = vrm.springBoneManager
  if (!manager)
    return
  for (const joint of manager.joints) {
    let original = authored.get(joint)
    if (!original) {
      original = {
        dragForce: joint.settings.dragForce,
        gravityPower: joint.settings.gravityPower,
        stiffness: joint.settings.stiffness,
      }
      authored.set(joint, original)
    }
    const group = groupOf(joint.bone)
    const all = tuning.all ?? {}
    const specific = (group && tuning[group]) || {}
    joint.settings.stiffness = original.stiffness * (all.stiffness ?? 1) * (specific.stiffness ?? 1)
    joint.settings.dragForce = Math.min(1, original.dragForce * (all.drag ?? 1) * (specific.drag ?? 1))
    joint.settings.gravityPower = Math.max(0, original.gravityPower + (all.gravityAdd ?? 0) + (specific.gravityAdd ?? 0))
  }
}

/**
 * Adds spring joints to bust bones that the model names but does not simulate.
 * VRoid exports usually simulate them already; some converted models do not.
 *
 * Returns the number of joints added.
 */
export function ensureVRMBustSpringBones(vrm: VRM, settings: Partial<VRMSpringBoneJointSettings> = {}) {
  const manager = vrm.springBoneManager
  if (!manager)
    return 0
  const simulated = new Set<Object3D>()
  for (const joint of manager.joints)
    simulated.add(joint.bone)

  const roots: Object3D[] = []
  vrm.scene.traverse((node) => {
    if (!BUST.test(node.name) || (node as { isBone?: boolean }).isBone !== true)
      return
    if (node.parent && BUST.test(node.parent.name))
      return
    roots.push(node)
  })

  let added = 0
  for (const root of roots) {
    let bone: Object3D | undefined = root
    while (bone) {
      const child: Object3D | undefined = bone.children.find(c => BUST.test(c.name))
      if (!simulated.has(bone)) {
        const joint = new SpringBoneJoint(bone, child ?? null, {
          dragForce: 0.1,
          gravityPower: 0,
          hitRadius: 0.02,
          stiffness: 0.45,
          ...settings,
        })
        manager.addJoint(joint)
        joint.setInitState()
        added++
      }
      bone = child
    }
  }
  return added
}

interface SpringBoneJointInternals {
  _prevTail: Vector3
  center: Object3D | null
}

const GROUP_INERTIA: Record<keyof VRMSpringBoneTuning, number> = { all: 0.5, hair: 1, bust: 0.6, skirt: 0.8 }
const MAX_PUSH_PER_FRAME = 0.012
const scratchPush = new Vector3()
const scratchInverse = new Matrix4()

/**
 * Pushes spring tails as if the body moved by `push` (world units) this frame.
 *
 * Springs only react to the body moving in the world. A desktop character stays put while
 * the camera orbits, so the stage feeds the camera's motion here to make hair and chest sway.
 * Lowering `_prevTail` raises the Verlet velocity the joint integrates on its next update.
 */
function pushSpringTails(vrm: VRM, push: Vector3) {
  const manager = vrm.springBoneManager
  if (!manager || push.lengthSq() < 1e-10)
    return
  for (const joint of manager.joints) {
    const internals = joint as unknown as SpringBoneJointInternals
    const group = groupOf(joint.bone) ?? 'all'
    scratchPush.copy(push).multiplyScalar(GROUP_INERTIA[group]).clampLength(0, MAX_PUSH_PER_FRAME)
    // Tails live in the center's space when a center is set.
    if (internals.center) {
      const length = scratchPush.length()
      scratchPush.transformDirection(scratchInverse.copy(internals.center.matrixWorld).invert()).multiplyScalar(length)
    }
    internals._prevTail?.sub(scratchPush)
  }
}

/** World positions of the spring joints in one group, for picking them on screen. */
export function listVRMSpringJointPositions(vrm: VRM, group: keyof VRMSpringBoneTuning): Vector3[] {
  const manager = vrm.springBoneManager
  if (!manager)
    return []
  const positions: Vector3[] = []
  for (const joint of manager.joints) {
    if (groupOf(joint.bone) === group)
      positions.push(joint.bone.getWorldPosition(new Vector3()))
  }
  return positions
}

/**
 * Drags the spring joints of a group near `near` by `push` (world units this frame),
 * fading out with distance, so the hair under the cursor follows it and sways after.
 */
export function dragVRMSpringGroup(vrm: VRM, group: keyof VRMSpringBoneTuning, near: Vector3, push: Vector3, radius = 0.3) {
  const manager = vrm.springBoneManager
  if (!manager || push.lengthSq() < 1e-12)
    return
  const position = new Vector3()
  for (const joint of manager.joints) {
    if (groupOf(joint.bone) !== group)
      continue
    const falloff = 1 - joint.bone.getWorldPosition(position).distanceTo(near) / radius
    if (falloff <= 0)
      continue
    const internals = joint as unknown as SpringBoneJointInternals
    scratchPush.copy(push).multiplyScalar(falloff).clampLength(0, 0.05)
    if (internals.center) {
      const length = scratchPush.length()
      scratchPush.transformDirection(scratchInverse.copy(internals.center.matrixWorld).invert()).multiplyScalar(length)
    }
    internals._prevTail?.sub(scratchPush)
  }
}

/**
 * Pushes only the joints on the breast bones themselves. The bust group also holds
 * clothing hanging below them (zips, shirt hems), which would flap up instead.
 */
function pushVRMBustJoints(vrm: VRM, push: Vector3, sideways = 0) {
  const manager = vrm.springBoneManager
  if (!manager)
    return
  for (const joint of manager.joints) {
    if (!BUST.test(joint.bone.name))
      continue
    const internals = joint as unknown as SpringBoneJointInternals
    // Sideways pushes mirror between the two breasts, so they circle in opposite directions.
    const side = /right|r$|[_.\s]r(?:[_.\s]|$)/i.test(joint.bone.name) ? -1 : 1
    scratchPush.copy(push)
    scratchPush.x += sideways * side
    if (internals.center) {
      const length = scratchPush.length()
      scratchPush.transformDirection(scratchInverse.copy(internals.center.matrixWorld).invert()).multiplyScalar(length)
    }
    internals._prevTail?.sub(scratchPush)
  }
}

/**
 * Plays a chest poke on the bust springs: a short downward push like a fingertip,
 * then a springy rebound. While it rings, the breast joints get less drag and a bit
 * more stiffness so they bounce a few times instead of sagging back once; both ease
 * back to the model's own settings as the bounce dies down.
 * Call `step()` every frame before the spring bones update.
 */
export function createVRMBustPoke(options: { amplitude?: number, pushSeconds?: number, ringSeconds?: number } = {}) {
  /** Largest per-frame push, in world units at 60 fps. */
  const amplitude = options.amplitude ?? 0.0045
  const pushSeconds = options.pushSeconds ?? 0.16
  const ringSeconds = options.ringSeconds ?? 2.2
  let time = -1
  let strength = 1
  const push = new Vector3()
  /** The joints' own settings, put back when the bounce ends. */
  let original: Map<VRMSpringBoneJoint, { dragForce: number, stiffness: number }> | undefined

  function restore() {
    for (const [joint, settings] of original ?? []) {
      joint.settings.dragForce = settings.dragForce
      joint.settings.stiffness = settings.stiffness
    }
    original = undefined
  }

  return {
    start(value = 1) {
      time = 0
      strength = value
    },
    /** Stops a bounce that is still ringing and puts the joint settings back. */
    cancel() {
      time = -1
      restore()
    },
    step(vrm: VRM | undefined, delta: number) {
      if (!vrm || time < 0)
        return
      const manager = vrm.springBoneManager
      if (!manager)
        return
      if (!original) {
        original = new Map()
        for (const joint of manager.joints) {
          if (BUST.test(joint.bone.name))
            original.set(joint, { dragForce: joint.settings.dragForce, stiffness: joint.settings.stiffness })
        }
      }
      time += delta
      if (time >= ringSeconds) {
        time = -1
        restore()
        return
      }

      // Springier while ringing, easing back over the last part of the bounce.
      const springiness = 1 - Math.max(0, (time - ringSeconds * 0.4) / (ringSeconds * 0.6))
      for (const [joint, settings] of original) {
        joint.settings.dragForce = settings.dragForce * (1 - 0.85 * springiness)
        joint.settings.stiffness = settings.stiffness * (1 + 0.5 * springiness)
      }

      // A press down, then a sideways nudge a quarter beat later. With the spring
      // swinging both ways, the two pushes out of phase trace a circle, not a bob.
      const pulse = (start: number) => {
        const t = (time - start) / pushSeconds
        return t > 0 && t < 1 ? Math.sin(t * Math.PI) * amplitude * strength * 60 * delta : 0
      }
      const down = pulse(0)
      const sideways = pulse(pushSeconds * 0.5) * 0.45
      if (down !== 0 || sideways !== 0) {
        push.set(0, -down, 0)
        pushVRMBustJoints(vrm, push, sideways)
      }
    },
  }
}

/** Model height that the drag distances below are authored against. */
const DRAG_REFERENCE_HEIGHT = 1.6
const DRAG_SCALE_MIN = 0.65
const DRAG_SCALE_MAX = 1.5
/** How far a breast may leave its rest pose, in metres at the reference height. */
const BUST_MAX_DISTANCE = 0.045
/** How far a skirt may leave its rest pose, in metres at the reference height. */
const SKIRT_MAX_DISTANCE = 0.65
const NAMED_MAX_DISTANCE = 0.04
const BUST_AXIS_SCALE: DragVec3 = { x: 1, y: 1, z: 0.35 }
const SKIRT_AXIS_SCALE: DragVec3 = { x: 1, y: 1, z: 0.7 }
const NAMED_AXIS_SCALE: DragVec3 = { x: 0.7, y: 0.5, z: 0.25 }
const BUST_FALLOFF_RADIUS = 0.12
const SKIRT_FALLOFF_RADIUS = 0.7
const NAMED_FALLOFF_RADIUS = 0.2
/** Pointer speed, in metres per second, that releases a full chest bounce. */
const BUST_RELEASE_REFERENCE_SPEED = 0.4
/** How long a released breast drag keeps a softer drag force, in seconds. */
const CLOTH_HOLD_RING_SECONDS = 2.2
/** Share of drag force removed at the start of a breast ring. Less drag rings longer. */
const CLOTH_HOLD_DRAG_DIP = 0.9
/** Extra stiffness while a released breast is ringing, so it overshoots instead of settling once. */
const BUST_RELEASE_STIFFNESS_BOOST = 0.7
/** Skirt release is a short drop, not a rubber ring. */
const SKIRT_FALL_RING_SECONDS = 0.55
const SKIRT_FALL_DRAG_DIP = 0.25
/** Stiffness kept while a breast is held. Low enough to follow the hand, not fight it. */
const BUST_HOLD_STIFFNESS_KEEP = 0.06
/** Drag force while a breast is held. Enough to kill a tear, not enough to freeze the spring. */
const BUST_HOLD_DRAG_FORCE = 0.62
/** Neck scarf follows this share of the breast pull. */
const SCARF_FOLLOW = 0.5
const SCARF = /ribbon|scarf|necktie|muffler|bow|リボン|ネクタイ|(?:^|_)tie(?:_|$)/i
const REGION_ALIAS_BUST = /^(?:bust|chest)$/i
const REGION_ALIAS_SKIRT = /^skirt$/i

export type VrmDragRegionKind = 'bust' | 'skirt' | 'named'

/** Scales drag distances with the model, on the same range as the interaction colliders. */
export function vrmDragModelScale(modelHeight: number) {
  if (!Number.isFinite(modelHeight) || modelHeight <= 0)
    return 1
  return Math.min(DRAG_SCALE_MAX, Math.max(DRAG_SCALE_MIN, modelHeight / DRAG_REFERENCE_HEIGHT))
}

/** `bust` and `chest` share the breast joints. Anything else is a bone-name search. */
export function resolveVRMDragRegion(regionId: string): VrmDragRegionKind {
  if (REGION_ALIAS_BUST.test(regionId) || BUST.test(regionId))
    return 'bust'
  if (REGION_ALIAS_SKIRT.test(regionId) || SKIRT.test(regionId))
    return 'skirt'
  return 'named'
}

function dragLimits(kind: VrmDragRegionKind, modelScale: number) {
  if (kind === 'bust')
    return { maxDistance: BUST_MAX_DISTANCE * modelScale, axisScale: BUST_AXIS_SCALE, radius: BUST_FALLOFF_RADIUS * modelScale }
  if (kind === 'skirt')
    return { maxDistance: SKIRT_MAX_DISTANCE * modelScale, axisScale: SKIRT_AXIS_SCALE, radius: SKIRT_FALLOFF_RADIUS * modelScale }
  return { maxDistance: NAMED_MAX_DISTANCE * modelScale, axisScale: NAMED_AXIS_SCALE, radius: NAMED_FALLOFF_RADIUS * modelScale }
}

function isChestScarf(bone: Object3D) {
  return SCARF.test(bone.name) && !BUST.test(bone.name)
}

function jointInDragRegion(bone: Object3D, regionId: string, kind: VrmDragRegionKind) {
  // Breast clothing hangs in the bust group. Only the breast bones themselves move.
  if (kind === 'bust')
    return BUST.test(bone.name)
  if (kind === 'skirt')
    return groupOf(bone) === 'skirt'
  const needle = regionId.toLowerCase()
  for (let node: Object3D | null = bone; node; node = node.parent) {
    if (node.name.toLowerCase().includes(needle))
      return true
  }
  return false
}

const regionPosition = new Vector3()

/**
 * Pushes the spring tails of one region by `applied` (world units this frame).
 *
 * `applied` is the delta that survived the accumulated clamp. Joints fade out
 * with distance from `near`, the same way a hair drag does.
 */
export function dragVRMRegion(vrm: VRM, regionId: string, near: Vector3, applied: Vector3, radius: number) {
  const manager = vrm.springBoneManager
  if (!manager || radius <= 0 || applied.lengthSq() < 1e-12)
    return
  const kind = resolveVRMDragRegion(regionId)
  for (const joint of manager.joints) {
    const scarf = kind === 'bust' && isChestScarf(joint.bone)
    if (!jointInDragRegion(joint.bone, regionId, kind) && !scarf)
      continue
    // A chest poke hits the shirt collider, which sits on the upper chest, not on
    // the breast bone. Every breast joint follows that pull. The neck scarf follows
    // part of the way. A skirt still fades with distance from the hand.
    const falloff = kind === 'bust'
      ? (scarf ? SCARF_FOLLOW : 1)
      : 1 - joint.bone.getWorldPosition(regionPosition).distanceTo(near) / radius
    if (falloff <= 0)
      continue
    const internals = joint as unknown as SpringBoneJointInternals
    scratchPush.copy(applied).multiplyScalar(falloff)
    if (internals.center) {
      const length = scratchPush.length()
      scratchPush.transformDirection(scratchInverse.copy(internals.center.matrixWorld).invert()).multiplyScalar(length)
    }
    internals._prevTail?.sub(scratchPush)
  }
}

export interface VrmRegionDragRelease {
  kind: VrmDragRegionKind | undefined
  /** 0 to 1, from how far the cloth was pulled, or how fast the last movement was. */
  strength: number
}

interface HeldJointSettings {
  stiffness: number
  gravityPower: number
  dragForce: number
}

/**
 * One drag gesture: accumulates a clamped offset, then pushes that frame's remainder.
 *
 * While the pointer is down, bust and skirt joints lose stiffness so the cloth stays
 * where the hand put it. Releasing restores the spring and dips drag force, so the
 * cloth rings home along the pull instead of playing a separate downward poke.
 */
export function createVRMRegionDrag() {
  let regionId: string | undefined
  let offset: DragVec3 = { x: 0, y: 0, z: 0 }
  let gestureOpen = false
  let lastAppliedLength = 0
  let lastDeltaSeconds = 1 / 60
  let lastMaxDistance = 0
  let ringTime = -1
  let ringStrength = 0
  let ringKind: VrmDragRegionKind | undefined
  const applied = new Vector3()
  const heldJoints = new Map<VRMSpringBoneJoint, HeldJointSettings>()

  function resetOffset() {
    offset = { x: 0, y: 0, z: 0 }
    lastAppliedLength = 0
    gestureOpen = false
  }

  function ringSeconds() {
    return ringKind === 'skirt' ? SKIRT_FALL_RING_SECONDS : CLOTH_HOLD_RING_SECONDS
  }

  function writeHeld(dragDip: number) {
    const dip = ringKind === 'skirt' ? SKIRT_FALL_DRAG_DIP : CLOTH_HOLD_DRAG_DIP
    const spring = ringKind === 'bust' ? BUST_RELEASE_STIFFNESS_BOOST : 0
    for (const [joint, settings] of heldJoints) {
      joint.settings.stiffness = settings.stiffness * (1 + spring * dragDip)
      joint.settings.gravityPower = settings.gravityPower
      joint.settings.dragForce = settings.dragForce * (1 - dip * dragDip)
    }
  }

  function clearHold() {
    writeHeld(0)
    heldJoints.clear()
    ringTime = -1
    ringStrength = 0
    ringKind = undefined
  }

  /** Softens the held cloth. A breast stays loose enough to follow the hand, with enough drag that it cannot fly past the clamp. */
  function soften(vrm: VRM) {
    const kind = regionId ? resolveVRMDragRegion(regionId) : undefined
    if (!regionId || (kind !== 'bust' && kind !== 'skirt'))
      return
    const manager = vrm.springBoneManager
    if (!manager)
      return
    for (const joint of manager.joints) {
      if (!jointInDragRegion(joint.bone, regionId, kind))
        continue
      if (!heldJoints.has(joint)) {
        heldJoints.set(joint, {
          stiffness: joint.settings.stiffness,
          gravityPower: joint.settings.gravityPower,
          dragForce: joint.settings.dragForce,
        })
      }
      const saved = heldJoints.get(joint)!
      joint.settings.gravityPower = 0
      if (kind === 'bust') {
        joint.settings.stiffness = saved.stiffness * BUST_HOLD_STIFFNESS_KEEP
        joint.settings.dragForce = Math.max(saved.dragForce, BUST_HOLD_DRAG_FORCE)
      }
      else {
        joint.settings.stiffness = 0
      }
    }
  }

  return {
    get regionId() {
      return regionId
    },
    get kind(): VrmDragRegionKind | undefined {
      return regionId ? resolveVRMDragRegion(regionId) : undefined
    },
    setRegion(id: string | null) {
      clearHold()
      regionId = id || undefined
      resetOffset()
    },
    /**
     * @returns True on the first call of a gesture, so the caller can cancel a bounce already playing.
     */
    drag(vrm: VRM, near: Vector3, frameDelta: Vector3, deltaSeconds: number, modelHeight: number) {
      if (!regionId)
        return false
      const started = !gestureOpen
      gestureOpen = true
      const limits = dragLimits(resolveVRMDragRegion(regionId), vrmDragModelScale(modelHeight))
      lastMaxDistance = limits.maxDistance
      const step = accumulateClampedDrag(offset, frameDelta, limits)
      offset = step.offset
      lastAppliedLength = Math.hypot(step.applied.x, step.applied.y, step.applied.z)
      lastDeltaSeconds = Math.max(deltaSeconds, 1e-4)
      applied.set(step.applied.x, step.applied.y, step.applied.z)
      dragVRMRegion(vrm, regionId, near, applied, limits.radius)
      return started
    },
    /**
     * Call every frame before the spring solver. Holds the cloth while the gesture
     * is open, then eases the drag force back after release.
     */
    step(vrm: VRM | undefined, delta: number) {
      if (!vrm)
        return
      if (gestureOpen) {
        soften(vrm)
        return
      }
      if (ringTime < 0 || heldJoints.size === 0)
        return
      ringTime += delta
      const fade = Math.max(0, 1 - ringTime / ringSeconds())
      writeHeld(ringStrength * fade)
      if (fade <= 0)
        clearHold()
    },
    release(): VrmRegionDragRelease {
      const kind = regionId ? resolveVRMDragRegion(regionId) : undefined
      const held = Math.hypot(offset.x, offset.y, offset.z)
      const speed = lastAppliedLength / lastDeltaSeconds
      const fromDistance = lastMaxDistance > 0 ? Math.min(1, held / lastMaxDistance) : 0
      const fromSpeed = Math.min(1, Math.max(0, speed / BUST_RELEASE_REFERENCE_SPEED))
      const strength = Math.max(fromDistance, fromSpeed)
      gestureOpen = false
      offset = { x: 0, y: 0, z: 0 }
      lastAppliedLength = 0
      if (heldJoints.size > 0 && strength > 0 && (kind === 'bust' || kind === 'skirt')) {
        ringKind = kind
        ringStrength = strength
        ringTime = 0
        writeHeld(strength)
      }
      else if (heldJoints.size > 0) {
        clearHold()
      }
      return { kind, strength }
    },
  }
}

/**
 * Steps spring bones with sub-steps, so a long frame does not overshoot.
 * After a hitch (a hidden window, a model load) it resets the springs instead of
 * integrating one huge step, which flings hair upward.
 */
export function createVRMSpringBoneStepper(options: { maxStep?: number, maxSubSteps?: number, resetAfter?: number } = {}) {
  const maxStep = options.maxStep ?? 1 / 60
  const maxSubSteps = options.maxSubSteps ?? 4
  const resetAfter = options.resetAfter ?? 0.25

  /**
   * @param push - Optional body motion this frame in world units, for example from the camera.
   */
  return function update(vrm: VRM | undefined, delta: number, push?: Vector3) {
    const manager = vrm?.springBoneManager
    if (!manager || delta <= 0)
      return
    if (delta > resetAfter) {
      manager.reset()
      return
    }
    if (push)
      pushSpringTails(vrm, push)
    const steps = Math.min(maxSubSteps, Math.ceil(delta / maxStep))
    const step = delta / steps
    for (let i = 0; i < steps; i++)
      manager.update(step)
  }
}
