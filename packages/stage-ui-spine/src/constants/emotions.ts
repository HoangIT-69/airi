export enum Emotion {
  Happy = 'happy',
  Sad = 'sad',
  Angry = 'angry',
  Think = 'think',
  Surprise = 'surprised',
  Awkward = 'awkward',
  Question = 'question',
  Curious = 'curious',
  Neutral = 'neutral',
}

export const EMOTION_VALUES = Object.values(Emotion)

/**
 * Default Spine animation track used for the persistent idle/state loop.
 */
export const SPINE_IDLE_TRACK = 0

/**
 * Default Spine animation track used for one-shot emotion overrides.
 *
 * Higher track index renders on top of the idle track, mirroring how the
 * Spine player layers shoot/celebrate animations over the idle skeleton.
 */
export const SPINE_EMOTION_TRACK = 1

/**
 * Common Spine animation names that AIRI maps incoming emotions to.
 *
 * These names follow the Esoteric Software example conventions
 * (idle/walk/run/jump/shoot/death/celebrate). Models that ship custom
 * names can override the mapping at runtime through the settings panel.
 */
export const SpineAnimationName = {
  Idle: 'idle',
  Happy: 'celebrate',
  Sad: 'sad',
  Angry: 'angry',
  Awkward: 'awkward',
  Think: 'think',
  Surprise: 'surprise',
  Question: 'question',
  Curious: 'curious',
  Neutral: 'idle',
} as const

export type SpineAnimationKey = keyof typeof SpineAnimationName

/**
 * Maps an AIRI emotion to a canonical Spine animation name.
 *
 * The actual track name played at runtime falls back to whichever name
 * exists on the loaded skeleton — see useSpineAnimationManager().
 */
export const EMOTION_SpineAnimationName_value: Record<Emotion, string> = {
  [Emotion.Happy]: SpineAnimationName.Happy,
  [Emotion.Sad]: SpineAnimationName.Sad,
  [Emotion.Angry]: SpineAnimationName.Angry,
  [Emotion.Think]: SpineAnimationName.Think,
  [Emotion.Surprise]: SpineAnimationName.Surprise,
  [Emotion.Awkward]: SpineAnimationName.Awkward,
  [Emotion.Question]: SpineAnimationName.Question,
  [Emotion.Neutral]: SpineAnimationName.Neutral,
  [Emotion.Curious]: SpineAnimationName.Curious,
}

/**
 * Animations a chat emotion may play, beyond the canonical name above. Covers
 * models that ship their own naming, such as the NIKKE exports (`happy`,
 * `delight`, `smile1`, `smile2`, `shy`, `no`, `think2`, `special`).
 *
 * One available name is picked at random per emotion, so a reply that repeats
 * an emotion does not replay the same pose. `strong` is used instead of `mild`
 * when the emotion's intensity is high and the model has one of its names.
 * Neutral has no pool: it eases back to the idle loop.
 */
export const EMOTION_SpineAnimationPools: Record<Emotion, { mild: string[], strong?: string[] }> = {
  [Emotion.Happy]: { mild: ['smile1', 'smile2', 'happy', 'smile'], strong: ['delight', 'happy', 'special', 'celebrate'] },
  [Emotion.Sad]: { mild: ['sad', 'cry'] },
  [Emotion.Angry]: { mild: ['no', 'pout', 'angry'], strong: ['angry'] },
  [Emotion.Think]: { mild: ['think2', 'think1', 'think'] },
  [Emotion.Surprise]: { mild: ['surprise', 'surprised'] },
  [Emotion.Awkward]: { mild: ['shy', 'smile2', 'awkward'] },
  [Emotion.Question]: { mild: ['think2', 'think', 'question'] },
  [Emotion.Curious]: { mild: ['surprise', 'think2', 'curious'] },
  [Emotion.Neutral]: { mild: [] },
}

/** Intensity at or above which an emotion plays from its `strong` pool. */
export const SPINE_STRONG_EMOTION_INTENSITY = 0.7
