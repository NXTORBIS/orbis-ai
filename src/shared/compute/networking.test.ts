import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  addressAssignment,
  checkTopology,
  congestion,
  findRoute,
  firewall,
  handshake,
  isNetworkError,
  nameLookup,
  readAddress,
  sameNetwork,
  shape,
  SHAPES,
  splitBlock,
  subnet,
  translate,
  type Topology,
  type NetworkError
} from './networking.ts'

/**
 * What the networking engine is held to.
 *
 * Subnetting is arithmetic, so every assertion here is a figure that can be worked out by hand — and the /31 and /32
 * cases are asserted explicitly, because they break the "subtract two" rule that holds everywhere else and getting
 * them wrong is the commonest mistake in the subject.
 */

/**
 * Asserts a call did not refuse, and narrows the type.
 *
 * Written with `Exclude` rather than `T | Error -> T`, which infers `T` as the whole union and so narrows nothing.
 */
const ok = <T,>(value: T): Exclude<T, NetworkError> => {
  assert.ok(!isNetworkError(value), isNetworkError(value) ? `${value.says} ${value.fix}` : '')
  return value as Exclude<T, NetworkError>
}

describe('addresses', () => {
  it('reads an address and gives its value', () => {
    const made = ok(readAddress('192.168.1.10'))
    assert.deepEqual([...made.octets], [192, 168, 1, 10])
    assert.equal(made.value, 0xc0a8010a)
  })

  it('refuses what is not an address, and says what one looks like', () => {
    for (const bad of ['192.168.1', '192.168.1.256', '192.168.1.1.1', 'hello', '', '1.2.3.-4']) {
      const made = readAddress(bad)
      assert.ok(isNetworkError(made), `let through: "${bad}"`)
    }
    const made = readAddress('nope')
    assert.ok(isNetworkError(made))
    assert.match(made.fix, /192\.168\.1\.10/)
  })
})

