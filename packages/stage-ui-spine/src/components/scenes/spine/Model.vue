<script setup lang="ts">
import type { AnimationState, AssetManager, GLTexture, Skeleton, SpineCanvas, SpineCanvasApp } from '@esotericsoftware/spine-webgl'

import type { SpineAnimationManager, SpineInteraction, SpineSide, SpineTouchRegion } from '../../../composables/spine'
import type { Emotion } from '../../../constants/emotions'
import type { SpineModelVariant } from '../../../utils/spine-zip-loader'

import { coverRect } from '@proj-airi/stage-shared'
import { Mutex } from 'es-toolkit'
import { storeToRefs } from 'pinia'
import { nextTick, onMounted, onUnmounted, ref, toRef, watch } from 'vue'

import { useSpineAnimationManager, useSpineInteraction } from '../../../composables/spine'
import { EMOTION_SpineAnimationName_fallbacks, EMOTION_SpineAnimationName_value, SPINE_EMOTION_TRACK, SPINE_IDLE_TRACK, SpineAnimationName } from '../../../constants/emotions'
import { useSpine } from '../../../stores/spine'
import { loadSpineRuntime } from '../../../utils/spine-runtime'
import { detectSpineVersionFromBinary, detectSpineVersionFromJson } from '../../../utils/spine-version'
import { loadSpineZip } from '../../../utils/spine-zip-loader'

const props = withDefaults(defineProps<{
  /**
   * Scene painted behind the model, inside this canvas rather than under it, so one
   * readback answers for the whole stage.
   */
  backgroundUrl?: string | null
  modelSrc?: string
  modelId?: string
  canvas?: HTMLCanvasElement
  width: number
  height: number
  resolution?: number
  paused?: boolean
  premultipliedAlpha?: boolean
  defaultMixDuration?: number
  idleAnimationEnabled?: boolean
  maxFps?: number
  /** Cursor in window client coordinates; the face follows it when the rig has a look bone. */
  cursorPosition?: { x: number, y: number }
  /** Loops the rig's talk animation on its own track while speech plays. */
  nowSpeaking?: boolean
  /** Wheel zoom, drag to move and poke reactions on the canvas. */
  interactive?: boolean
}>(), {
  paused: false,
  resolution: 1,
  premultipliedAlpha: true,
  defaultMixDuration: 0.2,
  idleAnimationEnabled: true,
  maxFps: 0,
  nowSpeaking: false,
  interactive: true,
})

const emits = defineEmits<{
  (e: 'modelLoaded'): void
  (e: 'error', error: Error): void
  (e: 'animationsDiscovered', value: { animations: { name: string, duration: number }[], skins: { name: string }[] }): void
  (e: 'poke', region: Exclude<SpineTouchRegion, 'hair'>): void
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

const spineStore = useSpine()
const {
  position,
  scale,
  currentAnimation,
  currentSkin,
  availableAnimations,
  availableSkins,
  availableVariants,
  currentVariant,
  animationSpeed,
  oneShotAnimation,
} = storeToRefs(spineStore)

let isUnmounted = false
const modelLoadMutex = new Mutex()
const modelLoading = ref(false)

// Live runtime objects.
let spineCanvas: SpineCanvas | undefined
let backgroundTexture: GLTexture | undefined
/** The runtime is version-detected per model load; the scene needs it to make a texture. */
let spineRuntime: Awaited<ReturnType<typeof loadSpineRuntime>> | undefined

async function syncBackground() {
  const canvas = spineCanvas
  const url = props.backgroundUrl

  if (!url) {
    backgroundTexture?.dispose()
    backgroundTexture = undefined
    return
  }

  if (!canvas || !spineRuntime)
    return

  // A scene that cannot decode leaves the stage as it is, rather than throwing where
  // nothing is waiting to catch it.
  let image: HTMLImageElement
  try {
    image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image()
      next.onload = () => resolve(next)
      next.onerror = () => reject(new Error(`failed to load ${url}`))
      next.src = url
    })
  }
  catch {
    return
  }

  // A later scene wins, and so does a later canvas: both can be replaced while the
  // image loads.
  if (props.backgroundUrl !== url || spineCanvas !== canvas)
    return

  // Replace only once the new one is ready, so a scene change never shows a gap.
  backgroundTexture?.dispose()
  backgroundTexture = new spineRuntime.GLTexture(canvas.context, image)
}

