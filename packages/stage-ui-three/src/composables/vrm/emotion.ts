import type { VRMCore, VRMHumanBoneName } from '@pixiv/three-vrm-core'

import type { ARKitWeights, VRMFaceInventory } from './face-rig'
import type { VRMPoseRotations } from './pose'

import { inspectVRMFace, registerARKitExpression, splitMouthShapes } from './face-rig'

/**
 * One facial expression weight in an emotion. `names` are tried in order, so a model without
 * `surprised` (VRM 0.x has none) can fall back to an open mouth.
 */
export interface VRMEmotionFace {
  names: readonly string[]
  weight: number
  /** Optional oscillation on top of `weight`, for laughing or trembling. */
  wave?: { amplitude: number, hz: number }
}

/** Head and body movement in degrees, VRM 1.0 convention (see {@link VRMPoseRotations}). */
export type VRMEmotionBody = (time: number, intensity: number) => VRMPoseRotations

/** How blinking behaves while an emotion shows. */
export type VRMEmotionBlink = 'normal' | 'slow' | 'fast' | 'off' | 'off-at-start'

export interface VRMEmotionPreset {
  /** Declared expressions, the whole face on models without ARKit blendshapes. */
  face: readonly VRMEmotionFace[]
  /**
   * ARKit blendshapes, for models that carry them. When the model has them, they play
   * together with `arkitFace` instead of `face`.
   */
  arkit?: ARKitWeights
  /** Declared expressions to mix with `arkit`. Defaults to `face`. */
  arkitFace?: readonly VRMEmotionFace[]
  /** Oscillation of the ARKit mouth shapes, such as a laugh's jaw. */
  mouthWave?: { amplitude: number, hz: number }
  /** Decorations drawn by the overlay layer, such as `blush` or `question`. */
  effects?: readonly string[]
  /** @default 'normal' */
  blink?: VRMEmotionBlink
  body?: VRMEmotionBody
  /** Seconds the head and body take to blend in. The face always takes {@link FACE_BLEND_S}. */
  attack: number
  /** Seconds to blend out. */
  release: number
  /** Seconds to hold before fading out on its own. 0 holds until the next emotion. */
  hold: number
  /** True when the face closes the eyes, so procedural blinking pauses. Same as `blink: 'off'`. */
  coversEyes?: boolean
}

/** Seconds a face takes to change to the next emotion. */
export const FACE_BLEND_S = 0.2
/** Seconds the head and body take to move from one emotion's pose to the next. */
const BODY_BLEND_S = 0.4
/** Share of ARKit mouth shapes kept while lip sync moves the mouth. */
const MOUTH_WHILE_SPEAKING = 0.3

