/**
 * Networking: addresses, topologies, routing, and the protocols on top.
 *
 * ## Addresses are arithmetic, so they are computed
 *
 * Subnetting is bit manipulation and nothing else. Every network address, broadcast address, host range and mask
 * here comes from the arithmetic rather than from a table, so an unusual prefix length works as well as a familiar
 * one and a question about a /27 gets the same quality of answer as one about a /24.
 *
 * ## Packets travel the topology that exists
 *
 * A path is found by searching the graph of links, with each link's delay and bandwidth. So removing a cable changes
 * the route because the search found a different one, and a packet's latency is the sum of what it actually crossed.
 *
 * ## The protocol models are educational, and say so
 *
 * The congestion control here is the textbook additive-increase, multiplicative-decrease with slow start — which is
 * TCP Tahoe, roughly. Real TCP is a great deal more than that: selective acknowledgement, fast recovery, pacing,
 * and a choice of several congestion algorithms. What is modelled is the part that explains the sawtooth, and the
 * limitations are listed rather than implied.
 *
 * Pure. No Electron, no DOM.
 */

export interface NetworkError {
  error: string
  says: string
  fix: string
}

export const isNetworkError = (value: unknown): value is NetworkError =>
  typeof value === 'object' && value !== null && 'error' in value && 'says' in value && 'fix' in value

const refuse = (error: string, says: string, fix: string): NetworkError => ({ error, says, fix })

export const NETWORK_LIMITS = Object.freeze({
  nodes: 64,
  links: 256,
  packets: 20_000,
  rounds: 2_000
})

// ---------------------------------------------------------------- addresses

export interface Address {
  /** The four octets. */
  octets: readonly [number, number, number, number]
  /** As a single 32-bit number, which is what the arithmetic works on. */
  value: number
  text: string
}

export function readAddress(text: string): Address | NetworkError {
  const parts = String(text).trim().split('.')
  if (parts.length !== 4) {
    return refuse('not an address', `"${text}" is not an IPv4 address.`, 'An address is four numbers separated by dots, as in 192.168.1.10.')
  }
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return refuse('not an address', `"${part}" is not a number between 0 and 255.`, 'Each of the four parts is a whole number from 0 to 255.')
    }
    const n = Number(part)
    if (n > 255) return refuse('out of range', `${n} is more than 255, which is the most one part can be.`, 'Each part holds eight bits, so 0 to 255.')
    octets.push(n)
  }
  const value = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
  return { octets: Object.freeze(octets) as Address['octets'], value, text: octets.join('.') }
}

const asAddress = (value: number): Address => {
  const n = value >>> 0
  const octets = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] as const
  return { octets: Object.freeze(octets) as Address['octets'], value: n, text: octets.join('.') }
}

export type AddressClass = 'A' | 'B' | 'C' | 'D (multicast)' | 'E (reserved)'

export interface SubnetReport {
  address: Address
  prefix: number
  mask: Address
  wildcard: Address
  network: Address
  broadcast: Address
  firstHost: Address | null
  lastHost: Address | null
  /** Addresses in the block, including the network and broadcast ones. */
  total: number
  /** Addresses a machine can actually be given. */
  usable: number
  /** Which historical class the address falls in. Mostly of historical interest now. */
  addressClass: AddressClass
  /** True for the ranges reserved for private use. */
  private: boolean
  /** True for loopback, link-local and the other special ranges. */
  special: string | null
  says: string
  notes: readonly string[]
}

/**
 * Works out everything about an address and prefix.
 *
 * The /31 and /32 cases are handled properly rather than as an afterthought: a /32 is a single host with no network
 * or broadcast address, and a /31 is the two-address form used on point-to-point links. Both are real and both break
 * the "subtract two" rule that holds everywhere else, which is exactly why they are worth getting right.
 */
export function subnet(text: string, prefix: number): SubnetReport | NetworkError {
  const address = readAddress(text)
  if (isNetworkError(address)) return address
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return refuse('bad prefix', `/${prefix} is not a prefix length.`, 'A prefix is a whole number from 0 to 32 — the count of leading bits that are the network.')
  }

  const maskValue = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (address.value & maskValue) >>> 0
  const broadcast = (network | (~maskValue >>> 0)) >>> 0
  const total = 2 ** (32 - prefix)

  /*
   * How many addresses can be given to a machine.
   *
   * A /32 is one address and it is the host — there is no network or broadcast address to set aside. A /31 is the
   * two-address form standardised for point-to-point links, where both addresses are usable. Everything else gives
   * up two. Getting this wrong by applying "minus two" everywhere is the commonest mistake in the subject.
   */
  const usable = prefix === 32 ? 1 : prefix === 31 ? 2 : Math.max(0, total - 2)
  const firstHost = prefix >= 31 ? asAddress(network) : usable > 0 ? asAddress(network + 1) : null
  const lastHost = prefix === 32 ? asAddress(network) : prefix === 31 ? asAddress(broadcast) : usable > 0 ? asAddress(broadcast - 1) : null

  const first = address.octets[0]
  const addressClass: AddressClass =
    first < 128 ? 'A' : first < 192 ? 'B' : first < 224 ? 'C' : first < 240 ? 'D (multicast)' : 'E (reserved)'

  const isPrivate =
    first === 10 ||
    (first === 172 && address.octets[1] >= 16 && address.octets[1] <= 31) ||
    (first === 192 && address.octets[1] === 168)

  let special: string | null = null
  if (first === 127) special = 'loopback — always this machine, and never sent on a wire'
  else if (first === 169 && address.octets[1] === 254) special = 'link-local — what a machine gives itself when no address server answered'
  else if (first === 0) special = 'this network — not a usable host address'
  else if (first >= 224 && first < 240) special = 'multicast — one packet delivered to many listeners'
  else if (first >= 240) special = 'reserved — never allocated'

  const notes: string[] = []
  if (prefix === 32) {
    notes.push('A /32 is a single address. There is no network or broadcast address to set aside, so the usual "subtract two" does not apply.')
  } else if (prefix === 31) {
    notes.push('A /31 is the two-address form for a link between exactly two routers. Both addresses are usable — again the "subtract two" rule does not apply.')
  } else {
    notes.push(
      `Two of the ${total.toLocaleString()} addresses cannot be given to a machine: the first names the network itself and the last is the broadcast address, so ${usable.toLocaleString()} are usable.`
    )
  }
  if (isPrivate) notes.push('This is in a private range, so it is never routed on the public internet. Many networks use the same private addresses behind their own translation.')
  if (special !== null) notes.push(`This address is special: ${special}.`)
  if (prefix < 8) notes.push(`A /${prefix} is an enormous block — ${total.toLocaleString()} addresses. Nothing is allocated this way any more.`)

  return {
    address,
    prefix,
    mask: asAddress(maskValue),
    wildcard: asAddress(~maskValue >>> 0),
    network: asAddress(network),
    broadcast: asAddress(broadcast),
    firstHost,
    lastHost,
    total,
    usable,
    addressClass,
    private: isPrivate,
    special,
    says: `${address.text}/${prefix} is in the network ${asAddress(network).text}/${prefix}, which holds ${usable.toLocaleString()} usable address${usable === 1 ? '' : 'es'}${firstHost !== null && lastHost !== null ? ` from ${firstHost.text} to ${lastHost.text}` : ''}.`,
    notes: Object.freeze(notes)
  }
}

