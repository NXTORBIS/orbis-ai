/**
 * An operating system's hard parts: scheduling, memory, synchronisation and deadlock.
 *
 * ## Every schedule is produced by scheduling
 *
 * A Gantt chart here is the output of running the policy over the processes, tick by tick. So round robin with a
 * quantum of 4 produces a different chart from a quantum of 2 because the scheduler behaved differently, and the
 * waiting times are measured off the chart rather than computed from a formula. That matters because the formulas
 * only hold for the simple cases and the interesting cases are the others.
 *
 * ## Starvation is shown rather than avoided
 *
 * Shortest-job-first starves a long process when short ones keep arriving. Strict priority starves a low-priority
 * process entirely. Both are real properties of those policies and both are reported — a scheduler that quietly
 * added ageing to avoid it would be teaching a different algorithm from the one named.
 *
 * ## Deadlock is detected, not assumed
 *
 * The resource-allocation graph is searched for a cycle, and the Banker's algorithm is run properly against the
 * actual need matrix. A state is called safe only when a complete safe sequence was found, and the sequence is
 * returned so it can be checked.
 *
 * Pure. No Electron, no DOM.
 */

export interface SchedulingError {
  error: string
  says: string
  fix: string
}

export const isSchedulingError = (value: unknown): value is SchedulingError =>
  typeof value === 'object' && value !== null && 'error' in value && 'says' in value && 'fix' in value

const refuse = (error: string, says: string, fix: string): SchedulingError => ({ error, says, fix })

export const OS_LIMITS = Object.freeze({
  processes: 64,
  ticks: 20_000,
  frames: 512,
  pages: 4_096,
  resources: 16
})

// ---------------------------------------------------------------- processes

export interface Process {
  id: string
  /** When it turns up. */
  arrives: number
  /** How much processor time it needs in total. */
  needs: number
  /** Lower is more urgent, which is the usual convention. */
  priority?: number
}

export type Policy =
  | 'first-come'
  | 'shortest-job'
  | 'shortest-remaining'
  | 'round-robin'
  | 'priority'
  | 'priority-preemptive'
  | 'multilevel'

export const POLICIES: readonly Policy[] = Object.freeze([
  'first-come',
  'shortest-job',
  'shortest-remaining',
  'round-robin',
  'priority',
  'priority-preemptive',
  'multilevel'
])

interface PolicyFacts {
  label: string
  about: string
  preemptive: boolean
  /** What goes wrong with it. Every policy has something. */
  costs: string
  usesQuantum: boolean
  usesPriority: boolean
}

export const POLICY_FACTS: Readonly<Record<Policy, PolicyFacts>> = Object.freeze({
  'first-come': {
    label: 'First come, first served',
    about: 'Whoever arrived first runs to completion. The simplest possible rule.',
    preemptive: false,
    costs: 'One long process at the front makes everything behind it wait, however short those are. That is the convoy effect, and it is why nothing real uses this alone.',
    usesQuantum: false,
    usesPriority: false
  },
  'shortest-job': {
    label: 'Shortest job first',
    about: 'Of everything waiting, the one needing least time runs next, to completion.',
    preemptive: false,
    costs: 'It gives the best possible average waiting time and it needs to know how long each job will take, which in reality nobody does. A long job starves while short ones keep arriving.',
    usesQuantum: false,
    usesPriority: false
  },
  'shortest-remaining': {
    label: 'Shortest remaining time',
    about: 'Shortest job first, but a newly arrived shorter job takes the processor immediately.',
    preemptive: true,
    costs: 'Optimal for average waiting time, and it switches constantly — every switch costs real time this model does not charge for.',
    usesQuantum: false,
    usesPriority: false
  },
  'round-robin': {
    label: 'Round robin',
    about: 'Each process gets a fixed slice in turn. Nobody waits for ever.',
    preemptive: true,
    costs: 'A small quantum is fair and switches a lot; a large one behaves more and more like first-come. The quantum is the whole decision.',
    usesQuantum: true,
    usesPriority: false
  },
  priority: {
    label: 'Priority',
    about: 'The most urgent waiting process runs to completion.',
    preemptive: false,
    costs: 'A low-priority process can wait for ever if urgent work keeps arriving — that is starvation. Real systems raise a waiting process’s priority over time to stop it; this does not, so you can watch it happen.',
    usesQuantum: false,
    usesPriority: true
  },
  'priority-preemptive': {
    label: 'Priority, pre-emptive',
    about: 'A more urgent arrival takes the processor straight away.',
    preemptive: true,
    costs: 'Starvation, as above, and worse: a low-priority process holding something an urgent one needs blocks it, which is priority inversion.',
    usesQuantum: false,
    usesPriority: true
  },
  multilevel: {
    label: 'Multilevel feedback queue',
    about:
      'Everything starts urgent with a short slice. A process that uses its whole slice drops a level and gets a longer one next time, so short interactive work stays responsive and long work still finishes.',
    preemptive: true,
    costs: 'It approximates shortest-remaining-time without needing to know how long anything will take, at the cost of being much harder to reason about. A process that drops to the bottom can still wait a long time.',
    usesQuantum: true,
    usesPriority: false
  }
})