/** Smooth 0 to 1 over [0, 1]. */
function smoothstep(x: number) {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** Smooth 0 to 1 to 0 that repeats `hz` times a second, without the sharp turns of a bare sine. */
function pulse(t: number, hz: number) {
  return 0.5 - 0.5 * Math.cos(t * Math.PI * 2 * hz)
}

/** Smooth 0 → 1 → 0 bump between `from` and `to` seconds. */
function bump(t: number, from: number, to: number) {
  if (t <= from || t >= to)
    return 0
  return Math.sin(((t - from) / (to - from)) * Math.PI)
}

/** Exponential settle toward 1 over roughly `seconds`. */
function settle(t: number, seconds: number) {
  return 1 - Math.exp(-t / Math.max(seconds / 3, 1e-3))
}

/**
 * Built-in emotions, made only from the standard VRM expressions, so they work on any model.
 * The character's ACT emotion tokens pick them while chatting.
 */
export const VRM_EMOTION_PRESETS: Record<string, VRMEmotionPreset> = {
  neutral: {
    face: [],
    attack: 0.4,
    release: 0.5,
    hold: 0,
  },
  /** Smile: eyes stay open. A model's `happy` (`Joy`) often closes them, which is the laugh. */
  happy: {
    face: [
      { names: ['happy', 'joy'], weight: 0.65 },
      { names: ['aa'], weight: 0.12 },
    ],
    arkitFace: [{ names: ['happy', 'joy'], weight: 0.25 }],
    arkit: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6, cheekSquintLeft: 0.3, cheekSquintRight: 0.3, eyeSquintLeft: 0.15, eyeSquintRight: 0.15 },
    body: (t, k) => ({
      head: [-3 * k * settle(t, 0.4) + 2 * k * bump(t, 0.2, 0.7), 0, 5 * k * settle(t, 0.6)],
      chest: [-2 * k * settle(t, 0.4), 0, 0],
    }),
    attack: 0.3,
    release: 0.6,
    hold: 4,
  },
  laugh: {
    face: [
      { names: ['happy', 'joy'], weight: 1 },
      { names: ['aa'], weight: 0.3 },
    ],
    arkit: { jawOpen: 0.3, mouthSmileLeft: 0.8, mouthSmileRight: 0.8, cheekSquintLeft: 0.4, cheekSquintRight: 0.4 },
    // A soft giggle, not a flap: small, and slower than speech.
    mouthWave: { amplitude: 0.25, hz: 2.4 },
    effects: ['sparkle'],
    body: (t, k) => {
      // Shoulders and chest lift with each breath of laughter, and the giggle fades as it goes on.
      const giggle = pulse(t, 2.4) * Math.exp(-t / 2.5) * smoothstep(t / 0.3)
      return {
        head: [-6 * k * settle(t, 0.5) + 1.5 * k * giggle, 0, 3 * k * Math.sin(t * 1.1) * settle(t, 0.8)],
        chest: [-2.5 * k * settle(t, 0.5) + 1.2 * k * giggle, 0, 0],
        leftShoulder: [0, 0, 2 * k * giggle],
        rightShoulder: [0, 0, -2 * k * giggle],
      }
    },
    attack: 0.35,
    release: 0.8,
    hold: 3,
    blink: 'off',
  },
  sad: {
    face: [
      { names: ['sad', 'sorrow'], weight: 0.8 },
      { names: ['oh'], weight: 0.08 },
    ],
    arkitFace: [{ names: ['sad', 'sorrow'], weight: 0.6 }],
    arkit: { browInnerUp: 0.7, mouthFrownLeft: 0.5, mouthFrownRight: 0.5, eyeLookDownLeft: 0.2, eyeLookDownRight: 0.2 },
    effects: ['tear'],
    body: (t, k) => ({
      head: [12 * k * settle(t, 1.2), 0, -4 * k * settle(t, 1.5)],
      neck: [4 * k * settle(t, 1.2), 0, 0],
      chest: [4 * k * settle(t, 1.2), 0, 0],
      leftShoulder: [0, 0, -4 * k * settle(t, 1.2)],
      rightShoulder: [0, 0, 4 * k * settle(t, 1.2)],
    }),
    attack: 0.8,
    release: 1,
    hold: 5,
    blink: 'slow',
  },
  surprised: {
    face: [
      { names: ['surprised'], weight: 0.9 },
      { names: ['oh'], weight: 0.45 },
    ],
    arkitFace: [],
    arkit: { eyeWideLeft: 1, eyeWideRight: 1, browInnerUp: 0.7, browOuterUpLeft: 0.7, browOuterUpRight: 0.7, jawOpen: 0.45, mouthFunnel: 0.25 },
    effects: ['exclaim'],
    body: (t, k) => ({
      head: [-9 * k * bump(t, 0, 0.5) - 3 * k * settle(t, 0.6), 0, 0],
      chest: [-4 * k * bump(t, 0, 0.6), 0, 0],
      leftShoulder: [0, 0, 6 * k * bump(t, 0, 0.7)],
      rightShoulder: [0, 0, -6 * k * bump(t, 0, 0.7)],
    }),
    attack: 0.08,
    release: 0.7,
    hold: 2.5,
    blink: 'off-at-start',
  },
  angry: {
    face: [
      { names: ['angry'], weight: 0.8 },
      { names: ['ee'], weight: 0.25 },
    ],
    arkitFace: [{ names: ['angry'], weight: 0.7 }],
    arkit: { browDownLeft: 0.6, browDownRight: 0.6, noseSneerLeft: 0.3, noseSneerRight: 0.3, mouthPressLeft: 0.4, mouthPressRight: 0.4 },
    effects: ['anger'],
    body: (t, k) => ({
      head: [6 * k * settle(t, 0.4), 4 * k * Math.sin(t * Math.PI * 2 * 3) * Math.exp(-t / 0.6), 0],
      chest: [3 * k * settle(t, 0.4), 0, 0],
    }),
    attack: 0.2,
    release: 0.7,
    hold: 3.5,
  },
  /** Shy. Looks down and away with a small smile. */
  awkward: {
    face: [
      { names: ['relaxed', 'fun'], weight: 0.45 },
      { names: ['happy', 'joy'], weight: 0.3 },
    ],
    arkitFace: [{ names: ['happy', 'joy'], weight: 0.2 }],
    arkit: { mouthSmileLeft: 0.3, mouthSmileRight: 0.3, eyeLookDownLeft: 0.4, eyeLookDownRight: 0.4, eyeLookOutLeft: 0.3, eyeLookInRight: 0.3, mouthRollLower: 0.2 },
    effects: ['blush', 'sweat'],
    body: (t, k) => ({
      head: [8 * k * settle(t, 0.6), -10 * k * settle(t, 0.8), 8 * k * settle(t, 0.8)],
      leftShoulder: [0, 0, 4 * k * settle(t, 0.5)],
      rightShoulder: [0, 0, -4 * k * settle(t, 0.5)],
    }),
    attack: 0.4,
    release: 0.8,
    hold: 3.5,
    blink: 'fast',
  },
  think: {
    face: [
      { names: ['ou'], weight: 0.15 },
      { names: ['relaxed', 'fun'], weight: 0.15 },
    ],
    arkitFace: [],
    arkit: { browDownRight: 0.4, browInnerUp: 0.2, mouthPressLeft: 0.4, mouthLeft: 0.3, eyeLookUpLeft: 0.4, eyeLookUpRight: 0.4 },
    effects: ['dots'],
    body: (t, k) => ({
      head: [-8 * k * settle(t, 0.8), 12 * k * settle(t, 1), 6 * k * settle(t, 1)],
    }),
    attack: 0.6,
    release: 0.8,
    hold: 4,
    blink: 'slow',
  },
  curious: {
    face: [
      { names: ['happy', 'joy'], weight: 0.2 },
      { names: ['oh'], weight: 0.15 },
    ],
    arkitFace: [],
    arkit: { browOuterUpLeft: 0.5, eyeWideLeft: 0.25, eyeWideRight: 0.25, mouthPucker: 0.15 },
    effects: ['sparkle'],
    body: (t, k) => ({
      head: [-2 * k * settle(t, 0.5), 4 * k * settle(t, 0.6), 13 * k * settle(t, 0.6)],
      chest: [-2 * k * settle(t, 0.6), 0, 0],
    }),
    attack: 0.4,
    release: 0.7,
    hold: 3.5,
  },
  /** Puzzled. */
  question: {
    face: [
      { names: ['oh'], weight: 0.2 },
    ],
    arkitFace: [],
    arkit: { browOuterUpRight: 0.6, browDownLeft: 0.4, mouthLeft: 0.3, mouthPucker: 0.2 },
    effects: ['question'],
    body: (t, k) => ({
      head: [0, 0, -12 * k * settle(t, 0.5)],
    }),
    attack: 0.35,
    release: 0.7,
    hold: 3,
  },
  relaxed: {
    face: [
      { names: ['relaxed', 'fun'], weight: 0.7 },
    ],
    arkitFace: [{ names: ['relaxed', 'fun'], weight: 0.6 }],
    arkit: { mouthSmileLeft: 0.2, mouthSmileRight: 0.2 },
    body: (t, k) => ({
      head: [3 * k * settle(t, 1), 0, 3 * k * settle(t, 1)],
    }),
    attack: 0.6,
    release: 0.8,
    hold: 4,
    blink: 'slow',
    coversEyes: true,
  },
  // Touch reactions below. Not chat emotions. Their head moves ease in over most of a
  // second, so a touch never snaps the head.
  /** Being patted: eyes closed in a smile, head leaning into the hand. */
  bliss: {
    face: [
      { names: ['happy', 'joy'], weight: 0.6 },
      { names: ['blink'], weight: 0.95 },
    ],
    body: (t, k) => ({
      head: [4 * k * settle(t, 1.2), 0, 6 * k * settle(t, 1.4)],
    }),
    attack: 0.35,
    release: 0.6,
    hold: 2.5,
    coversEyes: true,
  },
  /** A tap on the head or chest: a soft smile and a small shy tilt. */
  touchSmile: {
    face: [
      { names: ['happy', 'joy'], weight: 0.55 },
    ],
    body: (t, k) => ({
      head: [3 * k * settle(t, 1), 0, 5 * k * settle(t, 1.2)],
    }),
    attack: 0.4,
    release: 0.6,
    hold: 1.8,
  },
  /** A poke on the cheek: a small pout, head turning a little away. */
  pout: {
    face: [
      { names: ['angry'], weight: 0.35 },
      { names: ['ou'], weight: 0.35 },
    ],
    body: (t, k) => ({
      head: [0, -6 * k * settle(t, 1), -3 * k * settle(t, 1)],
    }),
    attack: 0.35,
    release: 0.6,
    hold: 1.8,
  },
}