watch(() => props.backgroundUrl, () => void syncBackground())
let assetCleanup: (() => void) | undefined
let animationManager: SpineAnimationManager | undefined
let interaction: SpineInteraction | undefined
let skeleton: Skeleton | undefined
let animationState: AnimationState | undefined
let loadedVariants: SpineModelVariant[] = []

// Intrinsic model bounds at scale 1 with the root at the origin, captured on
// load and used to auto-fit the skeleton to the canvas. Undefined until a model
// is loaded, or when the setup pose has no renderable bounds.
let modelIntrinsicBounds: { x: number, y: number, width: number, height: number } | undefined

// NOTICE:
// The view is framed by moving the camera, not by scaling the skeleton. Rigs with
// world-space transform constraints and stretchy IK (NIKKE legs) bend wrongly when
// the skeleton itself is scaled, so the skeleton stays at scale 1 and the origin.
let viewCamera = { x: 0, y: 0, zoom: 1 }

// Last time the skeleton was drawn, used to honour `maxFps`. The skeleton
// still advances every frame in `update`; only the GPU draw is throttled.
let lastRenderTime = 0

// Mutable defaults handed to the animation manager. The manager reads these
// fields on every call, so mutating them in place (see the prop watches
// below) propagates live setting changes without rebuilding the manager.
const animationDefaults = {
  mixDuration: props.defaultMixDuration,
  idleAnimationEnabled: props.idleAnimationEnabled,
}

const canvas = toRef(() => props.canvas)
const modelSrc = toRef(() => props.modelSrc)
const paused = toRef(() => props.paused)

function disposeSpine() {
  if (spineCanvas) {
    try {
      spineCanvas.dispose()
    }
    catch (err) {
      console.warn('[Spine] Failed to dispose SpineCanvas:', err)
    }
    spineCanvas = undefined
  }
  // The texture belongs to the disposed canvas's GL context. Keeping it would leave the
  // next canvas drawing a handle registered against a context it does not own.
  backgroundTexture?.dispose()
  backgroundTexture = undefined
  assetCleanup?.()
  assetCleanup = undefined
  animationManager = undefined
  interaction = undefined
  skeleton = undefined
  animationState = undefined
  modelIntrinsicBounds = undefined
  spineStore.isModelLoaded = false
}

