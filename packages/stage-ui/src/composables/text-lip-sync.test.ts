import { describe, expect, it } from 'vitest'

import { createTextLipSync, textToMouthBeats } from './text-lip-sync'

function run(lipSync: ReturnType<typeof createTextLipSync>, seconds: number) {
  let maxOpen = 0
  for (let t = 0; t < seconds; t += 1 / 60)
    maxOpen = Math.max(maxOpen, lipSync.update(1 / 60).open)
  return maxOpen
}

describe('textToMouthBeats', () => {
  it('reads accented vowels as their base vowel', () => {
    expect(textToMouthBeats('ạ').map(beat => beat.vowel)).toEqual(['A'])
    expect(textToMouthBeats('ờ').map(beat => beat.vowel)).toEqual(['O'])
  })

  it('skips markdown marks and emoji', () => {
    expect(textToMouthBeats('**✨**')).toEqual([])
  })

  it('closes the mouth on punctuation', () => {
    expect(textToMouthBeats('.')).toEqual([{ open: 0, duration: 0.3 }])
  })
})

describe('createTextLipSync', () => {
  it('opens the mouth while text plays and stops after the reply ends', () => {
    const lipSync = createTextLipSync()
    lipSync.push('Xin chào bạn')
    expect(lipSync.state.talking).toBe(true)
    expect(run(lipSync, 0.3)).toBeGreaterThan(0.3)

    lipSync.finish()
    run(lipSync, 5)
    expect(lipSync.state.talking).toBe(false)
    expect(lipSync.state.open).toBe(0)
  })

  it('keeps talking between chunks until the reply finishes', () => {
    const lipSync = createTextLipSync()
    lipSync.push('hi')
    run(lipSync, 1)
    expect(lipSync.state.talking).toBe(true)
    expect(lipSync.state.open).toBeLessThan(0.01)
  })

  it('stops after a long silence when the reply never finishes', () => {
    const lipSync = createTextLipSync()
    lipSync.push('hi')
    run(lipSync, 3)
    expect(lipSync.state.talking).toBe(false)
  })

  it('catches up when the reply streams faster than speech', () => {
    const lipSync = createTextLipSync()
    lipSync.push('a'.repeat(400))
    lipSync.finish()
    run(lipSync, 12)
    expect(lipSync.state.talking).toBe(false)
  })
})
