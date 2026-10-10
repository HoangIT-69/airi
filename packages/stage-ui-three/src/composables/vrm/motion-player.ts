import type { VRMCore } from '@pixiv/three-vrm-core'
import type { AnimationAction, AnimationClip, AnimationMixer, Event } from 'three'

import { LoopOnce, LoopRepeat, VectorKeyframeTrack } from 'three'

import { clipFromVRMAnimation, loadVRMAnimation } from './animation'

export interface VRMMotionPlayOptions {
  /** Repeat until {@link VRMMotionPlayer.stop}. Defaults to false. */
  loop?: boolean
  /** Seconds to blend from the current motion. */
  fadeIn?: number
  /** Seconds to blend back to idle when the motion ends. */
  fadeOut?: number
  /**
   * Keep the hips over the same floor spot. Defaults to true, because a desktop character
   * that walks away leaves its window.
   */
  inPlace?: boolean
  /**
   * Drop expression and look-at tracks, so the emotion, blink and gaze controllers keep
   * the face. Defaults to true.
   */
  bonesOnly?: boolean
  timeScale?: number
}

export interface VRMMotionPlayer {
  /** Resolves when the motion has finished and blended back to idle, or was replaced. */
  play: (url: string, options?: VRMMotionPlayOptions) => Promise<void>
  stop: (fadeOut?: number) => void
  /** True while a motion other than idle has weight. */
  readonly isPlaying: boolean
  dispose: () => void
}

/**
 * Removes the hips offset between the clip and the rest pose, and optionally the horizontal travel.
 * Unlike `reAnchorRootPositionTrack`, this reads the rest pose, so it works while idle is playing.
 */
function anchorToRestPose(clip: AnimationClip, vrm: VRMCore, inPlace: boolean) {
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips')
  const rest = vrm.humanoid?.normalizedRestPose.hips?.position
  if (!hips || !rest)
    return
  const hipsTrack = clip.tracks.find(track => track instanceof VectorKeyframeTrack && track.name === `${hips.name}.position`)
  if (!hipsTrack)
    return
  const dx = hipsTrack.values[0] - rest[0]
  const dy = hipsTrack.values[1] - rest[1]
  const dz = hipsTrack.values[2] - rest[2]
  for (const track of clip.tracks) {
    if (!(track instanceof VectorKeyframeTrack) || !track.name.endsWith('.position'))
      continue
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] -= dx
      track.values[i + 1] -= dy
      track.values[i + 2] -= dz
      if (inPlace && track === hipsTrack) {
        track.values[i] = rest[0]
        track.values[i + 2] = rest[2]
      }
    }
  }
}

function keepBoneTracks(clip: AnimationClip, vrm: VRMCore) {
  const boneNames = new Set<string>()
  for (const node of Object.values(vrm.humanoid?.normalizedHumanBones ?? {})) {
    if (node?.node.name)
      boneNames.add(node.node.name)
  }
  clip.tracks = clip.tracks.filter(track => boneNames.has(track.name.slice(0, track.name.lastIndexOf('.'))))
  return clip
}

/**
 * Copies idle tracks for bones the motion leaves out.
 *
 * While idle fades out, the mixer blends any bone without a motion track toward the bind
 * pose, so a head-only motion would lift the arms into a T-pose. Borrowing the idle track
 * keeps those bones on the idle animation instead.
 */
function fillMissingBoneTracks(clip: AnimationClip, idleClip: AnimationClip, vrm: VRMCore) {
  const boneNames = new Set<string>()
  for (const node of Object.values(vrm.humanoid?.normalizedHumanBones ?? {})) {
    if (node?.node.name)
      boneNames.add(node.node.name)
  }
  const present = new Set(clip.tracks.map(track => track.name))
  for (const track of idleClip.tracks) {
    const target = track.name.slice(0, track.name.lastIndexOf('.'))
    if (boneNames.has(target) && !present.has(track.name))
      clip.tracks.push(track.clone())
  }
}

/**
 * Plays VRMA files over the idle loop with cross-fades, then returns to idle.
 *
 * Expects:
 * - `idleAction` is already playing on `mixer`.
 */
export function createVRMMotionPlayer(vrm: VRMCore, mixer: AnimationMixer, idleAction: AnimationAction): VRMMotionPlayer {
  const clips = new Map<string, Promise<AnimationClip | undefined>>()
  let current: AnimationAction | undefined
  let currentFadeOut = 0.5
  let resolveCurrent: (() => void) | undefined
  let disposed = false

  function settle() {
    const resolve = resolveCurrent
    resolveCurrent = undefined
    resolve?.()
  }

  function loadClip(url: string, options: Required<Pick<VRMMotionPlayOptions, 'bonesOnly' | 'inPlace'>>) {
    const key = `${url}#${options.bonesOnly ? 'b' : 'f'}${options.inPlace ? 'p' : 'm'}`
    let pending = clips.get(key)
    if (!pending) {
      pending = loadVRMAnimation(url)
        .then(animation => clipFromVRMAnimation(vrm, animation))
        .then((clip) => {
          if (!clip)
            return undefined
          if (options.bonesOnly)
            keepBoneTracks(clip, vrm)
          anchorToRestPose(clip, vrm, options.inPlace)
          fillMissingBoneTracks(clip, idleAction.getClip(), vrm)
          clip.name = url
          return clip
        })
      // A failed load should not stay cached, so the next request retries.
      pending.catch(() => clips.delete(key))
      clips.set(key, pending)
    }
    return pending
  }

  function returnToIdle(fadeOut: number) {
    const finished = current
    current = undefined
    idleAction.enabled = true
    idleAction.setEffectiveTimeScale(1)
    idleAction.fadeIn(fadeOut)
    finished?.fadeOut(fadeOut)
    settle()
  }

  function onFinished(event: Event & { action?: AnimationAction }) {
    if (event.action && event.action === current)
      returnToIdle(currentFadeOut)
  }
  mixer.addEventListener('finished', onFinished as never)

  async function play(url: string, options: VRMMotionPlayOptions = {}) {
    const fadeIn = options.fadeIn ?? 0.4
    const clip = await loadClip(url, { bonesOnly: options.bonesOnly ?? true, inPlace: options.inPlace ?? true })
    if (disposed)
      return
    if (!clip)
      throw new Error(`No VRM animation in ${url}`)

    const action = mixer.clipAction(clip)
    const from = current ?? idleAction
    settle()

    action.reset()
    action.setLoop(options.loop ? LoopRepeat : LoopOnce, Infinity)
    action.clampWhenFinished = true
    action.setEffectiveTimeScale(options.timeScale ?? 1)
    action.setEffectiveWeight(1)
    action.enabled = true
    if (from !== action) {
      action.fadeIn(fadeIn)
      from.fadeOut(fadeIn)
    }
    action.play()
    current = action
    currentFadeOut = options.fadeOut ?? 0.5

    return new Promise<void>((resolve) => {
      resolveCurrent = resolve
    })
  }

  function stop(fadeOut = 0.5) {
    if (current)
      returnToIdle(fadeOut)
  }

  function dispose() {
    disposed = true
    mixer.removeEventListener('finished', onFinished as never)
    settle()
    for (const pending of clips.values()) {
      void pending.then((clip) => {
        if (clip)
          mixer.uncacheClip(clip)
      }).catch(() => {})
    }
    clips.clear()
  }

  return {
    play,
    stop,
    get isPlaying() {
      return Boolean(current)
    },
    dispose,
  }
}
