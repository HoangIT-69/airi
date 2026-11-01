import { describe, expect, it } from 'vitest'

import { arcanaModelUrl } from './custom-presets'

describe('custom display model presets', () => {
  it('serves the texture-reduced Arcana to touch devices', () => {
    expect(arcanaModelUrl(true)).toBe('/remote-assets/models/arcana/Arcana.mobile.vrm')
  })

  it('serves the full Arcana to pointer devices', () => {
    expect(arcanaModelUrl(false)).toBe('/remote-assets/models/arcana/Arcana.vrm')
  })
})
