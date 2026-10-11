import type { VRMCore } from '@pixiv/three-vrm-core'
import type { Object3D } from 'three'

import { CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Sprite, SpriteMaterial, SRGBColorSpace } from 'three'

import { isVRM0 } from './pose'

/**
 * Where the overlay sits on one model, in meters in the head's own frame. Saved per model,
 * because every face has its own size and head bone position.
 */
export interface VRMEffectsCalibration {
  /** Moves every decoration: x to the model's left, y up, z forward. */
  offset: readonly [number, number, number]
  /** Scales every decoration. */
  scale: number
  /** Blush sits on the skin, so it has its own placement. */
  blush: { spread: number, height: number, depth: number }
}

export const DEFAULT_VRM_EFFECTS_CALIBRATION: VRMEffectsCalibration = {
  offset: [0, 0, 0],
  scale: 1,
  blush: { spread: 0.034, height: 0.035, depth: 0.082 },
}

/** Decorations an emotion preset can name in `effects`. */
export const VRM_EFFECT_NAMES = ['blush', 'anger', 'sweat', 'question', 'exclaim', 'dots', 'sparkle', 'tear'] as const
export type VRMEffectName = typeof VRM_EFFECT_NAMES[number]

/** One drawn piece of an effect, placed in the head's frame before calibration. */
export interface VRMEffectPiece {
  effect: VRMEffectName
  /** x to the model's left, y up, z forward, in meters. */
  position: readonly [number, number, number]
  size: number
  /** Flat on the face instead of turned toward the camera. */
  onSkin?: boolean
}

/** Default layout, for a head about 0.2 m tall with the head bone near the jaw. */
const LAYOUT: readonly VRMEffectPiece[] = [
  { effect: 'anger', position: [0.075, 0.14, 0.03], size: 0.055 },
  { effect: 'sweat', position: [-0.085, 0.1, 0.02], size: 0.04 },
  { effect: 'question', position: [0.08, 0.21, 0], size: 0.07 },
  { effect: 'exclaim', position: [0.08, 0.21, 0], size: 0.07 },
  { effect: 'dots', position: [0.06, 0.2, 0.02], size: 0.07 },
  { effect: 'sparkle', position: [0.095, 0.15, 0.02], size: 0.035 },
  { effect: 'sparkle', position: [-0.09, 0.18, 0.01], size: 0.028 },
  { effect: 'tear', position: [0.03, 0.05, 0.088], size: 0.018 },
  { effect: 'tear', position: [-0.03, 0.05, 0.088], size: 0.018 },
]

/**
 * Where each piece goes on this model, in the head's local frame.
 * VRM 0.x heads face -Z in their local frame, so x and z flip.
 */
export function layoutVRMEffects(calibration: VRMEffectsCalibration, vrm0: boolean): VRMEffectPiece[] {
  const { offset, scale, blush } = calibration
  const flip = vrm0 ? -1 : 1
  const pieces: VRMEffectPiece[] = [
    { effect: 'blush', position: [blush.spread, blush.height, blush.depth], size: 0.034, onSkin: true },
    { effect: 'blush', position: [-blush.spread, blush.height, blush.depth], size: 0.034, onSkin: true },
    ...LAYOUT.map(piece => ({
      ...piece,
      position: [piece.position[0] * scale + offset[0], piece.position[1] * scale + offset[1], piece.position[2] * scale + offset[2]] as const,
      size: piece.size * scale,
    })),
  ]
  return pieces.map(piece => ({ ...piece, position: [piece.position[0] * flip, piece.position[1], piece.position[2] * flip] as const }))
}

