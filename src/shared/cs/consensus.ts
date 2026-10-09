/**
 * Leader election and a replicated log, the way Raft does it.
 *
 * ## Why a whole cluster rather than an animation
 *
 * The interesting facts about consensus are all about what happens when something goes wrong: a leader dies and a
 * new one appears without losing a committed entry; a network splits and the smaller half cannot elect anybody; two
 * candidates stand at once and neither wins. None of that can be shown by a picture of nodes passing arrows — it
 * has to be a cluster that really runs, where you kill a node and watch what the rest do.
 *
 * So this is a real implementation of the parts that matter: terms, votes, a majority rule, a log, and commitment
 * by majority. Every step is recorded, so the whole thing can be stepped through afterwards.
 *
 * ## Why a majority, written as a number
 *
 * Every report says how many nodes are up and how many a majority needs. "Five nodes, three needed, two reachable
 * — no leader can be elected" is the split-brain problem stated as arithmetic rather than as a warning, and it is
 * what makes the rule obvious instead of arbitrary.
 *
 * ## Time here is counted, not measured
 *
 * There is no clock. A tick is a step, timeouts are a number of ticks, and which node times out first is decided by
 * a seeded generator — so a run can be repeated exactly and the seed is part of the result.
 *
 * Pure.
 */

export interface ConsensusError {
  error: 'input' | 'too-big' | 'no-such-node'
  message: string
  fix: string
}

export const isConsensusError = (value: unknown): value is ConsensusError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>) && 'fix' in (value as Record<string, unknown>)

const fail = (error: ConsensusError['error'], message: string, fix: string): ConsensusError => ({ error, message, fix })

export const LIMITS = Object.freeze({ nodes: 9, ticks: 2_000, entries: 200 })

export type Role = 'follower' | 'candidate' | 'leader' | 'down'

export interface Entry {
  term: number
  value: string
}

export interface Node {
  id: string
  role: Role
  term: number
  /** Who this node voted for in its current term, or null. */
  votedFor: string | null
  log: Entry[]
  /** How far along the log is known to be safely stored on a majority. */
  committed: number
  /** Ticks until this node gives up waiting and stands for election. */
  timeout: number
}

export interface Event {
  tick: number
  kind: 'timeout' | 'vote-request' | 'vote' | 'elected' | 'append' | 'commit' | 'crash' | 'recover' | 'step-down' | 'no-majority' | 'partition'
  from: string
  to: string | null
  says: string
  term: number
}

export interface Cluster {
  nodes: Node[]
  tick: number
  events: Event[]
  /** Which side of a split each node is on. Same letter means they can talk. */
  partition: Readonly<Record<string, string>>
  seed: number
  random: number
}

/** The same seeded generator the rest of Orbis uses: a run can be repeated exactly. */
function next(state: number): { value: number; state: number } {
  // mulberry32
  let t = (state + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: (state + 0x6d2b79f5) | 0 }
}

export function makeCluster(count: number, seed = 1): Cluster | ConsensusError {
  if (!Number.isInteger(count) || count < 1) return fail('input', 'A cluster needs at least one node.', 'Try three — the smallest size that survives a failure.')
  if (count > LIMITS.nodes) return fail('too-big', `${count} nodes is more than this shows.`, `Use at most ${LIMITS.nodes}.`)

  let random = seed | 0
  const nodes: Node[] = []
  for (let one = 0; one < count; one += 1) {
    const made = next(random)
    random = made.state
    nodes.push({
      id: String.fromCharCode(65 + one),
      role: 'follower',
      term: 0,
      votedFor: null,
      log: [],
      committed: 0,
      // Randomised timeouts are what stop every node standing at once, so this is the real mechanism, not decoration.
      timeout: 5 + Math.floor(made.value * 8)
    })
  }
  return {
    nodes,
    tick: 0,
    events: [{ tick: 0, kind: 'recover', from: 'cluster', to: null, says: `${count} nodes started, all followers. A majority is ${majority(count)}.`, term: 0 }],
    partition: Object.freeze(Object.fromEntries(nodes.map((one) => [one.id, 'A']))),
    seed,
    random
  }
}

export const majority = (count: number): number => Math.floor(count / 2) + 1

