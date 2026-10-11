import type { Rectangle } from 'electron'

/**
 * Moves `bounds` the least distance that puts it inside `workArea`, shrinking it first
 * when it is larger than the work area.
 */
export function keepInsideWorkArea(bounds: Rectangle, workArea: Rectangle): Rectangle {
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))
  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  }
}
