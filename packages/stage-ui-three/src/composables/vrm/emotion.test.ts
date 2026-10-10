import type { VRMCore } from '@pixiv/three-vrm-core'

import { describe, expect, it } from 'vitest'

import { useVRMEmotion } from './emotion'

/** A model with VRM 0.x style expressions: no `surprised`. */
function createVrm(names: string[]) {
  const values = new Map<string, number>()
  const vrm = {
    expressionManager: {
      expressionMap: Object.fromEntries(names.map(name => [name, {}])),
      setValue: (name: string, value: number) => values.set(name, value),
      getValue: (name: string) => values.get(name) ?? 0,
    },
  } as unknown as VRMCore
  return { vrm, values }
}

function run(emotion: ReturnType<typeof useVRMEmotion>, seconds: number, options?: { skipVisemes?: boolean }) {
  for (let t = 0; t < seconds; t += 1 / 60)
    emotion.update(1 / 60, options)
}

describe('useVRMEmotion', () => {
  it('shows the face and moves the head, then clears everything when it ends', () => {
    const { vrm, values } = createVrm(['happy', 'aa', 'oh', 'sad'])
    const emotion = useVRMEmotion(vrm)

    emotion.play('laugh', 1)
    run(emotion, 1)
    expect(values.get('happy')).toBeGreaterThan(0.8)
    expect(Math.abs(emotion.body.head?.[0] ?? 0)).toBeGreaterThan(1)
    expect(emotion.isEmoteActive.value).toBe(true)

    run(emotion, 6)
    expect(values.get('happy')).toBe(0)
    expect(values.get('aa')).toBe(0)
    expect(emotion.current).toBeUndefined()
    expect(emotion.body).toEqual({})
  })

  it('falls back to an open mouth on models without a surprised expression', () => {
    const { vrm, values } = createVrm(['happy', 'oh'])
    const emotion = useVRMEmotion(vrm)

    emotion.play('surprised', 1)
    run(emotion, 0.5)

    expect(values.get('oh')).toBeGreaterThan(0.3)
    expect(values.has('surprised')).toBe(false)
  })

  it('crossfades between emotions and leaves the mouth to lip sync while speaking', () => {
    const { vrm, values } = createVrm(['happy', 'sad', 'aa'])
    const emotion = useVRMEmotion(vrm)

    emotion.play('happy', 1)
    run(emotion, 1)
    values.set('aa', 0.42)
    emotion.play('sad', 1)
    run(emotion, 2, { skipVisemes: true })

    expect(values.get('sad')).toBeGreaterThan(0.6)
    expect(values.get('happy')).toBeLessThan(0.01)
    expect(values.get('aa')).toBe(0.42)
  })

  it('scales with the strength setting', () => {
    const { vrm, values } = createVrm(['sad'])
    const emotion = useVRMEmotion(vrm, { strength: () => 0.5 })

    emotion.play('sad', 1)
    run(emotion, 2)

    expect(values.get('sad')).toBeCloseTo(0.4, 1)
  })
})
