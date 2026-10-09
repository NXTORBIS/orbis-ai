/**
 * Orbi, as a character with a body.
 *
 * ## Why this is a rig and not a set of drawings
 *
 * Twenty-six expressions across nine poses is 234 pictures, and nobody draws or maintains 234 pictures. So the
 * character is a **skeleton** — a head, a face, a body, two arms with hands, two legs with feet and the orbit ring —
 * and a pose is a small set of numbers for those parts. Every combination then exists without being drawn, two
 * poses can be blended halfway through a transition, and a new expression is six numbers rather than a new asset.
 *
 * It also means this file is pure and testable, and the component that draws it holds no decisions at all.
 *
 * ## The silhouette is the design
 *
 * The one rule everything here serves: **Orbi must be recognisable in black at sixteen pixels.** A rounded head
 * wider than it is tall, a smaller rounded body, stubby limbs, and the ring tilted behind the shoulders. Not a
 * sphere — a sphere at sixteen pixels is a dot, and a dot is not a character. The ring stays because rings are
 * already Orbis's visual language, but it is an accessory *behind* the character, never the character itself.
 *
 * ## Nothing here is load-bearing
 *
 * If every function in this file returned the resting pose, Student would still teach, time, measure and protect.
 * Orbi is the face of the thing and never the thing.
 */

import type { OrbiPersonality, OrbiState } from './types.ts'

// ---------------------------------------------------------------- the parts

export type PartName =
  | 'ring'
  | 'body'
  | 'leftLeg'
  | 'rightLeg'
  | 'leftFoot'
  | 'rightFoot'
  | 'leftArm'
  | 'rightArm'
  | 'leftHand'
  | 'rightHand'
  | 'head'
  | 'face'

/**
 * Drawn in this order, back to front.
 *
 * The ring first so it sits behind the shoulders, the head last so it overlaps the body — which is what gives the
 * character its chin and most of its cuteness.
 */
export const DRAW_ORDER: readonly PartName[] = [
  'ring',
  'leftLeg',
  'rightLeg',
  'leftFoot',
  'rightFoot',
  'leftArm',
  'leftHand',
  'body',
  'rightArm',
  'rightHand',
  'head',
  'face'
]

/** Where a part is and how it is turned, in the character's own 100×100 space. */
export interface PartPose {
  x: number
  y: number
  /** Degrees. Positive is clockwise. */
  rotate: number
  /** 1 is natural size. Used for squash and stretch, never to resize a part permanently. */
  scaleX: number
  scaleY: number
  /**
   * How present this part is, 0..1.
   *
   * **Orbi has no arms or legs most of the time.** They appear for the moment they are needed — a hand to point
   * with, legs to sit on — and fade out again. A small round character with limbs permanently dangling reads as a
   * toy standing to attention; one that grows an arm only to point at something reads as alive.
   *
   * A number rather than a flag so a blend fades it, which is why limbs never pop in.
   */
  show: number
}

export type Rig = Record<PartName, PartPose>

const at = (x: number, y: number, rotate = 0, scaleX = 1, scaleY = 1, show = 1): PartPose => ({ x, y, rotate, scaleX, scaleY, show })

/** A limb, hidden. The resting state for everything Orbi only grows when it needs it. */
const tucked = (x: number, y: number, rotate = 0): PartPose => at(x, y, rotate, 1, 1, 0)

/**
 * Standing still, arms down, looking ahead.
 *
 * Every other pose is written as a difference from this, so a pose only has to say what it changes — and a part
 * nobody thought about stays where a standing character's part belongs instead of at the origin.
 */
export const RESTING: Rig = {
  ring: at(50, 46, -18),
  body: at(50, 64),
  // Tucked away by default. A pose that needs a limb asks for it; nothing else grows one.
  leftLeg: tucked(42, 80),
  rightLeg: tucked(58, 80),
  leftFoot: tucked(41, 90),
  rightFoot: tucked(59, 90),
  leftArm: tucked(33, 64, 8),
  rightArm: tucked(67, 64, -8),
  leftHand: tucked(30, 73),
  rightHand: tucked(70, 73),
  head: at(50, 36),
  face: at(50, 37)
}

/**
 * Which limbs each pose actually needs.
 *
 * Kept as its own table rather than mixed into the pose changes, and applied afterwards. The first attempt put
 * it in the changes and it silently did nothing: a pose that also moves that arm replaces the whole entry, so
 * `{ ...RIGHT_ARM, rightArm: { rotate: 68 } }` loses the very thing it was spread in for. Separating them means a
 * pose cannot accidentally hide a limb it is busy posing.
 *
 * Anything not listed has no arms and no legs, which is Orbi's resting state.
 */
