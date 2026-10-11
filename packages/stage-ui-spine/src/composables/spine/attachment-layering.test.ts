import { describe, expect, it } from 'vitest'

import { attachmentSlots, createAttachmentLayering } from './attachment-layering'

/** Slots as a NIKKE face lays them out: idle eyes, think2 eyes, sleep eyes, and the body. */
const SETUP = ['l_eye_idle', null, null, 'body'] as const

function createRig() {
  const slots = SETUP.map(attachmentName => ({
    data: { attachmentName },
    attachment: attachmentName as string | null,
    setAttachment(attachment: string | null) {
      this.attachment = attachment
    },
  }))
  return {
    slots,
    getAttachment: (_slotIndex: number, name: string) => name,
  }
}

const think2 = { name: 'think2', timelines: [{ slotIndex: 0, attachmentNames: [null] }, { slotIndex: 1, attachmentNames: ['l_eye_think2'] }, { boneIndex: 3 }] }
const sleep = { name: 'sleep', timelines: [{ slotIndex: 0, attachmentNames: [null] }, { slotIndex: 2, attachmentNames: ['l_eye_sleep'] }] }
const empty = { name: '<empty>', timelines: [] }

/** What Spine leaves after applying think2 under sleep: both eyes drawn. */
function applyTracks(rig: ReturnType<typeof createRig>) {
  rig.slots[0].attachment = null
  rig.slots[1].attachment = 'l_eye_think2'
  rig.slots[2].attachment = 'l_eye_sleep'
}

describe('attachmentSlots', () => {
  it('lists only slots with attachment keys', () => {
    expect([...attachmentSlots(think2)]).toEqual([0, 1])
  })
})

describe('createAttachmentLayering', () => {
  it('hides idle face parts that the expression above does not key', () => {
    const rig = createRig()
    applyTracks(rig)
    createAttachmentLayering().apply(rig, { tracks: [{ animation: think2 }, { animation: sleep }] }, 0, [1])
    expect(rig.slots.map(slot => slot.attachment)).toEqual([null, null, 'l_eye_sleep', 'body'])
  })

  it('leaves the idle face alone when no expression plays', () => {
    const rig = createRig()
    rig.slots[0].attachment = null
    rig.slots[1].attachment = 'l_eye_think2'
    const layering = createAttachmentLayering()
    layering.apply(rig, { tracks: [{ animation: think2 }, { animation: empty }] }, 0, [1])
    layering.apply(rig, { tracks: [{ animation: think2 }, null] }, 0, [1])
    expect(rig.slots[1].attachment).toBe('l_eye_think2')
  })

  it('never touches slots the expression keys itself', () => {
    const rig = createRig()
    applyTracks(rig)
    createAttachmentLayering().apply(rig, { tracks: [{ animation: think2 }, { animation: sleep }] }, 0, [1])
    // Slot 0 is keyed by both, so the expression's hidden idle eye stays hidden.
    expect(rig.slots[0].attachment).toBeNull()
  })
})
