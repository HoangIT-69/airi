export type TextLipSyncVowel = 'A' | 'E' | 'I' | 'O' | 'U'

export const TEXT_LIP_SYNC_VOWELS: readonly TextLipSyncVowel[] = ['A', 'E', 'I', 'O', 'U']

interface Beat {
  /** Mouth vowel shape, or `undefined` to keep the previous shape. */
  vowel?: TextLipSyncVowel
  /** Target opening, 0..1. */
  open: number
  /** Seconds at normal speaking speed. */
  duration: number
}

const VOWEL_OPEN: Record<TextLipSyncVowel, number> = { A: 1, O: 0.85, E: 0.7, U: 0.55, I: 0.5 }
const LATIN_VOWEL: Record<string, TextLipSyncVowel> = { a: 'A', e: 'E', i: 'I', y: 'I', o: 'O', u: 'U' }
const CJK_VOWELS: TextLipSyncVowel[] = ['A', 'O', 'E', 'A', 'U', 'I']
const PAUSE_SECONDS: Record<string, number> = { ',': 0.16, '、': 0.16, '，': 0.16, ';': 0.2, ':': 0.2, '.': 0.3, '!': 0.3, '?': 0.3, '。': 0.3, '！': 0.3, '？': 0.3, '…': 0.35, '\n': 0.3 }
/** Han, kana and hangul each read as one syllable. */
const SYLLABIC = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/** Backlog, in seconds, past which speech speeds up to catch up with the text. */
const CATCH_UP_AFTER_S = 1.5
const MAX_SPEED = 4
/** How fast the mouth follows its target; higher is snappier. */
const MOUTH_RESPONSE = 22
/** Seconds without new text after which the reply counts as over, even if `finish()` never came. */
const SILENCE_ENDS_AFTER_S = 2

/**
 * Splits reply text into mouth beats: vowels open, consonants half close,
 * spaces nearly close and punctuation closes for a pause.
 */
export function textToMouthBeats(text: string): Beat[] {
  const beats: Beat[] = []
  // Strip diacritics so accented vowels (Vietnamese, French...) read as their base vowel.
  for (const char of text.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').toLowerCase()) {
    const pause = PAUSE_SECONDS[char]
    if (pause != null) {
      beats.push({ open: 0, duration: pause })
    }
    else if (/\s/.test(char)) {
      beats.push({ open: 0.05, duration: 0.05 })
    }
    else if (SYLLABIC.test(char)) {
      const vowel = CJK_VOWELS[char.codePointAt(0)! % CJK_VOWELS.length]
      beats.push({ vowel, open: VOWEL_OPEN[vowel], duration: 0.1 }, { open: 0.1, duration: 0.07 })
    }
    else if (LATIN_VOWEL[char]) {
      const vowel = LATIN_VOWEL[char]
      beats.push({ vowel, open: VOWEL_OPEN[vowel], duration: 0.08 })
    }
    else if (/\d/.test(char)) {
      beats.push({ vowel: 'A', open: 0.8, duration: 0.1 }, { open: 0.1, duration: 0.06 })
    }
    else if (LETTER_OR_DIGIT.test(char)) {
      beats.push({ open: 0.15, duration: 0.05 })
    }
    // Markdown marks, emoji and other symbols are not spoken.
  }
  return beats
}

/**
 * Moves a mouth from streamed reply text when there is no voice to analyse.
 *
 * Use when:
 * - A reply streams with speech output off or unavailable, and the avatar
 *   should still look like it is talking.
 *
 * Expects:
 * - `push()` for each streamed text chunk, `finish()` when the reply ends, and
 *   `update()` once per frame.
 *
 * Returns:
 * - A driver whose `weights` are smoothed per-vowel mouth weights (0..1) and
 *   `open` their maximum. `talking` holds from the first text until the last
 *   beat after `finish()` has played.
 */
export function createTextLipSync() {
  const queue: Beat[] = []
  let queuedSeconds = 0
  let current: Beat | undefined
  let remaining = 0
  /** The current beat's opening, varied a little per beat so syllables differ. */
  let target = 0
  let vowel: TextLipSyncVowel = 'A'
  let started = false
  let finished = false
  /** Seconds since the last beat played out. */
  let silentSeconds = 0
  const weights: Record<TextLipSyncVowel, number> = { A: 0, E: 0, I: 0, O: 0, U: 0 }
  const state = { weights, open: 0, talking: false }

  function push(text: string) {
    const beats = textToMouthBeats(text)
    if (!beats.length)
      return
    started = true
    finished = false
    silentSeconds = 0
    queue.push(...beats)
    for (const beat of beats)
      queuedSeconds += beat.duration
    state.talking = true
  }

  function finish() {
    finished = true
  }

  function reset() {
    queue.length = 0
    queuedSeconds = 0
    current = undefined
    remaining = 0
    started = false
    finished = false
    silentSeconds = 0
    state.talking = false
    state.open = 0
    for (const key of TEXT_LIP_SYNC_VOWELS)
      weights[key] = 0
  }

  function update(deltaSeconds: number) {
    // Replies stream faster than speech, so a long backlog plays faster.
    const speed = Math.min(MAX_SPEED, 1 + Math.max(0, queuedSeconds - CATCH_UP_AFTER_S) / CATCH_UP_AFTER_S)
    let step = deltaSeconds * speed
    while (step > 0) {
      if (remaining <= 0) {
        current = queue.shift()
        if (!current)
          break
        queuedSeconds = Math.max(0, queuedSeconds - current.duration)
        remaining = current.duration
        target = current.open * (0.85 + 0.15 * Math.random())
        if (current.vowel)
          vowel = current.vowel
      }
      const used = Math.min(step, remaining)
      remaining -= used
      step -= used
    }
    if (remaining <= 0 && !queue.length)
      current = undefined
    silentSeconds = current ? 0 : silentSeconds + deltaSeconds
    // A canceled reply may never call finish(); a long silence ends it too.
    if (silentSeconds > SILENCE_ENDS_AFTER_S)
      finished = true

    if (!current)
      target = 0
    const blend = 1 - Math.exp(-deltaSeconds * MOUTH_RESPONSE)
    let open = 0
    for (const key of TEXT_LIP_SYNC_VOWELS) {
      weights[key] += ((key === vowel ? target : 0) - weights[key]) * blend
      if (weights[key] < 0.001)
        weights[key] = 0
      open = Math.max(open, weights[key])
    }
    state.open = open
    state.talking = started && (!finished || !!current || queue.length > 0 || open > 0.01)
    if (finished && !state.talking)
      started = false
    return state
  }

  return { state, push, finish, reset, update }
}

export type TextLipSync = ReturnType<typeof createTextLipSync>