const NEEDS: Partial<Record<Pose, readonly PartName[]>> = {
  sit: ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'],
  walk: ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'],
  run: ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'],
  jump: ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'],
  lean: ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'],
  sleep: ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'],
  celebrate: ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'],
  dance: ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'],
  shield: ['leftArm', 'rightArm', 'leftHand', 'rightHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'],
  peek: ['leftArm', 'leftHand', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot'],
  stretch: ['leftArm', 'rightArm', 'leftHand', 'rightHand'],
  carry: ['leftArm', 'rightArm', 'leftHand', 'rightHand'],
  read: ['leftArm', 'rightArm', 'leftHand', 'rightHand'],
  write: ['leftArm', 'rightArm', 'leftHand', 'rightHand'],
  hide: ['leftArm', 'rightArm', 'leftHand', 'rightHand'],
  wave: ['rightArm', 'rightHand'],
  point: ['rightArm', 'rightHand'],
  press: ['rightArm', 'rightHand']
}

/** The limbs a pose grows. Everything else stays tucked away. */
export function limbsFor(pose: Pose): readonly PartName[] {
  return NEEDS[pose] ?? []
}

// ---------------------------------------------------------------- the face

export type EyeShape =
  | 'open'
  | 'wide'
  | 'narrow'
  | 'closed'
  | 'happy'
  | 'sleepy'
  | 'determined'
  | 'thinking'
  | 'worried'
  | 'sparkle'

export type MouthShape =
  | 'neutral'
  | 'smile'
  | 'grin'
  | 'small'
  | 'open'
  | 'oh'
  | 'flat'
  | 'wobble'
  | 'tiny-frown'
  | 'talking'

export interface Face {
  eyes: EyeShape
  mouth: MouthShape
  /** Degrees the brows tilt inward. Positive is a frown, negative is surprise. */
  brows: number
  /** 0..1. How wide apart the eyes sit, which is most of how young a face reads. */
  eyeSpread: number
  /** Cheek blush, 0..1. The cute personality turns this up and minimal turns it off. */
  blush: number
}

/**
 * Everything Orbi can be feeling.
 *
 * Deliberately longer than the state list: a state is what the session is doing, an expression is what Orbi's face
 * is doing, and one state can want several faces over its life — `focused` is determined at the start and tired by
 * minute eighty.
 */
export type Expression =
  | 'idle'
  | 'happy'
  | 'curious'
  | 'focused'
  | 'thinking'
  | 'confused'
  | 'surprised'
  | 'excited'
  | 'sleepy'
  | 'determined'
  | 'proud'
  | 'celebrating'
  | 'encouraging'
  | 'concerned'
  | 'playful'
  | 'studying'
  | 'reading'
  | 'writing'
  | 'listening'
  | 'recovering'
  | 'disappointed-but-kind'
  | 'guardian'
  | 'welcoming'
  | 'mischievous'
  | 'calm'
  | 'energetic'

/**
 * Each expression's face.
 *
 * Checked against one rule while writing them: **no two expressions may differ only by colour**, because colour is
 * the one channel a colour-blind student, a high-contrast theme and a sixteen-pixel icon all lose. Every row below
 * differs from its neighbours in eye shape, mouth shape or brow angle.
 */
export const FACES: Record<Expression, Face> = {
  idle: { eyes: 'narrow', mouth: 'small', brows: 0, eyeSpread: 0.5, blush: 0.1 },
  happy: { eyes: 'happy', mouth: 'smile', brows: -2, eyeSpread: 0.5, blush: 0.3 },
  curious: { eyes: 'wide', mouth: 'oh', brows: -6, eyeSpread: 0.55, blush: 0.15 },
  focused: { eyes: 'narrow', mouth: 'flat', brows: 4, eyeSpread: 0.45, blush: 0 },
  thinking: { eyes: 'thinking', mouth: 'small', brows: 3, eyeSpread: 0.5, blush: 0 },
  confused: { eyes: 'worried', mouth: 'wobble', brows: -4, eyeSpread: 0.52, blush: 0.1 },
  surprised: { eyes: 'wide', mouth: 'open', brows: -10, eyeSpread: 0.58, blush: 0.2 },
  excited: { eyes: 'sparkle', mouth: 'grin', brows: -5, eyeSpread: 0.52, blush: 0.4 },
  sleepy: { eyes: 'sleepy', mouth: 'small', brows: 1, eyeSpread: 0.48, blush: 0.15 },
  determined: { eyes: 'determined', mouth: 'flat', brows: 7, eyeSpread: 0.45, blush: 0 },
  proud: { eyes: 'happy', mouth: 'grin', brows: -3, eyeSpread: 0.5, blush: 0.35 },
  celebrating: { eyes: 'sparkle', mouth: 'open', brows: -8, eyeSpread: 0.55, blush: 0.5 },
  encouraging: { eyes: 'open', mouth: 'smile', brows: -2, eyeSpread: 0.5, blush: 0.25 },
  concerned: { eyes: 'worried', mouth: 'tiny-frown', brows: 5, eyeSpread: 0.5, blush: 0.05 },
  playful: { eyes: 'happy', mouth: 'grin', brows: -4, eyeSpread: 0.54, blush: 0.4 },
  studying: { eyes: 'narrow', mouth: 'small', brows: 3, eyeSpread: 0.46, blush: 0 },
  reading: { eyes: 'narrow', mouth: 'neutral', brows: 2, eyeSpread: 0.46, blush: 0.05 },
  writing: { eyes: 'narrow', mouth: 'small', brows: 2, eyeSpread: 0.46, blush: 0.05 },
  listening: { eyes: 'open', mouth: 'neutral', brows: -2, eyeSpread: 0.52, blush: 0.1 },
  recovering: { eyes: 'sleepy', mouth: 'small', brows: 2, eyeSpread: 0.48, blush: 0.1 },
  'disappointed-but-kind': { eyes: 'sleepy', mouth: 'smile', brows: 3, eyeSpread: 0.5, blush: 0.1 },
  guardian: { eyes: 'determined', mouth: 'flat', brows: 8, eyeSpread: 0.44, blush: 0 },
  welcoming: { eyes: 'happy', mouth: 'open', brows: -4, eyeSpread: 0.52, blush: 0.3 },
  mischievous: { eyes: 'narrow', mouth: 'grin', brows: -6, eyeSpread: 0.54, blush: 0.3 },
  calm: { eyes: 'narrow', mouth: 'smile', brows: 0, eyeSpread: 0.5, blush: 0.1 },
  energetic: { eyes: 'sparkle', mouth: 'grin', brows: -6, eyeSpread: 0.52, blush: 0.45 }
}

// ---------------------------------------------------------------- the poses

/** What the whole body is doing. A pose and an expression are chosen separately and combined. */
export type Pose =
  | 'stand'
  | 'sit'
  /**
   * How Orbi actually travels.
   *
   * Not a walk. Legs tucked away, body tilted into the direction of travel, riding its own ring — which is both
   * truer to what Orbi is and far better at speed, because stubby legs windmilling across a screen look frantic
   * rather than purposeful.
   */
  | 'glide'
  | 'walk'
  | 'run'
  | 'jump'
  | 'wave'
  | 'point'
  | 'stretch'
  | 'lean'
  | 'carry'
  | 'read'
  | 'write'
  | 'press'
  | 'sleep'
  | 'hide'
  | 'peek'
  | 'celebrate'
  | 'dance'
  | 'shield'
  | 'look-around'

/** A pose, as the parts it moves away from resting. */
export type PoseChanges = Partial<Record<PartName, Partial<PartPose>>>

/**
 * How each pose differs from standing.
 *
 * `phase` is where in a 0..1 cycle the pose is, so a walk is one entry whose legs are a function of phase rather
 * than four separate frames. Poses that do not move ignore it.
 */
export function poseChanges(pose: Pose, phase: number): PoseChanges {
  // A smooth back-and-forth from 0..1 of phase, which is what a limb does.
  const swing = Math.sin(phase * Math.PI * 2)
  const bob = Math.sin(phase * Math.PI * 4)

  switch (pose) {
    case 'sit':
      return {
        body: { y: 72 },
        head: { y: 45 },
        face: { y: 46 },
        ring: { y: 55, rotate: -12 },
        leftLeg: { x: 40, y: 84, rotate: -62 },
        rightLeg: { x: 60, y: 84, rotate: 62 },
        leftFoot: { x: 29, y: 88 },
        rightFoot: { x: 71, y: 88 },
        leftArm: { x: 35, y: 72, rotate: 18 },
        rightArm: { x: 65, y: 72, rotate: -18 },
        leftHand: { x: 33, y: 80 },
        rightHand: { x: 67, y: 80 }
      }
    case 'glide': {
      /*
       * Leaning into the move, with the ring swung underneath as the thing carrying it.
       *
       * No legs at all: the ring does the work, and the trail behind comes from the component rather than from
       * here. The small vertical drift keeps it from reading as a sticker being slid across the page.
       */
      const drift = Math.sin(phase * Math.PI * 2) * 1.6
      return {
        body: { y: 62 + drift, rotate: 12, scaleY: 1.03 },
        head: { x: 53, y: 33 + drift, rotate: 14 },
        face: { x: 53, y: 34 + drift, rotate: 14 },
        ring: { x: 47, y: 58 + drift, rotate: 8, scaleX: 1.15, scaleY: 1.15 }
      }
    }
    case 'walk':
      return {
        body: { y: 64 + bob * 1.2 },
        head: { y: 36 + bob * 1.2, rotate: swing * 2 },
        face: { y: 37 + bob * 1.2, rotate: swing * 2 },
        leftLeg: { rotate: swing * 22 },
        rightLeg: { rotate: -swing * 22 },
        leftFoot: { x: 41 + swing * 5, y: 90 - Math.max(0, swing) * 3 },
        rightFoot: { x: 59 - swing * 5, y: 90 - Math.max(0, -swing) * 3 },
        // Arms swing opposite the legs, which is the thing that makes a walk read as a walk.
        leftArm: { rotate: 8 - swing * 18 },
        rightArm: { rotate: -8 - swing * 18 },
        leftHand: { x: 30 - swing * 4, y: 73 },
        rightHand: { x: 70 - swing * 4, y: 73 }
      }
    case 'run':
      return {
        body: { y: 62 + bob * 2, rotate: 8 },
        head: { x: 53, y: 33 + bob * 2, rotate: 6 },
        face: { x: 53, y: 34 + bob * 2, rotate: 6 },
        ring: { x: 46, y: 44, rotate: -28 },
        leftLeg: { rotate: swing * 40 },
        rightLeg: { rotate: -swing * 40 },
        leftFoot: { x: 41 + swing * 9, y: 89 - Math.max(0, swing) * 6 },
        rightFoot: { x: 59 - swing * 9, y: 89 - Math.max(0, -swing) * 6 },
        leftArm: { rotate: 20 - swing * 34 },
        rightArm: { rotate: -20 - swing * 34 },
        leftHand: { x: 31 - swing * 6, y: 70 },
        rightHand: { x: 69 - swing * 6, y: 70 }
      }
    case 'jump':
      return {
        body: { y: 58, scaleY: 1.06, scaleX: 0.96 },
        head: { y: 29 },
        face: { y: 30 },
        ring: { y: 40, rotate: -24 },
        leftLeg: { y: 76, rotate: -18 },
        rightLeg: { y: 76, rotate: 18 },
        leftFoot: { x: 38, y: 84 },
        rightFoot: { x: 62, y: 84 },
        leftArm: { x: 31, y: 56, rotate: -46 },
        rightArm: { x: 69, y: 56, rotate: 46 },
        leftHand: { x: 25, y: 46 },
        rightHand: { x: 75, y: 46 }
      }
    case 'wave':
      return {
        rightArm: { x: 64, y: 56, rotate: 34 + swing * 16 },
        head: { rotate: -3 }
      }
    case 'point':
      return {
        // Nearly horizontal, from the shoulder, so the reach is the thing you notice rather than the hand.
        rightArm: { x: 63, y: 58, rotate: 84 },
        rightHand: { scaleX: 1.15, scaleY: 1.15 },
        head: { x: 52, rotate: 4 },
        face: { x: 52, rotate: 4 }
      }
    case 'stretch':
      return {
        body: { y: 63, scaleY: 1.05 },
        head: { y: 33, rotate: -6 },
        face: { y: 34, rotate: -6 },
        leftArm: { x: 30, y: 50, rotate: -62 },
        rightArm: { x: 70, y: 50, rotate: 62 },
        leftHand: { x: 22, y: 38 },
        rightHand: { x: 78, y: 38 }
      }
    case 'lean':
      return {
        body: { x: 54, rotate: 10 },
        head: { x: 56, rotate: 12 },
        face: { x: 56, rotate: 12 },
        ring: { x: 55, rotate: -6 },
        leftLeg: { x: 44, rotate: 6 },
        rightLeg: { x: 60, rotate: 10 },
        leftArm: { x: 37, y: 65, rotate: 18 },
        rightArm: { x: 70, y: 64, rotate: -2 }
      }
    case 'carry':
      return {
        leftArm: { x: 34, y: 60, rotate: -34 },
        rightArm: { x: 66, y: 60, rotate: 34 },
        leftHand: { x: 36, y: 50 },
        rightHand: { x: 64, y: 50 },
        body: { y: 65 },
        head: { rotate: -2 }
      }
    case 'read':
      return {
        head: { y: 38, rotate: 8 },
        face: { y: 39, rotate: 8 },
        leftArm: { x: 36, y: 66, rotate: -28 },
        rightArm: { x: 64, y: 66, rotate: 28 },
        leftHand: { x: 39, y: 57 },
        rightHand: { x: 61, y: 57 }
      }
    case 'write':
      return {
        head: { y: 39, rotate: 10 },
        face: { y: 40, rotate: 10 },
        rightArm: { x: 63, y: 68, rotate: 42 },
        rightHand: { x: 58, y: 78 },
        leftArm: { x: 36, y: 67, rotate: -12 },
        leftHand: { x: 36, y: 76 }
      }
    case 'press':
      return {
        rightArm: { x: 69, y: 62, rotate: 58 },
        rightHand: { x: 82, y: 60, scaleX: 0.9, scaleY: 0.9 },
        body: { y: 65, scaleY: 0.98 },
        head: { x: 52, y: 37 },
        face: { x: 52, y: 38 }
      }
    case 'sleep':
      return {
        body: { y: 74, rotate: -6 },
        head: { x: 46, y: 50, rotate: -18 },
        face: { x: 46, y: 51, rotate: -18 },
        ring: { x: 48, y: 60, rotate: -4 },
        leftLeg: { x: 40, y: 85, rotate: -70 },
        rightLeg: { x: 58, y: 85, rotate: 70 },
        leftFoot: { x: 28, y: 89 },
        rightFoot: { x: 72, y: 89 },
        leftArm: { x: 36, y: 76, rotate: 30 },
        rightArm: { x: 64, y: 76, rotate: -30 },
        leftHand: { x: 36, y: 84 },
        rightHand: { x: 64, y: 84 }
      }
    case 'hide':
      return {
        body: { y: 78, scaleY: 0.8 },
        head: { y: 56 },
        face: { y: 57 },
        ring: { y: 66, rotate: -8 },
        leftArm: { x: 36, y: 74, rotate: 24 },
        rightArm: { x: 64, y: 74, rotate: -24 },
        leftHand: { x: 36, y: 82 },
        rightHand: { x: 64, y: 82 },
        leftLeg: { y: 88 },
        rightLeg: { y: 88 },
        leftFoot: { y: 94 },
        rightFoot: { y: 94 }
      }
    case 'peek':
      return {
        body: { x: 58, y: 72, rotate: -8 },
        head: { x: 56, y: 46, rotate: -12 },
        face: { x: 56, y: 47, rotate: -12 },
        ring: { x: 58, y: 56, rotate: -10 },
        // One hand on the edge it is peeking round. That hand is the whole gag.
        leftArm: { x: 42, y: 66, rotate: -40 },
        leftHand: { x: 36, y: 56 },
        rightArm: { x: 70, y: 72, rotate: -10 },
        rightHand: { x: 72, y: 80 },
        leftLeg: { x: 52, y: 84 },
        rightLeg: { x: 64, y: 84 },
        leftFoot: { x: 50, y: 92 },
        rightFoot: { x: 66, y: 92 }
      }
    case 'celebrate':
      return {
        body: { y: 60 + bob * 2, scaleY: 1.04 },
        head: { y: 31 + bob * 2, rotate: swing * 4 },
        face: { y: 32 + bob * 2, rotate: swing * 4 },
        ring: { y: 42, rotate: -30 + swing * 10 },
        leftArm: { x: 30, y: 52, rotate: -58 },
        rightArm: { x: 70, y: 52, rotate: 58 },
        leftHand: { x: 22, y: 40 - Math.max(0, swing) * 3 },
        rightHand: { x: 78, y: 40 - Math.max(0, -swing) * 3 },
        leftLeg: { y: 78, rotate: -10 },
        rightLeg: { y: 78, rotate: 10 },
        leftFoot: { x: 39, y: 87 },
        rightFoot: { x: 61, y: 87 }
      }
    case 'dance':
      return {
        body: { x: 50 + swing * 3, y: 64 + Math.abs(bob), rotate: swing * 8 },
        head: { x: 50 + swing * 4, y: 36, rotate: swing * 10 },
        face: { x: 50 + swing * 4, y: 37, rotate: swing * 10 },
        ring: { x: 50 + swing * 3, rotate: -18 + swing * 16 },
        leftArm: { x: 33 + swing * 2, y: 60, rotate: -30 + swing * 30 },
        rightArm: { x: 67 + swing * 2, y: 60, rotate: 30 + swing * 30 },
        leftHand: { x: 28 + swing * 4, y: 50 },
        rightHand: { x: 72 + swing * 4, y: 50 },
        leftLeg: { rotate: swing * 14 },
        rightLeg: { rotate: swing * 14 },
        leftFoot: { x: 41 + swing * 3 },
        rightFoot: { x: 59 + swing * 3 }
      }
    case 'shield':
      /*
       * Standing between the student and the page, arms out, ring swung forward as the shield.
       *
       * The only pose where the ring comes in front of the body — which is exactly why it reads as protection
       * rather than as a greeting.
       */
      return {
        body: { y: 64, scaleX: 1.04 },
        head: { y: 35 },
        face: { y: 36 },
        ring: { y: 60, rotate: 0, scaleX: 1.3, scaleY: 1.3 },
        leftArm: { x: 30, y: 60, rotate: -40 },
        rightArm: { x: 70, y: 60, rotate: 40 },
        leftHand: { x: 22, y: 54 },
        rightHand: { x: 78, y: 54 },
        leftLeg: { x: 41, rotate: -8 },
        rightLeg: { x: 59, rotate: 8 },
        leftFoot: { x: 37 },
        rightFoot: { x: 63 }
      }
    case 'look-around':
      return {
        head: { x: 50 + swing * 5, rotate: swing * 12 },
        face: { x: 50 + swing * 5, rotate: swing * 12 },
        body: { rotate: swing * 2 }
      }
    case 'stand':
    default:
      return { body: { y: 64 + bob * 0.4 }, head: { y: 36 + bob * 0.4 }, face: { y: 37 + bob * 0.4 } }
  }
}

/** How far down each limb its end is, in the character's own units. The line each one is drawn as ends here. */
const ARM_LENGTH = 14
const LEG_LENGTH = 10

/** A point that far along a limb, once the limb has been turned. */
function endOf(limb: PartPose, length: number): { x: number; y: number } {
  const radians = (limb.rotate * Math.PI) / 180
  return {
    x: limb.x + Math.sin(radians) * length * limb.scaleY,
    y: limb.y + Math.cos(radians) * length * limb.scaleY
  }
}

/**
 * The finished skeleton: resting, with the pose's changes laid over it.
 *
 * **Hands and feet are worked out from the limbs rather than placed.** They were authored separately at first, and
 * every one of them floated a few units clear of the arm or leg it belonged to — a gap that is invisible while
 * reading the numbers and glaring the moment Orbi is on screen. Deriving them means a hand cannot come adrift in
 * any pose, including the half-finished ones a blend passes through.
 */
export function rigFor(pose: Pose, phase = 0): Rig {
  const changes = poseChanges(pose, phase)
  const out = {} as Rig
  for (const name of DRAW_ORDER) {
    out[name] = { ...RESTING[name], ...(changes[name] ?? {}) }
  }

  // Applied after the pose, so a pose that moves a limb cannot accidentally hide it.
  for (const limb of limbsFor(pose)) out[limb] = { ...out[limb], show: 1 }

  const leftHand = endOf(out.leftArm, ARM_LENGTH)
  const rightHand = endOf(out.rightArm, ARM_LENGTH)
  const leftFoot = endOf(out.leftLeg, LEG_LENGTH)
  const rightFoot = endOf(out.rightLeg, LEG_LENGTH)
  out.leftHand = { ...out.leftHand, x: leftHand.x, y: leftHand.y }
  out.rightHand = { ...out.rightHand, x: rightHand.x, y: rightHand.y }
  out.leftFoot = { ...out.leftFoot, x: leftFoot.x, y: leftFoot.y }
  out.rightFoot = { ...out.rightFoot, x: rightFoot.x, y: rightFoot.y }
  return out
}

/**
 * Halfway between two rigs.
 *
 * What makes a change of pose a movement rather than a jump cut, and the reason the parts are numbers. `amount` is
 * eased by the caller; this is the straight line between them.
 */
export function blendRigs(from: Rig, to: Rig, amount: number): Rig {
  const t = Math.max(0, Math.min(1, amount))
  const out = {} as Rig
  for (const name of DRAW_ORDER) {
    const a = from[name]
    const b = to[name]
    out[name] = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      rotate: a.rotate + (b.rotate - a.rotate) * t,
      scaleX: a.scaleX + (b.scaleX - a.scaleX) * t,
      scaleY: a.scaleY + (b.scaleY - a.scaleY) * t,
      // Blended like everything else, which is what makes an arm fade in rather than appear.
      show: a.show + (b.show - a.show) * t
    }
  }
  return out
}

