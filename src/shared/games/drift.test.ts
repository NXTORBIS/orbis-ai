import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DRIFT_LEVELS, FIELD, hitsRock, jumpSpot, makeRock, overlaps, ROCK_RADIUS, rockScore, splitRock, waveBonus, waveCount, waveRocks, waveSpeed, wrap, wrappedGap } from './drift.ts'
import type { Rock, RockSize } from './drift.ts'

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

const speedOf = (rock: Rock): number => Math.hypot(rock.vx, rock.vy)

test('the field has no edges: leaving one side brings you in at the other', () => {
  assert.equal(wrap(-10, FIELD.width), FIELD.width - 10)
  assert.equal(wrap(FIELD.width + 10, FIELD.width), 10)
  assert.equal(wrap(300, FIELD.width), 300)
  assert.equal(wrappedGap(5, FIELD.width - 5, FIELD.width), -10, 'the short way round is backwards')
  assert.equal(wrappedGap(5, 25, FIELD.width), 20)
  assert.equal(overlaps(5, 300, 10, FIELD.width - 5, 300, 10), true, 'two things either side of the seam touch')
  assert.equal(overlaps(5, 300, 10, 500, 300, 10), false)
})

test('a shot breaks a rock into two of the next size down, and they come out faster', () => {
  const random = rng(31337)
  for (const size of [3, 2] as RockSize[]) {
    const rock = makeRock(400, 300, size, 80, random)
    const pieces = splitRock(rock, random)
    assert.equal(pieces.length, 2, `a size ${size} rock breaks in two`)
    for (const piece of pieces) {
      assert.equal(piece.size, size - 1)
      assert.equal(piece.x, rock.x)
      assert.equal(piece.y, rock.y)
      assert.ok(ROCK_RADIUS[piece.size] < ROCK_RADIUS[rock.size], 'the pieces are smaller')
      assert.ok(speedOf(piece) > speedOf(rock), `a piece at ${speedOf(piece)} should beat the rock at ${speedOf(rock)}`)
      assert.ok(piece.rim.length > 6, 'a piece has an outline of its own')
    }
    // They go different ways, or it would look like one rock.
    assert.notEqual(Math.atan2(pieces[0].vy, pieces[0].vx), Math.atan2(pieces[1].vy, pieces[1].vx))
  }
  assert.deepEqual(splitRock(makeRock(0, 0, 1, 50, random), random), [], 'a small rock leaves nothing behind')
})

test('clearing one big rock to nothing is worth the same every time', () => {
  const random = rng(9)
  let open = [makeRock(100, 100, 3, 60, random)]
  let points = 0
  let broken = 0
  while (open.length) {
    const rock = open.pop()!
    points += rockScore(rock.size)
    broken++
    open = open.concat(splitRock(rock, random))
  }
  assert.equal(broken, 7, 'one big rock, two middling, four small')
  assert.equal(points, 20 + 2 * 50 + 4 * 100)
  assert.ok(rockScore(1) > rockScore(2) && rockScore(2) > rockScore(3), 'the small ones are worth most')
})

test('a wave never drops a rock on the ship, and the waves grow', () => {
  const ship = { x: FIELD.width / 2, y: FIELD.height / 2 }
  for (const name of ['easy', 'normal', 'hard'] as const) {
    const level = DRIFT_LEVELS[name]
    for (let wave = 1; wave <= 14; wave++) {
      const rocks = waveRocks(wave, level, ship, rng(wave * 7919 + name.length))
      assert.equal(rocks.length, waveCount(wave, level))
      for (const rock of rocks) {
        assert.equal(rock.size, 3, 'a wave starts with big rocks only')
        const gap = Math.hypot(wrappedGap(rock.x, ship.x, FIELD.width), wrappedGap(rock.y, ship.y, FIELD.height))
        assert.ok(gap > 150, `a rock landed ${Math.round(gap)} units from the ship`)
        assert.ok(speedOf(rock) > 0)
      }
    }
    assert.ok(waveCount(5, level) > waveCount(1, level), 'later waves hold more rocks')
    assert.equal(waveCount(40, level), 11, 'but not without limit')
    assert.ok(waveSpeed(5, level) > waveSpeed(1, level), 'and they drift faster')
    assert.ok(waveSpeed(99, level) <= level.rockSpeed * 2.2, 'up to a limit')
  }
  assert.ok(waveBonus(3) > waveBonus(1))
})

test('a jump finds a clear spot when there is one, and admits it when there is not', () => {
  const random = rng(5150)
  const clearance = 40
  const empty = jumpSpot([], clearance, random)
  assert.equal(empty.clear, true)

  // A field with room: ten rocks cannot cover a thousand units by six hundred.
  const few = Array.from({ length: 10 }, () => makeRock(random() * FIELD.width, random() * FIELD.height, 3, 50, random))
  for (let i = 0; i < 40; i++) {
    const spot = jumpSpot(few, clearance, random)
    assert.equal(spot.clear, true, 'there was room and the jump should have found it')
    for (const rock of few) assert.equal(hitsRock(rock, spot.x, spot.y, clearance - 1), false, 'the spot it found really is clear')
  }

  // A field with no room: big rocks on a tight grid, nowhere to land.
  const packed: Rock[] = []
  for (let x = 0; x < FIELD.width; x += 50) for (let y = 0; y < FIELD.height; y += 50) packed.push(makeRock(x, y, 3, 10, random))
  const crowded = jumpSpot(packed, clearance, random)
  assert.equal(crowded.clear, false, 'the jump must say when there is nowhere clear to land')
  assert.ok(crowded.x >= 0 && crowded.x <= FIELD.width && crowded.y >= 0 && crowded.y <= FIELD.height)
})

test('the three settings are really three different games', () => {
  const { easy, normal, hard } = DRIFT_LEVELS
  assert.ok(easy.lives > hard.lives)
  assert.ok(easy.rockSpeed < normal.rockSpeed && normal.rockSpeed < hard.rockSpeed)
  assert.ok(easy.risk < hard.risk, 'the jump is more of a gamble on hard')
  assert.ok(easy.grace > hard.grace, 'you get longer to settle after a respawn on easy')
  assert.ok(easy.shots >= normal.shots)
  assert.ok(easy.jumpCooldown < hard.jumpCooldown, 'and the jump comes round sooner')
  assert.ok(hard.waveBase > easy.waveBase)
})