/** Whether two addresses are on the same network, which decides whether a packet needs a router at all. */
export function sameNetwork(a: string, b: string, prefix: number): { same: boolean; says: string } | NetworkError {
  const first = subnet(a, prefix)
  if (isNetworkError(first)) return first
  const second = subnet(b, prefix)
  if (isNetworkError(second)) return second
  const same = first.network.value === second.network.value
  return {
    same,
    says: same
      ? `Both are on ${first.network.text}/${prefix}, so they can talk directly — no router involved.`
      : `${first.address.text} is on ${first.network.text}/${prefix} and ${second.address.text} is on ${second.network.text}/${prefix}. Different networks, so a packet between them has to go through a router.`
  }
}

/** Splits a block into equal smaller blocks. */
export function splitBlock(text: string, prefix: number, into: number): readonly SubnetReport[] | NetworkError {
  const parent = subnet(text, prefix)
  if (isNetworkError(parent)) return parent
  if (into < 2 || !Number.isInteger(into)) return refuse('bad count', `Cannot split into ${into}.`, 'Split into 2 or more.')
  const bitsNeeded = Math.ceil(Math.log2(into))
  const newPrefix = prefix + bitsNeeded
  if (newPrefix > 32) {
    return refuse(
      'will not fit',
      `Splitting a /${prefix} into ${into} needs ${bitsNeeded} more bits, which would be a /${newPrefix}.`,
      'A prefix cannot go past 32. Split into fewer, or start from a larger block.'
    )
  }
  const made: SubnetReport[] = []
  const step = 2 ** (32 - newPrefix)
  for (let i = 0; i < 2 ** bitsNeeded; i += 1) {
    const one = subnet(asAddress(parent.network.value + i * step).text, newPrefix)
    if (isNetworkError(one)) return one
    made.push(one)
  }
  return Object.freeze(made)
}

// ---------------------------------------------------------------- topology

export type DeviceKind = 'host' | 'switch' | 'router' | 'server'

export const DEVICE_KINDS: readonly DeviceKind[] = Object.freeze(['host', 'switch', 'router', 'server'])

export const DEVICE_ABOUT: Readonly<Record<DeviceKind, string>> = Object.freeze({
  host: 'A machine somebody uses. It has one address and sends everything not on its own network to its router.',
  switch: 'Joins machines on one network. It forwards by hardware address and does not look at IP addresses at all.',
  router: 'Joins networks. It looks at the destination address and decides which way to send the packet.',
  server: 'A machine something connects to. The same as a host as far as the network is concerned.'
})

export interface Device {
  id: string
  kind: DeviceKind
  /** Its address, where it has one. Switches do not need one to do their job. */
  address?: string
  prefix?: number
}

export interface Link {
  from: string
  to: string
  /** One way, in milliseconds. */
  delayMs: number
  /** In megabits per second. */
  bandwidthMbps: number
  /** Fraction of packets dropped, 0 to 1. */
  loss?: number
  /** Set when the cable is unplugged, so a route can be made to fail without deleting the link. */
  down?: boolean
}

export interface Topology {
  devices: readonly Device[]
  links: readonly Link[]
  name?: string
}

export interface TopologyCheck {
  ok: boolean
  /** Devices nothing connects to. */
  isolated: readonly string[]
  /** Links naming a device that does not exist. */
  dangling: readonly string[]
  /** Groups of devices that can reach each other but not the other groups. */
  islands: readonly (readonly string[])[]
  problems: readonly string[]
  notes: readonly string[]
}

