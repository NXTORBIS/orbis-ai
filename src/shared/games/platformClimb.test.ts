import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GRAVITY, JUMP_V, LEDGE_W, SPRING_V, START_LEDGE, WIDTH, bounceFrom, climbScore, ledgeWords, ledgeX, makeLedges, maxRise, reach, reachable } from './platformClimb.ts'
import type { Difficulty, Ledge } from './platformClimb.ts'

const ledge = (over: Partial<Ledge>): Ledge => ({ y: 0, x: 0, kind: 'solid', span: 0, period: 0, ...over })

test('the bounce is always the same height, and that height is where every other number comes from', () => {
  // Rise, worked out by hand: up until the speed runs out.
  let y = 0
  let v = JUMP_V
  const dt = 1 / 2000
  let highest = 0
  for (let i = 0; i < 4000; i++) {
    v -= GRAVITY * dt
    y += v * dt
    highest = Math.max(highest, y)
  }
  assert.ok(Math.abs(highest - maxRise()) < 1, `a bounce reaches ${highest.toFixed(1)}, not ${maxRise().toFixed(1)}`)
  assert.equal(bounceFrom('solid'), JUMP_V)
  assert.equal(bounceFrom('crumble'), JUMP_V, 'a crumbling ledge still throws you up; it is simply not there afterwards')
  assert.equal(bounceFrom('moving'), JUMP_V)
  assert.equal(bounceFrom('spring'), SPRING_V)
  assert.ok(maxRise(SPRING_V) > maxRise() * 2.5, 'a spring is worth looking for')
})

test('how far you can travel sideways falls away as the climb gets taller, and runs out at the top of the bounce', () => {
  assert.ok(reach(0) > reach(80))
  assert.ok(reach(80) > reach(150))
  assert.equal(reach(maxRise() + 1), 0, 'higher than a bounce goes is no distance at all')
  assert.ok(reach(maxRise()) > 0)
})

test('a jump is only called possible when it is possible at the worst moment', () => {
  const from = ledge({ y: 0, x: 0 })
  assert.equal(reachable(from, ledge({ y: 140, x: 10 })), true)
  assert.equal(reachable(from, ledge({ y: maxRise() + 5, x: 0 })), false, 'higher than a bounce reaches')
  assert.equal(reachable(from, ledge({ y: 100, x: WIDTH / 2 })), false, 'half a screen across while climbing a hundred')
  // Going off one side and coming back on the other is a real way across.
  assert.equal(reachable(ledge({ y: 0, x: 4 }), ledge({ y: 60, x: WIDTH - 20 })), true)
  // A sliding ledge is judged from both ends of its travel, not from where it happens to be.
  const slider = ledge({ y: 0, x: 0, kind: 'moving', span: 120, period: 3 })
  assert.equal(reachable(slider, ledge({ y: 120, x: 200 })), false, 'it would only be possible with the slider at the near end of its travel')
  assert.equal(reachable(ledge({ y: 0, x: 0 }), ledge({ y: 120, x: 170 })), true, 'and the same jump from a ledge that holds still is fine')
  assert.equal(reachable(slider, ledge({ y: 60, x: 60 })), true)
  assert.equal(reachable(from, ledge({ y: -30, x: 300 })), true, 'anything below you is reachable by falling')
})

test('a sliding ledge slides out and back and never leaves the screen', () => {
  const slider = ledge({ x: 40, span: 100, period: 4 })
  assert.equal(ledgeX(slider, 0), 40)
  assert.equal(ledgeX(slider, 2), 140, 'the far end, halfway through')
  assert.equal(ledgeX(slider, 4), 40, 'and back again')
  assert.ok(Math.abs(ledgeX(slider, 1) - 90) < 0.001, 'at a steady speed, not a drifting one')
  assert.equal(ledgeX(ledge({ x: 70 }), 9), 70, 'a still ledge does not move')
})

test('every ledge of a climb can be reached from the one below it, over three hundred ledges and fifty seeds', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 50; seed++) {
      let below = START_LEDGE
      for (let chunk = 0; chunk < 6; chunk++) {
        const ledges = makeLedges(seed, difficulty, below, chunk * 50, 50)
        assert.equal(ledges.length, 50)
        for (const next of ledges) {
          assert.ok(next.y > below.y, 'the climb only goes up')
          assert.ok(reachable(below, next), `${difficulty} seed ${seed}: a ledge at ${next.y} cannot be reached from ${below.y}`)
          assert.ok(next.x >= 0 && next.x + next.span + LEDGE_W <= WIDTH + 0.001, 'a ledge off the side of the screen')
          if (next.kind === 'moving') assert.ok(next.span > 0 && next.period > 0)
          else assert.equal(next.span, 0)
          seen.add(next.kind)
          below = next
        }
      }
    }
    assert.deepEqual([...seen].sort(), ['crumble', 'moving', 'solid', 'spring'], `${difficulty} never made one of the four kinds`)
  }
})

test('the same seed gives the same climb, and a different one does not', () => {
  const first = makeLedges(42, 'normal', START_LEDGE, 0, 20)
  assert.deepEqual(makeLedges(42, 'normal', START_LEDGE, 0, 20), first)
  assert.notDeepEqual(makeLedges(43, 'normal', START_LEDGE, 0, 20), first)
})

test('a harder climb has more that moves and more that breaks', () => {
  const count = (difficulty: Difficulty, kind: string): number => {
    let below = START_LEDGE
    let found = 0
    for (let chunk = 0; chunk < 4; chunk++) {
      for (const one of makeLedges(5, difficulty, below, chunk * 50, 50)) {
        if (one.kind === kind) found++
        below = one
      }
    }
    return found
  }
  assert.ok(count('hard', 'moving') > count('easy', 'moving'))
  assert.ok(count('hard', 'crumble') > count('easy', 'crumble'))
  assert.ok(count('easy', 'solid') > count('hard', 'solid'))
})

test('the score counts the height climbed and nothing else', () => {
  assert.equal(climbScore(0), 0)
  assert.equal(climbScore(-500), 0, 'falling back down is not worth minus points')
  assert.ok(climbScore(6000) > climbScore(600))
  assert.equal(climbScore(600), climbScore(600))
  assert.match(ledgeWords('spring'), /higher/)
  assert.equal(ledgeWords('solid'), '', 'nothing to say about an ordinary ledge')
})
