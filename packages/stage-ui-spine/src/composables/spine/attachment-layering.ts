/** The parts of a Spine runtime this module reads. Duck-typed, so the 4.0, 4.1 and 4.2 runtimes all fit. */
interface LayeringAnimation {
  name: string
  timelines: object[]
}

interface LayeringSlot {
  data: { attachmentName: string | null }
  setAttachment: (attachment: never) => void
}

interface LayeringSkeleton {
  slots: LayeringSlot[]
  getAttachment: (slotIndex: number, attachmentName: string) => unknown
}

interface LayeringTrack {
  animation: LayeringAnimation | null
}

interface LayeringState {
  tracks: (LayeringTrack | null)[]
}

/** Spine names the placeholder animation of `setEmptyAnimation` like this. */
const EMPTY_ANIMATION = '<empty>'

/** Slot indices whose attachment an animation keys. */
export function attachmentSlots(animation: LayeringAnimation): Set<number> {
  const slots = new Set<number>()
  for (const timeline of animation.timelines) {
    // Only attachment timelines carry `attachmentNames`, in every runtime version.
    if ('attachmentNames' in timeline && 'slotIndex' in timeline && typeof timeline.slotIndex === 'number')
      slots.add(timeline.slotIndex)
  }
  return slots
}

/**
 * Keeps one face on screen when an expression plays over an idle that also swaps face parts.
 *
 * NIKKE rigs draw each expression's eyes, brows and cheeks in their own slots. `think2` on the
 * idle track shows `l_eye_think2`. `sleep` on the expression track hides `l_eye_idle` and shows
 * `l_eye_sleep`, but never keys `l_eye_think2`, so Spine leaves both eyes visible. After
 * `AnimationState.apply()`, this puts slots that only the lower track keys back to the setup
 * attachment while an upper track plays a real animation, as if the idle had not swapped them.
 */
export function createAttachmentLayering() {
  const slotCache = new WeakMap<LayeringAnimation, Set<number>>()
  const conflictCache = new Map<string, number[]>()

  function slotsOf(animation: LayeringAnimation) {
    let slots = slotCache.get(animation)
    if (!slots) {
      slots = attachmentSlots(animation)
      slotCache.set(animation, slots)
    }
    return slots
  }

  /** Slots the lower animation keys and the upper one leaves alone. */
  function conflicts(lower: LayeringAnimation, upper: LayeringAnimation) {
    const key = `${lower.name}\u0000${upper.name}`
    let slots = conflictCache.get(key)
    if (!slots) {
      const upperSlots = slotsOf(upper)
      slots = [...slotsOf(lower)].filter(slot => !upperSlots.has(slot))
      conflictCache.set(key, slots)
    }
    return slots
  }

  /**
   * Runs after `AnimationState.apply()`.
   *
   * @param skeleton - The posed skeleton.
   * @param state - The animation state that just posed it.
   * @param lowerTrack - The idle track.
   * @param upperTracks - Expression tracks that own the face while they play.
   */
  function apply(skeleton: LayeringSkeleton, state: LayeringState, lowerTrack: number, upperTracks: number[]) {
    const lower = state.tracks[lowerTrack]?.animation
    if (!lower || lower.name === EMPTY_ANIMATION)
      return
    for (const track of upperTracks) {
      const upper = state.tracks[track]?.animation
      if (!upper || upper.name === EMPTY_ANIMATION)
        continue
      for (const slotIndex of conflicts(lower, upper)) {
        const slot = skeleton.slots[slotIndex]
        if (!slot)
          continue
        const name = slot.data.attachmentName
        slot.setAttachment((name ? skeleton.getAttachment(slotIndex, name) : null) as never)
      }
    }
  }

  return { apply }
}