describe('subnetting', () => {
  it('a /24 gives the textbook answer', () => {
    const made = ok(subnet('192.168.1.10', 24))
    assert.equal(made.mask.text, '255.255.255.0')
    assert.equal(made.network.text, '192.168.1.0')
    assert.equal(made.broadcast.text, '192.168.1.255')
    assert.equal(made.firstHost?.text, '192.168.1.1')
    assert.equal(made.lastHost?.text, '192.168.1.254')
    assert.equal(made.total, 256)
    assert.equal(made.usable, 254)
  })

  it('a /26 splits a /24 into four, and the arithmetic holds', () => {
    const made = ok(subnet('192.168.1.100', 26))
    assert.equal(made.mask.text, '255.255.255.192')
    assert.equal(made.network.text, '192.168.1.64')
    assert.equal(made.broadcast.text, '192.168.1.127')
    assert.equal(made.usable, 62)
  })

  it('an awkward prefix is as correct as a familiar one', () => {
    const made = ok(subnet('10.1.2.200', 27))
    assert.equal(made.mask.text, '255.255.255.224')
    assert.equal(made.network.text, '10.1.2.192')
    assert.equal(made.broadcast.text, '10.1.2.223')
    assert.equal(made.usable, 30)

    const odd = ok(subnet('172.16.5.33', 30))
    assert.equal(odd.network.text, '172.16.5.32')
    assert.equal(odd.usable, 2)
    assert.equal(odd.firstHost?.text, '172.16.5.33')
    assert.equal(odd.lastHost?.text, '172.16.5.34')
  })

  it('a /32 is one address with no network or broadcast to set aside', () => {
    const made = ok(subnet('8.8.8.8', 32))
    assert.equal(made.total, 1)
    assert.equal(made.usable, 1, 'a /32 holds exactly one usable address, not minus one')
    assert.equal(made.firstHost?.text, '8.8.8.8')
    assert.equal(made.lastHost?.text, '8.8.8.8')
    assert.ok(made.notes.some((one) => /subtract two/.test(one)))
  })

  it('a /31 has two usable addresses, which is the point of it', () => {
    const made = ok(subnet('10.0.0.4', 31))
    assert.equal(made.total, 2)
    assert.equal(made.usable, 2, 'both addresses in a /31 are usable')
    assert.equal(made.firstHost?.text, '10.0.0.4')
    assert.equal(made.lastHost?.text, '10.0.0.5')
    assert.ok(made.notes.some((one) => /two routers/.test(one)))
  })

  it('a /0 is the whole address space', () => {
    const made = ok(subnet('1.2.3.4', 0))
    assert.equal(made.total, 2 ** 32)
    assert.equal(made.mask.text, '0.0.0.0')
  })

  it('every prefix from 0 to 32 gives a consistent answer', () => {
    // The property that catches an off-by-one anywhere in the arithmetic.
    for (let prefix = 0; prefix <= 32; prefix += 1) {
      const made = ok(subnet('172.20.30.40', prefix))
      assert.equal(made.total, 2 ** (32 - prefix), `/${prefix} total`)
      assert.ok(made.network.value <= made.address.value, `/${prefix}: network above the address`)
      assert.ok(made.broadcast.value >= made.address.value, `/${prefix}: broadcast below the address`)
      assert.equal(made.broadcast.value - made.network.value + 1, made.total, `/${prefix}: block size`)
      const expected = prefix === 32 ? 1 : prefix === 31 ? 2 : 2 ** (32 - prefix) - 2
      assert.equal(made.usable, expected, `/${prefix} usable`)
    }
  })

  it('recognises the private ranges and says they are not routed', () => {
    for (const address of ['10.1.1.1', '172.16.0.1', '172.31.255.254', '192.168.0.1']) {
      const made = ok(subnet(address, 24))
      assert.equal(made.private, true, address)
      assert.ok(made.notes.some((one) => /private range/.test(one)), address)
    }
    assert.equal(ok(subnet('172.32.0.1', 24)).private, false, '172.32 is outside the private range')
    assert.equal(ok(subnet('8.8.8.8', 24)).private, false)
  })

  it('recognises the special addresses', () => {
    assert.match(ok(subnet('127.0.0.1', 8)).special ?? '', /loopback/)
    assert.match(ok(subnet('169.254.1.1', 16)).special ?? '', /link-local/)
    assert.match(ok(subnet('224.0.0.1', 4)).special ?? '', /multicast/)
    assert.equal(ok(subnet('93.184.216.34', 24)).special, null)
  })

  it('refuses a prefix that is not one', () => {
    assert.ok(isNetworkError(subnet('1.2.3.4', 33)))
    assert.ok(isNetworkError(subnet('1.2.3.4', -1)))
    assert.ok(isNetworkError(subnet('1.2.3.4', 24.5)))
  })

  it('says whether two addresses need a router between them', () => {
    const together = ok(sameNetwork('192.168.1.10', '192.168.1.200', 24))
    assert.equal(together.same, true)
    assert.match(together.says, /no router/)

    const apart = ok(sameNetwork('192.168.1.10', '192.168.2.10', 24))
    assert.equal(apart.same, false)
    assert.match(apart.says, /through a router/)

    // The same pair on a wider mask are on one network, which is the lesson.
    assert.equal(ok(sameNetwork('192.168.1.10', '192.168.2.10', 16)).same, true)
  })

  it('splits a block into equal pieces that tile it exactly', () => {
    const made = ok(splitBlock('192.168.1.0', 24, 4))
    assert.equal(made.length, 4)
    assert.deepEqual(made.map((one) => one.network.text), ['192.168.1.0', '192.168.1.64', '192.168.1.128', '192.168.1.192'])
    assert.ok(made.every((one) => one.prefix === 26))
    // No gaps and no overlaps: each starts where the last one's broadcast left off.
    for (let i = 1; i < made.length; i += 1) {
      assert.equal(made[i].network.value, made[i - 1].broadcast.value + 1)
    }
  })

  it('refuses a split that will not fit', () => {
    const made = splitBlock('192.168.1.0', 30, 8)
    assert.ok(isNetworkError(made))
    assert.match(made.says, /would be a \/33/)
  })
})