/** Emotions the settings page can preview, in display order. */
export const VRM_EMOTION_NAMES = ['happy', 'laugh', 'sad', 'surprised', 'angry', 'awkward', 'think', 'curious', 'question', 'relaxed', 'neutral'] as const

const VISEMES = new Set(['aa', 'ee', 'ih', 'oh', 'ou'])

function damp(current: number, target: number, rate: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-rate * delta))
}

/** The VRM expression a face entry resolves to on this model, or undefined. */
function resolveExpression(vrm: VRMCore, names: readonly string[]) {
  const map = vrm.expressionManager?.expressionMap
  if (!map)
    return undefined
  const available = Object.keys(map)
  for (const name of names) {
    const match = available.find(key => key.toLowerCase() === name.toLowerCase())
    if (match)
      return match
  }
  return undefined
}

/** Blinking for the emotion on screen, read by the blink controller every frame. */
export interface VRMEmotionBlinkState {
  /** Hold the lids open, because the face closes the eyes itself. */
  suppress: boolean
  /** Scale of a blink, 0 to 1. A squinting face blinks less far, so the lids do not cross. */
  amplitude: number
  /** Multiplier on the time between blinks: 2 blinks half as often. */
  interval: number
}

/** The ARKit expressions registered for one preset: the face part and the mouth shapes. */
interface ARKitExpressionNames {
  face?: string
  mouth?: string
  /** Strongest eye squint in the preset, for the blink amplitude. */
  squint: number
}