export type State = 'new' | 'ready' | 'running' | 'finished'

export interface Slice {
  /** Which process held the processor. Null means nothing was ready to run. */
  process: string | null
  from: number
  to: number
  /** The queue level, for the multilevel policy. */
  level?: number
}

export interface ProcessOutcome {
  id: string
  arrives: number
  needs: number
  priority: number
  /** When it first got the processor. */
  firstRan: number | null
  finished: number | null
  /** Finished minus arrived: the whole time it was in the system. */
  turnaround: number | null
  /** Turnaround minus the work it did: how long it spent waiting. */
  waiting: number | null
  /** How long before it first got any processor at all. */
  response: number | null
  /** How many times it was taken off the processor before finishing. */
  preempted: number
}

export interface Schedule {
  policy: Policy
  slices: readonly Slice[]
  processes: readonly ProcessOutcome[]
  /** Averages over every process that finished. */
  averageWaiting: number
  averageTurnaround: number
  averageResponse: number
  /** Ticks where nothing was ready. */
  idleTicks: number
  /** Times the processor changed hands. Each one costs real time a real system has to pay. */
  contextSwitches: number
  finishedAt: number
  /** Processes that waited far longer than the average, which is what starvation looks like. */
  starved: readonly string[]
  quantum: number | null
  says: string
  notes: readonly string[]
}

/**
 * Runs a policy over a set of processes, one tick at a time.
 *
 * Tick by tick rather than by computing the next completion, because a pre-emptive policy has to be able to change
 * its mind at any tick and because the Gantt chart has to be exact. The cost is linear in the total work, which for
 * a teaching workload is nothing.
 */
