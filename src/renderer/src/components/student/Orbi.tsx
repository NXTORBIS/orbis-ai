import { useEffect, useMemo, useRef, useState } from 'react'
import { atmosphere } from './atmosphere'
import type { OrbiBehaviour, OrbiState } from '../../../../shared/student/types'
import { ANIMATIONS, ambient, frame, nextAnimation, tierFor, type AnimFrame, type OrbiMoment, type Playing } from '../../../../shared/student/orbiAnim'
import OrbiBody from './OrbiBody'
import {
  FACES,
  FOR_STATE,
  blendFaces,
  blendRigs,
  describe as describeOrbi,
  ease,
  rigFor,
  styleFor,
  type Expression,
  type Pose
} from '../../../../shared/student/orbiCharacter'

/**
 * Orbi.
 *
 * A small original shape: a sphere with a ring around it, tilted, like something in orbit. Not a face with limbs and
 * not an animal -- the point is that it belongs in Orbis, where rings and orbits are already the visual language,
 * and that it stays recognisable at sixteen pixels in a corner.
 *
 * ## Four things it expresses itself with
 *
 * The eyes, the ring, the glow, and how far it floats. A deliberately small vocabulary: every state has to be
 * legible at a glance and distinguishable **without colour and without motion**, and a companion with forty poses
 * is one whose poses nobody learns.
 *
 * ## What makes it feel physical
 *
 * Three things, and none of them is a physics engine:
 *
 *   - **the ring lags the body.** When Orbi is dragged, the body follows the pointer, the ring follows the body a
 *     frame or two later, and the particles later still. That single delay is most of what separates "a picture
 *     moving" from "a thing with weight".
 *   - **it settles rather than stopping.** Released, it overshoots slightly and comes back.
 *   - **it looks at the pointer.** The eyes turn a few degrees toward the cursor when it is close by, and forget
 *     about it when it leaves.
 *
 * ## It is never load-bearing
 *
 * If this component threw, the timer, the policy and the learning would carry on -- nothing asks Orbi anything. It
 * is also genuinely cheap: transforms and opacity only, no canvas, one `requestAnimationFrame` loop that stops
 * itself whenever nothing is moving, and a low-power path that drops the particles first.
 */

export interface OrbiProps {
  /** What Orbi is, from the session and the student's own state. Used when no moment is playing. */
  state: OrbiState
  behaviour: OrbiBehaviour
  reducedMotion: boolean
  /** What just happened, if anything. Priorities decide whether it plays. */
  moment?: OrbiMoment | null
  /** What Orbi is saying, if anything. */
  says?: string | null
  size?: number
  onClick?(): void
  /** Set when Orbi is a presence beside the work rather than a thing on the page. */
  floating?: boolean
  /**
   * What Orbi's body should be doing, when something on the screen has asked.
   *
   * Left alone, the pose comes from the session state. Set by the tour and by anything anchoring Orbi to an
   * element -- sitting on a card, pointing at a button -- so a screen can borrow Orbi without owning its state.
   */
  pose?: Pose | null
  expression?: Expression | null
  /** Drawn mirrored, for when the thing Orbi is pointing at is on its other side. */
  flip?: boolean
  /** What Orbi is actually wearing. Only what has been unlocked ever reaches here. */
  worn?: readonly string[]
  /** The student's level, which decides how Orbi looks. */
  level?: number
  /** A town the student typed in, when they want Orbi to move with the weather. Nothing is looked up without it. */
  weatherCity?: string | null
  /** Where it sits, as a fraction of the window. Set when the student has moved it. */
  at?: { x: number; y: number } | null
  onMove?(at: { x: number; y: number }): void
}