async function loadModel() {
  await modelLoadMutex.acquire()

  modelLoading.value = true
  componentState.value = 'loading'

  try {
    if (!canvas.value) {
      modelLoading.value = false
      componentState.value = 'mounted'
      return
    }

    if (!modelSrc.value) {
      console.warn('[Spine] No model source provided')
      disposeSpine()
      modelLoading.value = false
      componentState.value = 'mounted'
      return
    }

    disposeSpine()

    let assetPaths: { skeletonPath: string, atlasPath: string, skeletonFormat: 'binary' | 'json', texturePaths: string[] }
    let pathPrefix = ''
    let blobUrls: Record<string, string> | undefined
    let rawData: Record<string, Uint8Array | string> | undefined

    const isLocalBlob = modelSrc.value.startsWith('blob:')
    if (isLocalBlob || modelSrc.value.endsWith('.zip')) {
      const response = await fetch(modelSrc.value)
      const blob = await response.blob()
      const file = new File([blob], 'model.zip', { type: 'application/zip' })
      const loaded = await loadSpineZip(file)
      loadedVariants = loaded.variants

      // Populate variant store.
      availableVariants.value = loaded.variants.map(v => ({ name: v.name }))
      // Select stored variant or default to first.
      const selectedVariant = loaded.variants.find(v => v.name === currentVariant.value)
        ?? loaded.variants[0]
      if (selectedVariant && currentVariant.value !== selectedVariant.name)
        currentVariant.value = selectedVariant.name

      assetPaths = selectedVariant.layout
      blobUrls = loaded.blobUrls
      rawData = loaded.rawData
      assetCleanup = loaded.dispose
    }
    else {
      // Plain URL case: assume a sibling .skel/.json + .atlas next to the source.
      const baseUrl = new URL(modelSrc.value, window.location.href)
      pathPrefix = baseUrl.href.replace(/\/[^/]+$/, '/')
      const baseName = baseUrl.pathname.replace(/^.*\//, '').replace(/\.(?:json|skel|atlas)(?:\.txt)?$/i, '')
      const skeletonFormat: 'binary' | 'json' = baseUrl.pathname.toLowerCase().endsWith('.json') ? 'json' : 'binary'
      assetPaths = {
        skeletonPath: `${baseName}.${skeletonFormat === 'binary' ? 'skel' : 'json'}`,
        atlasPath: `${baseName}.atlas`,
        skeletonFormat,
        texturePaths: [],
      }
    }

    // Detect version from skeleton data to load the matching runtime.
    let detectedVersion = rawData
      ? (assetPaths.skeletonFormat === 'binary'
          ? detectSpineVersionFromBinary(rawData[assetPaths.skeletonPath] as Uint8Array)
          : detectSpineVersionFromJson(rawData[assetPaths.skeletonPath] as string))
      : undefined
    if (!detectedVersion)
      detectedVersion = '4.2'
    const spine = await loadSpineRuntime(detectedVersion)
    spineRuntime = spine
    console.info(`[Spine] Detected skeleton version: ${detectedVersion}`)

    if (isUnmounted) {
      assetCleanup?.()
      modelLoading.value = false
      componentState.value = 'mounted'
      return
    }

    await new Promise<void>((resolve, reject) => {
      const app: SpineCanvasApp = {
        loadAssets: (sc) => {
          const am = sc.assetManager
          // NOTICE:
          // Patch BEFORE any load calls. SpineCanvas calls loadAssets
          // synchronously in its constructor, and am.loadBinary/loadJson/
          // loadTextureAtlas immediately dispatch XHRs. The downloader
          // checks rawDataUris at dispatch time — if we patch after the
          // constructor returns, requests already hit the dev server.
          if (blobUrls)
            patchAssetManagerForZipAssets(am, blobUrls, rawData!, assetPaths.texturePaths)

          if (assetPaths.skeletonFormat === 'binary')
            am.loadBinary(assetPaths.skeletonPath)
          else
            am.loadJson(assetPaths.skeletonPath)

          am.loadTextureAtlas(assetPaths.atlasPath)
        },
        initialize: (sc) => {
          try {
            const am = sc.assetManager
            const atlas = am.require(assetPaths.atlasPath) as import('@esotericsoftware/spine-webgl').TextureAtlas
            const attachmentLoader = new spine.AtlasAttachmentLoader(atlas)
            const skeletonData = assetPaths.skeletonFormat === 'binary'
              ? new spine.SkeletonBinary(attachmentLoader).readSkeletonData(am.require(assetPaths.skeletonPath) as Uint8Array)
              : new spine.SkeletonJson(attachmentLoader).readSkeletonData(am.require(assetPaths.skeletonPath) as string)

            skeleton = new spine.Skeleton(skeletonData)
            skeleton.setToSetupPose()

            const stateData = new spine.AnimationStateData(skeletonData)
            stateData.defaultMix = props.defaultMixDuration
            animationState = new spine.AnimationState(stateData)

            animationManager = useSpineAnimationManager(animationState, skeleton, animationDefaults)
            interaction = useSpineInteraction(skeleton)

            // Inventory animations and skins, populate the store.
            const animations = skeletonData.animations.map(animation => ({ name: animation.name, duration: animation.duration }))
            const skins = skeletonData.skins.map(s => ({ name: s.name }))
            availableAnimations.value = animations
            availableSkins.value = skins
            emits('animationsDiscovered', { animations, skins })

            // Apply the user's saved skin (if any).
            applySkin(currentSkin.value)

            // Capture the model's intrinsic bounds (scale 1, root at origin)
            // so applyTransformFromStore can auto-fit it to the canvas. Done
            // after the skin is applied because skin selection changes which
            // attachments are visible, and therefore the model's extent.
            skeleton.scaleX = 1
            skeleton.scaleY = 1
            skeleton.x = 0
            skeleton.y = 0
            if (spine.Physics)
              skeleton.updateWorldTransform(spine.Physics.update)
            else
              (skeleton as any).updateWorldTransform()
            const boundsOffset = new spine.Vector2()
            const boundsSize = new spine.Vector2()
            skeleton.getBounds(boundsOffset, boundsSize, [])
            modelIntrinsicBounds = boundsSize.x > 0 && boundsSize.y > 0
              ? { x: boundsOffset.x, y: boundsOffset.y, width: boundsSize.x, height: boundsSize.y }
              : undefined

            applyTransformFromStore()

            // Apply the user's saved idle animation.
            applyCurrentAnimation()

            spineStore.isModelLoaded = true
            emits('modelLoaded')
            resolve()
          }
          catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            reject(error)
          }
        },
        update: (_sc, delta) => {
          if (!skeleton || !animationState)
            return
          if (paused.value) {
            return
          }
          animationState.update(delta * animationSpeed.value)
          interaction?.reset()
          animationState.apply(skeleton)
          // Physics was added in Spine 4.2; older runtimes take no argument.
          const updateWorld = () => spine.Physics
            ? skeleton!.updateWorldTransform(spine.Physics.update)
            : (skeleton as any).updateWorldTransform()
          updateWorld()
          if (interaction && (interaction.hasLook || interaction.hasBust || interaction.hasHair)) {
            interaction.setLookTarget(props.cursorPosition ? clientToWorld(props.cursorPosition.x, props.cursorPosition.y) : undefined)
            interaction.apply(delta, modelIntrinsicBounds?.height ?? 1000)
            updateWorld()
          }
        },
        render: (sc) => {
          if (!skeleton)
            return
          // Cap the draw rate when maxFps > 0. Animation timing stays correct
          // because `update` keeps advancing every frame; we only skip the GPU
          // draw to honour the configured ceiling.
          if (props.maxFps > 0) {
            const now = performance.now()
            if (now - lastRenderTime < 1000 / props.maxFps)
              return
            lastRenderTime = now
          }
          const renderer = sc.renderer
          renderer.resize(spine.ResizeMode.Expand)
          renderer.camera.zoom = viewCamera.zoom
          renderer.camera.position.x = viewCamera.x
          renderer.camera.position.y = viewCamera.y
          renderer.camera.update()
          sc.gl.clearColor(0, 0, 0, 0)
          sc.gl.clear(sc.gl.COLOR_BUFFER_BIT)
          renderer.begin()
          if (backgroundTexture) {
            // The batcher keeps the blend the previous frame's last slot left, so the
            // scene sets its own. drawSkeleton then sets one per slot.
            const batcher = renderer.batcher
            // NOTICE: spine 4.0 takes raw GL factors; 4.1+ takes a BlendMode. The
            // loader types every runtime as 4.2. Both branches set the same blend.
            // Removal condition: when 4.0 support is dropped.
            if (batcher.setBlendMode.length === 3) {
              const setGLBlend = batcher.setBlendMode as unknown as (src: number, srcAlpha: number, dst: number) => void
              setGLBlend.call(batcher, sc.gl.SRC_ALPHA, sc.gl.ONE, sc.gl.ONE_MINUS_SRC_ALPHA)
            }
            else {
              batcher.setBlendMode(spine.BlendMode.Normal, false)
            }
            // The background fills the screen whatever the view, so it is sized in screen
            // pixels and mapped back through the camera's zoom and position.
            const camera = renderer.camera
            const rect = coverRect(
              { width: camera.viewportWidth, height: camera.viewportHeight },
              { width: backgroundTexture.getImage().width, height: backgroundTexture.getImage().height },
            )
            const width = rect.width * camera.zoom
            const height = rect.height * camera.zoom
            renderer.drawTexture(backgroundTexture, camera.position.x - width / 2, camera.position.y - height / 2, width, height)
          }
          renderer.drawSkeleton(skeleton, props.premultipliedAlpha)
          renderer.end()
        },
        error: (_sc, errors: Record<string, string>) => {
          const message = Object.values(errors).join('; ')
          const error = new Error(message)
          reject(error)
        },
      }

      spineCanvas = new spine.SpineCanvas(canvas.value!, {
        app,
        pathPrefix,
        webglConfig: { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true },
      })
      // The scene is already chosen before the runtime is detected, so the watcher
      // below has already fired and found nothing to draw with.
      void syncBackground()
    })
    componentState.value = 'mounted'
  }
  catch (err) {
    console.error('[Spine] Failed to load model:', err)
    emits('error', err instanceof Error ? err : new Error(String(err)))
  }
  finally {
    modelLoading.value = false
    modelLoadMutex.release()
  }
}

