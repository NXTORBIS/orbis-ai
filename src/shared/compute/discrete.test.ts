import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  DISCRETE_ASSUMPTIONS,
  DISCRETE_LIMITS,
  bellmanFord,
  breadthFirst,
  chineseRemainder,
  combinations,
  componentsOf,
  depthFirst,
  derangements,
  dijkstra,
  divisorsOf,
  enumerateCombinations,
  enumeratePermutations,
  equivalenceClasses,
  euclideanSteps,
  eulerian,
  extendedGcd,
  factorial,
  factorise,
  findCycle,
  gcd,
  graphOf,
  greedyColouring,
  inclusionExclusion,
  isBipartite,
  isDiscreteError,
  isPrime,
  kruskal,
  lcm,
  linearDiophantine,
  mod,
  modInverse,
  modPower,
  multinomial,
  orderElements,
  pascalRow,
  permutations,
  pigeonhole,
  relationProperties,
  sieveOfEratosthenes,
  solveCongruence,
  starsAndBars,
  topologicalSort,
  totient,
  type Graph
} from './discrete.ts'

const g = (vertices: string[], edges: { from: string; to: string; weight?: number }[], directed = false): Graph => {
  const one = graphOf(vertices, edges, directed)
  if (isDiscreteError(one)) throw new Error(one.message)
  return one
}

describe('divisibility', () => {
  test('the greatest common divisor is right, including at zero', () => {
    assert.equal(gcd(252n, 198n), 18n)
    assert.equal(gcd(17n, 5n), 1n)
    assert.equal(gcd(0n, 5n), 5n)
    assert.equal(gcd(0n, 0n), 0n)
    assert.equal(gcd(-12n, 18n), 6n)
  })

  test('the Euclidean steps are the algorithm, and they end at the gcd', () => {
    const result = euclideanSteps(126n, 84n)
    assert.equal(result.gcd, 42n)
    assert.equal(result.steps[0].describe, '126 = 84 x 1 + 42')
    assert.equal(result.steps[result.steps.length - 1].remainder, 0n)
  })

  test('Bezout coefficients really combine to the gcd', () => {
    const result = extendedGcd(240n, 46n)
    assert.equal(result.gcd, 2n)
    assert.equal(result.verified, true)
    assert.equal(240n * result.x + 46n * result.y, 2n)
  })

  test('the gcd from the extended algorithm is positive even for negative inputs', () => {
    const result = extendedGcd(-12n, 18n)
    assert.equal(result.gcd, 6n)
    assert.equal(result.verified, true)
  })

  test('the least common multiple divides first, so the product never grows further than it must', () => {
    assert.equal(lcm(4n, 6n), 12n)
    assert.equal(lcm(0n, 5n), 0n)
    // Two large numbers whose product would be enormous but whose lcm is not.
    assert.equal(lcm(10n ** 18n, 2n * 10n ** 18n), 2n * 10n ** 18n)
  })

  test('divisors come in pairs and classify the number', () => {
    const six = divisorsOf(6n)
    assert.ok(!isDiscreteError(six))
    assert.deepEqual(six.divisors, [1n, 2n, 3n, 6n])
    assert.equal(six.classification, 'perfect')
    assert.match(six.describe, /perfect/)

    const twelve = divisorsOf(12n)
    assert.ok(!isDiscreteError(twelve))
    assert.equal(twelve.classification, 'abundant')

    const eight = divisorsOf(8n)
    assert.ok(!isDiscreteError(eight))
    assert.equal(eight.classification, 'deficient')
  })

  test('divisors of a non-positive number are refused', () => {
    assert.ok(isDiscreteError(divisorsOf(0n)))
    assert.ok(isDiscreteError(divisorsOf(-4n)))
  })
})