/** Halfway between two faces. Shapes are not numbers, so they swap at the midpoint while the brows slide. */
export function blendFaces(from: Face, to: Face, amount: number): Face {
  const t = Math.max(0, Math.min(1, amount))
  return {
    eyes: t < 0.5 ? from.eyes : to.eyes,
    mouth: t < 0.5 ? from.mouth : to.mouth,
    brows: from.brows + (to.brows - from.brows) * t,
    eyeSpread: from.eyeSpread + (to.eyeSpread - from.eyeSpread) * t,
    blush: from.blush + (to.blush - from.blush) * t
  }
}

/** Smooth in and out, so a pose change starts and ends gently. */
export const ease = (t: number): number => {
  const x = Math.max(0, Math.min(1, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

// ---------------------------------------------------------------- who Orbi is being

/**
 * How Orbi carries itself, by personality.
 *
 * Six styles over one character, not six characters. Each is a handful of multipliers, which is why adding one is
 * cheap and why none of them can accidentally become a different creature.
 */
export type CharacterStyle = 'cute' | 'minimal' | 'futuristic' | 'academic' | 'competitive' | 'mature'

export interface StyleTraits {
  id: CharacterStyle
  name: string
  blurb: string
  /** How large the head is against the body. The single biggest lever on how young Orbi reads. */
  headScale: number
  /** How far the limbs travel. Minimal barely moves; cute overshoots. */
  motion: number
  /** Cheeks, sparkles, bounce. Off entirely for minimal and mature. */
  sweetness: number
  /** The ring's presence: thin and still, or wide and spinning. */
  ring: number
  /** Which accessory the style puts on by default, when nothing is chosen. Never overrides a choice. */
  defaultWear: string | null
}

export const STYLES: Readonly<Record<CharacterStyle, StyleTraits>> = {
  cute: { id: 'cute', name: 'Cute', blurb: 'Rounder, bouncier, and more expressive.', headScale: 1.12, motion: 1.15, sweetness: 1, ring: 0.9, defaultWear: null },
  minimal: { id: 'minimal', name: 'Minimal', blurb: 'Still and quiet. Barely moves unless something matters.', headScale: 1, motion: 0.45, sweetness: 0, ring: 0.6, defaultWear: null },
  futuristic: { id: 'futuristic', name: 'Futuristic', blurb: 'A brighter ring and a trace of light behind it.', headScale: 1.02, motion: 1, sweetness: 0.3, ring: 1.35, defaultWear: null },
  academic: { id: 'academic', name: 'Academic', blurb: 'Carries a book, and reacts to what you are studying.', headScale: 1.05, motion: 0.85, sweetness: 0.5, ring: 0.8, defaultWear: 'glasses' },
  competitive: { id: 'competitive', name: 'Competitive', blurb: 'Sharper and quicker, and keen on your personal bests.', headScale: 1, motion: 1.25, sweetness: 0.3, ring: 1.1, defaultWear: 'stopwatch' },
  mature: { id: 'mature', name: 'Grown-up', blurb: 'Plainer proportions and far less fuss.', headScale: 0.94, motion: 0.6, sweetness: 0, ring: 0.7, defaultWear: null }
}

/**
 * The style for a stored personality.
 *
 * The five old personalities are still what a profile has on disk, so they are mapped rather than migrated — a
 * saved setting must never become invalid because a list grew.
 */
export function styleFor(personality: OrbiPersonality | CharacterStyle): StyleTraits {
  if (personality in STYLES) return STYLES[personality as CharacterStyle]
  switch (personality) {
    case 'calm':
      return STYLES.minimal
    case 'energetic':
      return STYLES.competitive
    case 'playful':
      return STYLES.cute
    case 'academic':
      return STYLES.academic
    default:
      return STYLES.cute
  }
}

// ---------------------------------------------------------------- state to character

/**
 * What a session state looks like on Orbi's face and body.
 *
 * The one place the two vocabularies meet. Everything else in Student talks in states; everything in the drawing
 * talks in poses and expressions.
 */
export const FOR_STATE: Readonly<Record<OrbiState, { pose: Pose; expression: Expression }>> = {
  idle: { pose: 'stand', expression: 'idle' },
  ready: { pose: 'stand', expression: 'welcoming' },
  focused: { pose: 'sit', expression: 'studying' },
  thinking: { pose: 'stand', expression: 'thinking' },
  listening: { pose: 'stand', expression: 'listening' },
  explaining: { pose: 'point', expression: 'encouraging' },
  encouraging: { pose: 'wave', expression: 'encouraging' },
  curious: { pose: 'look-around', expression: 'curious' },
  break: { pose: 'stretch', expression: 'calm' },
  sleeping: { pose: 'sleep', expression: 'sleepy' },
  celebrating: { pose: 'celebrate', expression: 'celebrating' },
  'level-up': { pose: 'jump', expression: 'excited' },
  achievement: { pose: 'carry', expression: 'proud' },
  recovery: { pose: 'peek', expression: 'recovering' },
  'distraction-warning': { pose: 'shield', expression: 'guardian' },
  'focus-locked': { pose: 'sit', expression: 'determined' },
  error: { pose: 'stand', expression: 'concerned' },
  offline: { pose: 'sit', expression: 'calm' }
}

/** What Orbi is, in words, for a screen reader. Never relies on the drawing to carry the meaning. */
export function describe(pose: Pose, expression: Expression): string {
  const doing: Partial<Record<Pose, string>> = {
    sit: 'sitting',
    glide: 'gliding over',
    walk: 'walking over',
    run: 'running over',
    jump: 'jumping',
    wave: 'waving',
    point: 'pointing',
    stretch: 'stretching',
    read: 'reading',
    write: 'writing',
    sleep: 'asleep',
    hide: 'hiding',
    peek: 'peeking round the edge',
    celebrate: 'celebrating',
    dance: 'dancing',
    shield: 'standing in the way, shielding you',
    'look-around': 'looking around'
  }
  const feeling: Partial<Record<Expression, string>> = {
    studying: 'studying with you',
    guardian: 'on guard',
    'disappointed-but-kind': 'kind about it',
    recovering: 'waiting for you to carry on'
  }
  const action = doing[pose]
  const mood = feeling[expression] ?? expression.replace(/-/g, ' ')
  return action ? `Orbi, ${action}, ${mood}` : `Orbi, ${mood}`
}

// ---------------------------------------------------------------- where Orbi stands

/** How Orbi relates to a thing on the screen. The reason it is in the interface rather than beside it. */
export type AnchorKind = 'sit-on' | 'point-at' | 'press' | 'beside' | 'peek-behind' | 'guard' | 'carry-to'

export interface Anchored {
  /** Where Orbi's feet go, in pixels on the page. */
  x: number
  y: number
  pose: Pose
  /** True when Orbi should be drawn mirrored, because the thing is on its other side. */
  flip: boolean
  /** How big Orbi is here. Sitting on a small card means being small enough to sit on it. */
  size: number
}

/** A thing on the screen, as the geometry this needs. */
export interface Target {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where to stand to do something to a thing on the screen.
 *
 * Pure geometry on purpose: the component measures a real element and this decides, so the rule "Orbi sits on the
 * top edge of a card, a third in from the left" is written once and testable rather than guessed at per screen.
 */
export function anchorTo(kind: AnchorKind, target: Target, size = 64, viewport = { width: 1280, height: 800 }): Anchored {
  const middle = target.left + target.width / 2
  // Pointing from the left of something near the right edge would put Orbi off the screen.
  const roomOnRight = viewport.width - (target.left + target.width) > size * 1.4
  switch (kind) {
    case 'sit-on': {
      // Perched on the top edge, a third in, so it never covers the title.
      const small = Math.min(size, Math.max(32, target.height * 0.7))
      return { x: target.left + target.width / 3, y: target.top, pose: 'sit', flip: false, size: small }
    }
    case 'point-at':
      return roomOnRight
        ? { x: target.left - size * 0.75, y: target.top + target.height / 2, pose: 'point', flip: false, size }
        : { x: target.left + target.width + size * 0.75, y: target.top + target.height / 2, pose: 'point', flip: true, size }
    case 'press':
      return { x: target.left - size * 0.6, y: target.top + target.height / 2, pose: 'press', flip: false, size }
    case 'peek-behind':
      return { x: target.left + target.width - size * 0.3, y: target.top + target.height * 0.8, pose: 'peek', flip: true, size }
    case 'guard':
      // Dead centre of the thing being guarded, and bigger, because it is in the way on purpose.
      return { x: middle, y: target.top + target.height / 2, pose: 'shield', flip: false, size: size * 1.5 }
    case 'carry-to':
      return { x: target.left - size, y: target.top + target.height / 2, pose: 'carry', flip: false, size }
    case 'beside':
    default:
      return roomOnRight
        ? { x: target.left + target.width + size * 0.4, y: target.top + target.height / 2, pose: 'stand', flip: true, size }
        : { x: target.left - size * 0.4, y: target.top + target.height / 2, pose: 'stand', flip: false, size }
  }
}

/**
 * Whether Orbi may walk between two places, or should simply appear.
 *
 * Walking across a whole screen takes long enough to be annoying, and walking a few pixels is a twitch. Between
 * those, it is the thing that makes Orbi feel like it lives here.
 */
export function shouldWalk(from: { x: number; y: number }, to: { x: number; y: number }, reducedMotion: boolean): boolean {
  if (reducedMotion) return false
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  /*
   * Gliding goes further than legs ever could.
   *
   * When this was a walk, anything past about a screen's width had to give up and teleport, because watching a
   * small character trudge that far is a wait. A glide crosses the same distance in under a second, so the only
   * remaining rule is that a few pixels is a twitch rather than a journey.
   */
  return distance > 48
}

/** How long a walk takes, in milliseconds. Capped, because nobody waits for a mascot. */
export function walkTime(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  // Quick, and never long enough to wait for: a glide across a whole window takes under a second.
  return Math.min(950, Math.max(240, distance * 1.1))
}

/** Which way Orbi is heading, in degrees, so the lean and the trail point along the travel. */
export function headingOf(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI
}

/**
 * The trail behind a glide.
 *
 * Points along the path already covered, each fading with age. Returned as plain numbers so the component only
 * has to draw them — and so the shape of the trail is something a test can check rather than something that only
 * exists on screen.
 */
export function trailOf(
  from: { x: number; y: number },
  to: { x: number; y: number },
  through: number,
  count = 7
): { x: number; y: number; fade: number }[] {
  const at = Math.max(0, Math.min(1, through))
  if (at <= 0) return []
  const out: { x: number; y: number; fade: number }[] = []
  for (let i = 1; i <= count; i += 1) {
    // Spread back along the path behind where Orbi is now, never ahead of it.
    const behind = Math.max(0, at - (i / count) * 0.32)
    out.push({
      x: from.x + (to.x - from.x) * behind,
      y: from.y + (to.y - from.y) * behind,
      fade: (1 - i / (count + 1)) * Math.min(1, at * 3)
    })
  }
  return out
}