/**
 * Patches the AssetManager's Downloader to serve ZIP-extracted assets from
 * memory. Skeleton/atlas data is served directly from `rawData`; texture
 * pages use blob URLs registered in `rawDataUris` for `image.src`.
 *
 * NOTICE:
 * Spine's Downloader.rawDataUris has a broken heuristic: values without "."
 * are decoded as data: URIs via atob(). In Electron, blob URLs are
 * `blob:null/<uuid>` (no dots) → treated as inline data → 400 error.
 * Even with data: URIs, the atob round-trip corrupts multi-byte binary.
 * We bypass rawDataUris entirely for text/binary and monkey-patch the
 * download methods to resolve from the in-memory `rawData` map.
 * Source: spine-core/AssetManagerBase.js Downloader class.
 * Removal condition: Spine ships a Blob/ArrayBuffer-aware asset loader.
 */
function patchAssetManagerForZipAssets(
  assetManager: AssetManager,
  blobUrls: Record<string, string>,
  rawData: Record<string, Uint8Array | string>,
  texturePaths: string[],
) {
  const downloader = (assetManager as unknown as {
    downloader?: {
      rawDataUris: Record<string, string>
      downloadText: (url: string, success: (data: string) => void, error: (status: number, responseText: string) => void) => void
      downloadBinary: (url: string, success: (data: Uint8Array) => void, error: (status: number, response: unknown) => void) => void
    }
  }).downloader
  if (!downloader)
    return

  // Build a lookup keyed by both full path and bare filename.
  const textLookup = new Map<string, string>()
  const binaryLookup = new Map<string, Uint8Array>()
  for (const [path, data] of Object.entries(rawData)) {
    const bare = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
    if (typeof data === 'string') {
      textLookup.set(path, data)
      textLookup.set(bare, data)
    }
    else {
      binaryLookup.set(path, data)
      binaryLookup.set(bare, data)
    }
  }

  const origDownloadText = downloader.downloadText.bind(downloader)
  const origDownloadBinary = downloader.downloadBinary.bind(downloader)

  downloader.downloadText = (url, success, error) => {
    const data = textLookup.get(url)
    if (data !== undefined) {
      queueMicrotask(() => success(data))
      return
    }
    origDownloadText(url, success, error)
  }

  downloader.downloadBinary = (url, success, error) => {
    const data = binaryLookup.get(url)
    if (data !== undefined) {
      queueMicrotask(() => success(data))
      return
    }
    origDownloadBinary(url, success, error)
  }

  // Texture blob URLs → rawDataUris for image.src resolution in loadTexture.
  for (const path of texturePaths) {
    const url = blobUrls[path]
    if (!url)
      continue
    downloader.rawDataUris[path] = url
    const slash = path.lastIndexOf('/')
    if (slash !== -1)
      downloader.rawDataUris[path.slice(slash + 1)] = url
  }
}