describe('modular arithmetic', () => {
  test('mod always lands in the right range, unlike the remainder operator', () => {
    assert.equal(mod(-7n, 3n), 2n)
    assert.equal(mod(7n, 3n), 1n)
    // JavaScript's own operator keeps the sign of the dividend, which is not what mod means.
    assert.equal(-7n % 3n, -1n)
  })

  test('modulo zero is refused', () => {
    assert.ok(isDiscreteError(mod(1n, 0n)))
    assert.ok(isDiscreteError(modPower(2n, 3n, 0n)))
  })

  test('modular exponentiation never builds the full power', () => {
    // 2^1000 has 302 digits; the answer has one.
    assert.equal(modPower(2n, 1000n, 7n), 2n)
    assert.equal(modPower(3n, 0n, 7n), 1n)
    assert.equal(modPower(5n, 117n, 19n), 1n)
  })

  test('a negative exponent is refused, naming what it would need first', () => {
    const one = modPower(2n, -1n, 7n)
    assert.ok(isDiscreteError(one))
    assert.match(one.message, /modular inverse/)
  })

  test('a modular inverse exists exactly when the two are coprime', () => {
    const exists = modInverse(3n, 11n)
    assert.ok(!isDiscreteError(exists))
    assert.equal(exists.exists, true)
    assert.equal(exists.value, 4n)
    assert.equal((3n * 4n) % 11n, 1n)

    const not = modInverse(4n, 8n)
    assert.ok(!isDiscreteError(not))
    assert.equal(not.exists, false)
    assert.equal(not.value, null)
    assert.match(not.describe, /greatest common divisor is 4, not 1/)
  })

  test('a congruence with a coprime coefficient has one solution', () => {
    const solved = solveCongruence({ coefficient: 3n, value: 7n, modulus: 11n })
    assert.ok(!isDiscreteError(solved))
    assert.equal(solved.count, 1)
    assert.deepEqual(solved.solutions, [6n])
    assert.equal((3n * 6n) % 11n, 7n % 11n)
  })

  test('a congruence whose coefficient shares a factor has several solutions, and all are returned', () => {
    // 4x = 8 (mod 12): gcd(4,12) = 4, which divides 8, so there are four solutions.
    const solved = solveCongruence({ coefficient: 4n, value: 8n, modulus: 12n })
    assert.ok(!isDiscreteError(solved))
    assert.equal(solved.count, 4)
    assert.equal(solved.solutions.length, 4)
    for (const one of solved.solutions) assert.equal((4n * one) % 12n, 8n % 12n)
    assert.match(solved.describe, /There are 4 solutions/)
  })

  test('a congruence with no solution says why', () => {
    const solved = solveCongruence({ coefficient: 4n, value: 7n, modulus: 12n })
    assert.ok(!isDiscreteError(solved))
    assert.equal(solved.count, 0)
    assert.match(solved.describe, /does not divide 7/)
  })
})

describe('the Chinese remainder theorem', () => {
  test('a coprime system is solved and verified', () => {
    const result = chineseRemainder([
      { value: 2n, modulus: 3n },
      { value: 3n, modulus: 5n },
      { value: 2n, modulus: 7n }
    ])
    assert.ok(!isDiscreteError(result))
    assert.equal(result.value, 23n)
    assert.equal(result.modulus, 105n)
    assert.equal(result.verified, true)
    assert.equal(result.coprime, true)
  })

  test('a non-coprime but consistent system is solved, with the lcm as the modulus', () => {
    // x = 2 (mod 4), x = 2 (mod 6) -> x = 2 (mod 12).
    const result = chineseRemainder([
      { value: 2n, modulus: 4n },
      { value: 2n, modulus: 6n }
    ])
    assert.ok(!isDiscreteError(result))
    assert.equal(result.value, 2n)
    assert.equal(result.modulus, 12n)
    assert.equal(result.coprime, false)
    assert.match(result.describe, /least common multiple rather than their product/)
  })

  test('an inconsistent system is refused, naming the contradiction', () => {
    // x = 1 (mod 4) and x = 2 (mod 6) cannot both hold: they disagree modulo 2.
    const result = chineseRemainder([
      { value: 1n, modulus: 4n },
      { value: 2n, modulus: 6n }
    ])
    assert.ok(isDiscreteError(result))
    assert.equal(result.error, 'inconsistent')
    assert.match(result.message, /contradict each other/)
  })

  test('a single congruence is its own answer', () => {
    const result = chineseRemainder([{ value: 5n, modulus: 7n }])
    assert.ok(!isDiscreteError(result))
    assert.equal(result.value, 5n)
  })
})