export function schedule(
  processes: readonly Process[],
  policy: Policy,
  options: { quantum?: number; levels?: number } = {}
): Schedule | SchedulingError {
  if (processes.length === 0) return refuse('nothing to run', 'There are no processes.', 'Add at least one.')
  if (processes.length > OS_LIMITS.processes) {
    return refuse('too many', `${processes.length} processes is more than this will schedule.`, `Keep it under ${OS_LIMITS.processes}.`)
  }
  const facts = POLICY_FACTS[policy]
  if (facts === undefined) return refuse('unknown policy', `There is no policy called "${String(policy)}".`, `Try one of: ${POLICIES.join(', ')}.`)

  const seen = new Set<string>()
  for (const one of processes) {
    if (seen.has(one.id)) return refuse('duplicate', `Two processes are both called "${one.id}".`, 'Give them different names.')
    seen.add(one.id)
    if (!Number.isFinite(one.needs) || one.needs <= 0) {
      return refuse('bad burst', `"${one.id}" needs ${one.needs} of processor time, which is not a length.`, 'Every process needs more than zero.')
    }
    if (!Number.isFinite(one.arrives) || one.arrives < 0) {
      return refuse('bad arrival', `"${one.id}" arrives at ${one.arrives}.`, 'Arrival times start at zero.')
    }
  }

  const quantum = facts.usesQuantum ? Math.max(1, Math.floor(options.quantum ?? 4)) : null
  const levels = policy === 'multilevel' ? Math.max(2, Math.min(5, Math.floor(options.levels ?? 3))) : 1

  const total = processes.reduce((a, b) => a + b.needs, 0)
  const latest = Math.max(...processes.map((one) => one.arrives))
  const ceiling = Math.min(total + latest + 1, OS_LIMITS.ticks)

  interface Live {
    process: Process
    left: number
    firstRan: number | null
    finished: number | null
    preempted: number
    /** For round robin and multilevel: how much of the current slice is used. */
    used: number
    level: number
    /** Order it joined the ready queue, so first-come can be exact. */
    joined: number
  }

  const live: Live[] = processes.map((one) => ({
    process: one,
    left: one.needs,
    firstRan: null,
    finished: null,
    preempted: 0,
    used: 0,
    level: 0,
    joined: -1
  }))

  const slices: Slice[] = []
  let running: Live | null = null
  let idleTicks = 0
  let contextSwitches = 0
  let joinCounter = 0
  let tick = 0

  const push = (process: string | null, at: number, level?: number): void => {
    const last = slices[slices.length - 1]
    if (last !== undefined && last.process === process && last.to === at && last.level === level) {
      last.to = at + 1
      return
    }
    slices.push({ process, from: at, to: at + 1, ...(level === undefined ? {} : { level }) })
  }

  for (; tick < ceiling; tick += 1) {
    // Anything that has arrived and not yet joined a queue, joins now.
    for (const one of live) {
      if (one.joined < 0 && one.process.arrives <= tick && one.left > 0) {
        one.joined = joinCounter++
      }
    }

    const ready = live.filter((one) => one.left > 0 && one.joined >= 0)
    if (ready.length === 0) {
      if (live.every((one) => one.left === 0)) break
      idleTicks += 1
      push(null, tick)
      if (running !== null) running = null
      continue
    }

    /*
     * Choosing what runs. Each policy is its own rule, written out rather than parameterised, because the rules are
     * genuinely different and a single parameterised chooser would hide that.
     */
    const pick = (): Live => {
      switch (policy) {
        case 'first-come':
          // Once something is running it keeps the processor until it finishes.
          if (running !== null && running.left > 0) return running
          return [...ready].sort((a, b) => a.process.arrives - b.process.arrives || a.joined - b.joined)[0]
        case 'shortest-job':
          if (running !== null && running.left > 0) return running
          return [...ready].sort((a, b) => a.left - b.left || a.process.arrives - b.process.arrives || a.joined - b.joined)[0]
        case 'shortest-remaining':
          return [...ready].sort((a, b) => a.left - b.left || a.process.arrives - b.process.arrives || a.joined - b.joined)[0]
        case 'priority':
          if (running !== null && running.left > 0) return running
          return [...ready].sort(
            (a, b) => (a.process.priority ?? 0) - (b.process.priority ?? 0) || a.process.arrives - b.process.arrives || a.joined - b.joined
          )[0]
        case 'priority-preemptive':
          return [...ready].sort(
            (a, b) => (a.process.priority ?? 0) - (b.process.priority ?? 0) || a.process.arrives - b.process.arrives || a.joined - b.joined
          )[0]
        case 'round-robin': {
          if (running !== null && running.left > 0 && running.used < (quantum ?? 4)) return running
          // The slice is up: this one goes to the back and the next in line runs.
          if (running !== null && running.left > 0) {
            running.used = 0
            running.joined = joinCounter++
            running.preempted += 1
          }
          return [...ready].sort((a, b) => a.joined - b.joined)[0]
        }
        case 'multilevel': {
          const sliceFor = (level: number): number => (quantum ?? 2) * 2 ** level
          if (running !== null && running.left > 0 && running.used < sliceFor(running.level)) {
            // Unless something more urgent — a higher level — has turned up.
            const better = ready.find((one) => one.level < (running as Live).level)
            if (better === undefined) return running
          }
          if (running !== null && running.left > 0) {
            if (running.used >= sliceFor(running.level)) {
              // Used the whole slice, so it is probably long: drop it a level and give it a longer slice next time.
              running.level = Math.min(levels - 1, running.level + 1)
              running.preempted += 1
            }
            running.used = 0
            running.joined = joinCounter++
          }
          return [...ready].sort((a, b) => a.level - b.level || a.joined - b.joined)[0]
        }
      }
    }

    const chosen = pick()
    if (running !== null && running !== chosen && running.left > 0) {
      running.preempted += 1
      running.used = 0
    }
    if (running !== chosen) {
      if (running !== null || slices.length > 0) contextSwitches += 1
      running = chosen
    }

    if (chosen.firstRan === null) chosen.firstRan = tick
    chosen.left -= 1
    chosen.used += 1
    push(chosen.process.id, tick, policy === 'multilevel' ? chosen.level : undefined)

    if (chosen.left === 0) {
      chosen.finished = tick + 1
      running = null
    }
  }

  const outcomes: ProcessOutcome[] = live.map((one) => {
    const turnaround = one.finished === null ? null : one.finished - one.process.arrives
    return {
      id: one.process.id,
      arrives: one.process.arrives,
      needs: one.process.needs,
      priority: one.process.priority ?? 0,
      firstRan: one.firstRan,
      finished: one.finished,
      turnaround,
      waiting: turnaround === null ? null : turnaround - one.process.needs,
      response: one.firstRan === null ? null : one.firstRan - one.process.arrives,
      preempted: one.preempted
    }
  })

  const finishedOnes = outcomes.filter((one) => one.finished !== null)
  const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length)
  const averageWaiting = mean(finishedOnes.map((one) => one.waiting ?? 0))
  const averageTurnaround = mean(finishedOnes.map((one) => one.turnaround ?? 0))
  const averageResponse = mean(finishedOnes.map((one) => one.response ?? 0))

  /*
   * Starvation, measured rather than guessed at.
   *
   * A process that waited more than three times the average, or never ran at all, is starving. The threshold is a
   * judgement, so it is stated: what is not a judgement is that these policies can starve a process, and the point
   * is to show when it happened.
   */
  const starved = outcomes
    .filter((one) => one.finished === null || (averageWaiting > 0 && (one.waiting ?? 0) > averageWaiting * 3))
    .map((one) => one.id)

  const notes: string[] = [facts.costs]
  if (starved.length > 0) {
    notes.push(
      `${starved.join(', ')} waited far longer than the rest. ${
        facts.usesPriority
          ? 'That is starvation, and strict priority allows it: a low-priority process waits as long as urgent work keeps arriving. Real systems raise a waiting process’s priority over time to stop it.'
          : 'With this policy a long process can be held back while shorter ones keep arriving.'
      }`
    )
  }
  if (outcomes.some((one) => one.finished === null)) {
    notes.push('Some processes never finished within the time simulated.')
  }
  if (quantum !== null) {
    notes.push(
      `The quantum is ${quantum}. ${contextSwitches} context switches happened; a real switch costs a few microseconds of saving and restoring, which this does not charge for, so a very small quantum looks better here than it would be.`
    )
  }
  if (idleTicks > 0) notes.push(`The processor was idle for ${idleTicks} tick${idleTicks === 1 ? '' : 's'}, waiting for something to arrive.`)

  return {
    policy,
    slices: Object.freeze(slices),
    processes: Object.freeze(outcomes),
    averageWaiting,
    averageTurnaround,
    averageResponse,
    idleTicks,
    contextSwitches,
    finishedAt: Math.max(0, ...outcomes.map((one) => one.finished ?? 0)),
    starved: Object.freeze(starved),
    quantum,
    says: `${facts.label}: average wait ${averageWaiting.toFixed(2)}, average turnaround ${averageTurnaround.toFixed(2)}, everything done by ${Math.max(0, ...outcomes.map((one) => one.finished ?? 0))}.`,
    notes: Object.freeze(notes)
  }
}