/** What each state looks like. Colour is never the only difference -- see `eyes` and `tilt`. */
const LOOKS: Record<OrbiState, { eyes: 'open' | 'narrow' | 'closed' | 'wide' | 'happy' | 'thinking' | 'determined'; tilt: number; tone: string; label: string }> = {
  idle: { eyes: 'narrow', tilt: 14, tone: 'calm', label: 'Orbi is waiting' },
  ready: { eyes: 'open', tilt: 18, tone: 'calm', label: 'Orbi is ready' },
  focused: { eyes: 'narrow', tilt: 8, tone: 'focus', label: 'Orbi is focusing with you' },
  thinking: { eyes: 'thinking', tilt: 22, tone: 'calm', label: 'Orbi is thinking' },
  listening: { eyes: 'wide', tilt: 16, tone: 'calm', label: 'Orbi is listening' },
  explaining: { eyes: 'open', tilt: 12, tone: 'calm', label: 'Orbi is explaining' },
  encouraging: { eyes: 'happy', tilt: 20, tone: 'good', label: 'Orbi is cheering you on' },
  curious: { eyes: 'wide', tilt: 26, tone: 'calm', label: 'Orbi is curious' },
  break: { eyes: 'closed', tilt: 30, tone: 'rest', label: 'Orbi is resting' },
  sleeping: { eyes: 'closed', tilt: 34, tone: 'rest', label: 'Orbi is asleep' },
  celebrating: { eyes: 'happy', tilt: 10, tone: 'good', label: 'Orbi is celebrating' },
  'level-up': { eyes: 'happy', tilt: 0, tone: 'good', label: 'Orbi is celebrating a new level' },
  achievement: { eyes: 'happy', tilt: 6, tone: 'good', label: 'Orbi is celebrating an achievement' },
  recovery: { eyes: 'open', tilt: 24, tone: 'calm', label: 'Orbi is waiting for you to carry on' },
  'distraction-warning': { eyes: 'determined', tilt: 4, tone: 'warn', label: 'Orbi noticed a distraction' },
  'focus-locked': { eyes: 'narrow', tilt: 0, tone: 'focus', label: 'Orbi is in a locked session' },
  error: { eyes: 'narrow', tilt: 40, tone: 'warn', label: 'Something went wrong' },
  offline: { eyes: 'closed', tilt: 36, tone: 'rest', label: 'Orbi is offline' }
}

/** Accessories, drawn only when unlocked, worn, and there is room for them. */
function Accessory({ id, size }: { id: string; size: number }): React.JSX.Element | null {
  const s = size / 100
  switch (id) {
    case 'orbi-headphones':
      return (
        <g className="orbi-acc" aria-hidden>
          <path d={`M ${22 * s} ${44 * s} A ${28 * s} ${28 * s} 0 0 1 ${78 * s} ${44 * s}`} fill="none" stroke="currentColor" strokeWidth={5 * s} strokeLinecap="round" />
          <rect x={14 * s} y={42 * s} width={12 * s} height={20 * s} rx={5 * s} fill="currentColor" />
          <rect x={74 * s} y={42 * s} width={12 * s} height={20 * s} rx={5 * s} fill="currentColor" />
        </g>
      )
    case 'orbi-glasses':
      return (
        <g className="orbi-acc" aria-hidden>
          <circle cx={40 * s} cy={50 * s} r={10 * s} fill="none" stroke="currentColor" strokeWidth={3 * s} />
          <circle cx={60 * s} cy={50 * s} r={10 * s} fill="none" stroke="currentColor" strokeWidth={3 * s} />
        </g>
      )
    case 'orbi-cap':
      return (
        <g className="orbi-acc" aria-hidden>
          <path d={`M ${28 * s} ${30 * s} L ${50 * s} ${20 * s} L ${72 * s} ${30 * s} L ${50 * s} ${40 * s} Z`} fill="currentColor" />
          <path d={`M ${68 * s} ${32 * s} v ${12 * s}`} stroke="currentColor" strokeWidth={2 * s} />
        </g>
      )
    case 'orbi-hoodie':
      return (
        <g className="orbi-acc" aria-hidden>
          <path d={`M ${26 * s} ${74 * s} q ${24 * s} ${14 * s} ${48 * s} 0`} fill="none" stroke="currentColor" strokeWidth={6 * s} strokeLinecap="round" />
        </g>
      )
    case 'orbi-labcoat':
      return (
        <g className="orbi-acc" aria-hidden>
          <path d={`M ${30 * s} ${76 * s} L ${50 * s} ${86 * s} L ${70 * s} ${76 * s}`} fill="none" stroke="currentColor" strokeWidth={5 * s} strokeLinecap="round" />
        </g>
      )
    case 'orbi-backpack':
      return (
        <g className="orbi-acc" aria-hidden>
          <rect x={74 * s} y={52 * s} width={16 * s} height={20 * s} rx={5 * s} fill="currentColor" opacity={0.85} />
        </g>
      )
    case 'orbi-tablet':
      return (
        <g className="orbi-acc" aria-hidden>
          <rect x={64 * s} y={64 * s} width={22 * s} height={16 * s} rx={3 * s} fill="none" stroke="currentColor" strokeWidth={2.5 * s} />
        </g>
      )
    default:
      return null
  }
}