describe('primes', () => {
  test('small primes and composites are decided correctly', () => {
    for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 97n, 7919n]) {
      const result = isPrime(p)
      assert.ok(!isDiscreteError(result))
      assert.equal(result.prime, true, `${p}`)
    }
    for (const c of [0n, 1n, 4n, 9n, 100n, 7917n]) {
      const result = isPrime(c)
      assert.ok(!isDiscreteError(result))
      assert.equal(result.prime, false, `${c}`)
    }
  })

  test('a negative number is not prime, and the reason is the definition', () => {
    const result = isPrime(-7n)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.prime, false)
    assert.match(result.describe, /exactly two positive divisors/)
  })

  test('primality is proven below the bound where the witness set is complete', () => {
    const result = isPrime(104729n)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.prime, true)
    assert.equal(result.certainty, 'proven')
    assert.match(result.describe, /a proof and not an estimate/)
  })

  test('above the bound the same test is probabilistic, and says so rather than printing the same word', () => {
    // A prime well past 3.317 x 10^24.
    const big = 2n ** 127n - 1n
    const result = isPrime(big)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.prime, true)
    assert.equal(result.certainty, 'probable')
    assert.match(result.describe, /probably prime/)
  })

  test('a composite found by a small divisor names the divisor', () => {
    const result = isPrime(1001n)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.factor, 7n)
  })

  test('the sieve finds the right primes and counts what it eliminated', () => {
    const result = sieveOfEratosthenes(30)
    assert.ok(!isDiscreteError(result))
    assert.deepEqual(result.primes, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29])
    assert.equal(result.count, 10)
    assert.ok(result.eliminated > 0)
  })

  test('the sieve count matches the known number of primes below 10,000', () => {
    const result = sieveOfEratosthenes(10_000)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.count, 1229)
  })

  test('a sieve past the ceiling is refused', () => {
    assert.ok(isDiscreteError(sieveOfEratosthenes(DISCRETE_LIMITS.sieve + 1)))
    assert.ok(isDiscreteError(sieveOfEratosthenes(1)))
  })
})

describe('factorisation', () => {
  test('a factorisation is exact and multiplies back', () => {
    const result = factorise(7560n)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.complete, true)
    let product = 1n
    for (const { prime, power } of result.factors) product *= prime ** BigInt(power)
    assert.equal(product, 7560n)
    assert.match(result.describe, /7560 = 2\^3 x 3\^3 x 5 x 7/)
  })

  test('the divisor count comes from the powers, which is why the factorisation is worth having', () => {
    const result = factorise(7560n)
    assert.ok(!isDiscreteError(result))
    // 2^3 * 3^3 * 5 * 7 -> 4*4*2*2 = 64 divisors.
    assert.equal(result.divisorCount, 64)
    const divisors = divisorsOf(7560n)
    assert.ok(!isDiscreteError(divisors))
    assert.equal(divisors.count, 64)
  })

  test('one has no prime factors, which is the empty product', () => {
    const result = factorise(1n)
    assert.ok(!isDiscreteError(result))
    assert.deepEqual(result.factors, [])
    assert.match(result.describe, /empty product/)
  })

  test('a prime factors to itself', () => {
    const result = factorise(104729n)
    assert.ok(!isDiscreteError(result))
    assert.deepEqual(result.factors, [{ prime: 104729n, power: 1 }])
  })

  test('a semiprime past trial division is split by the rho method', () => {
    // Two primes well past where trial division would reach in reasonable time.
    const a = 1000000007n
    const b = 1000000009n
    const result = factorise(a * b)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.complete, true)
    assert.deepEqual(result.factors.map((one) => one.prime).sort((x, y) => (x < y ? -1 : 1)), [a, b])
  })

  test('a non-positive number is refused', () => {
    assert.ok(isDiscreteError(factorise(0n)))
    assert.ok(isDiscreteError(factorise(-6n)))
  })

  test('the totient comes from the factorisation and matches a direct count', () => {
    const result = totient(60n)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.value, 16n)

    // Counted directly for a small case, which is the check.
    let counted = 0n
    for (let i = 1n; i <= 60n; i++) if (gcd(i, 60n) === 1n) counted += 1n
    assert.equal(counted, 16n)
  })

  test('the totient of a prime is one less than it', () => {
    const result = totient(97n)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.value, 96n)
  })
})