/** Auto-fit scale times the user's scale: canvas pixels per skeleton unit. */
function viewScale() {
  if (!canvas.value)
    return scale.value
  // Base scale auto-fits the model's intrinsic bounds into the canvas so tall
  // or oversized rigs are fully visible by default. The user's `scale` setting
  // multiplies on top, so 1 means "fit".
  let baseScale = 1
  if (modelIntrinsicBounds) {
    const margin = 0.9
    const fitScale = Math.min(canvas.value.width / modelIntrinsicBounds.width, canvas.value.height / modelIntrinsicBounds.height) * margin
    if (Number.isFinite(fitScale) && fitScale > 0)
      baseScale = fitScale
  }
  return baseScale * scale.value
}

function boundsCentre() {
  return modelIntrinsicBounds
    ? { x: modelIntrinsicBounds.x + modelIntrinsicBounds.width / 2, y: modelIntrinsicBounds.y + modelIntrinsicBounds.height / 2 }
    : { x: 0, y: 0 }
}

function applyTransformFromStore() {
  if (!canvas.value)
    return

  if (skeleton) {
    skeleton.scaleX = 1
    skeleton.scaleY = 1
    skeleton.x = 0
    skeleton.y = 0
  }

  // Screen centre shows the bounds centre, shifted by the user's offset in
  // canvas pixels (y up).
  const finalScale = viewScale()
  const centre = boundsCentre()
  viewCamera = {
    x: centre.x - position.value.x / finalScale,
    y: centre.y - position.value.y / finalScale,
    zoom: 1 / finalScale,
  }
}