/** Who this node can reach: everybody on its own side of the split that is not down. */
const reachable = (cluster: Cluster, from: string): Node[] =>
  cluster.nodes.filter((one) => one.id !== from && one.role !== 'down' && cluster.partition[one.id] === cluster.partition[from])

/**
 * One tick of the whole cluster.
 *
 * Followers count down. A follower that reaches zero becomes a candidate, raises its term and asks everybody it can
 * reach for a vote. A node votes yes only if the candidate's term is at least its own and it has not already voted
 * in that term — which is the rule that makes two leaders in one term impossible.
 */
export function step(cluster: Cluster): Cluster {
  const nodes = cluster.nodes.map((one) => ({ ...one, log: [...one.log] }))
  const events: Event[] = []
  const tick = cluster.tick + 1
  let random = cluster.random
  const count = nodes.length
  const need = majority(count)

  const leader = nodes.find((one) => one.role === 'leader')

  for (const node of nodes) {
    if (node.role === 'down') continue

    if (node.role === 'leader') {
      // A leader that cannot reach a majority stands down. This is what stops the smaller half of a split
      // carrying on as though nothing happened.
      const canReach = reachable({ ...cluster, nodes }, node.id).length + 1
      if (canReach < need) {
        node.role = 'follower'
        node.votedFor = null
        const made = next(random)
        random = made.state
        node.timeout = 5 + Math.floor(made.value * 8)
        events.push({
          tick,
          kind: 'step-down',
          from: node.id,
          to: null,
          says: `${node.id} can reach only ${canReach} of ${count} nodes, and a leader needs ${need}. It stands down.`,
          term: node.term
        })
        continue
      }
      // Heartbeats: every follower it can reach has its timeout reset, which is why no election happens while a
      // leader is alive.
      for (const other of reachable({ ...cluster, nodes }, node.id)) {
        const target = nodes.find((one) => one.id === other.id)
        if (!target) continue
        if (target.term <= node.term) {
          target.term = node.term
          target.role = target.role === 'candidate' ? 'follower' : target.role
          const made = next(random)
          random = made.state
          target.timeout = 5 + Math.floor(made.value * 8)
          // The leader's log is the truth: a follower takes it as given.
          target.log = [...node.log]
          target.committed = node.committed
        }
      }
      continue
    }

    node.timeout -= 1
    if (node.timeout > 0) continue

    // Stand for election.
    node.term += 1
    node.role = 'candidate'
    node.votedFor = node.id
    const made = next(random)
    random = made.state
    node.timeout = 5 + Math.floor(made.value * 8)
    events.push({ tick, kind: 'timeout', from: node.id, to: null, says: `${node.id} heard nothing and stands for election in term ${node.term}.`, term: node.term })

    let votes = 1
    for (const other of reachable({ ...cluster, nodes }, node.id)) {
      const target = nodes.find((one) => one.id === other.id)
      if (!target) continue
      events.push({ tick, kind: 'vote-request', from: node.id, to: target.id, says: `${node.id} asks ${target.id} for a vote in term ${node.term}.`, term: node.term })
      // The whole safety argument in one condition: a later term, and nobody voted for yet in it.
      const upToDate = node.log.length >= target.log.length
      if (target.term < node.term && upToDate) {
        target.term = node.term
        target.votedFor = node.id
        target.role = 'follower'
        votes += 1
        events.push({ tick, kind: 'vote', from: target.id, to: node.id, says: `${target.id} votes for ${node.id} — its own term was ${target.term - 0} and it had not voted.`, term: node.term })
      } else {
        events.push({
          tick,
          kind: 'vote',
          from: target.id,
          to: node.id,
          says: `${target.id} refuses — ${target.term >= node.term ? `its term is already ${target.term}` : 'the candidate’s log is behind'}.`,
          term: node.term
        })
      }
    }

    if (votes >= need) {
      node.role = 'leader'
      events.push({ tick, kind: 'elected', from: node.id, to: null, says: `${node.id} has ${votes} of ${count} votes, which is a majority, and becomes leader for term ${node.term}.`, term: node.term })
      for (const other of nodes) if (other.id !== node.id && other.role === 'leader') other.role = 'follower'
    } else {
      events.push({
        tick,
        kind: 'no-majority',
        from: node.id,
        to: null,
        says: `${node.id} got ${votes} of ${need} needed. No leader — it will time out and try again with a higher term.`,
        term: node.term
      })
    }
  }

  void leader
  return { ...cluster, nodes, tick, events: [...cluster.events, ...events].slice(-400), random }
}