describe('Diophantine equations', () => {
  test('a solvable equation gives the whole family, and the particular one checks out', () => {
    const result = linearDiophantine(3n, 5n, 11n)
    assert.equal(result.hasSolution, true)
    assert.equal(3n * (result.x as bigint) + 5n * (result.y as bigint), 11n)
    // Another member of the family also solves it.
    const x = (result.x as bigint) + (result.xStep as bigint)
    const y = (result.y as bigint) - (result.yStep as bigint)
    assert.equal(3n * x + 5n * y, 11n)
  })

  test('an unsolvable equation says why, in terms of the divisor', () => {
    const result = linearDiophantine(4n, 6n, 7n)
    assert.equal(result.hasSolution, false)
    assert.match(result.describe, /greatest common divisor of 4 and 6 is 2/)
  })

  test('both coefficients zero is handled either way', () => {
    assert.equal(linearDiophantine(0n, 0n, 0n).hasSolution, true)
    assert.equal(linearDiophantine(0n, 0n, 5n).hasSolution, false)
  })
})

describe('combinatorics', () => {
  test('a factorial is exact past what a double holds', () => {
    assert.equal(factorial(20), 2432902008176640000n)
    assert.equal(factorial(21), 51090942171709440000n)
    // 23! is the first factorial a double cannot hold exactly: the round trip through Number loses digits.
    const exact = factorial(23) as bigint
    assert.equal(exact, 25852016738884976640000n)
    assert.notEqual(BigInt(Number(exact)), exact)
  })

  test('nCr is exact for a case with thirty digits', () => {
    // C(100, 50) is 100891344545564193334812497256.
    assert.equal(combinations(100, 50), 100891344545564193334812497256n)
  })

  test('nCr is symmetric and has the right edge cases', () => {
    assert.equal(combinations(10, 3), combinations(10, 7))
    assert.equal(combinations(5, 0), 1n)
    assert.equal(combinations(5, 5), 1n)
    assert.equal(combinations(5, 6), 0n)
  })

  test('nPr counts arrangements', () => {
    assert.equal(permutations(8, 5), 6720n)
    assert.equal(permutations(5, 5), factorial(5))
    assert.equal(permutations(5, 0), 1n)
  })

  test('a multinomial needs its parts and is exact', () => {
    // 5!/(2!2!1!) = 30.
    assert.equal(multinomial([2, 2, 1]), 30n)
    assert.equal(multinomial([3]), 1n)
  })

  test('stars and bars counts both the non-negative and the positive case', () => {
    // x+y+z = 5 has C(7,2) = 21 non-negative solutions and C(4,2) = 6 positive ones.
    const nonNegative = starsAndBars(5, 3)
    assert.ok(!isDiscreteError(nonNegative))
    assert.equal(nonNegative.count, 21n)

    const positive = starsAndBars(5, 3, true)
    assert.ok(!isDiscreteError(positive))
    assert.equal(positive.count, 6n)
  })

  test('a positive stars-and-bars problem with too small a total has no solutions', () => {
    const result = starsAndBars(2, 5, true)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.count, 0n)
    assert.match(result.describe, /smallest such sum is 5/)
  })

  test('inclusion and exclusion adds and subtracts correctly', () => {
    const sizes = new Map([
      ['A', 10n],
      ['B', 20n],
      ['C', 30n],
      ['A&B', 5n],
      ['A&C', 6n],
      ['B&C', 7n],
      ['A&B&C', 2n]
    ])
    const result = inclusionExclusion(['A', 'B', 'C'], sizes)
    assert.ok(!isDiscreteError(result))
    // 10+20+30 - 5-6-7 + 2 = 44.
    assert.equal(result.count, 44n)
    assert.equal(result.complete, true)
  })

  test('a missing intersection is reported, never taken to be empty', () => {
    const sizes = new Map([['A', 10n], ['B', 20n]])
    const result = inclusionExclusion(['A', 'B'], sizes)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.complete, false)
    assert.deepEqual(result.missing, [['A', 'B']])
    assert.match(result.describe, /not taken to be zero/)
  })

  test('derangements follow their recurrence', () => {
    assert.equal(derangements(0), 1n)
    assert.equal(derangements(1), 0n)
    assert.equal(derangements(2), 1n)
    assert.equal(derangements(4), 9n)
    assert.equal(derangements(10), 1334961n)
  })

  test('the pigeonhole principle gives the guaranteed occupancy and the threshold', () => {
    const basic = pigeonhole(25, 6)
    assert.ok(!isDiscreteError(basic))
    assert.equal(basic.guaranteed, 5)
    assert.match(basic.describe, /which is less than 25/)

    const threshold = pigeonhole(25, 6, 5)
    assert.ok(!isDiscreteError(threshold))
    assert.equal(threshold.neededFor, 25)
  })

  test('a row of Pascal’s triangle is exact and symmetric', () => {
    const row = pascalRow(8)
    assert.ok(!isDiscreteError(row))
    assert.deepEqual(row.entries, [1n, 8n, 28n, 56n, 70n, 56n, 28n, 8n, 1n])
    assert.equal(row.sum, 256n)
    assert.equal(row.entries[3], combinations(8, 3))
  })
})