/** Runs several policies over the same processes, so they can be compared on identical work. */
export interface Comparison {
  sides: readonly { policy: Policy; label: string; averageWaiting: number; averageTurnaround: number; averageResponse: number; contextSwitches: number; starved: readonly string[] }[]
  bestWaiting: Policy
  bestResponse: Policy
  says: string
}

export function comparePolicies(
  processes: readonly Process[],
  policies: readonly Policy[],
  options: { quantum?: number } = {}
): Comparison | SchedulingError {
  if (policies.length < 2) return refuse('too few', 'Comparing needs at least two policies.', 'Pick two or more.')
  const sides: Comparison['sides'][number][] = []
  for (const policy of policies) {
    const made = schedule(processes, policy, options)
    if (isSchedulingError(made)) return made
    sides.push({
      policy,
      label: POLICY_FACTS[policy].label,
      averageWaiting: made.averageWaiting,
      averageTurnaround: made.averageTurnaround,
      averageResponse: made.averageResponse,
      contextSwitches: made.contextSwitches,
      starved: made.starved
    })
  }
  const bestWaiting = [...sides].sort((a, b) => a.averageWaiting - b.averageWaiting)[0]
  const bestResponse = [...sides].sort((a, b) => a.averageResponse - b.averageResponse)[0]
  return {
    sides: Object.freeze(sides),
    bestWaiting: bestWaiting.policy,
    bestResponse: bestResponse.policy,
    says:
      bestWaiting.policy === bestResponse.policy
        ? `${bestWaiting.label} did best on both waiting and response here.`
        : `${bestWaiting.label} gave the shortest average wait; ${bestResponse.label} got round to everybody soonest. Those are different goals, which is why there is more than one policy.`
  }
}

// ---------------------------------------------------------------- memory

export type PageReplacement = 'fifo' | 'lru' | 'optimal' | 'clock' | 'lfu'

export const PAGE_REPLACEMENTS: readonly PageReplacement[] = Object.freeze(['fifo', 'lru', 'optimal', 'clock', 'lfu'])

export const PAGE_REPLACEMENT_ABOUT: Readonly<Record<PageReplacement, string>> = Object.freeze({
  fifo: 'Evicts whatever has been in memory longest. Simple, and it can get worse when you add memory — which is Belady’s anomaly, and this will show it.',
  lru: 'Evicts whatever was used least recently. Usually close to the best, and needs hardware to track use.',
  optimal: 'Evicts whatever will not be needed for longest. Impossible in reality, because it needs the future — but it is the floor every other policy is measured against.',
  clock: 'An approximation of least-recently-used using one bit per page. What real systems actually do.',
  lfu: 'Evicts whatever has been used least often. Fooled by a page that was popular once and is not any more.'
})

export interface PageStep {
  /** Which page was wanted. */
  wanted: number
  /** The frames after this reference. Null is an empty frame. */
  frames: readonly (number | null)[]
  fault: boolean
  /** Which page was thrown out, if any. */
  evicted: number | null
  says: string
}

export interface PagingReport {
  policy: PageReplacement
  frames: number
  steps: readonly PageStep[]
  faults: number
  hits: number
  faultRate: number
  says: string
  notes: readonly string[]
}

/**
 * Runs a page-replacement policy over a reference string.
 *
 * The optimal policy is included deliberately. It cannot be implemented in a real system — it needs to know what will
 * be referenced next — but it is the only honest baseline: saying a policy achieved 12 faults means nothing until you
 * know the best possible was 9.
 */
