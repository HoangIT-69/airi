import type { ccv3 } from '@proj-airi/ccc'

import type { DisplayModelURL } from './stores/display-models'
import type { useAiriCardStore } from './stores/modules/airi-card'
import type { AiriExtension } from './types/airiCard'

/**
 * Fork-owned presets for the self-hosted web app. The files are not in this repository: the
 * Cloudflare Worker serves `/remote-assets/*` from R2 on the same origin, so every device gets
 * the same models, poses and card without importing them in each browser.
 */
const REMOTE_ASSETS = '/remote-assets'
/** Newer than the upstream presets, so the custom models sort first. */
const CUSTOM_PRESET_IMPORTED_AT = 1767225600000

export const CUSTOM_DEFAULT_DISPLAY_MODEL_ID = 'preset-vrm-arcana'
export const CUSTOM_CARD_SEED_KEY = 'custom/presets/card-thu-ky-v1'
const CUSTOM_CARD_URL = `${REMOTE_ASSETS}/cards/thu-ky/card.json`

/** Phones and tablets get the texture-reduced Arcana; the full one runs out of GPU memory there. */
export function isTouchDevice() {
  return typeof matchMedia === 'function'
    && matchMedia('(pointer: coarse)').matches
    && typeof navigator !== 'undefined'
    && navigator.maxTouchPoints > 0
}

export function arcanaModelUrl(touch = isTouchDevice()) {
  return `${REMOTE_ASSETS}/models/arcana/${touch ? 'Arcana.mobile.vrm' : 'Arcana.vrm'}`
}

// A type-only import keeps this module out of an import cycle with the display models store.
export const customDisplayModelPresets: DisplayModelURL[] = [
  { id: CUSTOM_DEFAULT_DISPLAY_MODEL_ID, format: 'vrm' as DisplayModelURL['format'], type: 'url', url: arcanaModelUrl(), name: 'Arcana', importedAt: CUSTOM_PRESET_IMPORTED_AT },
  { id: 'preset-spine-c583', format: 'spine-zip' as DisplayModelURL['format'], type: 'url', url: `${REMOTE_ASSETS}/models/c583/c583.zip`, name: 'c583 (NIKKE)', importedAt: CUSTOM_PRESET_IMPORTED_AT },
]

export interface CustomMotionPreset {
  /** Path under `/remote-assets/motions/`. The lowercased file name becomes the pose name. */
  path: string
  /** Omitted for the VRoid pack files, which take their description from the motion store. */
  description?: string
}

export const customMotionPresets: CustomMotionPreset[] = [
  { path: 'Angry.vrma', description: 'Stomps and looks angry' },
  { path: 'Backflip.vrma', description: 'Does a backflip' },
  { path: 'BellyDance.vrma', description: 'Belly dance' },
  { path: 'BlowKiss.vrma', description: 'Blows a kiss' },
  { path: 'Blush.vrma', description: 'Blushes shyly' },
  { path: 'Clapping.vrma', description: 'Claps hands' },
  { path: 'Dance.vrma', description: 'Cheerful dance' },
  { path: 'Goodbye.vrma', description: 'Waves goodbye' },
  { path: 'Jump.vrma', description: 'Jumps for joy' },
  { path: 'LookAround.vrma', description: 'Looks around curiously' },
  { path: 'PikeWalk.vrma', description: 'Walks in a pike stance' },
  { path: 'PushUp.vrma', description: 'Does push-ups' },
  { path: 'Relax.vrma', description: 'Stretches and relaxes' },
  { path: 'Sad.vrma', description: 'Looks down sadly' },
  { path: 'Sleepy.vrma', description: 'Yawns sleepily' },
  { path: 'Surprised.vrma', description: 'Jumps back in surprise' },
  { path: 'Thinking.vrma', description: 'Thinks with a hand on the chin' },
  { path: 'walking.vrma', description: 'Walks in place' },
  { path: 'VRMA_01_show_full_body.vrma' },
  { path: 'VRMA_02_greeting.vrma' },
  { path: 'VRMA_03_peace_sign.vrma' },
  { path: 'VRMA_04_shoot.vrma' },
  { path: 'VRMA_05_spin.vrma' },
  { path: 'VRMA_06_model_pose.vrma' },
  { path: 'VRMA_07_squat.vrma' },
  ...[1, 2, 3, 4, 5].map(n => ({ path: `dances/freestyle-${n}.vrma`, description: `Freestyle dance ${n}` })),
  { path: 'dances/girl-groove.vrma', description: 'Girl group groove dance' },
  { path: 'dances/hip-hop.vrma', description: 'Hip-hop dance' },
  { path: 'dances/house.vrma', description: 'House dance' },
  { path: 'dances/locking.vrma', description: 'Locking dance' },
  { path: 'dances/pop-groove.vrma', description: 'Pop groove dance' },
  { path: 'dances/rumba.vrma', description: 'Rumba dance' },
  { path: 'dances/samba.vrma', description: 'Samba dance' },
  { path: 'dances/swing.vrma', description: 'Swing dance' },
  { path: 'dances/thriller.vrma', description: 'Thriller zombie dance' },
]

export function customMotionUrl(path: string) {
  return `${REMOTE_ASSETS}/motions/${path}`
}

/**
 * Adds the "Thư Ký" card once per browser and makes it active with Arcana. `addCard` mints a
 * new id each call, so a localStorage flag keeps reloads from adding copies. A failed fetch
 * leaves the flag unset, so the next start tries again.
 */
export async function seedCustomCards(cardStore: Pick<ReturnType<typeof useAiriCardStore>, 'addCard' | 'activateCard'>) {
  if (localStorage.getItem(CUSTOM_CARD_SEED_KEY))
    return
  let card: ccv3.CharacterCardV3
  try {
    const response = await fetch(CUSTOM_CARD_URL)
    if (!response.ok)
      return
    card = await response.json()
  }
  catch {
    // Offline or not hosted yet: try again on the next start.
    return
  }
  const airi: Partial<AiriExtension> = card.data.extensions?.airi ?? {}
  card.data.extensions = { ...card.data.extensions, airi: { ...airi, modules: { ...airi.modules, displayModelId: CUSTOM_DEFAULT_DISPLAY_MODEL_ID } } }
  const id = await cardStore.addCard(card, 'import')
  localStorage.setItem(CUSTOM_CARD_SEED_KEY, id)
  await cardStore.activateCard(id)
}