/** Offset from the canvas centre in backing-store pixels, y down. */
function clientToCanvasOffset(clientX: number, clientY: number) {
  const el = canvas.value!
  const rect = el.getBoundingClientRect()
  const ratio = rect.width > 0 ? el.width / rect.width : 1
  return {
    x: (clientX - rect.left - rect.width / 2) * ratio,
    y: (clientY - rect.top - rect.height / 2) * ratio,
    ratio,
  }
}

/** Maps window client coordinates to skeleton world coordinates. */
function clientToWorld(clientX: number, clientY: number) {
  const offset = clientToCanvasOffset(clientX, clientY)
  return { x: viewCamera.x + offset.x * viewCamera.zoom, y: viewCamera.y - offset.y * viewCamera.zoom }
}

const MIN_SCALE = 0.2
const MAX_SCALE = 6

function onWheel(event: WheelEvent) {
  if (!props.interactive || !canvas.value || !skeleton)
    return
  event.preventDefault()
  const anchor = clientToWorld(event.clientX, event.clientY)
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * Math.exp(-event.deltaY * 0.0015)))
  if (next === scale.value)
    return
  scale.value = Number(next.toFixed(3))

  // Keep the point under the cursor fixed while zooming.
  const finalScale = viewScale()
  const offset = clientToCanvasOffset(event.clientX, event.clientY)
  const centre = boundsCentre()
  position.value = {
    x: Math.round((centre.x - (anchor.x - offset.x / finalScale)) * finalScale),
    y: Math.round((centre.y - (anchor.y + offset.y / finalScale)) * finalScale),
  }
  applyTransformFromStore()
}

/**
 * One pointer press on the canvas. What a drag does depends on where it started:
 * hair swings, the crown gets patted, anywhere else moves the model.
 */
let drag: {
  id: number
  x: number
  y: number
  startX: number
  startY: number
  moved: boolean
  touch?: { region: SpineTouchRegion, side?: SpineSide }
  /** Pointer travel over the head so far, in CSS pixels. */
  stroke: number
  patting: boolean
} | undefined
const DRAG_THRESHOLD_PX = 6
/** How far the pointer must rub the head before it counts as a pat. */
const PAT_STROKE_PX = 40
/** Closed-eye smiles first; NIKKE rigs smile with closed eyes in `sleep`. */
const PAT_ANIMATIONS = ['sleep', 'delight', 'smile', 'happy']

function rigSize() {
  return modelIntrinsicBounds?.height ?? 1000
}

function onPointerDown(event: PointerEvent) {
  if (!props.interactive || !event.isPrimary || event.button !== 0 || !skeleton)
    return
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    touch: interaction?.hitTest(clientToWorld(event.clientX, event.clientY), rigSize()),
    stroke: 0,
    patting: false,
  }
  try {
    canvas.value?.setPointerCapture?.(event.pointerId)
  }
  catch {}
}

function startPat() {
  const name = PAT_ANIMATIONS.find(candidate => animationManager?.resolveAnimation(candidate))
  if (name)
    animationManager?.playEmotion(name, { loop: true })
}

/** Reaction for a tap on each region, most fitting name first. */
const TAP_ANIMATIONS: Record<Exclude<SpineTouchRegion, 'hair'>, string[]> = {
  head: ['smile1', 'happy', 'smile'],
  cheek: ['angry', 'pout', 'no'],
  bust: ['shy', 'awkward', 'surprise'],
}

/**
 * Plays the first available reaction once over the idle loop. It mixes in and out
 * slowly, so the body eases into the pose instead of snapping to it.
 */
/**
 * When the running touch reaction ends. Touches before then are ignored: switching
 * reactions mid-blend snaps the pose.
 */
let touchLockedUntil = 0
/** Reaction hold plus its mix out, in milliseconds. */
const TOUCH_LOCK_MS = 3800

function touchLocked() {
  return performance.now() < touchLockedUntil
}