/** Whether the machine is busy enough that Orbi should do less. Measured, never guessed. */
function useLowPower(active: boolean): boolean {
  const [low, setLow] = useState(false)
  useEffect(() => {
    if (!active) return
    let frames = 0
    let since = performance.now()
    let running = true
    let handle = 0
    const tick = (): void => {
      if (!running) return
      frames += 1
      const now = performance.now()
      if (now - since >= 2000) {
        // Under about forty frames a second for two seconds: something else needs the machine more than Orbi does.
        setLow(frames / ((now - since) / 1000) < 40)
        frames = 0
        since = now
      }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(handle)
    }
  }, [active])
  return low
}

/** The part of the day, in the words a person would use. */
function partOfDay(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

export default function Orbi({
  state,
  behaviour,
  reducedMotion,
  moment = null,
  says,
  size = 96,
  onClick,
  floating,
  worn = [],
  pose: askedPose = null,
  expression: askedExpression = null,
  flip = false,
  level = 1,
  at = null,
  weatherCity = null,
  onMove
}: OrbiProps): React.JSX.Element | null {
  const [bubble, setBubble] = useState<string | null>(null)
  const [hovering, setHovering] = useState(false)
  const [toward, setToward] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [playing, setPlaying] = useState<Playing | null>(null)
  /**
   * How loud the atmosphere is, and what time of day it is.
   *
   * Both are *looked at*, never assumed: the loudness is read from the audio engine actually playing, so Orbi moves
   * with the sound that exists rather than with a guess about it, and goes still the instant the sound stops. Both
   * are off entirely when movement is switched off or the machine is struggling -- a companion that burns a battery
   * to shimmer is a companion somebody turns off.
   */
  const [loud, setLoud] = useState(0)
  /**
   * What it is doing outside, when Orbis already knows.
   *
   * Only read from the weather widget the student set up themselves -- Student never asks for a location and never
   * goes looking. With no widget, this stays null and Orbi drifts the way it always does.
   */
  const [weather, setWeather] = useState<'rain' | 'clear' | 'snow' | null>(null)
  const [, redraw] = useState(0)
  const holder = useRef<HTMLDivElement>(null)
  const grabbed = useRef<{ dx: number; dy: number } | null>(null)
  const lowPower = useLowPower(behaviour.animation !== 'off' && !reducedMotion)

  const enabled = behaviour.enabled && behaviour.visibility !== 'hidden'
  const moving = enabled && !reducedMotion && behaviour.animation !== 'off' && !lowPower
  const tier = tierFor(level)

  // What Orbi said stays up for a few seconds and then goes. A message that waits to be dismissed is in the way.
  useEffect(() => {
    if (!says) return
    setBubble(says)
    const timer = setTimeout(() => setBubble(null), 6000)
    return () => clearTimeout(timer)
  }, [says])

  /** The animation decision, made by the shared priority rules rather than here. */
  useEffect(() => {
    if (!enabled) return
    const ambientNow = ambient({ session: null, idleMinutes: 0, hour: new Date().getHours(), hovering, dragging: drag !== null, thinking: state === 'thinking', weather })
    setPlaying((held) => nextAnimation(held, moment, ambientNow, Date.now()))
  }, [moment, hovering, drag, state, enabled])

  /**
   * One loop, and only while something is actually finishing.
   *
   * The ambient animations are pure CSS and need no JavaScript at all; this exists so a timed moment can hand back
   * to the ambient layer at the right instant. With nothing timed running, nothing runs.
   */
  useEffect(() => {
    if (!playing?.endsAt) return
    let handle = 0
    const tick = (): void => {
      if (Date.now() >= (playing.endsAt as number)) {
        const ambientNow = ambient({ session: null, idleMinutes: 0, hour: new Date().getHours(), hovering, dragging: drag !== null, thinking: state === 'thinking', weather })
        setPlaying(nextAnimation(playing, null, ambientNow, Date.now()))
        return
      }
      redraw((one) => one + 1)
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing, hovering, drag, state])

  /**
   * Moving with the sound.
   *
   * Four readings a second, not sixty: this drives a CSS variable the stylesheet eases between, so the picture is
   * smooth while the measuring is cheap. With nothing playing the engine reports zero and the loop stops asking.
   */
  useEffect(() => {
    if (!moving) {
      setLoud(0)
      return
    }
    let stopped = false
    const read = (): void => {
      if (stopped) return
      const engine = atmosphere()
      const next = engine.active ? engine.loudness() : 0
      setLoud((held) => (Math.abs(held - next) < 0.03 ? held : next))
    }
    read()
    const timer = setInterval(read, 250)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [moving])

  useEffect(() => {
    if (!moving) return
    let stopped = false
    const look = async (): Promise<void> => {
      try {
        if (!weatherCity) return
        const out = await window.api.widgetWeather(weatherCity)
        const symbol = out.ok ? String(out.data.now.symbol ?? '') : ''
        if (stopped || !symbol) return
        // MET Norway's own codes, read literally: rain, snow, or a clear sky. Anything else is nothing in particular.
        setWeather(/rain|sleet|drizzle|thunder/.test(symbol) ? 'rain' : /snow/.test(symbol) ? 'snow' : /clearsky|fair/.test(symbol) ? 'clear' : null)
      } catch {
        // No widget, no network, no weather. Orbi carries on exactly as before.
      }
    }
    void look()
    // Weather changes slowly; this is a quarter-hourly look, not a poll.
    const timer = setInterval(() => void look(), 900_000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [moving, weatherCity])

  /** The eyes turn toward the pointer when it is nearby, and forget about it when it is not. */
  useEffect(() => {
    if (!enabled || reducedMotion || behaviour.animation === 'off' || lowPower) return
    const onPointer = (event: PointerEvent): void => {
      const box = holder.current?.getBoundingClientRect()
      if (!box) return
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2
      const dx = event.clientX - cx
      const dy = event.clientY - cy
      const away = Math.hypot(dx, dy)
      if (away > 320) {
        setToward((held) => (held.x === 0 && held.y === 0 ? held : { x: 0, y: 0 }))
        return
      }
      const reach = Math.max(1, away)
      setToward({ x: Math.max(-1, Math.min(1, dx / reach)), y: Math.max(-1, Math.min(1, dy / reach)) })
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    return () => window.removeEventListener('pointermove', onPointer)
  }, [enabled, reducedMotion, behaviour.animation, lowPower])

  /**
   * Dragging, with the pointer captured.
   *
   * Capture matters: without it, a quick drag that leaves the element stops getting events and Orbi is left stuck
   * halfway. Everything is in window fractions so the position survives the window being resized.
   */
  const startDrag = (event: React.PointerEvent): void => {
    if (!onMove || !floating) return
    const box = holder.current?.getBoundingClientRect()
    if (!box) return
    grabbed.current = { dx: event.clientX - (box.left + box.width / 2), dy: event.clientY - (box.top + box.height / 2) }
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
    setDrag({ x: event.clientX, y: event.clientY })
  }

  useEffect(() => {
    if (!drag || !onMove) return
    const onPointer = (event: PointerEvent): void => setDrag({ x: event.clientX, y: event.clientY })
    const onUp = (event: PointerEvent): void => {
      const held = grabbed.current
      grabbed.current = null
      setDrag(null)
      if (!held) return
      const x = (event.clientX - held.dx) / Math.max(1, window.innerWidth)
      const y = (event.clientY - held.dy) / Math.max(1, window.innerHeight)
      onMove({ x: Math.max(0.03, Math.min(0.97, x)), y: Math.max(0.08, Math.min(0.95, y)) })
    }
    window.addEventListener('pointermove', onPointer)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag, onMove])

  const anim: AnimFrame = useMemo(
    () => (playing ? frame(playing, Date.now(), behaviour, lowPower, reducedMotion) : { moment: 'idle', state, ring: 0.5, float: 4, glow: 0.3, particles: false, through: 0 }),
    [playing, behaviour, lowPower, reducedMotion, state]
  )

  // A moment's own state wins while it plays; otherwise Orbi is whatever the session says it is.
  const shown: OrbiState = playing && ANIMATIONS[playing.moment].priority <= 2 ? anim.state : state
  const look = LOOKS[shown] ?? LOOKS.ready
  const traits = styleFor(behaviour.personality)

  /*
   * What the body is doing, and the move into it.
   *
   * A change of pose is eased over a fifth of a second rather than swapped, which is the whole difference between
   * a character turning round and a jump cut. The previous pose is kept in a ref because the blend needs both
   * ends, and a state would re-render on every frame of the blend for no reason.
   */
  const fromState = FOR_STATE[shown] ?? FOR_STATE.ready
  const pose: Pose = askedPose ?? fromState.pose
  const expression: Expression = askedExpression ?? fromState.expression
  const previous = useRef<{ pose: Pose; expression: Expression; at: number }>({ pose, expression, at: 0 })
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    if (previous.current.pose === pose && previous.current.expression === expression) return
    previous.current = { pose: previous.current.pose, expression: previous.current.expression, at: Date.now() }
    const held = { pose, expression }
    const timer = setTimeout(() => {
      previous.current = { ...held, at: 0 }
    }, 240)
    return () => clearTimeout(timer)
  }, [pose, expression])

  /*
   * The cycle a walk, a dance or a celebration runs on.
   *
   * Stopped entirely for the poses that do not move and whenever motion is reduced, so a still Orbi costs nothing
   * at all rather than ticking quietly behind a static picture.
   */
  const cycling = !reducedMotion && behaviour.animation !== 'off' && ['walk', 'run', 'dance', 'celebrate', 'wave', 'look-around', 'stand'].includes(pose)
  useEffect(() => {
    if (!cycling) {
      setPhase(0)
      return
    }
    let handle = 0
    const speed = pose === 'run' ? 620 : pose === 'walk' ? 900 : pose === 'stand' ? 3600 : 1200
    const start = Date.now()
    const tick = (): void => {
      setPhase(((Date.now() - start) % speed) / speed)
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [cycling, pose])

  const blend = previous.current.at > 0 ? ease(Math.min(1, (Date.now() - previous.current.at) / 240)) : 1
  const rig = blend >= 1 ? rigFor(pose, phase) : blendRigs(rigFor(previous.current.pose, phase), rigFor(pose, phase), blend)
  const faceNow = blend >= 1 ? FACES[expression] : blendFaces(FACES[previous.current.expression], FACES[expression], blend)

  const scale = behaviour.size === 'small' ? 0.7 : behaviour.size === 'large' ? 1.3 : 1
  const px = Math.round(size * scale)
  const s = px / 100

  const style = useMemo(() => {
    const out: Record<string, string> = {
      '--orbi-size': `${px}px`,
      '--orbi-tilt': `${look.tilt}deg`,
      // A ring that is not turning is written as zero, so the animation can be switched off rather than slowed to a crawl.
      '--orbi-spin': anim.ring <= 0 ? '0s' : `${Math.max(1.4, 26 / anim.ring)}s`,
      '--orbi-glow': String(anim.glow),
      '--orbi-float': `${anim.float}px`,
      '--orbi-burst': String(anim.through),
      // The sound, and the hour. Both are plain numbers the stylesheet decides what to do with.
      '--orbi-loud': loud.toFixed(2),
      '--orbi-hour': String(new Date().getHours())
    }
    if (at && floating) {
      out.left = `${at.x * 100}%`
      out.top = `${at.y * 100}%`
      out.right = 'auto'
      out.bottom = 'auto'
      out.transform = 'translate(-50%, -50%)'
    }
    if (drag && grabbed.current) {
      out.left = `${drag.x - grabbed.current.dx}px`
      out.top = `${drag.y - grabbed.current.dy}px`
      out.right = 'auto'
      out.bottom = 'auto'
      out.transform = 'translate(-50%, -50%)'
    }
    return out as React.CSSProperties
  }, [loud, px, look.tilt, anim.ring, anim.glow, anim.float, anim.through, at, floating, drag])

  if (!enabled) return null

  // At the smallest size there is nowhere to put accessories, so they are left off rather than drawn as smudges.
  const wearing = behaviour.visibility === 'minimal' || px < 56 ? [] : worn
  const rings = tier.id === 'orbit-master' ? 3 : tier.id === 'quantum' ? 2 : 1
  /*
   * What Orbi is, in words.
   *
   * Said from the pose and the expression rather than from the state's label, so a screen reader hears "pointing"
   * when Orbi is pointing -- the state alone cannot know that a screen asked for a different pose.
   */
  const described = describeOrbi(pose, expression)

  const body = (
    <svg viewBox={`0 0 ${px} ${px}`} width={px} height={px} role="img" aria-label={described} className="orbi-svg">
      <defs>
        <radialGradient id={`orbi-sphere-${tier.id}`} cx="35%" cy="30%">
          <stop offset="0%" stopColor="var(--orbi-light)" />
          <stop offset="55%" stopColor="var(--orbi-mid)" />
          <stop offset="100%" stopColor="var(--orbi-deep)" />
        </radialGradient>
      </defs>

      {/*
        * The extra rings a high tier earns.
        *
        * The character's own ring comes from the rig, so these are the ones *beyond* the first -- which is why a
        * new student has exactly one and nothing here draws a second copy of it.
        */}
      {Array.from({ length: Math.max(0, rings - 1) }, (_, i) => (
        <g key={i} className="orbi-ring-group" style={{ ['--orbi-ring-offset' as string]: `${(i + 1) * 30}deg`, ['--orbi-ring-delay' as string]: `${(i + 1) * -4}s` }}>
          <ellipse
            cx={rig.ring.x * s}
            cy={rig.ring.y * s}
            rx={(36 - i * 6) * s}
            ry={(11 - i * 2) * s}
            fill="none"
            stroke="var(--orbi-ring)"
            strokeWidth={1.8 * s}
            className="orbi-ring"
            opacity={0.6}
          />
        </g>
      ))}

      {/* The shield: the ring opening out, rather than a separate graphic. */}
      {shown === 'distraction-warning' ? <circle cx={rig.ring.x * s} cy={rig.ring.y * s} r={44 * s} fill="none" stroke="var(--orbi-ring)" strokeWidth={2 * s} className="orbi-shield" /> : null}

      {/* Orbi itself: a skeleton of parts, placed by the rig. Everything around it is weather. */}
      <OrbiBody
        rig={rig}
        face={faceNow}
        size={px}
        flip={flip}
        traits={traits}
        toward={toward}
        glow={anim.glow}
        // At the smallest sizes lines beat fills: a filled shape at sixteen pixels is a blob.
        plain={px < 40}
      />
      {tier.id === 'astral' || tier.id === 'orbit-master' ? (
        <g className="orbi-stars" aria-hidden>
          <circle cx={22 * s} cy={26 * s} r={1.4 * s} fill="var(--orbi-glint)" />
          <circle cx={78 * s} cy={22 * s} r={1.1 * s} fill="var(--orbi-glint)" />
          <circle cx={74 * s} cy={66 * s} r={1.3 * s} fill="var(--orbi-glint)" />
        </g>
      ) : null}

      <g className="orbi-accs" style={{ color: 'var(--orbi-acc)' }}>
        {wearing.map((id) => (
          <Accessory key={id} id={id} size={px} />
        ))}
      </g>

      {/* Particles, only for a moment that earns them and only when the machine can spare it. */}
      {anim.particles ? (
        <g className="orbi-particles" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <circle key={i} cx={50 * s} cy={52 * s} r={1.6 * s} fill="var(--orbi-ring)" style={{ ['--orbi-p' as string]: String(i) }} />
          ))}
        </g>
      ) : null}
    </svg>
  )

  const classes = [
    'orbi',
    `orbi-${look.tone}`,
    // The part of the day, so the colour around Orbi can follow the window rather than the clock being read out.
    `orbi-${partOfDay(new Date().getHours())}`,
    `orbi-tier-${tier.id}`,
    floating ? 'orbi-floating' : '',
    anim.float === 0 && anim.ring === 0 ? 'orbi-still' : lowPower || behaviour.animation === 'reduced' ? 'orbi-simple' : '',
    behaviour.visibility === 'compact' ? 'orbi-compact' : '',
    drag ? 'orbi-dragging' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={holder}
      className={classes}
      style={style}
      data-state={shown}
      data-moment={anim.moment}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onPointerDown={startDrag}
    >
      {bubble && behaviour.messages !== 'off' ? (
        // Announced politely: worth reading, never worth interrupting what somebody is doing.
        <div className="orbi-says" role="status" aria-live="polite">
          {bubble}
        </div>
      ) : null}
      {onClick ? (
        <button type="button" className="orbi-press" onClick={onClick} aria-label={`${described}. Open Orbi.`}>
          {body}
        </button>
      ) : (
        body
      )}
    </div>
  )
}

/** Orbi's wearable things, filtered to what is unlocked. Used by the collection and the room. */
export function wearable(unlocked: readonly string[]): string[] {
  return ['orbi-headphones', 'orbi-glasses', 'orbi-cap', 'orbi-hoodie', 'orbi-labcoat', 'orbi-backpack', 'orbi-tablet'].filter((one) => unlocked.includes(one))
}