describe('topologies', () => {
  it('every ready-made shape builds and checks out', () => {
    for (const which of SHAPES) {
      const made = ok(shape(which)) as Topology
      const check = ok(checkTopology(made))
      assert.equal(check.ok, true, `${which}: ${check.problems.join(' | ')}`)
      assert.equal(check.islands.length, 1, `${which} is in ${check.islands.length} pieces`)
    }
  })

  it('finds a device with no cable', () => {
    const made = ok(
      checkTopology({
        devices: [
          { id: 'a', kind: 'host', address: '192.168.1.1', prefix: 24 },
          { id: 'lonely', kind: 'host', address: '192.168.1.2', prefix: 24 }
        ],
        links: []
      })
    )
    assert.equal(made.isolated.length, 2)
    assert.ok(made.notes.some((one) => /no cable/.test(one)))
  })

  it('finds a link naming a device that does not exist', () => {
    const made = ok(
      checkTopology({
        devices: [{ id: 'a', kind: 'host', address: '192.168.1.1', prefix: 24 }],
        links: [{ from: 'a', to: 'ghost', delayMs: 1, bandwidthMbps: 100 }]
      })
    )
    assert.equal(made.ok, false)
    assert.deepEqual(made.dangling, ['ghost'])
  })

  it('finds a host with no address, because it cannot do anything', () => {
    const made = ok(checkTopology({ devices: [{ id: 'a', kind: 'host' }], links: [] }))
    assert.equal(made.ok, false)
    assert.ok(made.problems.some((one) => /no address/.test(one)))
  })

  it('a switch needs no address, and is not complained about', () => {
    const made = ok(
      checkTopology({
        devices: [{ id: 'sw', kind: 'switch' }, { id: 'pc', kind: 'host', address: '192.168.1.1', prefix: 24 }],
        links: [{ from: 'sw', to: 'pc', delayMs: 1, bandwidthMbps: 100 }]
      })
    )
    assert.equal(made.ok, true, made.problems.join(' | '))
  })

  it('finds two networks with nothing joining them', () => {
    const made = ok(
      checkTopology({
        devices: [
          { id: 'a1', kind: 'host', address: '192.168.1.1', prefix: 24 },
          { id: 'a2', kind: 'host', address: '192.168.1.2', prefix: 24 },
          { id: 'b1', kind: 'host', address: '10.0.0.1', prefix: 24 },
          { id: 'b2', kind: 'host', address: '10.0.0.2', prefix: 24 }
        ],
        links: [
          { from: 'a1', to: 'a2', delayMs: 1, bandwidthMbps: 100 },
          { from: 'b1', to: 'b2', delayMs: 1, bandwidthMbps: 100 }
        ]
      })
    )
    assert.equal(made.islands.length, 2)
    assert.ok(made.notes.some((one) => /separate groups/.test(one)))
  })
})

