/** One mouth shape of the rig's talk animation, or the idle mouth when nothing is said. */
export type SpineTalkFrame = number | 'rest'

export interface SpineTalkInput {
  speaking: boolean
  /**
   * Mouth openness from audio lip sync or reply text, 0 to 1. Undefined when there is none,
   * then the driver makes up a speech rhythm.
   */
  level?: number
}

export interface SpineTalkDriverOptions {
  /** Number of distinct mouth shapes in the talk animation. */
  frameCount: number
  /** Returns a number in [0, 1). Tests pass a fixed sequence. */
  random?: () => number
}

/** Smoothed level above this opens the mouth, below `CLOSE_LEVEL` closes it. The gap stops flicker. */
const OPEN_LEVEL = 0.14
const CLOSE_LEVEL = 0.07
/** A syllable holds one shape this long, in seconds, before the next shape while the sound goes on. */
const SYLLABLE_MIN_S = 0.13
const SYLLABLE_MAX_S = 0.21
/** The shortest any shape or closed mouth stays, so a flickering level cannot flap the mouth. */
const MIN_SHOWN_S = 0.05
/** Made-up rhythm: shapes per word, and the pause between words. */
const WORD_MIN_SHAPES = 2
const WORD_MAX_SHAPES = 5
const PAUSE_MIN_S = 0.12
const PAUSE_MAX_S = 0.28
/** A level stuck at 0 this long while speaking means the lip sync is not running. */
const SILENT_LEVEL_FALLBACK_S = 1.2

/**
 * Picks the talk animation frame to show each frame, at the pace of real speech.
 *
 * NIKKE talk animations swap mouth shapes every 0.1 s in a fixed loop. Looping that while any
 * speech plays flaps the mouth at 10 Hz with the same pattern every half second. The driver
 * instead holds each shape for one syllable (about 0.13 to 0.21 s), changes shape on each new
 * syllable of the audio level, never repeats a shape twice in a row, and closes the mouth in pauses.
 */
export function createSpineTalkDriver(options: SpineTalkDriverOptions) {
  const random = options.random ?? Math.random
  let frame: SpineTalkFrame = 'rest'
  let hold = 0
  let open = false
  /** Seconds the current frame has been on screen. */
  let shownFor = 0
  let smoothed = 0
  let silentFor = 0
  let shapesLeft = 0

  function between(min: number, max: number) {
    return min + (max - min) * random()
  }

  function nextShape(): number {
    if (options.frameCount <= 1)
      return 0
    const previous = typeof frame === 'number' ? frame : -1
    let next = Math.floor(random() * options.frameCount)
    if (next === previous)
      next = (next + 1 + Math.floor(random() * (options.frameCount - 1))) % options.frameCount
    return next
  }

  function show(next: SpineTalkFrame, seconds: number) {
    frame = next
    hold = seconds
    shownFor = 0
  }

  /** Rhythm without a level: a few shapes, a pause, repeat. */
  function updateMadeUp() {
    if (hold > 0)
      return
    if (frame !== 'rest' && shapesLeft <= 0) {
      show('rest', between(PAUSE_MIN_S, PAUSE_MAX_S))
      return
    }
    if (frame === 'rest')
      shapesLeft = Math.round(between(WORD_MIN_SHAPES, WORD_MAX_SHAPES))
    shapesLeft--
    show(nextShape(), between(SYLLABLE_MIN_S, SYLLABLE_MAX_S))
  }

  function updateFromLevel(level: number, delta: number) {
    // Fast attack, slower release, like a jaw that opens quickly and settles.
    smoothed += (level - smoothed) * (1 - Math.exp(-(level > smoothed ? 45 : 40) * delta))
    const wasOpen = open
    open = open ? smoothed > CLOSE_LEVEL : smoothed > OPEN_LEVEL
    // The voice stopped: close now, once the shape has been seen.
    if (!open) {
      if (frame !== 'rest' && shownFor >= MIN_SHOWN_S)
        show('rest', 0)
      return
    }
    if (!wasOpen && frame === 'rest' && shownFor < MIN_SHOWN_S) {
      // Keep a short pause closed, and try again next frame.
      open = false
      return
    }
    // A new syllable starts a new shape at once. A long vowel moves on after one syllable's time.
    if (!wasOpen || hold <= 0)
      show(nextShape(), between(SYLLABLE_MIN_S, SYLLABLE_MAX_S))
  }

  /** Advances by `delta` seconds and returns the frame to show. */
  function update(delta: number, input: SpineTalkInput): SpineTalkFrame {
    hold -= delta
    shownFor += delta
    if (!input.speaking) {
      frame = 'rest'
      hold = 0
      open = false
      smoothed = 0
      silentFor = 0
      shapesLeft = 0
      return frame
    }
    const level = input.level
    silentFor = level !== undefined && level <= 0 ? silentFor + delta : 0
    if (level === undefined || silentFor > SILENT_LEVEL_FALLBACK_S)
      updateMadeUp()
    else
      updateFromLevel(level, delta)
    return frame
  }

  return { update }
}