export function checkTopology(topology: Topology): TopologyCheck | NetworkError {
  if (topology.devices.length === 0) return refuse('empty', 'There are no devices.', 'Add a machine or two and a link between them.')
  if (topology.devices.length > NETWORK_LIMITS.nodes) {
    return refuse('too many', `${topology.devices.length} devices is more than this will simulate.`, `Keep it under ${NETWORK_LIMITS.nodes}.`)
  }
  if (topology.links.length > NETWORK_LIMITS.links) {
    return refuse('too many links', `${topology.links.length} links is more than this will simulate.`, `Keep it under ${NETWORK_LIMITS.links}.`)
  }

  const known = new Set(topology.devices.map((one) => one.id))
  const problems: string[] = []
  const dangling: string[] = []
  const seen = new Set<string>()

  for (const one of topology.devices) {
    if (seen.has(one.id)) problems.push(`Two devices are both called "${one.id}".`)
    seen.add(one.id)
    if (one.address !== undefined) {
      const made = readAddress(one.address)
      if (isNetworkError(made)) problems.push(`${one.id}: ${made.says}`)
    }
    if (one.kind !== 'switch' && one.address === undefined) {
      problems.push(`${one.id} is a ${one.kind} with no address. It cannot send or receive anything.`)
    }
  }

  const neighbours = new Map<string, string[]>()
  for (const link of topology.links) {
    for (const end of [link.from, link.to]) {
      if (!known.has(end)) {
        dangling.push(end)
        problems.push(`A link names "${end}", which is not a device.`)
      }
    }
    if (link.delayMs < 0) problems.push(`A link between ${link.from} and ${link.to} has a negative delay.`)
    if (link.bandwidthMbps <= 0) problems.push(`A link between ${link.from} and ${link.to} has no bandwidth.`)
    if (!known.has(link.from) || !known.has(link.to)) continue
    const a = neighbours.get(link.from)
    if (a === undefined) neighbours.set(link.from, [link.to])
    else a.push(link.to)
    const b = neighbours.get(link.to)
    if (b === undefined) neighbours.set(link.to, [link.from])
    else b.push(link.from)
  }

  const isolated = topology.devices.filter((one) => (neighbours.get(one.id) ?? []).length === 0).map((one) => one.id)

  // The islands: who can reach whom at all.
  const islands: string[][] = []
  const visited = new Set<string>()
  for (const device of topology.devices) {
    if (visited.has(device.id)) continue
    const group: string[] = []
    const queue = [device.id]
    visited.add(device.id)
    while (queue.length > 0) {
      const at = queue.shift() as string
      group.push(at)
      for (const next of neighbours.get(at) ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        queue.push(next)
      }
    }
    islands.push(group.sort())
  }

  const notes: string[] = []
  if (islands.length > 1) {
    notes.push(
      `There are ${islands.length} separate groups: ${islands.map((one) => one.join('/')).join(' and ')}. Nothing in one can reach anything in another, however the addresses are set.`
    )
  }
  if (isolated.length > 0) notes.push(`${isolated.join(', ')} ${isolated.length === 1 ? 'has' : 'have'} no cable at all.`)
  const routers = topology.devices.filter((one) => one.kind === 'router').length
  if (routers === 0 && topology.devices.length > 1) {
    notes.push('There is no router, so everything here has to be on one network to talk to anything.')
  }

  return {
    ok: problems.length === 0,
    isolated: Object.freeze(isolated),
    dangling: Object.freeze([...new Set(dangling)]),
    islands: Object.freeze(islands.map((one) => Object.freeze(one))),
    problems: Object.freeze(problems),
    notes: Object.freeze(notes)
  }
}

export interface Route {
  path: readonly string[]
  /** One way, in milliseconds: the sum of the link delays. */
  delayMs: number
  /** The slowest link on the path, which is what limits throughput. */
  bottleneckMbps: number
  /** The chance a packet gets through all of it. */
  deliveryChance: number
  hops: number
  says: string
}

/**
 * Finds the quickest route between two devices.
 *
 * Dijkstra over the link delays, which is what a link-state routing protocol does. The bottleneck bandwidth is
 * reported separately, because the fastest route and the fattest route are not the same thing — a satellite link can
 * be enormously wide and still take half a second.
 */
export function findRoute(topology: Topology, from: string, to: string): Route | NetworkError {
  const known = new Set(topology.devices.map((one) => one.id))
  if (!known.has(from)) return refuse('no such device', `There is no device called "${from}".`, `The devices are: ${[...known].join(', ')}.`)
  if (!known.has(to)) return refuse('no such device', `There is no device called "${to}".`, `The devices are: ${[...known].join(', ')}.`)
  if (from === to) return refuse('same place', 'The source and the destination are the same device.', 'Pick two different ones.')

  const edges = new Map<string, { to: string; link: Link }[]>()
  for (const link of topology.links) {
    if (link.down === true) continue
    const a = edges.get(link.from)
    if (a === undefined) edges.set(link.from, [{ to: link.to, link }])
    else a.push({ to: link.to, link })
    const b = edges.get(link.to)
    if (b === undefined) edges.set(link.to, [{ to: link.from, link }])
    else b.push({ to: link.from, link })
  }

  const best = new Map<string, number>([[from, 0]])
  const cameFrom = new Map<string, { node: string; link: Link }>()
  const settled = new Set<string>()

  while (settled.size < known.size) {
    let at: string | null = null
    let atCost = Infinity
    for (const [node, cost] of best) {
      if (settled.has(node)) continue
      if (cost < atCost) {
        at = node
        atCost = cost
      }
    }
    if (at === null) break
    settled.add(at)
    if (at === to) break
    for (const { to: next, link } of edges.get(at) ?? []) {
      const cost = atCost + link.delayMs
      if (cost < (best.get(next) ?? Infinity)) {
        best.set(next, cost)
        cameFrom.set(next, { node: at, link })
      }
    }
  }

  if (!best.has(to)) {
    const check = checkTopology(topology)
    const why = !isNetworkError(check) && check.islands.length > 1 ? ' They are in separate groups with no cable between them.' : ''
    return refuse(
      'no route',
      `There is no way for a packet to get from ${from} to ${to}.${why}`,
      'Add a link, or plug in one that is down.'
    )
  }

  const path: string[] = [to]
  const crossed: Link[] = []
  let at = to
  while (at !== from) {
    const step = cameFrom.get(at)
    if (step === undefined) break
    crossed.push(step.link)
    path.unshift(step.node)
    at = step.node
  }

  const delayMs = crossed.reduce((a, b) => a + b.delayMs, 0)
  const bottleneckMbps = crossed.length === 0 ? Infinity : Math.min(...crossed.map((one) => one.bandwidthMbps))
  const deliveryChance = crossed.reduce((a, b) => a * (1 - (b.loss ?? 0)), 1)

  return {
    path: Object.freeze(path),
    delayMs,
    bottleneckMbps,
    deliveryChance,
    hops: crossed.length,
    says: `${path.join(' → ')}: ${crossed.length} hop${crossed.length === 1 ? '' : 's'}, ${delayMs}ms one way, limited to ${bottleneckMbps} Mbps by its slowest link${deliveryChance < 1 ? `, and about ${((1 - deliveryChance) * 100).toFixed(1)}% of packets lost on the way` : ''}.`
  }
}