describe('enumeration versus counting', () => {
  test('a small set is enumerated in full', () => {
    const result = enumeratePermutations(['a', 'b', 'c'])
    assert.ok(!isDiscreteError(result))
    assert.equal(result.items.length, 6)
    assert.equal(result.count, 6n)
    assert.equal(result.complete, true)
  })

  test('partial permutations are enumerated', () => {
    const result = enumeratePermutations(['a', 'b', 'c'], 2)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.items.length, 6)
    assert.ok(result.items.every((one) => one.length === 2))
  })

  test('combinations are enumerated without repeats', () => {
    const result = enumerateCombinations(['a', 'b', 'c', 'd'], 2)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.items.length, 6)
    assert.deepEqual(result.items[0], ['a', 'b'])
  })

  test('an impossible enumeration is refused while the count stays available', () => {
    const items = Array.from({ length: 100 }, (_, i) => String(i))
    const listed = enumeratePermutations(items)
    assert.ok(isDiscreteError(listed))
    assert.match(listed.message, /producing the list is a different question/)
    // The count itself is fine.
    assert.equal(permutations(100, 100), factorial(100))
  })
})

describe('graphs', () => {
  const simple = (): Graph => g(['A', 'B', 'C', 'D'], [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C' },
    { from: 'B', to: 'D' },
    { from: 'C', to: 'D' }
  ])

  test('an edge to a vertex that does not exist is refused', () => {
    const one = graphOf(['A'], [{ from: 'A', to: 'Z' }])
    assert.ok(isDiscreteError(one))
    assert.match(one.message, /"Z", which is not a vertex/)
  })

  test('breadth-first visits by distance and records every step', () => {
    const result = breadthFirst(simple(), 'A')
    assert.ok(!isDiscreteError(result))
    assert.deepEqual(result.order, ['A', 'B', 'C', 'D'])
    assert.equal(result.steps.length, 4)
    assert.deepEqual(result.steps[0].frontier, [])
    assert.deepEqual(result.steps[1].frontier, ['C'])
  })

  test('depth-first goes deep before wide', () => {
    const result = depthFirst(simple(), 'A')
    assert.ok(!isDiscreteError(result))
    assert.equal(result.order[0], 'A')
    assert.equal(result.order.length, 4)
    // B is reached before C, and D before C, which is what depth-first means here.
    assert.ok(result.order.indexOf('D') < result.order.indexOf('C'))
  })

  test('a disconnected vertex is reported as unreached rather than silently missing', () => {
    const graph = g(['A', 'B', 'X'], [{ from: 'A', to: 'B' }])
    const result = breadthFirst(graph, 'A')
    assert.ok(!isDiscreteError(result))
    assert.deepEqual(result.unreached, ['X'])
  })

  test('Dijkstra finds the shortest path and its cost', () => {
    const graph = g(['A', 'B', 'C', 'D'], [
      { from: 'A', to: 'B', weight: 1 },
      { from: 'B', to: 'D', weight: 5 },
      { from: 'A', to: 'C', weight: 2 },
      { from: 'C', to: 'D', weight: 1 }
    ])
    const result = dijkstra(graph, 'A', 'D')
    assert.ok(!isDiscreteError(result))
    assert.deepEqual(result.path, ['A', 'C', 'D'])
    assert.equal(result.cost, 3)
  })

  test('Dijkstra refuses a negative weight rather than returning a wrong distance', () => {
    const graph = g(['A', 'B'], [{ from: 'A', to: 'B', weight: -1 }])
    const result = dijkstra(graph, 'A')
    assert.ok(isDiscreteError(result))
    assert.match(result.message, /would return a distance that is not the shortest/)
    assert.match(result.message, /Bellman-Ford/)
  })

  test('Bellman-Ford handles a negative weight', () => {
    const graph = g(['A', 'B', 'C'], [
      { from: 'A', to: 'B', weight: 4 },
      { from: 'A', to: 'C', weight: 5 },
      { from: 'C', to: 'B', weight: -3 }
    ], true)
    const result = bellmanFord(graph, 'A', 'B')
    assert.ok(!isDiscreteError(result))
    assert.equal(result.cost, 2)
    assert.deepEqual(result.path, ['A', 'C', 'B'])
  })

  test('a negative cycle is detected and reported as making shortest paths meaningless', () => {
    const graph = g(['A', 'B', 'C'], [
      { from: 'A', to: 'B', weight: 1 },
      { from: 'B', to: 'C', weight: -3 },
      { from: 'C', to: 'A', weight: 1 }
    ], true)
    const result = bellmanFord(graph, 'A')
    assert.ok(!isDiscreteError(result))
    assert.ok(result.negativeCycle)
    assert.match(result.notes[0], /there is no shortest path -- not a long one, but none at all/)
  })

  test('an unreachable target is reported rather than given a distance', () => {
    const graph = g(['A', 'B', 'X'], [{ from: 'A', to: 'B', weight: 1 }])
    const result = dijkstra(graph, 'A', 'X')
    assert.ok(!isDiscreteError(result))
    assert.equal(result.path, null)
    assert.ok(result.notes.some((one) => /cannot be reached/.test(one)))
  })

  test('Kruskal builds a minimum spanning tree and keeps what it rejected', () => {
    const graph = g(['A', 'B', 'C', 'D'], [
      { from: 'A', to: 'B', weight: 1 },
      { from: 'B', to: 'C', weight: 2 },
      { from: 'C', to: 'D', weight: 3 },
      { from: 'A', to: 'D', weight: 10 }
    ])
    const result = kruskal(graph)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.spanning, true)
    assert.equal(result.totalWeight, 6)
    assert.equal(result.edges.length, 3)
    assert.equal(result.rejected.length, 1)
    assert.match(result.rejected[0].why, /would close a cycle/)
  })

  test('a disconnected graph gives a forest, and says so rather than claiming a tree', () => {
    const graph = g(['A', 'B', 'X', 'Y'], [
      { from: 'A', to: 'B', weight: 1 },
      { from: 'X', to: 'Y', weight: 1 }
    ])
    const result = kruskal(graph)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.spanning, false)
    assert.match(result.notes[0], /spanning forest/)
  })

  test('components are found, and a connected graph has one', () => {
    assert.equal(componentsOf(simple()).count, 1)
    assert.equal(componentsOf(simple()).connected, true)
    const split = componentsOf(g(['A', 'B', 'X'], [{ from: 'A', to: 'B' }]))
    assert.equal(split.count, 2)
    assert.equal(split.connected, false)
  })

  test('an undirected cycle is found, and an edge back to the parent is not mistaken for one', () => {
    const cycle = findCycle(simple())
    assert.equal(cycle.hasCycle, true)
    assert.ok(cycle.cycle)

    // A path has no cycle, although every edge leads back to a visited vertex.
    const path = findCycle(g(['A', 'B', 'C'], [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }]))
    assert.equal(path.hasCycle, false)
    assert.match(path.describe, /forest/)
  })

  test('a directed cycle is found and a directed acyclic graph is not called cyclic', () => {
    const cyclic = findCycle(g(['A', 'B'], [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }], true))
    assert.equal(cyclic.hasCycle, true)

    const acyclic = findCycle(g(['A', 'B'], [{ from: 'A', to: 'B' }], true))
    assert.equal(acyclic.hasCycle, false)
    assert.match(acyclic.describe, /directed acyclic graph/)
  })

  test('bipartiteness is decided, and a non-bipartite graph comes with the reason', () => {
    const even = isBipartite(g(['A', 'B', 'C', 'D'], [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'D' },
      { from: 'D', to: 'A' }
    ]))
    assert.equal(even.bipartite, true)
    assert.equal(even.sides?.[0].length, 2)

    const triangle = isBipartite(g(['A', 'B', 'C'], [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' }
    ]))
    assert.equal(triangle.bipartite, false)
    assert.match(triangle.describe, /cycle of odd length/)
  })

  test('an Eulerian circuit is found when every degree is even', () => {
    const square = g(['A', 'B', 'C', 'D'], [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'D' },
      { from: 'D', to: 'A' }
    ])
    const result = eulerian(square)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.circuit, true)
    assert.ok(result.trail)
    // Every edge exactly once means the trail has one more vertex than there are edges.
    assert.equal((result.trail as string[]).length, square.edges.length + 1)
  })

  test('an Eulerian path is found with exactly two odd vertices', () => {
    const result = eulerian(g(['A', 'B', 'C'], [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' }
    ]))
    assert.ok(!isDiscreteError(result))
    assert.equal(result.path, true)
    assert.equal(result.circuit, false)
    assert.deepEqual(result.oddDegreeVertices.sort(), ['A', 'C'])
  })

  test('a graph with four odd vertices has neither, and the reason is the degree argument', () => {
    // The complete graph on four vertices: every degree is 3, so all four are odd.
    const result = eulerian(g(['A', 'B', 'C', 'D'], [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' },
      { from: 'B', to: 'C' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' }
    ]))
    assert.ok(!isDiscreteError(result))
    assert.equal(result.path, false)
    assert.match(result.describe, /every visit to a vertex uses two of its edges/)
  })

  test('a greedy colouring says it is a colouring found, not the chromatic number', () => {
    const result = greedyColouring(g(['A', 'B', 'C', 'D', 'E'], [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' },
      { from: 'C', to: 'D' },
      { from: 'D', to: 'E' }
    ]))
    assert.equal(result.optimal, false)
    assert.match(result.describe, /not necessarily the fewest possible/)
  })

  test('a two-colouring of a bipartite graph is reported as optimal, because that case is decidable', () => {
    const result = greedyColouring(g(['A', 'B'], [{ from: 'A', to: 'B' }]))
    assert.equal(result.used, 2)
    assert.equal(result.optimal, true)
    assert.match(result.describe, /fewest possible/)
  })

  test('no edges means one colour, and that is optimal', () => {
    const result = greedyColouring(g(['A', 'B'], []))
    assert.equal(result.used, 1)
    assert.equal(result.optimal, true)
  })

  test('a topological order respects every edge', () => {
    const graph = g(['A', 'B', 'C', 'D'], [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' }
    ], true)
    const result = topologicalSort(graph)
    assert.ok(!isDiscreteError(result))
    const order = result.order as string[]
    for (const edge of graph.edges) {
      assert.ok(order.indexOf(edge.from) < order.indexOf(edge.to), `${edge.from} before ${edge.to}`)
    }
  })

  test('a cyclic graph has no topological order, and the cycle is named', () => {
    const result = topologicalSort(g(['A', 'B'], [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }], true))
    assert.ok(!isDiscreteError(result))
    assert.equal(result.order, null)
    assert.match(result.describe, /depend on each other in a circle/)
  })

  test('a topological order of an undirected graph is refused', () => {
    assert.ok(isDiscreteError(topologicalSort(simple())))
  })
})