export function paging(
  references: readonly number[],
  frames: number,
  policy: PageReplacement
): PagingReport | SchedulingError {
  if (references.length === 0) return refuse('no references', 'There is nothing to page in.', 'Give a sequence of page numbers.')
  if (references.length > OS_LIMITS.pages) return refuse('too many', `${references.length} references is more than this will run.`, `Keep it under ${OS_LIMITS.pages}.`)
  if (frames < 1 || frames > OS_LIMITS.frames) return refuse('bad frame count', `${frames} frames is not a usable amount of memory.`, `Use between 1 and ${OS_LIMITS.frames}.`)
  if (!PAGE_REPLACEMENT_ABOUT[policy]) return refuse('unknown policy', `There is no policy called "${String(policy)}".`, `Try one of: ${PAGE_REPLACEMENTS.join(', ')}.`)

  const held: (number | null)[] = new Array(frames).fill(null)
  const arrived = new Map<number, number>()
  const usedAt = new Map<number, number>()
  const usedCount = new Map<number, number>()
  const referenced = new Map<number, boolean>()
  let clockHand = 0

  const steps: PageStep[] = []
  let faults = 0

  for (let at = 0; at < references.length; at += 1) {
    const wanted = references[at]
    const where = held.indexOf(wanted)

    if (where >= 0) {
      usedAt.set(wanted, at)
      usedCount.set(wanted, (usedCount.get(wanted) ?? 0) + 1)
      referenced.set(wanted, true)
      steps.push({ wanted, frames: Object.freeze([...held]), fault: false, evicted: null, says: `Page ${wanted} was already there.` })
      continue
    }

    faults += 1
    const free = held.indexOf(null)
    let slot: number
    let evicted: number | null = null

    if (free >= 0) {
      slot = free
    } else {
      switch (policy) {
        case 'fifo': {
          slot = 0
          let oldest = Infinity
          for (let i = 0; i < held.length; i += 1) {
            const when = arrived.get(held[i] as number) ?? 0
            if (when < oldest) {
              oldest = when
              slot = i
            }
          }
          break
        }
        case 'lru': {
          slot = 0
          let oldest = Infinity
          for (let i = 0; i < held.length; i += 1) {
            const when = usedAt.get(held[i] as number) ?? -1
            if (when < oldest) {
              oldest = when
              slot = i
            }
          }
          break
        }
        case 'lfu': {
          slot = 0
          let fewest = Infinity
          for (let i = 0; i < held.length; i += 1) {
            const count = usedCount.get(held[i] as number) ?? 0
            if (count < fewest) {
              fewest = count
              slot = i
            }
          }
          break
        }
        case 'optimal': {
          /*
           * The page not needed for longest. This reads the rest of the reference string, which is exactly why no real
           * system can do it — and exactly why it is the right baseline.
           */
          slot = 0
          let furthest = -1
          for (let i = 0; i < held.length; i += 1) {
            const next = references.indexOf(held[i] as number, at + 1)
            if (next === -1) {
              slot = i
              furthest = Infinity
              break
            }
            if (next > furthest) {
              furthest = next
              slot = i
            }
          }
          break
        }
        case 'clock': {
          // Walk round giving each page one second chance, which is what the reference bit buys.
          for (let guard = 0; guard < held.length * 2 + 1; guard += 1) {
            const page = held[clockHand] as number
            if (referenced.get(page) === true) {
              referenced.set(page, false)
              clockHand = (clockHand + 1) % held.length
              continue
            }
            break
          }
          slot = clockHand
          clockHand = (clockHand + 1) % held.length
          break
        }
      }
      evicted = held[slot] as number
      arrived.delete(evicted)
      usedAt.delete(evicted)
      usedCount.delete(evicted)
      referenced.delete(evicted)
    }

    held[slot] = wanted
    arrived.set(wanted, at)
    usedAt.set(wanted, at)
    usedCount.set(wanted, 1)
    referenced.set(wanted, true)

    steps.push({
      wanted,
      frames: Object.freeze([...held]),
      fault: true,
      evicted,
      says:
        evicted === null
          ? `Page ${wanted} was not there, and there was a free frame.`
          : `Page ${wanted} was not there, so page ${evicted} was thrown out to make room.`
    })
  }

  const hits = references.length - faults
  const notes: string[] = [PAGE_REPLACEMENT_ABOUT[policy]]
  if (policy !== 'optimal') {
    const best = paging(references, frames, 'optimal')
    if (!isSchedulingError(best)) {
      notes.push(
        faults === best.faults
          ? `That is as few faults as any policy could manage on this sequence — the same as the optimal policy, which is allowed to know the future.`
          : `The optimal policy, which may look ahead, would have had ${best.faults} faults. That gap of ${faults - best.faults} is what this policy costs for not knowing the future.`
      )
    }
  }
  if (frames >= new Set(references).size) {
    notes.push(`There are ${frames} frames for ${new Set(references).size} distinct pages, so every fault here is unavoidable — each page simply had to be loaded once.`)
  }

  return {
    policy,
    frames,
    steps: Object.freeze(steps),
    faults,
    hits,
    faultRate: faults / references.length,
    says: `${faults} page faults out of ${references.length} references — ${((faults / references.length) * 100).toFixed(1)}%.`,
    notes: Object.freeze(notes)
  }
}