/** Run until there is a leader or the tick budget runs out. */
export function settle(cluster: Cluster, within = 60): Cluster {
  let now = cluster
  for (let one = 0; one < Math.min(within, LIMITS.ticks); one += 1) {
    if (now.nodes.some((two) => two.role === 'leader')) break
    now = step(now)
  }
  return now
}

export function crash(cluster: Cluster, id: string): Cluster | ConsensusError {
  const node = cluster.nodes.find((one) => one.id === id)
  if (!node) return fail('no-such-node', `There is no node called "${id}".`, `The nodes are ${cluster.nodes.map((one) => one.id).join(', ')}.`)
  const was = node.role
  const nodes = cluster.nodes.map((one) => (one.id === id ? { ...one, role: 'down' as Role } : one))
  const up = nodes.filter((one) => one.role !== 'down').length
  return {
    ...cluster,
    nodes,
    events: [
      ...cluster.events,
      {
        tick: cluster.tick,
        kind: 'crash',
        from: id,
        to: null,
        says:
          was === 'leader'
            ? `${id} was the leader and has crashed. ${up} nodes are up and a majority is ${majority(cluster.nodes.length)} — ${up >= majority(cluster.nodes.length) ? 'an election can still happen' : 'no leader can be elected now'}.`
            : `${id} has crashed. ${up} of ${cluster.nodes.length} are up.`,
        term: node.term
      }
    ]
  }
}

export function recover(cluster: Cluster, id: string): Cluster | ConsensusError {
  const node = cluster.nodes.find((one) => one.id === id)
  if (!node) return fail('no-such-node', `There is no node called "${id}".`, `The nodes are ${cluster.nodes.map((one) => one.id).join(', ')}.`)
  const made = next(cluster.random)
  const nodes = cluster.nodes.map((one) =>
    one.id === id ? { ...one, role: 'follower' as Role, votedFor: null, timeout: 5 + Math.floor(made.value * 8) } : one
  )
  return {
    ...cluster,
    nodes,
    random: made.state,
    events: [
      ...cluster.events,
      { tick: cluster.tick, kind: 'recover', from: id, to: null, says: `${id} is back, as a follower. It will take the leader’s log when it next hears from one.`, term: node.term }
    ]
  }
}

/** Split the cluster into two sides. Nodes on different sides cannot hear each other at all. */
export function partition(cluster: Cluster, sideB: readonly string[]): Cluster | ConsensusError {
  for (const one of sideB) {
    if (!cluster.nodes.some((two) => two.id === one)) return fail('no-such-node', `There is no node called "${one}".`, `The nodes are ${cluster.nodes.map((two) => two.id).join(', ')}.`)
  }
  const map = Object.fromEntries(cluster.nodes.map((one) => [one.id, sideB.includes(one.id) ? 'B' : 'A']))
  const sizeA = cluster.nodes.length - sideB.length
  const need = majority(cluster.nodes.length)
  return {
    ...cluster,
    partition: Object.freeze(map),
    events: [
      ...cluster.events,
      {
        tick: cluster.tick,
        kind: 'partition',
        from: 'cluster',
        to: null,
        says: `Split into ${sizeA} and ${sideB.length}. A majority is ${need}, so ${sizeA >= need ? 'the larger side can elect a leader and the smaller cannot' : sideB.length >= need ? 'the smaller side here is actually the majority' : 'neither side has a majority and nothing can be decided'}.`,
        term: 0
      }
    ]
  }
}

export function heal(cluster: Cluster): Cluster {
  return {
    ...cluster,
    partition: Object.freeze(Object.fromEntries(cluster.nodes.map((one) => [one.id, 'A']))),
    events: [...cluster.events, { tick: cluster.tick, kind: 'recover', from: 'cluster', to: null, says: 'The split has healed. Any node on a stale term will step down when it hears a higher one.', term: 0 }]
  }
}