// ---------------------------------------------------------------- the protocols

export interface Exchange {
  at: number
  from: string
  to: string
  /** What the message is, in the protocol's own terms. */
  kind: string
  /** The interesting fields, so the exchange can be read. */
  fields: Readonly<Record<string, string | number>>
  says: string
}

export interface ProtocolRun {
  protocol: string
  exchanges: readonly Exchange[]
  /** Total time for the whole thing, in milliseconds. */
  totalMs: number
  /** Round trips the exchange needed, which is what dominates on a slow link. */
  roundTrips: number
  succeeded: boolean
  says: string
  notes: readonly string[]
}

/**
 * The address-assignment exchange: discover, offer, request, acknowledge.
 *
 * Four messages and two round trips, which is why a machine takes a moment to get an address when it joins a network.
 */
export function addressAssignment(options: { clientId?: string; serverId?: string; delayMs?: number; offered?: string; lease?: number } = {}): ProtocolRun {
  const client = options.clientId ?? 'laptop'
  const server = options.serverId ?? 'router'
  const delay = options.delayMs ?? 2
  const offered = options.offered ?? '192.168.1.42'
  const lease = options.lease ?? 86_400

  const exchanges: Exchange[] = [
    {
      at: 0,
      from: client,
      to: 'everyone',
      kind: 'Discover',
      fields: { from: '0.0.0.0', to: '255.255.255.255' },
      says: `${client} has no address yet, so it shouts to the whole network asking whether anybody hands them out. It cannot address the question to the server, because it does not know the server exists.`
    },
    {
      at: delay,
      from: server,
      to: client,
      kind: 'Offer',
      fields: { offered, mask: '255.255.255.0', router: '192.168.1.1', lease },
      says: `${server} offers ${offered}, along with the mask, the router to use and how long the address is good for.`
    },
    {
      at: delay * 2,
      from: client,
      to: 'everyone',
      kind: 'Request',
      fields: { asking: offered },
      says: `${client} asks for that address specifically — still as a broadcast, so that any other server that also offered knows its offer was not taken.`
    },
    {
      at: delay * 3,
      from: server,
      to: client,
      kind: 'Acknowledge',
      fields: { confirmed: offered, lease },
      says: `${server} confirms it. ${client} now has ${offered} for ${(lease / 3600).toFixed(0)} hours, and will ask to keep it before then.`
    }
  ]

  return {
    protocol: 'address assignment',
    exchanges: Object.freeze(exchanges),
    totalMs: delay * 3,
    roundTrips: 2,
    succeeded: true,
    says: `Four messages and two round trips to get an address — ${delay * 3}ms on this network.`,
    notes: Object.freeze([
      'The first and third messages are broadcasts because the machine has no address to be replied to yet. That is why this exchange only works on the local network and cannot cross a router without help.',
      'The address is a lease, not a gift. A machine that goes away without saying so keeps its address reserved until the lease runs out.'
    ])
  }
}