/**
 * Looks for Belady's anomaly: more memory making a policy worse.
 *
 * It is a genuinely surprising property of FIFO and it can be demonstrated, so this looks for it on a given reference
 * string rather than asserting it happens. Where it does not happen on that string, it says so.
 */
export interface BeladyReport {
  policy: PageReplacement
  byFrames: readonly { frames: number; faults: number }[]
  anomalyAt: readonly { frames: number; from: number; to: number }[]
  says: string
}

export function beladyCheck(references: readonly number[], policy: PageReplacement, upTo = 8): BeladyReport | SchedulingError {
  const byFrames: { frames: number; faults: number }[] = []
  for (let frames = 1; frames <= Math.min(upTo, OS_LIMITS.frames); frames += 1) {
    const made = paging(references, frames, policy)
    if (isSchedulingError(made)) return made
    byFrames.push({ frames, faults: made.faults })
  }
  const anomalyAt: { frames: number; from: number; to: number }[] = []
  for (let i = 1; i < byFrames.length; i += 1) {
    if (byFrames[i].faults > byFrames[i - 1].faults) {
      anomalyAt.push({ frames: byFrames[i].frames, from: byFrames[i - 1].faults, to: byFrames[i].faults })
    }
  }
  return {
    policy,
    byFrames: Object.freeze(byFrames),
    anomalyAt: Object.freeze(anomalyAt),
    says:
      anomalyAt.length === 0
        ? `On this sequence more memory never made things worse. ${policy === 'fifo' ? 'FIFO can behave that way, but it does not on every sequence — try the reference string 1 2 3 4 1 2 5 1 2 3 4 5.' : 'This policy cannot behave that way: it is a stack algorithm, so more memory can never cost more faults.'}`
        : `Adding memory made it worse: at ${anomalyAt[0].frames} frames the faults went up from ${anomalyAt[0].from} to ${anomalyAt[0].to}. That is Belady's anomaly, and it is why FIFO is not used on its own.`
  }
}

// ---------------------------------------------------------------- deadlock

export interface ResourceRequest {
  process: string
  resource: string
  /** Holding it, or waiting for it. */
  holding: boolean
}

export interface DeadlockReport {
  deadlocked: boolean
  /** The cycle found, as alternating process and resource names. */
  cycle: readonly string[]
  /** Processes caught in it. */
  involved: readonly string[]
  says: string
  notes: readonly string[]
}

/**
 * Looks for a cycle in the resource-allocation graph.
 *
 * With one instance of each resource a cycle *is* a deadlock. With several instances a cycle only means a deadlock
 * might exist, and this says so rather than claiming otherwise — which is precisely why the Banker's algorithm below
 * exists for the multiple-instance case.
 */
export function findDeadlock(edges: readonly ResourceRequest[], instances: Readonly<Record<string, number>> = {}): DeadlockReport {
  // A process points at a resource it waits for; a resource points at the process holding it.
  const out = new Map<string, string[]>()
  const processes = new Set<string>()
  const resources = new Set<string>()
  for (const edge of edges) {
    processes.add(edge.process)
    resources.add(edge.resource)
    const from = edge.holding ? `R:${edge.resource}` : `P:${edge.process}`
    const to = edge.holding ? `P:${edge.process}` : `R:${edge.resource}`
    const held = out.get(from)
    if (held === undefined) out.set(from, [to])
    else held.push(to)
  }

  const colour = new Map<string, 0 | 1 | 2>()
  const path: string[] = []
  let cycle: string[] = []

  const walk = (node: string): boolean => {
    const state = colour.get(node) ?? 0
    if (state === 1) {
      const at = path.indexOf(node)
      cycle = [...path.slice(at), node]
      return true
    }
    if (state === 2) return false
    colour.set(node, 1)
    path.push(node)
    for (const next of out.get(node) ?? []) if (walk(next)) return true
    path.pop()
    colour.set(node, 2)
    return false
  }

  for (const node of out.keys()) {
    if (cycle.length > 0) break
    walk(node)
  }

  const involved = cycle.filter((one) => one.startsWith('P:')).map((one) => one.slice(2))
  const several = [...resources].filter((one) => (instances[one] ?? 1) > 1)

  const notes: string[] = []
  if (cycle.length > 0 && several.length > 0) {
    notes.push(
      `${several.join(', ')} ${several.length === 1 ? 'has' : 'have'} more than one instance, so a cycle only means a deadlock is possible, not certain. Use the Banker's check to be sure.`
    )
  }
  if (cycle.length === 0) {
    notes.push('No cycle in the graph means no deadlock right now. It does not mean the system cannot reach one later — that is what the safety check is for.')
  }
  if (cycle.length > 0) {
    notes.push(
      'The four things that all have to be true for a deadlock are: a resource only one process can hold, a process holding one while waiting for another, no way to take a resource back, and a circular wait. Breaking any one of them prevents it.'
    )
  }

  return {
    deadlocked: cycle.length > 0 && several.length === 0,
    cycle: Object.freeze(cycle.map((one) => one.slice(2))),
    involved: Object.freeze([...new Set(involved)]),
    says:
      cycle.length === 0
        ? 'No circular wait: nothing is deadlocked.'
        : several.length > 0
          ? `There is a circular wait through ${[...new Set(involved)].join(' → ')}, but some resources have several instances so this may not be a deadlock.`
          : `Deadlocked. ${[...new Set(involved)].join(' is waiting on ')} is waiting on ${involved[0] ?? '?'}, and none of them can move.`,
    notes: Object.freeze(notes)
  }
}

