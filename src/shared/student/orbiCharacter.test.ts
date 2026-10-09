import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DRAW_ORDER,
  FACES,
  FOR_STATE,
  RESTING,
  STYLES,
  anchorTo,
  blendFaces,
  blendRigs,
  describe as describeOrbi,
  ease,
  poseChanges,
  rigFor,
  headingOf,
  shouldWalk,
  styleFor,
  trailOf,
  walkTime,
  type Expression,
  type Pose
} from './orbiCharacter.ts'

const POSES: Pose[] = [
  'stand', 'sit', 'walk', 'run', 'jump', 'wave', 'point', 'stretch', 'lean', 'carry',
  'read', 'write', 'press', 'sleep', 'hide', 'peek', 'celebrate', 'dance', 'shield', 'look-around'
]

describe('Orbi the character', () => {
  it('has a head, a face, a body, two arms with hands, two legs with feet and the ring', () => {
    for (const part of ['head', 'face', 'body', 'leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot', 'ring'] as const) {
      assert.ok(DRAW_ORDER.includes(part), `${part} is missing`)
      assert.ok(RESTING[part], `${part} has no resting place`)
    }
  })

  it('the head is drawn in front of the body, which is what gives it a chin', () => {
    assert.ok(DRAW_ORDER.indexOf('head') > DRAW_ORDER.indexOf('body'))
    assert.ok(DRAW_ORDER.indexOf('face') > DRAW_ORDER.indexOf('head'))
  })

  it('the ring is behind everything, so it is an accessory and not the character', () => {
    assert.equal(DRAW_ORDER[0], 'ring')
  })

  it('the head sits above the body, and the feet below the legs', () => {
    assert.ok(RESTING.head.y < RESTING.body.y)
    assert.ok(RESTING.leftFoot.y > RESTING.leftLeg.y)
    assert.ok(RESTING.rightFoot.y > RESTING.rightLeg.y)
  })

  it('every pose produces a complete skeleton, with nothing left at the origin', () => {
    for (const pose of POSES) {
      const rig = rigFor(pose, 0.25)
      for (const part of DRAW_ORDER) {
        assert.ok(rig[part], `${pose}/${part} missing`)
        assert.ok(Number.isFinite(rig[part].x) && Number.isFinite(rig[part].y), `${pose}/${part} not a number`)
        // Nothing may fall outside the character's own box, or it gets clipped.
        assert.ok(rig[part].x > -20 && rig[part].x < 120, `${pose}/${part} x off the canvas: ${rig[part].x}`)
        assert.ok(rig[part].y > -20 && rig[part].y < 120, `${pose}/${part} y off the canvas: ${rig[part].y}`)
      }
    }
  })

  it('every pose keeps the head above the feet, even mid-cycle', () => {
    for (const pose of POSES) {
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        const rig = rigFor(pose, phase)
        assert.ok(rig.head.y < rig.leftFoot.y, `${pose} at ${phase} is upside down`)
      }
    }
  })

  it('walking swings the arms opposite the legs', () => {
    /* The single thing that makes a walk read as a walk rather than a slide. */
    const quarter = poseChanges('walk', 0.25)
    assert.ok((quarter.leftLeg?.rotate ?? 0) > 0)
    assert.ok((quarter.leftArm?.rotate ?? 0) < (poseChanges('walk', 0.75).leftArm?.rotate ?? 0))
  })

  it('a walk cycle comes back to where it started', () => {
    const start = rigFor('walk', 0)
    const end = rigFor('walk', 1)
    assert.ok(Math.abs(start.leftFoot.x - end.leftFoot.x) < 0.001)
  })

  it('sitting lowers the body and bends the legs', () => {
    const stand = rigFor('stand')
    const sit = rigFor('sit')
    assert.ok(sit.body.y > stand.body.y)
    assert.ok(Math.abs(sit.leftLeg.rotate) > 40)
  })

  it('shielding is the one pose that brings the ring in front of the body', () => {
    const shield = rigFor('shield')
    assert.ok(shield.ring.y > shield.body.y - 10, 'the ring must come forward to read as protection')
    assert.ok(shield.ring.scaleX > 1.2)
  })

  it('Orbi has no arms or legs when it is just standing there', () => {
    /*
     * The rule the whole limb system exists for.
     *
     * A small round character with arms and legs permanently dangling reads as a toy standing to attention. They
     * appear for the moment they are needed and are drawn back in afterwards.
     */
    const rig = rigFor('stand')
    for (const limb of ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'] as const) {
      assert.equal(rig[limb].show, 0, `${limb} should be tucked away when standing`)
    }
    assert.equal(rig.head.show, 1)
    assert.equal(rig.body.show, 1)
  })

  it('a limb only ever appears with the pose that needs it', () => {
    assert.equal(rigFor('point').rightArm.show, 1, 'pointing needs an arm')
    assert.equal(rigFor('point').leftArm.show, 0, 'and only the one')
    assert.equal(rigFor('wave').rightArm.show, 1)
    assert.equal(rigFor('sit').leftLeg.show, 1, 'sitting needs legs')
    assert.equal(rigFor('celebrate', 0).leftArm.show, 1)
    assert.equal(rigFor('shield').leftArm.show, 1, 'shielding is done with both arms out')
    assert.equal(rigFor('look-around').leftArm.show, 0, 'looking around needs nothing')
  })

  it('no pose ever shows a hand without the arm it hangs off', () => {
    for (const pose of POSES) {
      const rig = rigFor(pose, 0.4)
      if (rig.leftHand.show > 0) assert.ok(rig.leftArm.show > 0, `${pose} has a floating left hand`)
      if (rig.rightHand.show > 0) assert.ok(rig.rightArm.show > 0, `${pose} has a floating right hand`)
      if (rig.leftFoot.show > 0) assert.ok(rig.leftLeg.show > 0, `${pose} has a floating left foot`)
      if (rig.rightFoot.show > 0) assert.ok(rig.rightLeg.show > 0, `${pose} has a floating right foot`)
    }
  })

  it('limbs fade rather than appear, so a blend is halfway there', () => {
    const half = blendRigs(rigFor('stand'), rigFor('point'), 0.5)
    assert.ok(half.rightArm.show > 0 && half.rightArm.show < 1, `partway through it is ${half.rightArm.show}`)
  })

  it('hands and feet stay attached to the limbs, in every pose', () => {
    /*
     * The fault this guards against was invisible in the numbers and obvious on screen.
     *
     * Hands were placed by hand and floated a few units clear of the arms. Nothing failed, nothing warned, and
     * Orbi rendered with detached mittens.
     */
    const reach = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y)
    for (const pose of POSES) {
      for (const phase of [0, 0.3, 0.6, 0.9]) {
        const rig = rigFor(pose, phase)
        // Within a hand's own radius of where the arm actually ends.
        assert.ok(reach(rig.leftHand, { x: rig.leftArm.x, y: rig.leftArm.y }) < 16, `${pose} left hand adrift`)
        assert.ok(reach(rig.rightHand, { x: rig.rightArm.x, y: rig.rightArm.y }) < 16, `${pose} right hand adrift`)
        assert.ok(reach(rig.leftFoot, { x: rig.leftLeg.x, y: rig.leftLeg.y }) < 12, `${pose} left foot adrift`)
        assert.ok(reach(rig.rightFoot, { x: rig.rightLeg.x, y: rig.rightLeg.y }) < 12, `${pose} right foot adrift`)
      }
    }
  })

  it('a hand follows its arm when the arm turns', () => {
    const down = rigFor('stand')
    const up = rigFor('celebrate', 0)
    assert.ok(up.leftHand.y < down.leftHand.y, 'raising the arms must raise the hands')
  })

  it('pointing reaches well clear of the body', () => {
    const point = rigFor('point')
    // The body's right edge sits at about 61, so the hand must be comfortably past it to read as a reach.
    assert.ok(point.rightHand.x > 72, `the hand only reaches ${point.rightHand.x}`)
    assert.ok(Math.abs(point.rightHand.y - point.rightArm.y) < 5, 'and reaches outward rather than downward')
  })

  it('every expression has a face', () => {
    const all: Expression[] = [
      'idle', 'happy', 'curious', 'focused', 'thinking', 'confused', 'surprised', 'excited', 'sleepy',
      'determined', 'proud', 'celebrating', 'encouraging', 'concerned', 'playful', 'studying', 'reading',
      'writing', 'listening', 'recovering', 'disappointed-but-kind', 'guardian', 'welcoming', 'mischievous',
      'calm', 'energetic'
    ]
    for (const one of all) assert.ok(FACES[one], `${one} has no face`)
    assert.equal(Object.keys(FACES).length, all.length)
  })

  it('no two expressions differ only by how much they blush', () => {
    /*
     * The accessibility rule, enforced rather than remembered.
     *
     * Blush and spread are colour and nuance; a student reading at sixteen pixels in high contrast has neither.
     * Every expression must be told apart by eye shape, mouth shape or brows.
     */
    const seen = new Map<string, string>()
    for (const [name, face] of Object.entries(FACES)) {
      const key = `${face.eyes}|${face.mouth}|${Math.round(face.brows)}`
      const clash = seen.get(key)
      assert.equal(clash, undefined, `${name} is indistinguishable from ${clash}`)
      seen.set(key, name)
    }
  })

  it('blending two skeletons lands exactly on each end', () => {
    const a = rigFor('stand')
    const b = rigFor('sit')
    assert.deepEqual(blendRigs(a, b, 0), a)
    assert.deepEqual(blendRigs(a, b, 1), b)
    const half = blendRigs(a, b, 0.5)
    assert.ok(half.body.y > a.body.y && half.body.y < b.body.y)
  })

  it('blending is clamped, so a late frame cannot throw a limb off', () => {
    const a = rigFor('stand')
    const b = rigFor('jump')
    assert.deepEqual(blendRigs(a, b, 5), b)
    assert.deepEqual(blendRigs(a, b, -3), a)
  })

  it('a face swaps shape at the midpoint while the brows slide', () => {
    const half = blendFaces(FACES.idle, FACES.celebrating, 0.5)
    assert.equal(half.eyes, FACES.celebrating.eyes)
    assert.ok(half.brows > FACES.celebrating.brows && half.brows < FACES.idle.brows)
  })

  it('the easing starts and ends still', () => {
    assert.equal(ease(0), 0)
    assert.equal(ease(1), 1)
    assert.ok(ease(0.1) < 0.1)
    assert.ok(ease(0.9) > 0.9)
  })

  it('every session state has a pose and an expression', () => {
    for (const [state, one] of Object.entries(FOR_STATE)) {
      assert.ok(one.pose, state)
      assert.ok(FACES[one.expression], `${state} points at an expression that does not exist`)
    }
  })

  it('a distraction makes Orbi a guard, and focus makes it sit down', () => {
    assert.equal(FOR_STATE['distraction-warning'].pose, 'shield')
    assert.equal(FOR_STATE.focused.pose, 'sit')
    assert.equal(FOR_STATE.sleeping.pose, 'sleep')
  })

  it('six styles over one character', () => {
    assert.equal(Object.keys(STYLES).length, 6)
    for (const one of Object.values(STYLES)) {
      assert.ok(one.name.length > 2, one.id)
      assert.ok(one.blurb.length > 10, one.id)
      assert.ok(one.headScale > 0.8 && one.headScale < 1.3, one.id)
    }
  })

  it('minimal moves least and cute is the sweetest', () => {
    assert.ok(STYLES.minimal.motion < STYLES.cute.motion)
    assert.equal(STYLES.minimal.sweetness, 0)
    assert.equal(STYLES.mature.sweetness, 0)
    assert.equal(STYLES.cute.sweetness, 1)
  })

  it('a personality saved before the styles existed still resolves', () => {
    /* A stored setting must never become invalid because a list grew. */
    for (const old of ['calm', 'energetic', 'academic', 'playful', 'minimal'] as const) {
      assert.ok(styleFor(old).id, old)
    }
    assert.equal(styleFor('playful').id, 'cute')
    assert.equal(styleFor('calm').id, 'minimal')
    assert.equal(styleFor('cute').id, 'cute')
  })

  it('what Orbi is doing is said in words, not only drawn', () => {
    assert.match(describeOrbi('shield', 'guardian'), /shielding you/i)
    assert.match(describeOrbi('sit', 'studying'), /sitting/i)
    assert.match(describeOrbi('stand', 'happy'), /happy/i)
  })

  it('sitting on a card perches on its top edge and never covers the title', () => {
    const card = { left: 100, top: 200, width: 300, height: 120 }
    const out = anchorTo('sit-on', card, 64)
    assert.equal(out.pose, 'sit')
    assert.equal(out.y, card.top)
    assert.ok(out.x > card.left && out.x < card.left + card.width / 2)
    // Small enough to sit on a short card rather than swallow it.
    assert.ok(out.size <= 84)
  })

  it('pointing swaps sides rather than going off the screen', () => {
    const middle = anchorTo('point-at', { left: 400, top: 100, width: 200, height: 50 }, 64, { width: 1280, height: 800 })
    assert.equal(middle.flip, false)
    assert.ok(middle.x < 400)
    const edge = anchorTo('point-at', { left: 1180, top: 100, width: 80, height: 50 }, 64, { width: 1280, height: 800 })
    assert.equal(edge.flip, true)
    assert.ok(edge.x > 1180)
  })

  it('guarding stands in the middle of the thing and is bigger on purpose', () => {
    const out = anchorTo('guard', { left: 0, top: 0, width: 400, height: 300 }, 64)
    assert.equal(out.pose, 'shield')
    assert.equal(out.x, 200)
    assert.ok(out.size > 64)
  })

  it('peeking appears at the far edge, facing back', () => {
    const out = anchorTo('peek-behind', { left: 100, top: 100, width: 200, height: 100 }, 64)
    assert.equal(out.pose, 'peek')
    assert.equal(out.flip, true)
  })

  it('Orbi glides anything worth crossing, and never twitches', () => {
    assert.equal(shouldWalk({ x: 0, y: 0 }, { x: 10, y: 0 }, false), false, 'a few pixels is a twitch')
    assert.equal(shouldWalk({ x: 0, y: 0 }, { x: 300, y: 0 }, false), true)
    // A glide crosses a whole window, which a walk could not: there is no upper limit any more.
    assert.equal(shouldWalk({ x: 0, y: 0 }, { x: 1800, y: 600 }, false), true)
    assert.equal(shouldWalk({ x: 0, y: 0 }, { x: 300, y: 0 }, true), false, 'reduced motion never travels')
  })

  it('a glide is never long enough to wait for', () => {
    assert.ok(walkTime({ x: 0, y: 0 }, { x: 1800, y: 0 }) <= 950, 'even right across the screen is under a second')
    assert.ok(walkTime({ x: 0, y: 0 }, { x: 60, y: 0 }) >= 240)
  })

  it('gliding tucks the legs away entirely', () => {
    /* The point of a glide: no stubby legs windmilling across the screen. */
    const rig = rigFor('glide', 0.5)
    assert.equal(rig.leftLeg.show, 0)
    assert.equal(rig.rightLeg.show, 0)
    assert.equal(rig.leftArm.show, 0)
    assert.ok(rig.body.rotate > 5, 'and it leans into the move')
  })

  it('the heading points along the travel', () => {
    assert.equal(Math.round(headingOf({ x: 0, y: 0 }, { x: 10, y: 0 })), 0)
    assert.equal(Math.round(headingOf({ x: 0, y: 0 }, { x: 0, y: 10 })), 90)
    assert.equal(Math.round(headingOf({ x: 10, y: 0 }, { x: 0, y: 0 })), 180)
  })

  it('the trail only ever sits on ground already covered', () => {
    const from = { x: 0, y: 0 }
    const to = { x: 100, y: 0 }
    const half = trailOf(from, to, 0.5)
    assert.ok(half.length > 0)
    for (const one of half) {
      assert.ok(one.x <= 50 + 0.001, `a mote at ${one.x} is ahead of Orbi`)
      assert.ok(one.x >= 0)
    }
    // Oldest is faintest, so the streak reads as a direction rather than a row of dots.
    assert.ok(half[0].fade > half[half.length - 1].fade)
  })

  it('there is no trail before the move has started', () => {
    assert.deepEqual(trailOf({ x: 0, y: 0 }, { x: 100, y: 0 }, 0), [])
  })
})