/** Give the leader something to replicate. Committed only once a majority holds it. */
export function propose(cluster: Cluster, value: string): Cluster | ConsensusError {
  const leader = cluster.nodes.find((one) => one.role === 'leader')
  if (!leader) return fail('input', 'There is no leader, so nothing can be agreed.', 'Step the cluster until one is elected.')
  if (leader.log.length >= LIMITS.entries) return fail('too-big', `The log already has ${LIMITS.entries} entries.`, 'That is as far as this traces.')

  const entry: Entry = { term: leader.term, value }
  const canReach = reachable(cluster, leader.id).length + 1
  const need = majority(cluster.nodes.length)
  const nodes = cluster.nodes.map((one) => {
    if (one.id === leader.id) return { ...one, log: [...one.log, entry] }
    if (one.role === 'down' || cluster.partition[one.id] !== cluster.partition[leader.id]) return one
    return { ...one, log: [...one.log, entry] }
  })
  const holding = nodes.filter((one) => one.log.length === leader.log.length + 1 && one.role !== 'down').length
  const committed = holding >= need

  return {
    ...cluster,
    nodes: nodes.map((one) => (committed && one.role !== 'down' && cluster.partition[one.id] === cluster.partition[leader.id] ? { ...one, committed: one.log.length } : one)),
    events: [
      ...cluster.events,
      { tick: cluster.tick, kind: 'append', from: leader.id, to: null, says: `${leader.id} appends "${value}" and sends it to ${canReach - 1} follower${canReach === 2 ? '' : 's'}.`, term: leader.term },
      {
        tick: cluster.tick,
        kind: 'commit',
        from: leader.id,
        to: null,
        says: committed
          ? `${holding} of ${cluster.nodes.length} nodes hold it, which is a majority, so "${value}" is committed and can never be undone.`
          : `Only ${holding} of ${need} hold it, so "${value}" is written but not committed. It may yet be lost.`,
        term: leader.term
      }
    ]
  }
}

export interface Report {
  leader: string | null
  term: number
  up: number
  need: number
  /** Whether the cluster can still decide anything. */
  canDecide: boolean
  committedLog: readonly Entry[]
  says: string
  notes: readonly string[]
}

export function describe(cluster: Cluster): Report {
  const leader = cluster.nodes.find((one) => one.role === 'leader') ?? null
  const up = cluster.nodes.filter((one) => one.role !== 'down').length
  const need = majority(cluster.nodes.length)
  const sides = new Map<string, number>()
  for (const one of cluster.nodes) {
    if (one.role === 'down') continue
    sides.set(cluster.partition[one.id], (sides.get(cluster.partition[one.id]) ?? 0) + 1)
  }
  const biggest = Math.max(0, ...sides.values())
  const canDecide = biggest >= need

  return {
    leader: leader?.id ?? null,
    term: Math.max(0, ...cluster.nodes.map((one) => one.term)),
    up,
    need,
    canDecide,
    committedLog: Object.freeze(leader ? leader.log.slice(0, leader.committed) : []),
    says: leader
      ? `${leader.id} leads in term ${leader.term}. ${up} of ${cluster.nodes.length} nodes up; a majority is ${need}.`
      : canDecide
        ? `No leader yet. ${up} of ${cluster.nodes.length} up, which is enough to elect one — step forward.`
        : `No leader, and none is possible: the largest group that can talk to itself is ${biggest} and a majority is ${need}.`,
    notes: Object.freeze([
      `A majority of ${cluster.nodes.length} is ${need}, so the cluster survives ${cluster.nodes.length - need} failure${cluster.nodes.length - need === 1 ? '' : 's'}.`,
      'Two leaders in one term is impossible because a node votes at most once per term and a majority of any two groups must overlap.',
      ...(sides.size > 1 ? ['The cluster is split. The smaller side cannot elect anybody and its old leader will stand down, which is what prevents two leaders from both accepting writes.'] : []),
      'There is no clock here. A tick is a step and timeouts are counted in ticks, from a seeded generator — so the same seed gives the same run.'
    ])
  }
}