function playTapReaction(candidates: string[]) {
  if (!animationState || !animationManager)
    return
  const name = candidates.map(candidate => animationManager!.resolveAnimation(candidate)).find(Boolean)
  if (!name)
    return
  const entry = animationState.setAnimation(SPINE_EMOTION_TRACK, name, false)
  entry.mixDuration = 0.6
  // Hold the reaction a few seconds, then ease back to idle.
  animationState.addEmptyAnimation(SPINE_EMOTION_TRACK, 0.8, Math.min(entry.animation!.duration, 3))
}

function onPointerMove(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId)
    return
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX)
    return
  drag.moved = true
  const region = drag.touch?.region
  const { ratio } = clientToCanvasOffset(event.clientX, event.clientY)

  if (region === 'hair' && drag.touch?.side) {
    const offset = (event.clientX - drag.startX) * ratio * viewCamera.zoom
    interaction?.dragHair(drag.touch.side, offset, rigSize())
  }
  else if (region === 'head' || region === 'cheek') {
    drag.stroke += Math.hypot(event.clientX - drag.x, event.clientY - drag.y)
    if (!drag.patting && drag.stroke > PAT_STROKE_PX && !touchLocked()) {
      drag.patting = true
      touchLockedUntil = Number.POSITIVE_INFINITY
      startPat()
    }
  }
  else {
    position.value = {
      x: Math.round(position.value.x + (event.clientX - drag.x) * ratio),
      y: Math.round(position.value.y - (event.clientY - drag.y) * ratio),
    }
    applyTransformFromStore()
  }
  drag.x = event.clientX
  drag.y = event.clientY
}

function endDrag(current: NonNullable<typeof drag>) {
  if (current.touch?.region === 'hair' && current.touch.side)
    interaction?.dragHair(current.touch.side, undefined, rigSize())
  if (current.patting) {
    animationManager?.clearEmotion(0.6)
    touchLockedUntil = performance.now() + 800
  }
}

function onPointerUp(event: PointerEvent) {
  const current = drag
  if (!current || current.id !== event.pointerId)
    return
  drag = undefined
  if (canvas.value?.hasPointerCapture?.(event.pointerId))
    canvas.value.releasePointerCapture(event.pointerId)
  endDrag(current)
  if (current.moved || !interaction)
    return

  const region = current.touch?.region
  if (!region || region === 'hair' || touchLocked())
    return
  touchLockedUntil = performance.now() + TOUCH_LOCK_MS
  if (region === 'bust')
    interaction.pokeBust(1.4)
  playTapReaction(TAP_ANIMATIONS[region])
  emits('poke', region)
}

function onPointerCancel(event: PointerEvent) {
  if (drag?.id !== event.pointerId)
    return
  endDrag(drag)
  drag = undefined
}

watch(canvas, (next, prev) => {
  prev?.removeEventListener('wheel', onWheel)
  prev?.removeEventListener('pointerdown', onPointerDown)
  prev?.removeEventListener('pointermove', onPointerMove)
  prev?.removeEventListener('pointerup', onPointerUp)
  prev?.removeEventListener('pointercancel', onPointerCancel)
  next?.addEventListener('wheel', onWheel, { passive: false })
  next?.addEventListener('pointerdown', onPointerDown)
  next?.addEventListener('pointermove', onPointerMove)
  next?.addEventListener('pointerup', onPointerUp)
  next?.addEventListener('pointercancel', onPointerCancel)
}, { immediate: true })

function applyCurrentAnimation() {
  if (!animationManager)
    return
  const desired = currentAnimation.value?.name ?? SpineAnimationName.Idle
  animationManager.setIdle(desired, currentAnimation.value?.loop ?? true)
}

function applySkin(skinName: string) {
  if (!skeleton)
    return

  if (!skinName) {
    skeleton.setSkinByName(skeleton.data.defaultSkin?.name ?? skeleton.data.skins[0]?.name ?? 'default')
    skeleton.setSlotsToSetupPose()
    return
  }

  const skin = skeleton.data.findSkin(skinName)
  if (skin) {
    skeleton.setSkin(skin)
    skeleton.setSlotsToSetupPose()
  }
}