/** Looking a name up, with the recursion a resolver actually does. */
export function nameLookup(
  name: string,
  options: { cached?: boolean; delayMs?: number; answer?: string } = {}
): ProtocolRun | NetworkError {
  const clean = String(name).trim().toLowerCase()
  if (clean.length === 0 || !/^[a-z0-9.-]+$/.test(clean)) {
    return refuse('not a name', `"${name}" is not a name that could be looked up.`, 'Try something like example.com.')
  }
  const delay = options.delayMs ?? 12
  const answer = options.answer ?? '93.184.216.34'
  const labels = clean.split('.').filter((one) => one.length > 0)

  if (options.cached === true) {
    return {
      protocol: 'name lookup',
      exchanges: Object.freeze<Exchange[]>([
        {
          at: 0,
          from: 'laptop',
          to: 'resolver',
          kind: 'Query',
          fields: { name: clean, type: 'A' },
          says: `Asking the resolver for ${clean}.`
        },
        {
          at: 1,
          from: 'resolver',
          to: 'laptop',
          kind: 'Answer (from cache)',
          fields: { name: clean, address: answer, ttl: 300 },
          says: `The resolver already knew, so it answered in one step. This is why the second visit to a site feels faster than the first.`
        }
      ]),
      totalMs: 1,
      roundTrips: 1,
      succeeded: true,
      says: `Answered from the cache in 1ms, with no other server asked.`,
      notes: Object.freeze([
        'A cached answer has a time to live. Once that runs out the resolver has to ask again, which is why a changed address takes a while to be seen everywhere.'
      ])
    }
  }

  const exchanges: Exchange[] = [
    { at: 0, from: 'laptop', to: 'resolver', kind: 'Query', fields: { name: clean, type: 'A' }, says: `Asking the resolver for ${clean}. The machine asks once and waits.` },
    { at: delay, from: 'resolver', to: 'root', kind: 'Query', fields: { name: clean }, says: 'The resolver knows nothing about this name, so it starts at the root.' },
    {
      at: delay * 2,
      from: 'root',
      to: 'resolver',
      kind: 'Referral',
      fields: { tryNext: `the ${labels[labels.length - 1]} servers` },
      says: `The root does not know the answer and does not pretend to. It says which servers handle ".${labels[labels.length - 1]}".`
    },
    {
      at: delay * 3,
      from: 'resolver',
      to: `${labels[labels.length - 1]} servers`,
      kind: 'Query',
      fields: { name: clean },
      says: 'The resolver asks those.'
    },
    {
      at: delay * 4,
      from: `${labels[labels.length - 1]} servers`,
      to: 'resolver',
      kind: 'Referral',
      fields: { tryNext: `the servers for ${labels.slice(-2).join('.')}` },
      says: `Again a referral rather than an answer, this time to whoever holds ${labels.slice(-2).join('.')}.`
    },
    { at: delay * 5, from: 'resolver', to: `${labels.slice(-2).join('.')} servers`, kind: 'Query', fields: { name: clean }, says: 'And asks those.' },
    {
      at: delay * 6,
      from: `${labels.slice(-2).join('.')} servers`,
      to: 'resolver',
      kind: 'Answer',
      fields: { name: clean, address: answer, ttl: 300 },
      says: `These are the servers responsible for the name, so they answer: ${answer}.`
    },
    {
      at: delay * 6 + 1,
      from: 'resolver',
      to: 'laptop',
      kind: 'Answer',
      fields: { name: clean, address: answer },
      says: `The resolver passes it back, and keeps it for the next time anybody asks.`
    }
  ]

  return {
    protocol: 'name lookup',
    exchanges: Object.freeze(exchanges) as readonly Exchange[],
    totalMs: delay * 6 + 1,
    roundTrips: 4,
    succeeded: true,
    says: `Four round trips and ${delay * 6 + 1}ms, because nothing had the answer cached.`,
    notes: Object.freeze([
      'The machine asked once. The resolver did all the walking, which is what "recursive" means — and why a slow resolver makes everything feel slow.',
      'Each step is a referral, not a guess. No server in the chain invents an answer it does not have.',
      'The next lookup of this name is answered from the cache in one step, until the time to live runs out.'
    ])
  }
}

export interface Translation {
  insideAddress: string
  insidePort: number
  outsideAddress: string
  outsidePort: number
  destination: string
}

export interface NatReport {
  table: readonly Translation[]
  outsideAddress: string
  /** How many inside machines are sharing the one outside address. */
  sharing: number
  says: string
  notes: readonly string[]
}

/**
 * Address translation: many private addresses behind one public one.
 *
 * The port is what makes it work, and this shows the table that has to be kept. The point worth taking away is the
 * consequence: a connection started from outside has no entry in the table, so there is nowhere to send it — which
 * is why a machine behind translation cannot simply be connected to.
 */
export function translate(
  connections: readonly { from: string; port: number; to: string }[],
  outsideAddress = '203.0.113.7'
): NatReport | NetworkError {
  if (connections.length === 0) return refuse('nothing to translate', 'There are no connections.', 'Add a machine making a connection.')
  if (connections.length > 200) return refuse('too many', `${connections.length} connections is more than this will show.`, 'Keep it under 200.')

  const table: Translation[] = []
  let nextPort = 49_152
  for (const one of connections) {
    const address = readAddress(one.from)
    if (isNetworkError(address)) return address
    table.push({
      insideAddress: address.text,
      insidePort: one.port,
      outsideAddress,
      outsidePort: nextPort++,
      destination: one.to
    })
  }

  const sharing = new Set(table.map((one) => one.insideAddress)).size

  return {
    table: Object.freeze(table),
    outsideAddress,
    sharing,
    says: `${sharing} machine${sharing === 1 ? '' : 's'} sharing ${outsideAddress}, with ${table.length} connection${table.length === 1 ? '' : 's'} kept apart by port number.`,
    notes: Object.freeze([
      'Every reply comes back to the one outside address, and the port is the only thing that says which inside machine it belongs to. That table is the whole of how this works.',
      'A connection started from the outside has no entry in the table, so there is nowhere to send it. That is why a machine behind translation cannot simply be connected to, and why forwarding a port has to be set up by hand.',
      'The table has to be kept for as long as a connection lasts. A router with a small table drops connections when it fills up.'
    ])
  }
}

export interface FirewallRule {
  /** Earlier rules win, which is how every firewall works. */
  order: number
  action: 'allow' | 'deny'
  from?: string
  to?: string
  port?: number
  protocol?: 'tcp' | 'udp' | 'any'
  note?: string
}

export interface FirewallVerdict {
  packet: { from: string; to: string; port: number; protocol: 'tcp' | 'udp' }
  allowed: boolean
  /** Which rule decided it, or null when nothing matched and the default applied. */
  byRule: number | null
  says: string
}

export interface FirewallReport {
  verdicts: readonly FirewallVerdict[]
  defaultAction: 'allow' | 'deny'
  /** Rules no packet ever matched, which usually means they are in the wrong order. */
  unusedRules: readonly number[]
  /** Rules that can never match because an earlier one covers everything they do. */
  shadowedRules: readonly { rule: number; by: number }[]
  says: string
  notes: readonly string[]
}

/**
 * Applies firewall rules to packets, first match wins.
 *
 * ## The shadowing check is the useful part
 *
 * A rule that can never match because an earlier one already covers it is the commonest firewall mistake, and it is
 * silent: the rule is there, it looks right, and it does nothing. Finding those is worth more than evaluating the
 * packets.
 */
