import { describe, expect, it, vi } from 'vitest'

import { defaultsForMotionFile, toMotionName } from './vrm-motions'

vi.mock('localforage', () => ({ default: { createInstance: () => ({}) } }))

describe('vrm motion library helpers', () => {
  it('fills the VRoid pack defaults from the file name', () => {
    expect(defaultsForMotionFile('VRMA_03.vrma')).toMatchObject({ name: 'peace-sign', description: 'Cheerful peace sign' })
    expect(defaultsForMotionFile('VRMA_07_squat.vrma').name).toBe('squat')
  })

  it('makes a usable name for other files', () => {
    expect(defaultsForMotionFile('Chào Hỏi (1).VRMA').name).toBe('chao-hoi-1')
    expect(toMotionName('  Đi bộ nhanh ')).toBe('di-bo-nhanh')
  })
})