describe('relations', () => {
  const members = ['1', '2', '3']

  test('equality is an equivalence relation', () => {
    const pairs: [string, string][] = [['1', '1'], ['2', '2'], ['3', '3']]
    const properties = relationProperties(members, pairs)
    assert.equal(properties.equivalence, true)
    assert.equal(properties.partialOrder, true)
  })

  test('a property that fails comes with the pair that breaks it', () => {
    const properties = relationProperties(members, [['1', '2']])
    assert.equal(properties.reflexive, false)
    assert.match(properties.counterexamples.reflexive, /\(1, 1\) is missing/)
    assert.equal(properties.symmetric, false)
    assert.match(properties.counterexamples.symmetric, /\(2, 1\) is not/)
  })

  test('transitivity is checked, with the chain that breaks it', () => {
    const pairs: [string, string][] = [['1', '1'], ['2', '2'], ['3', '3'], ['1', '2'], ['2', '3']]
    const properties = relationProperties(members, pairs)
    assert.equal(properties.transitive, false)
    assert.match(properties.counterexamples.transitive, /\(1, 3\) is not/)
  })

  test('equivalence classes partition the members', () => {
    const pairs: [string, string][] = [
      ['1', '1'], ['2', '2'], ['3', '3'],
      ['1', '2'], ['2', '1']
    ]
    const result = equivalenceClasses(members, pairs)
    assert.ok(!isDiscreteError(result))
    assert.equal(result.classes.length, 2)
    assert.deepEqual(result.classes.flat().sort(), ['1', '2', '3'])
  })

  test('a relation that is not an equivalence has no classes, and the refusal says which property failed', () => {
    const result = equivalenceClasses(members, [['1', '2']])
    assert.ok(isDiscreteError(result))
    // Transitivity holds vacuously here -- there is no pair to chain with -- so only two properties are named.
    assert.match(result.message, /not reflexive or symmetric/)
  })

  test('minimal and least are not conflated', () => {
    // Two incomparable minimal elements and no least one.
    const pairs: [string, string][] = [
      ['a', 'a'], ['b', 'b'], ['c', 'c'],
      ['a', 'c'], ['b', 'c']
    ]
    const result = orderElements(['a', 'b', 'c'], pairs)
    assert.ok(!isDiscreteError(result))
    assert.deepEqual(result.minimal.sort(), ['a', 'b'])
    assert.equal(result.least, null)
    assert.equal(result.greatest, 'c')
    assert.match(result.describe, /which is not the same thing/)
  })

  test('incomparable pairs are listed', () => {
    const pairs: [string, string][] = [['a', 'a'], ['b', 'b'], ['c', 'c'], ['a', 'c'], ['b', 'c']]
    const result = orderElements(['a', 'b', 'c'], pairs)
    assert.ok(!isDiscreteError(result))
    assert.deepEqual(result.incomparable, [['a', 'b']])
  })

  test('a relation that is not a partial order is refused rather than approximated', () => {
    assert.ok(isDiscreteError(orderElements(members, [['1', '2']])))
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the engine is built on', () => {
    assert.ok(DISCRETE_ASSUMPTIONS.length >= 9)
    assert.ok(DISCRETE_ASSUMPTIONS.some((one) => /count and an enumeration are different/.test(one)))
    assert.ok(DISCRETE_ASSUMPTIONS.some((one) => /probabilistic/.test(one)))
    assert.ok(DISCRETE_ASSUMPTIONS.some((one) => /Minimal and least are different/.test(one)))
  })
})