export function firewall(
  rules: readonly FirewallRule[],
  packets: readonly { from: string; to: string; port: number; protocol: 'tcp' | 'udp' }[],
  defaultAction: 'allow' | 'deny' = 'deny'
): FirewallReport | NetworkError {
  if (rules.length > 100) return refuse('too many rules', `${rules.length} rules is more than this will check.`, 'Keep it under 100.')

  const ordered = [...rules].sort((a, b) => a.order - b.order)
  const matches = (rule: FirewallRule, packet: { from: string; to: string; port: number; protocol: string }): boolean => {
    if (rule.from !== undefined && rule.from !== 'any' && rule.from !== packet.from) return false
    if (rule.to !== undefined && rule.to !== 'any' && rule.to !== packet.to) return false
    if (rule.port !== undefined && rule.port !== packet.port) return false
    if (rule.protocol !== undefined && rule.protocol !== 'any' && rule.protocol !== packet.protocol) return false
    return true
  }

  const used = new Set<number>()
  const verdicts: FirewallVerdict[] = packets.map((packet) => {
    const hit = ordered.find((rule) => matches(rule, packet))
    if (hit !== undefined) used.add(hit.order)
    const allowed = hit === undefined ? defaultAction === 'allow' : hit.action === 'allow'
    return {
      packet,
      allowed,
      byRule: hit?.order ?? null,
      says:
        hit === undefined
          ? `Nothing matched, so the default applies: ${defaultAction}.`
          : `Rule ${hit.order} matched first, so this is ${hit.action === 'allow' ? 'allowed' : 'blocked'}.${hit.note === undefined ? '' : ` (${hit.note})`}`
    }
  })

  /*
   * Shadowing: an earlier rule that matches everything a later one does.
   *
   * Checked by whether the earlier rule is at least as general in every field — a rule with no value for a field
   * matches anything there, so it is more general than one that names a value.
   */
  const asGeneral = (earlier: FirewallRule, later: FirewallRule): boolean => {
    const field = (a: unknown, b: unknown): boolean => a === undefined || a === 'any' || a === b
    return field(earlier.from, later.from) && field(earlier.to, later.to) && field(earlier.port, later.port) && field(earlier.protocol, later.protocol)
  }
  const shadowedRules: { rule: number; by: number }[] = []
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (asGeneral(ordered[j], ordered[i])) {
        shadowedRules.push({ rule: ordered[i].order, by: ordered[j].order })
        break
      }
    }
  }

  const unusedRules = ordered.filter((one) => !used.has(one.order)).map((one) => one.order)
  const allowed = verdicts.filter((one) => one.allowed).length

  const notes: string[] = [
    'The first rule that matches decides, and nothing after it is looked at. Order is as much a part of a firewall as the rules themselves.'
  ]
  if (shadowedRules.length > 0) {
    notes.push(
      `${shadowedRules.map((one) => `rule ${one.rule}`).join(', ')} can never match: ${shadowedRules.map((one) => `rule ${one.by} already covers everything rule ${one.rule} does`).join('; ')}. Move ${shadowedRules.length === 1 ? 'it' : 'them'} earlier, or take ${shadowedRules.length === 1 ? 'it' : 'them'} out.`
    )
  }
  if (unusedRules.length > 0 && packets.length > 0) {
    notes.push(`No packet in this set matched ${unusedRules.map((one) => `rule ${one}`).join(', ')}. That may be correct, or they may be in the wrong order.`)
  }
  notes.push(
    `The default is to ${defaultAction}. Defaulting to deny means you list what is allowed, which is the safer way round and the harder one to get working.`
  )

  return {
    verdicts: Object.freeze(verdicts),
    defaultAction,
    unusedRules: Object.freeze(unusedRules),
    shadowedRules: Object.freeze(shadowedRules),
    says: `${allowed} of ${packets.length} packet${packets.length === 1 ? '' : 's'} allowed.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- congestion

export interface CongestionSample {
  round: number
  /** How many packets may be in flight. */
  window: number
  /** The threshold where it stops doubling and starts adding. */
  threshold: number
  phase: 'slow-start' | 'congestion-avoidance' | 'recovery'
  /** True when a packet was lost this round. */
  lost: boolean
  /** How much was actually delivered. */
  delivered: number
}

export interface CongestionReport {
  samples: readonly CongestionSample[]
  /** Average window across the run, which is proportional to throughput. */
  averageWindow: number
  losses: number
  /** How much was delivered in total. */
  delivered: number
  /** What could have been delivered with no losses at all. */
  ideal: number
  efficiency: number
  says: string
  notes: readonly string[]
}

/**
 * Congestion control: slow start, then additive increase, with a multiplicative decrease on loss.
 *
 * ## What this is, precisely
 *
 * The textbook scheme — closest to TCP Tahoe. The window doubles each round until it reaches the threshold, then
 * grows by one each round; a loss halves the threshold and restarts. That is enough to produce the sawtooth, which is
 * the thing worth seeing, and it is explicitly *not* what a modern stack does.
 *
 * ## The loss is where the capacity is, not random
 *
 * A packet is lost when the window exceeds what the path can hold. That is the honest model: congestion loss happens
 * because the sender sent more than fitted. Random loss is offered separately, because on a wireless link that is
 * also real and the algorithm cannot tell the two apart — which is its central weakness.
 */
export function congestion(
  options: { capacity?: number; rounds?: number; randomLoss?: number; seed?: number; startThreshold?: number } = {}
): CongestionReport | NetworkError {
  const capacity = Math.max(2, Math.floor(options.capacity ?? 24))
  const rounds = Math.max(4, Math.min(NETWORK_LIMITS.rounds, Math.floor(options.rounds ?? 60)))
  const randomLoss = Math.max(0, Math.min(0.5, options.randomLoss ?? 0))

  // A fixed generator, so the same settings always give the same picture and a comparison is a comparison.
  let seed = (options.seed ?? 1) >>> 0
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }

  let window = 1
  let threshold = Math.max(2, Math.floor(options.startThreshold ?? capacity))
  const samples: CongestionSample[] = []
  let losses = 0
  let delivered = 0

  for (let round = 0; round < rounds; round += 1) {
    const phase: CongestionSample['phase'] = window < threshold ? 'slow-start' : 'congestion-avoidance'
    const overCapacity = window > capacity
    const unlucky = randomLoss > 0 && random() < randomLoss
    const lost = overCapacity || unlucky

    const gotThrough = lost ? Math.min(window, capacity) : window
    delivered += gotThrough

    samples.push({ round, window, threshold, phase, lost, delivered: gotThrough })

    if (lost) {
      losses += 1
      // Halve the threshold and start again from one: the multiplicative decrease.
      threshold = Math.max(2, Math.floor(window / 2))
      window = 1
    } else if (window < threshold) {
      window = Math.min(window * 2, threshold)
    } else {
      window += 1
    }
  }

  const averageWindow = samples.reduce((a, b) => a + b.window, 0) / samples.length
  const ideal = capacity * rounds

  const notes: string[] = [
    'The window doubles each round while it is below the threshold, which is slow start — it is called slow because it begins at one, not because it rises slowly. Above the threshold it grows by one a round, which is the additive increase.',
    'A loss halves the threshold and drops the window back to one. Repeated, that produces the sawtooth: this is how a sender finds out how much the path can carry without being told.'
  ]
  if (randomLoss > 0) {
    notes.push(
      `There is also ${(randomLoss * 100).toFixed(0)}% random loss, which is what a wireless link has. The algorithm cannot tell that from congestion, so it backs off anyway — which is why plain congestion control performs badly over a lossy link however much capacity there is.`
    )
  }
  notes.push(
    'This is the textbook scheme, closest to TCP Tahoe. A modern stack has fast recovery, selective acknowledgement and a choice of congestion algorithms, and recovers from a loss without dropping all the way back to one.'
  )

  return {
    samples: Object.freeze(samples),
    averageWindow,
    losses,
    delivered,
    ideal,
    efficiency: delivered / ideal,
    says: `Over ${rounds} rounds the window averaged ${averageWindow.toFixed(1)} against a path that holds ${capacity}, with ${losses} loss${losses === 1 ? '' : 'es'} — ${((delivered / ideal) * 100).toFixed(0)}% of what a perfect sender would have delivered.`,
    notes: Object.freeze(notes)
  }
}

export interface Handshake {
  exchanges: readonly Exchange[]
  /** Time before any data can be sent, which is what a round trip costs. */
  beforeDataMs: number
  says: string
  notes: readonly string[]
}

/** The three-message exchange that opens a connection, and the four that close it. */
export function handshake(roundTripMs = 20): Handshake {
  const half = roundTripMs / 2
  return {
    exchanges: Object.freeze<Exchange[]>([
      { at: 0, from: 'client', to: 'server', kind: 'SYN', fields: { sequence: 1000 }, says: 'The client asks to open a connection, and says which number it will start counting from.' },
      { at: half, from: 'server', to: 'client', kind: 'SYN-ACK', fields: { sequence: 5000, acknowledging: 1001 }, says: 'The server agrees, says its own starting number, and confirms the client’s.' },
      { at: roundTripMs, from: 'client', to: 'server', kind: 'ACK', fields: { acknowledging: 5001 }, says: 'The client confirms the server’s number. The connection is open, and data can go with this message.' },
      { at: roundTripMs, from: 'client', to: 'server', kind: 'data', fields: { bytes: 1460 }, says: 'The first data, one round trip after the client decided to send it.' },
      { at: roundTripMs * 2, from: 'client', to: 'server', kind: 'FIN', fields: {}, says: 'The client has nothing more to send.' },
      { at: roundTripMs * 2 + half, from: 'server', to: 'client', kind: 'ACK', fields: {}, says: 'Acknowledged — but the server may still have data to send, so the connection is only half closed.' },
      { at: roundTripMs * 3, from: 'server', to: 'client', kind: 'FIN', fields: {}, says: 'Now the server has nothing more either.' },
      { at: roundTripMs * 3 + half, from: 'client', to: 'server', kind: 'ACK', fields: {}, says: 'Acknowledged. Closed.' }
    ]),
    beforeDataMs: roundTripMs,
    says: `One full round trip — ${roundTripMs}ms — before a single byte of data can be sent.`,
    notes: Object.freeze([
      'Three messages to open, four to close. Closing takes four because each side has to say separately that it has finished, so one can keep sending after the other has stopped.',
      `The round trip before any data is why a slow link feels slow even when it is wide: fetching twenty small files means twenty of those, which is ${(roundTripMs * 20 / 1000).toFixed(1)} seconds of waiting before counting the data itself.`,
      'The starting numbers are chosen rather than beginning at zero, which makes it much harder for anybody else to inject data into the connection.'
    ])
  }
}

// ---------------------------------------------------------------- topologies worth having ready

export type Shape = 'two-hosts' | 'small-office' | 'two-networks' | 'ring' | 'star' | 'redundant' | 'datacentre'

export const SHAPES: readonly Shape[] = Object.freeze(['two-hosts', 'small-office', 'two-networks', 'star', 'ring', 'redundant', 'datacentre'])

export const SHAPE_ABOUT: Readonly<Record<Shape, string>> = Object.freeze({
  'two-hosts': 'Two machines and a cable. The smallest network there is.',
  'small-office': 'Four machines on a switch, with a router to the outside.',
  'two-networks': 'Two separate networks joined by a router. Shows what a router is actually for.',
  star: 'Everything through one switch. Simple, and the switch is a single point of failure.',
  ring: 'Each device joined to the next, round in a circle. Survives one cable break.',
  redundant: 'Two routes between the ends. Unplug one and watch the route change.',
  datacentre: 'Two layers of switches with every lower one joined to every upper one, which is how a real data centre is wired.'
})

export function shape(which: Shape): Topology | NetworkError {
  const host = (id: string, n: number, prefix = 24): Device => ({ id, kind: 'host', address: `192.168.1.${n}`, prefix })
  const fast = (from: string, to: string): Link => ({ from, to, delayMs: 1, bandwidthMbps: 1000 })

  switch (which) {
    case 'two-hosts':
      return { name: 'Two machines', devices: [host('pc1', 10), host('pc2', 11)], links: [fast('pc1', 'pc2')] }
    case 'small-office':
      return {
        name: 'A small office',
        devices: [
          host('pc1', 10),
          host('pc2', 11),
          host('pc3', 12),
          { id: 'printer', kind: 'host', address: '192.168.1.50', prefix: 24 },
          { id: 'switch', kind: 'switch' },
          { id: 'router', kind: 'router', address: '192.168.1.1', prefix: 24 }
        ],
        links: [fast('pc1', 'switch'), fast('pc2', 'switch'), fast('pc3', 'switch'), fast('printer', 'switch'), { from: 'switch', to: 'router', delayMs: 1, bandwidthMbps: 1000 }]
      }
    case 'two-networks':
      return {
        name: 'Two networks and a router',
        devices: [
          { id: 'pcA', kind: 'host', address: '192.168.1.10', prefix: 24 },
          { id: 'pcB', kind: 'host', address: '10.0.0.10', prefix: 24 },
          { id: 'switchA', kind: 'switch' },
          { id: 'switchB', kind: 'switch' },
          { id: 'router', kind: 'router', address: '192.168.1.1', prefix: 24 }
        ],
        links: [fast('pcA', 'switchA'), fast('switchA', 'router'), fast('router', 'switchB'), fast('switchB', 'pcB')]
      }
    case 'star':
      return {
        name: 'A star',
        devices: [host('pc1', 10), host('pc2', 11), host('pc3', 12), host('pc4', 13), { id: 'switch', kind: 'switch' }],
        links: [fast('pc1', 'switch'), fast('pc2', 'switch'), fast('pc3', 'switch'), fast('pc4', 'switch')]
      }
    case 'ring':
      return {
        name: 'A ring',
        devices: [host('pc1', 10), host('pc2', 11), host('pc3', 12), host('pc4', 13)],
        links: [fast('pc1', 'pc2'), fast('pc2', 'pc3'), fast('pc3', 'pc4'), fast('pc4', 'pc1')]
      }
    case 'redundant':
      return {
        name: 'Two routes',
        devices: [
          host('pc', 10),
          { id: 'server', kind: 'server', address: '10.0.0.5', prefix: 24 },
          { id: 'fast-router', kind: 'router', address: '192.168.1.1', prefix: 24 },
          { id: 'slow-router', kind: 'router', address: '192.168.1.2', prefix: 24 }
        ],
        links: [
          { from: 'pc', to: 'fast-router', delayMs: 2, bandwidthMbps: 1000 },
          { from: 'fast-router', to: 'server', delayMs: 3, bandwidthMbps: 1000 },
          { from: 'pc', to: 'slow-router', delayMs: 2, bandwidthMbps: 100 },
          { from: 'slow-router', to: 'server', delayMs: 40, bandwidthMbps: 100 }
        ]
      }
    case 'datacentre': {
      const devices: Device[] = []
      const links: Link[] = []
      for (let i = 0; i < 2; i += 1) devices.push({ id: `spine${i}`, kind: 'switch' })
      for (let i = 0; i < 3; i += 1) {
        devices.push({ id: `leaf${i}`, kind: 'switch' })
        for (let s = 0; s < 2; s += 1) links.push({ from: `leaf${i}`, to: `spine${s}`, delayMs: 1, bandwidthMbps: 40_000 })
        for (let h = 0; h < 2; h += 1) {
          const id = `server${i}-${h}`
          devices.push({ id, kind: 'server', address: `10.0.${i}.${h + 10}`, prefix: 24 })
          links.push({ from: id, to: `leaf${i}`, delayMs: 1, bandwidthMbps: 10_000 })
        }
      }
      return { name: 'A data centre', devices, links }
    }
    default:
      return refuse('unknown shape', `There is no topology called "${String(which)}".`, `Try one of: ${SHAPES.join(', ')}.`)
  }
}

export const NETWORK_ASSUMPTIONS: readonly string[] = Object.freeze([
  'IPv4 only. IPv6 addressing is a different arithmetic and is not modelled.',
  'A switch forwards everything to everything. There is no hardware-address table, no spanning tree and no virtual networks.',
  'Delay is the sum of the link delays. Real latency also includes time spent in queues, which grows sharply as a link approaches full, and that is not modelled.',
  'Bandwidth limits what a route can carry and does not slow an individual packet down. There is no queueing model.',
  'The congestion control is the textbook scheme — closest to TCP Tahoe. A modern stack recovers from a loss far better than this does.',
  'The protocol exchanges are the message sequences and the fields that matter, not the bytes on the wire. There is no real packet encoding anywhere here.',
  'Nothing here touches a real network. Every address, route and packet is made up inside the model.'
])