const BLINK_INTERVAL: Record<VRMEmotionBlink, number> = { 'normal': 1, 'slow': 1.8, 'fast': 0.55, 'off': 1, 'off-at-start': 1 }
/** Seconds `off-at-start` keeps the eyes open, as a startled person stares. */
const STARE_S = 1

/**
 * Plays emotion presets: facial expressions with a little head and body movement, blended in
 * and out over time.
 *
 * On models with ARKit blendshapes each preset's `arkit` weights are registered as VRM
 * expressions (`emotion:<name>` and `emotion:<name>:mouth`), so they play through `setValue()`.
 *
 * Expects:
 * - `update()` runs every frame after lip sync. While speech is active, viseme expressions are
 *   left to lip sync and ARKit mouth shapes are turned down.
 * - {@link body} is read by the procedural layer and added on top of the animation.
 * - {@link blinkState} is read by the blink controller.
 */
export function useVRMEmotion(vrm: VRMCore, options: { presets?: Record<string, VRMEmotionPreset>, strength?: () => number } = {}) {
  const presets = options.presets ?? VRM_EMOTION_PRESETS
  const inventory: VRMFaceInventory = vrm.scene ? inspectVRMFace(vrm) : { expressions: [], arkit: [], morphs: new Map() }
  const arkitNames = new Map<string, ARKitExpressionNames>()
  if (inventory.arkit.length > 0) {
    for (const [name, candidate] of Object.entries(presets)) {
      if (!candidate.arkit)
        continue
      const { face, mouth } = splitMouthShapes(candidate.arkit)
      arkitNames.set(name, {
        face: registerARKitExpression(vrm, inventory, `emotion:${name}`, face),
        mouth: registerARKitExpression(vrm, inventory, `emotion:${name}:mouth`, mouth),
        squint: Math.max(candidate.arkit.eyeSquintLeft ?? 0, candidate.arkit.eyeSquintRight ?? 0),
      })
    }
  }

  let preset: VRMEmotionPreset | undefined
  let presetName: string | undefined
  let time = 0
  let intensity = 1
  let envelope = 0
  /** Face blend of the current emotion, 0 to 1 over {@link FACE_BLEND_S}. */
  let faceBlend = 0
  let releasing = false
  let holdOverride: number | undefined
  const written = new Map<string, number>()
  const target = new Map<string, number>()
  const isEmoteActive = { value: false }
  let body: VRMPoseRotations = {}
  /** The pose the last emotion held when the next one started, faded out over {@link BODY_BLEND_S}. */
  let bodyFrom: VRMPoseRotations = {}
  let blinkState: VRMEmotionBlinkState = { suppress: false, amplitude: 1, interval: 1 }

  function play(name: string, value = 1, holdSeconds?: number) {
    const next = presets[name]
    if (!next)
      return false
    bodyFrom = body
    preset = next
    presetName = name
    time = 0
    faceBlend = 0
    intensity = Math.min(1, Math.max(0, value))
    releasing = false
    holdOverride = holdSeconds
    return true
  }

  function release() {
    releasing = true
  }

  function setTarget(name: string | undefined, weight: number) {
    if (!name)
      return
    target.set(name, Math.max(target.get(name) ?? 0, Math.min(1, Math.max(0, weight))))
  }

  function update(delta: number, frame: { skipVisemes?: boolean } = {}) {
    const expressionManager = vrm.expressionManager
    target.clear()
    body = {}
    let squint = 0
    if (preset && presetName) {
      time += delta
      const hold = holdOverride ?? preset.hold
      if (hold > 0 && time > preset.attack + hold)
        releasing = true
      envelope = releasing
        ? Math.max(0, envelope - delta / Math.max(preset.release, 1e-3))
        : Math.min(1, envelope + delta / Math.max(preset.attack, 1e-3))
      faceBlend = Math.min(1, faceBlend + delta / FACE_BLEND_S)
      const strength = (options.strength?.() ?? 1) * intensity
      // The face eases in over FACE_BLEND_S and out over the preset's release.
      const k = (releasing ? envelope : smoothstep(faceBlend)) * strength

      const arkit = arkitNames.get(presetName)
      const usesARKit = Boolean(arkit && (arkit.face || arkit.mouth))
      const faces = usesARKit ? (preset.arkitFace ?? preset.face) : preset.face
      for (const face of faces) {
        const wave = face.wave ? face.wave.amplitude * Math.sin(time * Math.PI * 2 * face.wave.hz) : 0
        setTarget(resolveExpression(vrm, face.names), (face.weight + wave) * k)
      }
      if (arkit && usesARKit) {
        setTarget(arkit.face, k)
        const wave = preset.mouthWave ? preset.mouthWave.amplitude * (pulse(time, preset.mouthWave.hz) * 2 - 1) : 0
        setTarget(arkit.mouth, k * (1 + wave) * (frame.skipVisemes ? MOUTH_WHILE_SPEAKING : 1))
        squint = arkit.squint * k
      }

      if (preset.body) {
        const raw = preset.body(time, strength)
        // The envelope carries over from the last emotion, so the new pose also eases in over its attack.
        const weight = smoothstep(envelope) * (releasing ? 1 : smoothstep(time / Math.max(preset.attack, 1 / 30)))
        for (const [bone, rotation] of Object.entries(raw) as [VRMHumanBoneName, readonly [number, number, number]][])
          body[bone] = [rotation[0] * weight, rotation[1] * weight, rotation[2] * weight]
      }
      if (releasing && envelope <= 0) {
        preset = undefined
        presetName = undefined
      }
    }

    // Hand over from the last emotion's pose, so a new emotion never snaps the head.
    const handover = 1 - smoothstep(time / BODY_BLEND_S)
    if (handover > 0) {
      for (const [bone, rotation] of Object.entries(bodyFrom) as [VRMHumanBoneName, readonly [number, number, number]][]) {
        const current = body[bone] ?? [0, 0, 0]
        body[bone] = [current[0] + rotation[0] * handover, current[1] + rotation[1] * handover, current[2] + rotation[2] * handover]
      }
    }
    else {
      bodyFrom = {}
    }

    // Fade every expression this controller has touched toward its target. The new emotion's
    // own blend already eases it in, so this only smooths the old one out.
    for (const name of new Set([...written.keys(), ...target.keys()])) {
      if (frame.skipVisemes && VISEMES.has(name.toLowerCase()))
        continue
      const next = damp(written.get(name) ?? 0, target.get(name) ?? 0, 20, delta)
      if (next < 0.002 && !target.has(name)) {
        expressionManager?.setValue(name, 0)
        written.delete(name)
        continue
      }
      expressionManager?.setValue(name, next)
      written.set(name, next)
    }

    const blink = preset?.blink ?? (preset?.coversEyes ? 'off' : 'normal')
    const showing = Boolean(preset && envelope > 0.05)
    const suppress = showing && (blink === 'off' || (blink === 'off-at-start' && time < STARE_S))
    isEmoteActive.value = suppress
    blinkState = {
      suppress,
      amplitude: 1 - 0.6 * Math.min(1, squint),
      interval: showing ? BLINK_INTERVAL[blink] : 1,
    }
  }

  /** Same signature as the old emote controller, so callers keep working. */
  function setEmotionWithResetAfter(name: string, ms: number, value = 1) {
    if (!play(name, value, ms / 1000))
      play('neutral')
  }

  function dispose() {
    preset = undefined
    written.clear()
    const manager = vrm.expressionManager
    for (const names of arkitNames.values()) {
      for (const name of [names.face, names.mouth]) {
        const expression = name ? manager?.getExpression(name) : undefined
        if (expression)
          manager?.unregisterExpression(expression)
      }
    }
    arkitNames.clear()
  }

  return {
    get body() {
      return body
    },
    get current() {
      return presetName
    },
    get blinkState() {
      return blinkState
    },
    /** Overlay effects of the emotion on screen, with how far it has blended in. */
    get effects() {
      return preset?.effects?.length ? { names: preset.effects, weight: releasing ? envelope : smoothstep(faceBlend) } : undefined
    },
    /** What the model's face supports, for the settings page. */
    inventory,
    dispose,
    isEmoteActive,
    play,
    release,
    setEmotionWithResetAfter,
    update,
  }
}

export type VRMEmotionController = ReturnType<typeof useVRMEmotion>
