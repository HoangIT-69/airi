import type { VRM, VRMSpringBoneJoint, VRMSpringBoneJointSettings } from '@pixiv/three-vrm'
import type { Object3D } from 'three'

import { VRMSpringBoneJoint as SpringBoneJoint } from '@pixiv/three-vrm'

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

/**
 * Steps spring bones with sub-steps, so a long frame does not overshoot.
 * After a hitch (a hidden window, a model load) it resets the springs instead of
 * integrating one huge step, which flings hair upward.
 */
export function createVRMSpringBoneStepper(options: { maxStep?: number, maxSubSteps?: number, resetAfter?: number } = {}) {
  const maxStep = options.maxStep ?? 1 / 60
  const maxSubSteps = options.maxSubSteps ?? 4
  const resetAfter = options.resetAfter ?? 0.25

  return function update(vrm: VRM | undefined, delta: number) {
    const manager = vrm?.springBoneManager
    if (!manager || delta <= 0)
      return
    if (delta > resetAfter) {
      manager.reset()
      return
    }
    const steps = Math.min(maxSubSteps, Math.ceil(delta / maxStep))
    const step = delta / steps
    for (let i = 0; i < steps; i++)
      manager.update(step)
  }
}
