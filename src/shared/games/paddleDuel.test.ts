import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bounceOffPaddle, COURT, duelScore, matchDone, MAX_BOUNCE, opponentAim, PADDLE_SKILL, predictCrossing, RALLY_STEP, SPEED_CAP, WIN_POINTS } from './paddleDuel.ts'
import type { Ball } from './paddleDuel.ts'

const rng = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

/**
 * Where the ball really ends up, worked out the slow way: run it until it hits a wall, turn it round, carry on. The
 * folding in predictCrossing has to agree with this, or the opponent is reading a ball that is not there.
 */
function playItOut(ball: Ball, lineX: number, top: number, bottom: number): number {
  let { x, y, vy } = ball
  const vx = ball.vx
  let left = (lineX - x) / vx
  for (let guard = 0; guard < 500 && left > 1e-12; guard++) {
    const wall = vy > 0 ? (bottom - y) / vy : vy < 0 ? (top - y) / vy : Infinity
    if (wall < left) {
      x += vx * wall
      y += vy * wall
      vy = -vy
      left -= wall
    } else {
      x += vx * left
      y += vy * left
      left = 0
    }
  }
  return y
}

test('the opponent reads the ball right, however many times it bounces', () => {
  const random = rng(606060)
  let steep = 0
  for (let i = 0; i < 3000; i++) {
    const ball: Ball = { x: 60 + random() * 880, y: random() * COURT.height, vx: (random() < 0.5 ? -1 : 1) * (120 + random() * 700), vy: (random() - 0.5) * 2400 }
    const lineX = ball.vx > 0 ? COURT.width - 20 : 20
    const predicted = predictCrossing(ball, lineX, 0, COURT.height)
    assert.ok(predicted !== null, 'the ball is on its way to that line')
    const played = playItOut(ball, lineX, 0, COURT.height)
    assert.ok(Math.abs(predicted - played) < 0.01, `read ${predicted} but the ball arrived at ${played}`)
    assert.ok(predicted >= -0.01 && predicted <= COURT.height + 0.01, 'and it stays on the court')
    if (Math.abs(ball.vy / ball.vx) > 3) steep++
  }
  assert.ok(steep > 200, `only ${steep} of the balls bounced much — the test was too easy`)
})

test('a ball going the other way, or straight up, cannot be read', () => {
  assert.equal(predictCrossing({ x: 500, y: 300, vx: -300, vy: 0 }, COURT.width - 20, 0, COURT.height), null)
  assert.equal(predictCrossing({ x: 500, y: 300, vx: 0, vy: 300 }, COURT.width - 20, 0, COURT.height), null)
  assert.equal(predictCrossing({ x: 500, y: 300, vx: 300, vy: 0 }, COURT.width - 20, 0, COURT.height), 300, 'a flat ball comes back flat')
})

test('where the ball hits the paddle is what decides the angle', () => {
  const base = { paddleCentre: 300, paddleHalf: 50, speed: 500, toRight: true }
  const middle = bounceOffPaddle({ ...base, ballY: 300 })
  assert.equal(Math.round(middle.vy), 0, 'the middle sends it straight back')
  assert.ok(middle.vx > 0, 'and away from the paddle')

  const top = bounceOffPaddle({ ...base, ballY: 250 })
  const bottom = bounceOffPaddle({ ...base, ballY: 350 })
  assert.ok(top.vy < 0 && bottom.vy > 0, 'the ends send it off at an angle')
  assert.equal(top.offset, -1)
  assert.equal(bottom.offset, 1)
  assert.ok(Math.abs(Math.atan2(top.vy, top.vx) + MAX_BOUNCE) < 1e-9, 'the end of the paddle is the sharpest angle there is')

  // Further out than the end of the paddle is still the end of the paddle.
  assert.equal(bounceOffPaddle({ ...base, ballY: 900 }).offset, 1)

  const halfway = bounceOffPaddle({ ...base, ballY: 325 })
  assert.ok(Math.abs(halfway.vy) < Math.abs(bottom.vy) && halfway.vy > 0, 'halfway out is halfway round')

  const left = bounceOffPaddle({ ...base, ballY: 325, toRight: false })
  assert.ok(left.vx < 0, 'the other paddle sends it the other way')

  // A moving paddle bends the ball, but never past the sharpest angle.
  const carried = bounceOffPaddle({ ...base, ballY: 300, paddleVy: 2000 })
  assert.ok(carried.vy > middle.vy, 'a paddle on the move drags the ball with it')
  for (const paddleVy of [-9000, -2000, 0, 2000, 9000])
    for (const ballY of [250, 300, 350]) {
      const hit = bounceOffPaddle({ ...base, ballY, paddleVy })
      assert.ok(Math.abs(Math.atan2(hit.vy, hit.vx)) <= MAX_BOUNCE + 1e-9, 'nothing leaves at more than sixty degrees')
    }
})