describe('routing', () => {
  it('finds the path across a small office', () => {
    const office = ok(shape('small-office')) as Topology
    const made = ok(findRoute(office, 'pc1', 'printer'))
    assert.deepEqual([...made.path], ['pc1', 'switch', 'printer'])
    assert.equal(made.hops, 2)
    assert.equal(made.delayMs, 2)
  })

  it('takes the quicker of two routes, and the quicker one is not the wider one', () => {
    const both = ok(shape('redundant')) as Topology
    const made = ok(findRoute(both, 'pc', 'server'))
    assert.ok(made.path.includes('fast-router'), `it took ${made.path.join(' → ')}`)
    assert.equal(made.delayMs, 5)
  })

  it('finds the other route when the quick one is unplugged', () => {
    const both = ok(shape('redundant')) as Topology
    const broken: Topology = {
      ...both,
      links: both.links.map((one) => (one.to === 'fast-router' || one.from === 'fast-router' ? { ...one, down: true } : one))
    }
    const made = ok(findRoute(broken, 'pc', 'server'))
    assert.ok(made.path.includes('slow-router'), `it took ${made.path.join(' → ')}`)
    assert.equal(made.delayMs, 42)
    // And the bottleneck changed with it, because the other route is narrower.
    assert.equal(made.bottleneckMbps, 100)
  })

  it('reports the slowest link as the bottleneck, not the average', () => {
    const made = ok(
      findRoute(
        {
          devices: [
            { id: 'a', kind: 'host', address: '10.0.0.1', prefix: 24 },
            { id: 'b', kind: 'switch' },
            { id: 'c', kind: 'host', address: '10.0.0.2', prefix: 24 }
          ],
          links: [
            { from: 'a', to: 'b', delayMs: 1, bandwidthMbps: 1000 },
            { from: 'b', to: 'c', delayMs: 1, bandwidthMbps: 10 }
          ]
        },
        'a',
        'c'
      )
    )
    assert.equal(made.bottleneckMbps, 10)
  })

  it('multiplies the loss along the path rather than adding it', () => {
    const made = ok(
      findRoute(
        {
          devices: [
            { id: 'a', kind: 'host', address: '10.0.0.1', prefix: 24 },
            { id: 'b', kind: 'switch' },
            { id: 'c', kind: 'host', address: '10.0.0.2', prefix: 24 }
          ],
          links: [
            { from: 'a', to: 'b', delayMs: 1, bandwidthMbps: 100, loss: 0.1 },
            { from: 'b', to: 'c', delayMs: 1, bandwidthMbps: 100, loss: 0.1 }
          ]
        },
        'a',
        'c'
      )
    )
    // 0.9 × 0.9, not 1 − 0.2.
    assert.ok(Math.abs(made.deliveryChance - 0.81) < 1e-9, `delivery chance was ${made.deliveryChance}`)
  })

  it('says there is no route when there is none, and why', () => {
    const made = findRoute(
      {
        devices: [
          { id: 'a', kind: 'host', address: '10.0.0.1', prefix: 24 },
          { id: 'b', kind: 'host', address: '10.0.0.2', prefix: 24 }
        ],
        links: []
      },
      'a',
      'b'
    )
    assert.ok(isNetworkError(made))
    assert.match(made.says, /no way for a packet/)
    assert.match(made.fix, /Add a link/)
  })

  it('refuses a device that does not exist, and lists the ones that do', () => {
    const office = ok(shape('small-office')) as Topology
    const made = findRoute(office, 'pc1', 'nonsense')
    assert.ok(isNetworkError(made))
    assert.match(made.fix, /pc1/)
  })

  it('the data centre has two equal routes between any pair of leaves', () => {
    const dc = ok(shape('datacentre')) as Topology
    const made = ok(findRoute(dc, 'server0-0', 'server2-1'))
    // Up to a spine and back down: four hops whichever spine it uses.
    assert.equal(made.hops, 4)
  })
})