export interface BankerState {
  processes: readonly string[]
  resources: readonly string[]
  /** How many of each resource exists. */
  total: readonly number[]
  /** What each process already holds. */
  allocated: readonly (readonly number[])[]
  /** The most each process will ever ask for. */
  maximum: readonly (readonly number[])[]
}

export interface BankerReport {
  safe: boolean
  /** An order in which every process could finish, when there is one. */
  sequence: readonly string[]
  /** What is left unallocated. */
  available: readonly number[]
  /** What each process may still ask for. */
  need: readonly (readonly number[])[]
  /** Where it got stuck, when it is not safe. */
  stuckWith: readonly string[]
  says: string
  notes: readonly string[]
}

/**
 * The Banker's algorithm, run properly.
 *
 * A state is safe only when a complete sequence was found in which every process can finish. The sequence is
 * returned so it can be checked rather than taken on trust — and an unsafe state names which processes could not be
 * satisfied, which is the part that tells you what to do about it.
 */
export function bankersCheck(state: BankerState): BankerReport | SchedulingError {
  const n = state.processes.length
  const m = state.resources.length
  if (n === 0 || m === 0) return refuse('empty', 'There are no processes or no resources.', 'Describe at least one of each.')
  if (m > OS_LIMITS.resources) return refuse('too many resources', `${m} resource kinds is more than this will check.`, `Keep it under ${OS_LIMITS.resources}.`)
  if (state.allocated.length !== n || state.maximum.length !== n) {
    return refuse('wrong shape', 'There must be one row of allocation and one of maximum for every process.', 'Check the table has as many rows as there are processes.')
  }
  for (let i = 0; i < n; i += 1) {
    if (state.allocated[i].length !== m || state.maximum[i].length !== m) {
      return refuse('wrong shape', `Process "${state.processes[i]}" has the wrong number of columns.`, `There should be ${m}, one per resource.`)
    }
    for (let j = 0; j < m; j += 1) {
      if (state.allocated[i][j] > state.maximum[i][j]) {
        return refuse(
          'impossible',
          `"${state.processes[i]}" already holds ${state.allocated[i][j]} of ${state.resources[j]} but says it will never need more than ${state.maximum[i][j]}.`,
          'A process cannot hold more than its stated maximum.'
        )
      }
    }
  }

  const available = state.total.map((total, j) => total - state.allocated.reduce((a, row) => a + row[j], 0))
  for (let j = 0; j < m; j += 1) {
    if (available[j] < 0) {
      return refuse(
        'over-allocated',
        `More of ${state.resources[j]} is held than exists.`,
        'Check the allocation column adds up to no more than the total.'
      )
    }
  }

  const need = state.maximum.map((row, i) => row.map((most, j) => most - state.allocated[i][j]))
  const finished = new Array<boolean>(n).fill(false)
  const free = [...available]
  const sequence: string[] = []

  for (let round = 0; round < n; round += 1) {
    const next = need.findIndex((row, i) => !finished[i] && row.every((want, j) => want <= free[j]))
    if (next < 0) break
    for (let j = 0; j < m; j += 1) free[j] += state.allocated[next][j]
    finished[next] = true
    sequence.push(state.processes[next])
  }

  const safe = sequence.length === n
  const stuckWith = state.processes.filter((_, i) => !finished[i])

  const notes: string[] = []
  if (safe) {
    notes.push(
      `Safe does not mean nothing can go wrong — it means there is at least one order in which everybody can finish, so the system can always avoid deadlock by granting requests in that order.`
    )
  } else {
    notes.push(
      `${stuckWith.join(', ')} could not be satisfied from what is left even after everything else finished. That does not mean a deadlock has happened; it means one is possible from here, so a careful system would refuse the request that led to this state.`
    )
  }
  notes.push('The algorithm needs every process to declare its maximum need in advance, which is the reason real systems almost never use it.')

  return {
    safe,
    sequence: Object.freeze(sequence),
    available: Object.freeze(available),
    need: Object.freeze(need.map((one) => Object.freeze(one))),
    stuckWith: Object.freeze(stuckWith),
    says: safe
      ? `Safe. Everybody can finish, in the order ${sequence.join(' → ')}.`
      : `Not safe. ${sequence.length === 0 ? 'Nothing' : sequence.join(' → ')} could finish, and then ${stuckWith.join(', ')} ${stuckWith.length === 1 ? 'is' : 'are'} stuck.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- synchronisation

export interface Critical {
  /** Each process's attempt, as a list of what it does each step. */
  attempts: readonly { process: string; steps: readonly ('want' | 'enter' | 'work' | 'leave')[] }[]
}

export interface RaceReport {
  /** Whether two processes were ever inside at once. */
  raced: boolean
  /** The interleaving that caused it, as text. */
  interleaving: readonly string[]
  /** The final value of the shared counter, and what it should have been. */
  counter: number
  shouldBe: number
  says: string
  notes: readonly string[]
}

/**
 * Shows what happens when two processes increment a shared counter without a lock, and with one.
 *
 * ## Why this is simulated rather than described
 *
 * "Read, add, write is not atomic" is a sentence. Watching the interleaving that loses an increment is the thing that
 * makes it land. So this runs the three steps of an increment for each process in a chosen order and reports the
 * counter that resulted — which, unlocked, is genuinely less than it should be.
 */
export function race(
  rounds: number,
  options: { locked?: boolean; processes?: number } = {}
): RaceReport | SchedulingError {
  const workers = Math.max(2, Math.min(8, Math.floor(options.processes ?? 2)))
  if (rounds < 1 || rounds > 1_000) return refuse('bad rounds', `${rounds} rounds is not a usable number.`, 'Use between 1 and 1,000.')
  const locked = options.locked === true

  let counter = 0
  let lockHeldBy: number | null = null
  const interleaving: string[] = []
  let raced = false
  let inside = 0

  /*
   * A deliberately awkward interleaving: every process reads before any of them writes.
   *
   * That is the worst case and it is a real one — it is exactly what happens when the scheduler takes the processor
   * away between the read and the write, which it is free to do at any instruction.
   */
  for (let round = 0; round < rounds; round += 1) {
    const readValues = new Array<number>(workers).fill(0)

    for (let who = 0; who < workers; who += 1) {
      if (locked) {
        if (lockHeldBy !== null) {
          interleaving.push(`P${who} waits: the lock is held by P${lockHeldBy}`)
          continue
        }
        lockHeldBy = who
        interleaving.push(`P${who} takes the lock`)
      }
      inside += 1
      if (inside > 1) raced = true
      readValues[who] = counter
      if (interleaving.length < 60) interleaving.push(`P${who} reads ${counter}`)

      if (locked) {
        counter = readValues[who] + 1
        if (interleaving.length < 60) interleaving.push(`P${who} writes ${counter}`)
        inside -= 1
        lockHeldBy = null
        interleaving.push(`P${who} releases the lock`)
      }
    }

    if (!locked) {
      // Now they all write, each with the value it read — so all but one increment is lost.
      for (let who = 0; who < workers; who += 1) {
        counter = readValues[who] + 1
        if (interleaving.length < 60) interleaving.push(`P${who} writes ${counter}`)
        inside -= 1
      }
    }
  }

  const shouldBe = rounds * workers
  const notes: string[] = []
  if (!locked) {
    notes.push(
      'An increment is three steps: read, add one, write back. Nothing stops the scheduler taking the processor away between them, and when it does, two processes read the same value and one of the increments is simply lost.'
    )
    notes.push('This is the worst ordering rather than a random one. A real race usually loses some of the increments rather than most of them, which is exactly what makes it hard to find.')
  } else {
    notes.push('With a lock, only one process is inside at a time, so every read sees the previous write and nothing is lost.')
    notes.push('The cost is that the others wait. A lock held for a long time turns a parallel program back into a serial one.')
  }

  return {
    raced,
    interleaving: Object.freeze(interleaving.slice(0, 60)),
    counter,
    shouldBe,
    says: locked
      ? `The counter came to ${counter}, which is what it should be.`
      : `The counter came to ${counter} when it should be ${shouldBe} — ${shouldBe - counter} increment${shouldBe - counter === 1 ? '' : 's'} lost.`,
    notes: Object.freeze(notes)
  }
}

export const OS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Time is in ticks, not seconds. A tick is however long a scheduling quantum unit is, and nothing here converts it to real time.',
  'A context switch is counted and costs nothing. A real one costs microseconds of saving and restoring state, which makes a very small quantum worse than it looks here.',
  'Processes use the processor and nothing else: no input or output, so nothing ever blocks waiting for a disk or a network.',
  'Every process declares exactly how long it needs. Real schedulers do not know that, which is why shortest-job-first cannot actually be implemented.',
  'Memory is pages and frames with no translation cost. There is no translation cache, no multi-level page table and no copy-on-write.',
  'The deadlock and safety checks are over a stated snapshot. They say what is true of that state, not what will happen next.'
])