test('every return is faster than the last, up to a ceiling', () => {
  let speed = 430
  const seen: number[] = []
  for (let hit = 0; hit < 60; hit++) {
    const result = bounceOffPaddle({ ballY: 300, paddleCentre: 300, paddleHalf: 50, speed, toRight: hit % 2 === 0 })
    assert.ok(result.speed > speed - 1e-9)
    speed = result.speed
    seen.push(speed)
  }
  assert.ok(seen[1] > seen[0] * (RALLY_STEP - 0.001), 'the rally really does speed up')
  assert.equal(speed, SPEED_CAP, 'and stops at the ceiling rather than running away')
})

test('the opponent aims where the ball will be, off by its own steady error', () => {
  // Close enough to the line that every opponent is watching it.
  const ball: Ball = { x: 700, y: 200, vx: 600, vy: 250 }
  const lineX = COURT.width - 20
  const crossing = predictCrossing(ball, lineX, 0, COURT.height)!
  const honest = opponentAim(ball, lineX, PADDLE_SKILL.hard, 0, 60)
  assert.ok(Math.abs(honest - crossing) < 0.01, 'with no error it reads the ball exactly')

  const high = opponentAim(ball, lineX, PADDLE_SKILL.easy, -1, 60)
  const low = opponentAim(ball, lineX, PADDLE_SKILL.easy, 1, 60)
  assert.ok(high < crossing && low > crossing, 'the error pulls its aim off the ball either way')
  assert.ok(Math.abs(low - high) > PADDLE_SKILL.hard.error * COURT.height, 'the easy opponent is further out than the hard one')

  // Going the other way, it waits in the middle.
  const away: Ball = { x: 300, y: 120, vx: -600, vy: 250 }
  assert.equal(opponentAim(away, lineX, PADDLE_SKILL.hard, 0, 60), COURT.height / 2)
  // And it does not set off the instant the ball leaves the other paddle.
  const fresh: Ball = { x: 30, y: 500, vx: 500, vy: -100 }
  assert.equal(opponentAim(fresh, lineX, PADDLE_SKILL.easy, 0, 60), COURT.height / 2, 'the easy opponent reacts late')
  assert.notEqual(opponentAim(fresh, lineX, PADDLE_SKILL.hard, 0, 60), COURT.height / 2, 'the hard one is already moving')
  // Its aim never leaves the court.
  for (const bias of [-1, 1]) for (const y of [2, 598]) {
    const edge = opponentAim({ x: 760, y, vx: 600, vy: 0 }, lineX, PADDLE_SKILL.easy, bias, 60)
    assert.ok(edge >= 0 && edge <= COURT.height, `aimed at ${edge}, off the court`)
    assert.notEqual(edge, COURT.height / 2, 'it is watching this one')
  }
})

test('the harder opponent reaches more balls than the easy one', () => {
  const random = rng(8080)
  const reached = (skill: typeof PADDLE_SKILL.easy): number => {
    let saves = 0
    for (let rally = 0; rally < 300; rally++) {
      const ball: Ball = { x: 40, y: random() * COURT.height, vx: 300 + random() * 500, vy: (random() - 0.5) * 900 }
      const lineX = COURT.width - 20
      const bias = random() * 2 - 1
      let paddle = COURT.height / 2
      const steps = 240
      const step = (lineX - ball.x) / ball.vx / steps
      const moving = { ...ball }
      for (let i = 0; i < steps; i++) {
        const aim = opponentAim(moving, lineX, skill, bias, 60)
        const move = Math.min(skill.speed * step, Math.abs(aim - paddle))
        paddle += Math.sign(aim - paddle) * move
        moving.x += moving.vx * step
        moving.y += moving.vy * step
        if (moving.y < 0 || moving.y > COURT.height) moving.vy = -moving.vy
      }
      const arrival = predictCrossing(ball, lineX, 0, COURT.height)!
      if (Math.abs(arrival - paddle) <= 60) saves++
    }
    return saves
  }
  const easy = reached(PADDLE_SKILL.easy)
  const hard = reached(PADDLE_SKILL.hard)
  assert.ok(hard > easy + 20, `hard saved ${hard} and easy saved ${easy} out of 300`)
  assert.ok(easy < 290, 'the easy opponent has to miss some')
  assert.ok(hard > 240, 'the hard opponent should be hard to get past')
})

test('a match ends at seven, and the points say how it went', () => {
  assert.equal(matchDone(6, 6), false)
  assert.equal(matchDone(WIN_POINTS, 3), true)
  assert.equal(matchDone(2, WIN_POINTS), true)
  assert.ok(duelScore(7, 3, 20, 'normal') > duelScore(7, 3, 4, 'normal'), 'a long rally is worth something')
  assert.ok(duelScore(7, 6, 10, 'hard') > duelScore(7, 6, 10, 'easy'), 'beating the harder opponent is worth more')
  assert.ok(duelScore(7, 6, 10, 'normal') > duelScore(6, 7, 10, 'normal'), 'winning beats losing')
  assert.ok(duelScore(3, 7, 10, 'normal') > 0, 'a match played still counts for something')
})