describe('the protocols', () => {
  it('getting an address takes four messages and two round trips', () => {
    const made = addressAssignment({ delayMs: 3 })
    assert.equal(made.exchanges.length, 4)
    assert.equal(made.roundTrips, 2)
    assert.deepEqual(made.exchanges.map((one) => one.kind), ['Discover', 'Offer', 'Request', 'Acknowledge'])
    // The first message has to be a broadcast, and the reason is worth stating.
    assert.match(made.exchanges[0].says, /cannot address the question/)
    assert.ok(made.notes.some((one) => /lease/.test(one)))
  })

  it('a name lookup with nothing cached walks down from the root', () => {
    const made = ok(nameLookup('example.com'))
    assert.equal(made.roundTrips, 4)
    assert.ok(made.exchanges.some((one) => one.to === 'root'))
    assert.ok(made.exchanges.some((one) => one.kind === 'Referral'))
    // The root refers rather than answering, and this says so.
    assert.ok(made.exchanges.some((one) => /does not pretend/.test(one.says)))
  })

  it('a cached lookup is one step, which is why the second visit is faster', () => {
    const made = ok(nameLookup('example.com', { cached: true }))
    assert.equal(made.roundTrips, 1)
    assert.ok(made.totalMs < ok(nameLookup('example.com')).totalMs)
    assert.match(made.says, /cache/)
  })

  it('refuses something that is not a name', () => {
    assert.ok(isNetworkError(nameLookup('')))
    assert.ok(isNetworkError(nameLookup('not a name!')))
  })

  it('address translation keeps connections apart by port, and says why incoming ones fail', () => {
    const made = ok(
      translate([
        { from: '192.168.1.10', port: 51000, to: 'example.com' },
        { from: '192.168.1.10', port: 51001, to: 'example.com' },
        { from: '192.168.1.11', port: 44000, to: 'example.com' }
      ])
    )
    assert.equal(made.table.length, 3)
    assert.equal(made.sharing, 2)
    // Every outside port is different, which is the whole mechanism.
    assert.equal(new Set(made.table.map((one) => one.outsidePort)).size, 3)
    assert.ok(made.notes.some((one) => /started from the outside/.test(one)))
  })

  it('the handshake takes a full round trip before any data', () => {
    const made = handshake(30)
    assert.equal(made.beforeDataMs, 30)
    assert.deepEqual(made.exchanges.slice(0, 3).map((one) => one.kind), ['SYN', 'SYN-ACK', 'ACK'])
    // Four messages to close, because each side finishes separately.
    assert.equal(made.exchanges.filter((one) => one.kind === 'FIN' || one.kind === 'ACK').length, 5)
    assert.ok(made.notes.some((one) => /four to close/.test(one)))
  })
})

describe('congestion control', () => {
  it('starts at one and doubles while in slow start', () => {
    const made = ok(congestion({ capacity: 32, rounds: 6, startThreshold: 16 }))
    assert.deepEqual(made.samples.slice(0, 5).map((one) => one.window), [1, 2, 4, 8, 16])
    assert.equal(made.samples[0].phase, 'slow-start')
  })

  it('grows by one a round once past the threshold', () => {
    const made = ok(congestion({ capacity: 40, rounds: 10, startThreshold: 4 }))
    const avoiding = made.samples.filter((one) => one.phase === 'congestion-avoidance').map((one) => one.window)
    for (let i = 1; i < avoiding.length; i += 1) {
      assert.equal(avoiding[i] - avoiding[i - 1], 1, 'additive increase must add exactly one')
    }
  })

  it('a loss halves the threshold and drops the window to one — the sawtooth', () => {
    const made = ok(congestion({ capacity: 8, rounds: 30 }))
    assert.ok(made.losses > 0, 'a window that grows past the capacity must eventually lose something')
    const at = made.samples.findIndex((one) => one.lost)
    assert.ok(at >= 0 && at + 1 < made.samples.length)
    assert.equal(made.samples[at + 1].window, 1, 'the window must drop back to one after a loss')
    assert.ok(made.samples[at + 1].threshold <= Math.floor(made.samples[at].window / 2) + 1)
    assert.ok(made.notes.some((one) => /sawtooth/.test(one)))
  })

  it('never delivers more than the path can carry', () => {
    const made = ok(congestion({ capacity: 10, rounds: 40 }))
    for (const sample of made.samples) {
      assert.ok(sample.delivered <= 10, `delivered ${sample.delivered} on a path holding 10`)
    }
    assert.ok(made.efficiency <= 1)
  })

  it('random loss makes it perform badly however much capacity there is, which is its weakness', () => {
    const clean = ok(congestion({ capacity: 40, rounds: 60, randomLoss: 0, seed: 7 }))
    const lossy = ok(congestion({ capacity: 40, rounds: 60, randomLoss: 0.15, seed: 7 }))
    assert.ok(lossy.averageWindow < clean.averageWindow, `lossy ${lossy.averageWindow} should be below clean ${clean.averageWindow}`)
    assert.ok(lossy.notes.some((one) => /cannot tell that from congestion/.test(one)))
  })

  it('the same settings give the same picture every time', () => {
    const a = ok(congestion({ capacity: 20, rounds: 50, randomLoss: 0.1, seed: 42 }))
    const b = ok(congestion({ capacity: 20, rounds: 50, randomLoss: 0.1, seed: 42 }))
    assert.deepEqual(a.samples.map((one) => one.window), b.samples.map((one) => one.window))
  })

  it('says what it is and is not', () => {
    const made = ok(congestion({ rounds: 10 }))
    assert.ok(made.notes.some((one) => /Tahoe/.test(one)), 'it must say which scheme this is')
  })
})

