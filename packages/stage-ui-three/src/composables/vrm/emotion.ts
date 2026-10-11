import type { VRMCore, VRMHumanBoneName } from '@pixiv/three-vrm-core'

import type { VRMPoseRotations } from './pose'

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

export interface VRMEmotionPreset {
  face: readonly VRMEmotionFace[]
  body?: VRMEmotionBody
  /** Seconds to blend in. */
  attack: number
  /** Seconds to blend out. */
  release: number
  /** Seconds to hold before fading out on its own. 0 holds until the next emotion. */
  hold: number
  /** True when the face closes or narrows the eyes, so procedural blinking pauses. */
  coversEyes?: boolean
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
  happy: {
    face: [
      { names: ['happy', 'joy'], weight: 0.65 },
      { names: ['aa'], weight: 0.12 },
    ],
    body: (t, k) => ({
      head: [-3 * k * settle(t, 0.4) + 2 * k * bump(t, 0.2, 0.7), 0, 5 * k * settle(t, 0.6)],
      chest: [-2 * k * settle(t, 0.4), 0, 0],
    }),
    attack: 0.3,
    release: 0.6,
    hold: 4,
    coversEyes: true,
  },
  laugh: {
    face: [
      { names: ['happy', 'joy'], weight: 1 },
      { names: ['aa'], weight: 0.4, wave: { amplitude: 0.25, hz: 5 } },
    ],
    body: (t, k) => {
      const shake = Math.sin(t * Math.PI * 2 * 5) * Math.exp(-t / 2.2)
      return {
        head: [-8 * k * settle(t, 0.3) + 2.5 * k * shake, 0, 4 * k * Math.sin(t * 1.3)],
        chest: [-3 * k * settle(t, 0.3) + 1.5 * k * shake, 0, 0],
        leftShoulder: [0, 0, 3 * k * shake],
        rightShoulder: [0, 0, -3 * k * shake],
      }
    },
    attack: 0.2,
    release: 0.8,
    hold: 3,
    coversEyes: true,
  },
  sad: {
    face: [
      { names: ['sad', 'sorrow'], weight: 0.8 },
      { names: ['oh'], weight: 0.08 },
    ],
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
  },
  surprised: {
    face: [
      { names: ['surprised'], weight: 0.9 },
      { names: ['oh'], weight: 0.45 },
    ],
    body: (t, k) => ({
      head: [-9 * k * bump(t, 0, 0.5) - 3 * k * settle(t, 0.6), 0, 0],
      chest: [-4 * k * bump(t, 0, 0.6), 0, 0],
      leftShoulder: [0, 0, 6 * k * bump(t, 0, 0.7)],
      rightShoulder: [0, 0, -6 * k * bump(t, 0, 0.7)],
    }),
    attack: 0.08,
    release: 0.7,
    hold: 2.5,
  },
  angry: {
    face: [
      { names: ['angry'], weight: 0.8 },
      { names: ['ee'], weight: 0.25 },
    ],
    body: (t, k) => ({
      head: [6 * k * settle(t, 0.4), 4 * k * Math.sin(t * Math.PI * 2 * 3) * Math.exp(-t / 0.6), 0],
      chest: [3 * k * settle(t, 0.4), 0, 0],
    }),
    attack: 0.2,
    release: 0.7,
    hold: 3.5,
  },
  awkward: {
    face: [
      { names: ['relaxed', 'fun'], weight: 0.45 },
      { names: ['happy', 'joy'], weight: 0.3 },
    ],
    body: (t, k) => ({
      head: [8 * k * settle(t, 0.6), -10 * k * settle(t, 0.8), 8 * k * settle(t, 0.8)],
      leftShoulder: [0, 0, 4 * k * settle(t, 0.5)],
      rightShoulder: [0, 0, -4 * k * settle(t, 0.5)],
    }),
    attack: 0.4,
    release: 0.8,
    hold: 3.5,
    coversEyes: true,
  },
  think: {
    face: [
      { names: ['ou'], weight: 0.15 },
      { names: ['relaxed', 'fun'], weight: 0.15 },
    ],
    body: (t, k) => ({
      head: [-8 * k * settle(t, 0.8), 12 * k * settle(t, 1), 6 * k * settle(t, 1)],
    }),
    attack: 0.6,
    release: 0.8,
    hold: 4,
  },
  curious: {
    face: [
      { names: ['happy', 'joy'], weight: 0.2 },
      { names: ['oh'], weight: 0.15 },
    ],
    body: (t, k) => ({
      head: [-2 * k * settle(t, 0.5), 4 * k * settle(t, 0.6), 13 * k * settle(t, 0.6)],
      chest: [-2 * k * settle(t, 0.6), 0, 0],
    }),
    attack: 0.4,
    release: 0.7,
    hold: 3.5,
  },
  question: {
    face: [
      { names: ['oh'], weight: 0.2 },
    ],
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
    body: (t, k) => ({
      head: [3 * k * settle(t, 1), 0, 3 * k * settle(t, 1)],
    }),
    attack: 0.6,
    release: 0.8,
    hold: 4,
    coversEyes: true,
  },
  /** Being patted: eyes closed in a smile, head leaning into the hand. Not a chat emotion. */
  bliss: {
    face: [
      { names: ['happy', 'joy'], weight: 0.6 },
      { names: ['blink'], weight: 0.95 },
    ],
    body: (t, k) => ({
      head: [4 * k * settle(t, 0.6), 0, 6 * k * settle(t, 0.8)],
    }),
    attack: 0.35,
    release: 0.6,
    hold: 2.5,
    coversEyes: true,
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

/**
 * Plays emotion presets: facial expressions with a little head and body movement, blended in
 * and out over time.
 *
 * Expects:
 * - `update()` runs every frame after lip sync. While speech is active, mouth shapes are left
 *   to lip sync.
 * - {@link body} is read by the procedural layer and added on top of the animation.
 */
export function useVRMEmotion(vrm: VRMCore, options: { presets?: Record<string, VRMEmotionPreset>, strength?: () => number } = {}) {
  const presets = options.presets ?? VRM_EMOTION_PRESETS
  let preset: VRMEmotionPreset | undefined
  let presetName: string | undefined
  let time = 0
  let intensity = 1
  let envelope = 0
  let releasing = false
  let holdOverride: number | undefined
  const written = new Map<string, number>()
  const target = new Map<string, number>()
  const isEmoteActive = { value: false }
  let body: VRMPoseRotations = {}

  function play(name: string, value = 1, holdSeconds?: number) {
    const next = presets[name]
    if (!next)
      return false
    preset = next
    presetName = name
    time = 0
    intensity = Math.min(1, Math.max(0, value))
    releasing = false
    holdOverride = holdSeconds
    return true
  }

  function release() {
    releasing = true
  }

  function update(delta: number, frame: { skipVisemes?: boolean } = {}) {
    const expressionManager = vrm.expressionManager
    target.clear()
    body = {}
    if (preset) {
      time += delta
      const hold = holdOverride ?? preset.hold
      if (hold > 0 && time > preset.attack + hold)
        releasing = true
      envelope = releasing
        ? Math.max(0, envelope - delta / Math.max(preset.release, 1e-3))
        : Math.min(1, envelope + delta / Math.max(preset.attack, 1e-3))
      const strength = (options.strength?.() ?? 1) * intensity
      const k = envelope * strength
      for (const face of preset.face) {
        const name = resolveExpression(vrm, face.names)
        if (!name)
          continue
        const wave = face.wave ? face.wave.amplitude * Math.sin(time * Math.PI * 2 * face.wave.hz) : 0
        target.set(name, Math.max(target.get(name) ?? 0, Math.min(1, Math.max(0, (face.weight + wave) * k))))
      }
      if (preset.body) {
        const raw = preset.body(time, strength)
        for (const [bone, rotation] of Object.entries(raw) as [VRMHumanBoneName, readonly [number, number, number]][])
          body[bone] = [rotation[0] * envelope, rotation[1] * envelope, rotation[2] * envelope]
      }
      if (releasing && envelope <= 0) {
        preset = undefined
        presetName = undefined
      }
    }

    // Blend every expression this controller has touched toward its target, so switching
    // emotions crossfades instead of popping, and an emotion that ends leaves nothing behind.
    for (const name of new Set([...written.keys(), ...target.keys()])) {
      if (frame.skipVisemes && VISEMES.has(name.toLowerCase()))
        continue
      const next = damp(written.get(name) ?? 0, target.get(name) ?? 0, 12, delta)
      if (next < 0.002 && !target.has(name)) {
        expressionManager?.setValue(name, 0)
        written.delete(name)
        continue
      }
      expressionManager?.setValue(name, next)
      written.set(name, next)
    }

    isEmoteActive.value = Boolean(preset?.coversEyes && envelope > 0.05)
  }

  /** Same signature as the old emote controller, so callers keep working. */
  function setEmotionWithResetAfter(name: string, ms: number, value = 1) {
    if (!play(name, value, ms / 1000))
      play('neutral')
  }

  function dispose() {
    preset = undefined
    written.clear()
  }

  return {
    get body() {
      return body
    },
    get current() {
      return presetName
    },
    dispose,
    isEmoteActive,
    play,
    release,
    setEmotionWithResetAfter,
    update,
  }
}

export type VRMEmotionController = ReturnType<typeof useVRMEmotion>