/**
 * Plays an emotion-tagged animation on the dedicated emotion track.
 *
 * Use when:
 * - The chat orchestrator emits an `EmotionPayload`. The Stage component
 *   forwards the emotion name here so the model can react in real time
 *   without disturbing the persistent idle loop on track 0.
 *
 * Expects:
 * - The skeleton has loaded (`componentState === 'mounted'`). The call is
 *   a no-op if invoked before then.
 *
 * Returns:
 * - The resolved animation name when one was found, otherwise `undefined`.
 */
function setEmotion(emotion: Emotion, intensity: number = 1): string | undefined {
  if (!animationManager)
    return undefined
  const animationName = [EMOTION_SpineAnimationName_value[emotion], ...EMOTION_SpineAnimationName_fallbacks[emotion] ?? []]
    .find(name => name && animationManager!.resolveAnimation(name))
  if (!animationName)
    return undefined
  // Intensity scales the emotion track's blend weight so a stronger emotion
  // overrides more of the idle pose. Replies usually carry 0.3 to 0.7, which at
  // face value leaves a half-blended face, so weak emotions still get a 0.6 floor.
  // Clamp to [0, 1]; alpha outside that range is undefined in Spine's track mixing.
  const alpha = 0.6 + 0.4 * Math.min(1, Math.max(0, intensity))
  const entry = animationManager.playEmotion(animationName, { alpha })
  return entry?.animation?.name
}

watch(modelSrc, async () => await loadModel(), { immediate: true })
watch(canvas, async (next, prev) => {
  if (next && next !== prev)
    await loadModel()
})

watch([() => props.width, () => props.height, () => props.resolution, position, scale], async () => {
  // The sibling Canvas component resizes the backing store in its own watcher
  // when width/height/resolution change. Wait a tick so `canvas.width/height`
  // reflect the new size before we recompute the skeleton's centre.
  await nextTick()
  applyTransformFromStore()
}, { deep: true })

watch(currentAnimation, () => {
  applyCurrentAnimation()
}, { deep: true })

watch(oneShotAnimation, (req) => {
  if (req)
    animationManager?.playEmotion(req.name, { loop: req.loop })
})

watch(currentSkin, (skinName) => {
  applySkin(skinName)
})

watch(currentVariant, async () => {
  if (loadedVariants.length > 1)
    await loadModel()
})

watch(() => props.idleAnimationEnabled, (enabled) => {
  animationDefaults.idleAnimationEnabled = enabled
  if (!animationManager || !skeleton || !animationState)
    return
  if (enabled)
    applyCurrentAnimation()
  else
    animationState.setEmptyAnimation(SPINE_IDLE_TRACK, props.defaultMixDuration)
})

watch(() => props.defaultMixDuration, (mix) => {
  animationDefaults.mixDuration = mix
  if (animationState)
    animationState.data.defaultMix = mix
})

// Talk animations only move the mouth, so they loop on a track above emotions.
const SPINE_TALK_TRACK = 2
watch(() => props.nowSpeaking, (speaking) => {
  if (!animationManager || !animationState)
    return
  const name = animationManager.resolveAnimation(speaking ? 'talk_start' : 'talk_end')
  if (speaking && name) {
    animationState.setAnimation(SPINE_TALK_TRACK, name, true)
    return
  }
  if (name)
    animationState.setAnimation(SPINE_TALK_TRACK, name, false)
  animationState.addEmptyAnimation(SPINE_TALK_TRACK, props.defaultMixDuration, 0)
})

watch(paused, () => {
  // SpineCanvas does not expose a built-in pause; we toggle by stopping
  // the update step from advancing time (handled in the update callback).
  // We still let render run so the last frame remains visible.
})

onMounted(async () => {
  // First load is triggered by the immediate watch above when the canvas
  // becomes available.
})

onUnmounted(() => {
  isUnmounted = true
  disposeSpine()
})

defineExpose({
  setEmotion,
  pokeBust: () => interaction?.pokeBust(),
  listAnimations: () => animationManager?.listAnimations() ?? [],
  listSkins: () => availableSkins.value.map(s => s.name),
})

import.meta.hot?.dispose(() => {
  console.warn('[Dev] Reload on HMR dispose is active for this component. Performing a full reload.')
  window.location.reload()
})
</script>

<template>
  <slot />
</template>
