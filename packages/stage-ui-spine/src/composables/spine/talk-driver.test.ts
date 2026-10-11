import type { SpineTalkFrame } from './talk-driver'

import { describe, expect, it } from 'vitest'

import { createSpineTalkDriver } from './talk-driver'

const FRAME = 1 / 60

/** A repeatable pseudo-random source. */
function seeded(seed = 7) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/** Runs the driver and returns how long each shown frame lasted, in seconds. */
function run(seconds: number, level: (t: number) => number | undefined) {
  const driver = createSpineTalkDriver({ frameCount: 5, random: seeded() })
  const runs: { frame: SpineTalkFrame, seconds: number }[] = []
  for (let t = 0; t < seconds; t += FRAME) {
    const frame = driver.update(FRAME, { speaking: true, level: level(t) })
    const last = runs.at(-1)
    if (last && last.frame === frame)
      last.seconds += FRAME
    else
      runs.push({ frame, seconds: FRAME })
  }
  return runs
}

describe('createSpineTalkDriver', () => {
  it('rests when nothing is said', () => {
    const driver = createSpineTalkDriver({ frameCount: 5 })
    expect(driver.update(FRAME, { speaking: false, level: 1 })).toBe('rest')
  })

  it('changes shape no faster than one syllable on a steady sound', () => {
    const shapes = run(3, () => 0.6).filter(entry => entry.frame !== 'rest')
    // The old loop swapped every 0.1 s, 30 times in 3 s.
    expect(shapes.length).toBeLessThan(25)
    for (const entry of shapes.slice(0, -1))
      expect(entry.seconds).toBeGreaterThanOrEqual(0.12)
  })

  it('never shows the same shape twice in a row', () => {
    const shapes = run(3, () => 0.6).map(entry => entry.frame)
    for (let i = 1; i < shapes.length; i++)
      expect(shapes[i]).not.toBe(shapes[i - 1])
  })

  it('closes the mouth in pauses of the voice', () => {
    // Four syllables a second: 0.15 s of sound, 0.1 s of silence.
    const runs = run(2, t => (t % 0.25 < 0.15 ? 0.7 : 0))
    expect(runs.filter(entry => entry.frame === 'rest').length).toBeGreaterThanOrEqual(5)
  })

  it('makes up a rhythm with pauses when there is no level', () => {
    const runs = run(4, () => undefined)
    const rests = runs.filter(entry => entry.frame === 'rest')
    const shapes = runs.filter(entry => entry.frame !== 'rest')
    expect(rests.length).toBeGreaterThan(2)
    expect(shapes.length).toBeGreaterThan(rests.length)
  })

  it('falls back to a made-up rhythm when the level stays at 0', () => {
    const runs = run(4, () => 0)
    expect(runs.some(entry => entry.frame !== 'rest')).toBe(true)
  })
})