/** Draws one effect onto a canvas. Stand-ins until real art is imported. */
function drawEffect(effect: VRMEffectName, ctx: CanvasRenderingContext2D, size: number) {
  const c = size / 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  switch (effect) {
    case 'blush': {
      const gradient = ctx.createRadialGradient(c, c, 0, c, c, c)
      gradient.addColorStop(0, 'rgba(255, 105, 130, 0.65)')
      gradient.addColorStop(0.6, 'rgba(255, 120, 140, 0.3)')
      gradient.addColorStop(1, 'rgba(255, 130, 150, 0)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.ellipse(c, c, c, c * 0.62, 0, 0, Math.PI * 2)
      ctx.fill()
      // Three short hatch lines, the anime blush mark.
      ctx.strokeStyle = 'rgba(230, 70, 100, 0.55)'
      ctx.lineWidth = size * 0.035
      for (const dx of [-0.22, 0, 0.22]) {
        ctx.beginPath()
        ctx.moveTo(c + (dx - 0.06) * size, c + 0.08 * size)
        ctx.lineTo(c + (dx + 0.06) * size, c - 0.08 * size)
        ctx.stroke()
      }
      break
    }
    case 'anger': {
      // Four bulging arcs around a gap: the cross-popping vein mark.
      ctx.strokeStyle = '#e8283c'
      ctx.lineWidth = size * 0.1
      for (let i = 0; i < 4; i++) {
        ctx.save()
        ctx.translate(c, c)
        ctx.rotate((i * Math.PI) / 2)
        ctx.beginPath()
        ctx.moveTo(size * 0.1, -size * 0.36)
        ctx.quadraticCurveTo(size * 0.12, -size * 0.12, size * 0.36, -size * 0.1)
        ctx.stroke()
        ctx.restore()
      }
      break
    }
    case 'sweat':
    case 'tear': {
      ctx.fillStyle = effect === 'sweat' ? 'rgba(120, 190, 255, 0.95)' : 'rgba(140, 200, 255, 0.9)'
      ctx.strokeStyle = 'rgba(40, 110, 200, 0.9)'
      ctx.lineWidth = size * 0.05
      ctx.beginPath()
      ctx.moveTo(c, size * 0.1)
      ctx.bezierCurveTo(c + size * 0.32, size * 0.5, c + size * 0.3, size * 0.88, c, size * 0.88)
      ctx.bezierCurveTo(c - size * 0.3, size * 0.88, c - size * 0.32, size * 0.5, c, size * 0.1)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.beginPath()
      ctx.ellipse(c - size * 0.08, size * 0.6, size * 0.05, size * 0.1, -0.4, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'question':
    case 'exclaim':
    case 'dots': {
      const text = effect === 'question' ? '?' : effect === 'exclaim' ? '!' : '...'
      ctx.font = `900 ${size * (effect === 'dots' ? 0.6 : 0.85)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = size * 0.09
      ctx.strokeStyle = '#ffffff'
      ctx.strokeText(text, c, c * (effect === 'dots' ? 0.9 : 1.05))
      ctx.fillStyle = effect === 'exclaim' ? '#ff5a3c' : '#3a3a48'
      ctx.fillText(text, c, c * (effect === 'dots' ? 0.9 : 1.05))
      break
    }
    case 'sparkle': {
      ctx.fillStyle = '#ffe680'
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = size * 0.04
      ctx.beginPath()
      for (let i = 0; i < 8; i++) {
        const radius = i % 2 === 0 ? c * 0.95 : c * 0.22
        const angle = (i * Math.PI) / 4 - Math.PI / 2
        ctx.lineTo(c + Math.cos(angle) * radius, c + Math.sin(angle) * radius)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      break
    }
  }
}

function createTexture(effect: VRMEffectName) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx)
    drawEffect(effect, ctx, size)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

interface EffectNode {
  piece: VRMEffectPiece
  object: Object3D
  material: SpriteMaterial | MeshBasicMaterial
  /** Gives each copy of an effect its own rhythm. */
  seed: number
}

/** How strongly a piece shows over time, for pulsing, bobbing and sliding. */
function animate(node: EffectNode, time: number, weight: number) {
  const { effect, position, size } = node.piece
  const t = time + node.seed
  let opacity = weight
  let scale = size * (0.6 + 0.4 * Math.min(1, weight * 1.5))
  let dy = 0
  switch (effect) {
    case 'anger':
      scale *= 1 + 0.12 * Math.max(0, Math.sin(t * Math.PI * 2 * 2))
      break
    case 'question':
    case 'exclaim':
    case 'dots':
      dy = 0.006 * Math.sin(t * 3)
      break
    case 'sparkle':
      opacity *= 0.5 + 0.5 * Math.sin(t * 5) ** 2
      scale *= 0.8 + 0.2 * Math.sin(t * 5)
      break
    case 'sweat':
      dy = -0.01 * ((t * 0.5) % 1)
      break
    case 'tear': {
      const phase = (t * 0.6) % 1
      dy = -0.04 * phase
      opacity *= 1 - phase
      break
    }
  }
  node.object.position.set(position[0], position[1] + dy, position[2])
  if (node.piece.onSkin)
    node.object.scale.set(size * 1.6, size, 1)
  else
    node.object.scale.set(scale, scale, 1)
  node.material.opacity = opacity
  node.object.visible = opacity > 0.01
}

/**
 * Anime decorations that follow the head: blush on the cheeks, an anger mark, sweat, a question
 * mark. The mouth and eyes stay 3D; nothing here covers them.
 *
 * Use when:
 * - A model has a saved calibration. Without one, {@link setCalibration} gets undefined and
 *   nothing shows, except while the settings page previews the layout.
 */
export function createVRMEmotionEffects() {
  const group = new Group()
  group.name = 'airi-emotion-effects'
  const textures = new Map<VRMEffectName, CanvasTexture>()
  let nodes: EffectNode[] = []
  let vrm: VRMCore | undefined
  let calibration: VRMEffectsCalibration | undefined
  let preview = false
  let time = 0
  const weights = new Map<VRMEffectName, number>()

  function texture(effect: VRMEffectName) {
    let value = textures.get(effect)
    if (!value) {
      value = createTexture(effect)
      textures.set(effect, value)
    }
    return value
  }

  function clearNodes() {
    for (const node of nodes) {
      node.object.removeFromParent()
      node.material.dispose()
      if (node.object instanceof Mesh)
        node.object.geometry.dispose()
    }
    nodes = []
  }

  function rebuild() {
    clearNodes()
    const head = vrm?.humanoid?.getNormalizedBoneNode('head')
    const layout = calibration ?? (preview ? DEFAULT_VRM_EFFECTS_CALIBRATION : undefined)
    if (!vrm || !head || !layout)
      return
    head.add(group)
    layoutVRMEffects(layout, isVRM0(vrm)).forEach((piece, index) => {
      let object: Object3D
      let material: SpriteMaterial | MeshBasicMaterial
      if (piece.onSkin) {
        material = new MeshBasicMaterial({ map: texture(piece.effect), transparent: true, depthWrite: false, side: DoubleSide })
        object = new Mesh(new PlaneGeometry(1, 1), material)
        // A plane faces +Z. VRM 0.x heads face -Z.
        if (isVRM0(vrm!))
          object.rotation.y = Math.PI
      }
      else {
        material = new SpriteMaterial({ map: texture(piece.effect), transparent: true, depthWrite: false })
        object = new Sprite(material)
      }
      object.renderOrder = 10
      object.visible = false
      group.add(object)
      nodes.push({ piece, object, material, seed: index * 1.7 })
    })
  }

  /** Puts the decorations on this model's head. */
  function attach(next: VRMCore | undefined) {
    vrm = next
    rebuild()
  }

  /** The saved placement for this model, or undefined to show nothing. */
  function setCalibration(next: VRMEffectsCalibration | undefined) {
    calibration = next
    rebuild()
  }

  /** Shows every decoration at once, for placing them. */
  function setPreview(next: boolean) {
    preview = next
    rebuild()
  }

  /**
   * @param delta - Seconds since the last frame.
   * @param active - Effects of the emotion on screen, with how far it has blended in.
   */
  function update(delta: number, active: { names: readonly string[], weight: number } | undefined) {
    time += delta
    for (const effect of VRM_EFFECT_NAMES) {
      const goal = preview ? 1 : active?.names.includes(effect) ? active.weight : 0
      const current = weights.get(effect) ?? 0
      weights.set(effect, current + (goal - current) * (1 - Math.exp(-12 * delta)))
    }
    for (const node of nodes)
      animate(node, time, weights.get(node.piece.effect) ?? 0)
  }

  function dispose() {
    clearNodes()
    group.removeFromParent()
    for (const value of textures.values())
      value.dispose()
    textures.clear()
    vrm = undefined
  }

  return { attach, setCalibration, setPreview, update, dispose }
}

export type VRMEmotionEffects = ReturnType<typeof createVRMEmotionEffects>