describe('the firewall', () => {
  const RULES = [
    { order: 1, action: 'allow' as const, port: 443, protocol: 'tcp' as const, note: 'web' },
    { order: 2, action: 'allow' as const, port: 22, protocol: 'tcp' as const, from: '192.168.1.10', note: 'admin only' },
    { order: 3, action: 'deny' as const, port: 22, protocol: 'tcp' as const, note: 'everybody else' }
  ]

  it('the first matching rule decides', () => {
    const made = ok(
      firewall(RULES, [
        { from: '1.2.3.4', to: 'server', port: 443, protocol: 'tcp' },
        { from: '192.168.1.10', to: 'server', port: 22, protocol: 'tcp' },
        { from: '1.2.3.4', to: 'server', port: 22, protocol: 'tcp' }
      ])
    )
    assert.equal(made.verdicts[0].allowed, true)
    assert.equal(made.verdicts[0].byRule, 1)
    assert.equal(made.verdicts[1].allowed, true)
    assert.equal(made.verdicts[1].byRule, 2)
    assert.equal(made.verdicts[2].allowed, false)
    assert.equal(made.verdicts[2].byRule, 3)
  })

  it('what nothing matches gets the default', () => {
    const made = ok(firewall(RULES, [{ from: '1.2.3.4', to: 'server', port: 8080, protocol: 'tcp' }], 'deny'))
    assert.equal(made.verdicts[0].allowed, false)
    assert.equal(made.verdicts[0].byRule, null)
    assert.match(made.verdicts[0].says, /default/)

    const permissive = ok(firewall(RULES, [{ from: '1.2.3.4', to: 'server', port: 8080, protocol: 'tcp' }], 'allow'))
    assert.equal(permissive.verdicts[0].allowed, true)
  })

  it('finds a rule that can never match because an earlier one covers it', () => {
    // The commonest firewall mistake: a general deny above a specific allow.
    const made = ok(
      firewall(
        [
          { order: 1, action: 'deny', port: 22, protocol: 'tcp' },
          { order: 2, action: 'allow', port: 22, protocol: 'tcp', from: '192.168.1.10' }
        ],
        [{ from: '192.168.1.10', to: 'server', port: 22, protocol: 'tcp' }]
      )
    )
    assert.equal(made.verdicts[0].allowed, false, 'the general deny wins, which is the bug')
    assert.deepEqual(made.shadowedRules.map((one) => one.rule), [2])
    assert.ok(made.notes.some((one) => /can never match/.test(one)))
    assert.ok(made.notes.some((one) => /Move/.test(one)))
  })

  it('does not call a rule shadowed when it is genuinely different', () => {
    const made = ok(firewall(RULES, [{ from: '1.2.3.4', to: 'server', port: 443, protocol: 'tcp' }]))
    assert.equal(made.shadowedRules.length, 0, `wrongly shadowed: ${JSON.stringify(made.shadowedRules)}`)
  })

  it('reports rules nothing matched', () => {
    const made = ok(firewall(RULES, [{ from: '1.2.3.4', to: 'server', port: 443, protocol: 'tcp' }]))
    assert.deepEqual([...made.unusedRules], [2, 3])
    assert.ok(made.notes.some((one) => /No packet in this set/.test(one)))
  })

  it('says which way round the default is, and which is safer', () => {
    const made = ok(firewall(RULES, [], 'deny'))
    assert.ok(made.notes.some((one) => /safer way round/.test(one)))
  })

  it('refuses an unreasonable number of rules', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ order: i, action: 'allow' as const }))
    assert.ok(isNetworkError(firewall(many, [])))
  })
})
