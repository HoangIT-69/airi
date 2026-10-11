import type { VRM } from '@pixiv/three-vrm'
import type { Object3D } from 'three'

import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { createVRMRegionDrag } from './spring-bone'

function joint(name: string, parentName?: string) {
  const tail = new Vector3()
  const bone = {
    name,
    parent: parentName ? { name: parentName, parent: null } : null,
    getWorldPosition(target: Vector3) {
      return target.set(0, 1, 0)
    },
  }
  return { bone: bone as unknown as Object3D, tail }
}

function modelOf(joints: ReturnType<typeof joint>[]): VRM {
  return {
    springBoneManager: {
      joints: joints.map(item => ({ bone: item.bone, _prevTail: item.tail })),
    },
  } as unknown as VRM
}

describe('createVRMRegionDrag', () => {
  it('stops pulling a skirt once the accumulated offset reaches the limit', () => {
    const skirt = joint('Skirt_L_01', 'Hips')
    const drag = createVRMRegionDrag()
    const vrm = modelOf([skirt])
    const near = new Vector3(0, 1, 0)
    drag.setRegion('skirt')

    for (let frame = 0; frame < 8; frame++)
      drag.drag(vrm, near, new Vector3(1, 0, 0), 1 / 60, 1.6)

    const held = skirt.tail.x
    drag.drag(vrm, near, new Vector3(1, 0, 0), 1 / 60, 1.6)

    expect(held).toBeCloseTo(-0.65)
    expect(skirt.tail.x).toBeCloseTo(held)
  })

  it('pulls a breast when the pointer is on the shirt, away from the bone', () => {
    const breast = joint('Breast_L')
    breast.bone.getWorldPosition = (target: Vector3) => target.set(0, 0.5, 0.4)
    const drag = createVRMRegionDrag()
    drag.setRegion('bust')
    drag.drag(modelOf([breast]), new Vector3(0, 1.2, 0), new Vector3(0.05, 0, 0), 1 / 60, 1.6)

    expect(breast.tail.x).toBeLessThan(0)
  })

  it('moves a neck scarf with the breast and leaves a hanging zip', () => {
    const breast = joint('Breast_L')
    const scarf = joint('NeckRibbon')
    const zip = joint('Zip', 'Bust')
    const drag = createVRMRegionDrag()
    const vrm = modelOf([breast, scarf, zip])
    drag.setRegion('bust')
    drag.drag(vrm, new Vector3(0, 1, 0), new Vector3(0.02, 0, 0), 1 / 60, 1.6)

    expect(breast.tail.x).toBeCloseTo(-0.02)
    expect(scarf.tail.x).toBeCloseTo(-0.01)
    expect(zip.tail.x).toBe(0)
  })

  it('does not drag clothing that only hangs under a breast bone', () => {
    const breast = joint('Breast_L')
    const zip = joint('Zip', 'Bust')
    const drag = createVRMRegionDrag()
    const vrm = modelOf([breast, zip])
    drag.setRegion('chest')

    drag.drag(vrm, new Vector3(0, 1, 0), new Vector3(0.02, 0, 0), 1 / 60, 1.6)

    expect(breast.tail.x).toBeLessThan(0)
    expect(zip.tail.x).toBe(0)
  })

  it('reports a release strength for the breast bounce and none of the offset remains', () => {
    const breast = joint('Breast_L')
    const drag = createVRMRegionDrag()
    drag.setRegion('bust')
    drag.drag(modelOf([breast]), new Vector3(0, 1, 0), new Vector3(0.02, 0, 0), 0.05, 1.6)

    const release = drag.release()

    expect(release.kind).toBe('bust')
    expect(release.strength).toBeGreaterThan(0)
    expect(release.strength).toBeLessThanOrEqual(1)
  })

  it('reports breast release strength from how far the chest was pulled', () => {
    const breast = joint('Breast_L')
    const drag = createVRMRegionDrag()
    const vrm = modelOf([breast])
    drag.setRegion('bust')
    drag.drag(vrm, new Vector3(0, 1, 0), new Vector3(0.08, 0, 0), 1 / 60, 1.6)
    drag.drag(vrm, new Vector3(0, 1, 0), new Vector3(0, 0, 0), 0.5, 1.6)

    const release = drag.release()

    expect(release.kind).toBe('bust')
    expect(release.strength).toBeGreaterThan(0.5)
  })

  it('keeps a little breast stiffness while held and rings the drag force back on release', () => {
    const settings = { stiffness: 0.5, gravityPower: 0.1, dragForce: 0.4 }
    const bone = {
      name: 'Breast_L',
      parent: null,
      getWorldPosition(target: Vector3) {
        return target.set(0, 1, 0)
      },
    }
    const breast = { bone: bone as unknown as Object3D, _prevTail: new Vector3(), settings: { ...settings } }
    const vrm = { springBoneManager: { joints: [breast] } } as unknown as VRM
    const drag = createVRMRegionDrag()
    drag.setRegion('bust')
    drag.drag(vrm, new Vector3(0, 1, 0), new Vector3(0.04, 0, 0), 1 / 60, 1.6)
    drag.step(vrm, 1 / 60)

    expect(breast.settings.stiffness).toBeCloseTo(settings.stiffness * 0.06)
    expect(breast.settings.gravityPower).toBe(0)
    expect(breast.settings.dragForce).toBeGreaterThanOrEqual(0.62)
    expect(breast.settings.dragForce).toBeLessThan(0.9)

    drag.release()

    expect(breast.settings.stiffness).toBeGreaterThan(settings.stiffness)
    expect(breast.settings.dragForce).toBeLessThan(settings.dragForce)
  })
})
