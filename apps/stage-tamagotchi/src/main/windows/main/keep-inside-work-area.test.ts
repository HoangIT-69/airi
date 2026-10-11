import { describe, expect, it } from 'vitest'

import { keepInsideWorkArea } from './work-area'

const workArea = { x: 0, y: 0, width: 1536, height: 824 }

describe('keepInsideWorkArea', () => {
  it('leaves a window that already fits alone', () => {
    const bounds = { x: 100, y: 50, width: 480, height: 700 }
    expect(keepInsideWorkArea(bounds, workArea)).toEqual(bounds)
  })

  it('pulls a window dragged past the bottom-right corner back on screen', () => {
    expect(keepInsideWorkArea({ x: 1400, y: 600, width: 480, height: 700 }, workArea))
      .toEqual({ x: 1056, y: 124, width: 480, height: 700 })
  })

  it('shrinks a window taller than the work area so its bottom corner shows', () => {
    expect(keepInsideWorkArea({ x: 471, y: 79, width: 479, height: 1029 }, workArea))
      .toEqual({ x: 471, y: 0, width: 479, height: 824 })
  })
})
