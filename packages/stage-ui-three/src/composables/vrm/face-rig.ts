import type { VRMCore } from '@pixiv/three-vrm-core'
import type { Mesh, Object3D } from 'three'

import { VRMExpression, VRMExpressionMorphTargetBind } from '@pixiv/three-vrm-core'

/** The 52 ARKit face blendshapes, as many VRoid and VTuber models export them. */
export const ARKIT_BLENDSHAPES = [
  'browInnerUp',
  'browDownLeft',
  'browDownRight',
  'browOuterUpLeft',
  'browOuterUpRight',
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'cheekPuff',
  'cheekSquintLeft',
  'cheekSquintRight',
  'noseSneerLeft',
  'noseSneerRight',
  'jawOpen',
  'jawForward',
  'jawLeft',
  'jawRight',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthRollUpper',
  'mouthRollLower',
  'mouthShrugUpper',
  'mouthShrugLower',
  'mouthClose',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthDimpleLeft',
  'mouthDimpleRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'tongueOut',
] as const

export type ARKitBlendshape = typeof ARKIT_BLENDSHAPES[number]

/** ARKit weights, 0 to 1. */
export type ARKitWeights = Partial<Record<ARKitBlendshape, number>>

/**
 * Mouth-shaping blendshapes. They fight lip sync, so they are turned down while the character
 * speaks. Smiles and frowns stay out of this group, so a face keeps its mood while talking.
 */
export const ARKIT_MOUTH_SHAPES: ReadonlySet<string> = new Set([
  'jawOpen',
  'jawForward',
  'jawLeft',
  'jawRight',
  'mouthFunnel',
  'mouthPucker',
  'mouthLeft',
  'mouthRight',
  'mouthRollUpper',
  'mouthRollLower',
  'mouthShrugUpper',
  'mouthShrugLower',
  'mouthClose',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'tongueOut',
])

/** One morph target found on the model: every mesh primitive that carries it, with its index there. */
interface MorphTargetSlot {
  primitives: Mesh[]
  indices: number[]
}

export interface VRMFaceInventory {
  /** Expressions the VRM declares, by the names `expressionManager` uses. */
  expressions: string[]
  /** ARKit blendshapes found on the meshes, in ARKit order. */
  arkit: ARKitBlendshape[]
  /** Where each found ARKit blendshape lives, for building expressions. */
  morphs: Map<string, MorphTargetSlot>
}

/** Lowercase name without separators, so `mouthSmile_L`, `MouthSmileLeft` and `mouthSmileLeft` can match. */
function normalize(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Lists what the face can do: declared expressions and the ARKit blendshapes on its meshes.
 *
 * VRM files often carry ARKit blendshapes without declaring them as expressions, so
 * `getExpression()` cannot see them. Reading `morphTargetDictionary` finds them anyway.
 */
export function inspectVRMFace(vrm: VRMCore): VRMFaceInventory {
  const expressions = Object.keys(vrm.expressionManager?.expressionMap ?? {})
  const byNormalized = new Map<string, MorphTargetSlot>()
  vrm.scene.traverse((object: Object3D) => {
    const mesh = object as Mesh
    const dictionary = mesh.morphTargetDictionary
    if (!dictionary)
      return
    for (const [name, index] of Object.entries(dictionary)) {
      const key = normalize(name)
      const slot = byNormalized.get(key) ?? { primitives: [], indices: [] }
      slot.primitives.push(mesh)
      slot.indices.push(index)
      byNormalized.set(key, slot)
    }
  })
  const arkit = ARKIT_BLENDSHAPES.filter(name => byNormalized.has(normalize(name)))
  return { expressions, arkit, morphs: new Map(arkit.map(name => [name, byNormalized.get(normalize(name))!])) }
}

/**
 * Builds a VRM expression from ARKit weights and registers it, so it plays through
 * `setValue()` like any declared expression. Blendshapes the model lacks are skipped.
 *
 * Returns:
 * - The registered expression name, or undefined when none of the weights exist on the model.
 */
export function registerARKitExpression(vrm: VRMCore, inventory: VRMFaceInventory, name: string, weights: ARKitWeights): string | undefined {
  const manager = vrm.expressionManager
  if (!manager)
    return undefined
  const existing = manager.getExpression(name)
  if (existing)
    manager.unregisterExpression(existing)
  const expression = new VRMExpression(name)
  let binds = 0
  for (const [shape, weight] of Object.entries(weights)) {
    const slot = inventory.morphs.get(shape)
    if (!slot || !weight)
      continue
    // A morph index can differ between primitives, so bind each index separately.
    const groups = new Map<number, Mesh[]>()
    slot.indices.forEach((index, i) => groups.set(index, [...(groups.get(index) ?? []), slot.primitives[i]]))
    for (const [index, primitives] of groups) {
      expression.addBind(new VRMExpressionMorphTargetBind({ primitives, index, weight: Math.min(1, Math.max(0, weight)) }))
      binds++
    }
  }
  if (binds === 0)
    return undefined
  manager.registerExpression(expression)
  return name
}

/** Splits weights into what may play while speaking and the mouth shapes that would fight lip sync. */
export function splitMouthShapes(weights: ARKitWeights): { face: ARKitWeights, mouth: ARKitWeights } {
  const face: ARKitWeights = {}
  const mouth: ARKitWeights = {}
  for (const [shape, weight] of Object.entries(weights) as [ARKitBlendshape, number][]) {
    if (ARKIT_MOUTH_SHAPES.has(shape))
      mouth[shape] = weight
    else
      face[shape] = weight
  }
  return { face, mouth }
}
