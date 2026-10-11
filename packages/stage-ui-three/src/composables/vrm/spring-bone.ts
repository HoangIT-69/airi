import type { VRM, VRMSpringBoneJoint, VRMSpringBoneJointSettings } from '@pixiv/three-vrm'
import type { Object3D } from 'three'

import { VRMSpringBoneJoint as SpringBoneJoint } from '@pixiv/three-vrm'
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
