import { useEffect, useState } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes } from './LabShell'
import { useCS } from './useCS'
import './phase7.css'

/**
 * The Distributed Systems Laboratory — a cluster that really elects, and really fails.
 *
 * ## Break it on purpose
 *
 * Everything worth knowing about consensus is about what happens when something goes wrong. Kill the leader and a
 * new one appears without losing a committed entry. Split the cluster and the smaller half cannot elect anybody —
 * which is not a rule somebody imposed, it is arithmetic: a majority of five is three, and two is not three.
 *
 * ## The majority is a number on screen
 *
 * "Five nodes, three needed, two reachable — nothing can be decided" is the split-brain problem stated as counting.
 * That is the whole reason the rule exists, and a diagram of nodes with arrows never shows it.
 */

interface Node {
  id: string
  role: 'follower' | 'candidate' | 'leader' | 'down'
  term: number
  votedFor: string | null
  log: { term: number; value: string }[]
  committed: number
  timeout: number
}

interface Event {
  tick: number
  kind: string
  from: string
  to: string | null
  says: string
  term: number
}

interface Cluster {
  nodes: readonly Node[]
  tick: number
  events: readonly Event[]
  partition: Readonly<Record<string, string>>
  seed: number
}

interface Report {
  leader: string | null
  term: number
  up: number
  need: number
  canDecide: boolean
  committedLog: readonly { term: number; value: string }[]
  says: string
  notes: readonly string[]
}

const ROLE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  follower: 'waiting to hear from a leader',
  candidate: 'standing for election',
  leader: 'leading',
  down: 'crashed'
})

export default function ConsensusLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engine = useCS()
  const values = instance?.values ?? {}
  const [showing, setShowing] = useState<string>('cluster')

  const nodes = Number(values.nodes ?? 5)
  const seed = Number(values.seed ?? 1)
  const node = String(values.node ?? 'A')
  const sideB = String(values.sideB ?? 'D,E')
    .split(/[,\s]+/)
    .filter(Boolean)
  const value = String(values.value ?? 'x = 1')
  const action = String(values.action ?? 'settle')

  useEffect(() => {
    if (!engine.ready) return
    engine.ask({ kind: 'consensus', what: 'make', nodes, seed, node, sideB, value })
  }, [engine.ready, nodes, seed])

  useEffect(() => {
    if (!engine.ready) return
    if (action === 'make') return
    engine.ask({ kind: 'consensus', what: action as never, nodes, seed, node, sideB, value })
  }, [engine.ready, action, node, sideB.join(','), value])

  const held = engine.consensus.value
  const cluster = (held?.cluster ?? null) as Cluster | null
  const report = (held?.report ?? null) as Report | null
  const sides = cluster === null ? [] : [...new Set(Object.values(cluster.partition))]

  return (
    <LabShell
      title="Distributed Systems"
      summary={report?.says}
      refused={engine.consensus.refused}
      broke={engine.consensus.broke}
      busy={engine.consensus.busy}
      waitingFor="Running the cluster…"
      ready={held !== null}
      instance={instance}
      onConfigure={onConfigure}
      tabs={[
        { id: 'cluster', label: 'The cluster' },
        { id: 'log', label: 'The log' },
        { id: 'events', label: 'What happened' }
      ]}
      showing={showing}
      onShow={setShowing}
      aside={
        <>
          {report !== null && cluster !== null && (
            <Facts
              title="Now"
              rows={[
                ['Leader', report.leader ?? 'none'],
                ['Term', report.term],
                ['Nodes up', `${report.up} of ${cluster.nodes.length}`],
                ['A majority is', report.need],
                ['Can decide', report.canDecide ? 'yes' : 'no'],
                ['Ticks', cluster.tick],
                ['Committed', report.committedLog.length]
              ]}
              about={`It survives ${cluster.nodes.length - report.need} failure${cluster.nodes.length - report.need === 1 ? '' : 's'}. One more and nothing can be agreed.`}
            />
          )}
          <Notes title="Worth knowing" notes={report?.notes} />
        </>
      }
    >
      {showing === 'cluster' && cluster !== null && report !== null && (
        <>
          <h4 className="p4-heading">{report.says}</h4>
          {sides.length > 1 && (
            <p className="p4-says">
              The cluster is split into {sides.length} groups that cannot hear each other. Only a group of{' '}
              {report.need} or more can elect anybody.
            </p>
          )}
          {sides.map((side) => (
            <div key={side} className="p7-side">
              {sides.length > 1 && (
                <div className="p7-side-head">
                  <strong>Side {side}</strong>
                  <span className="p2-faint">
                    {cluster.nodes.filter((one) => cluster.partition[one.id] === side && one.role !== 'down').length} up —{' '}
                    {cluster.nodes.filter((one) => cluster.partition[one.id] === side && one.role !== 'down').length >= report.need
                      ? 'a majority, so it can elect a leader'
                      : 'not a majority, so it cannot'}
                  </span>
                </div>
              )}
              <div className="p7-nodes">
                {cluster.nodes
                  .filter((one) => cluster.partition[one.id] === side)
                  .map((one) => (
                    <div key={one.id} className={`p7-node ${one.role}`}>
                      <strong>{one.id}</strong>
                      <span>{ROLE_WORDS[one.role] ?? one.role}</span>
                      <small className="p2-faint">
                        term {one.term}
                        {one.role === 'follower' && one.timeout > 0 ? ` · times out in ${one.timeout}` : ''}
                      </small>
                      <small>{one.log.length} entr{one.log.length === 1 ? 'y' : 'ies'}, {one.committed} committed</small>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </>
      )}

      {showing === 'log' && cluster !== null && report !== null && (
        <>
          <h4 className="p4-heading">The replicated log</h4>
          {report.committedLog.length === 0 ? (
            <p className="p4-says">
              Nothing is committed yet. Elect a leader, then propose a value — it is committed only once a majority
              of nodes holds it, and that is what makes it impossible to lose.
            </p>
          ) : (
            <div className="p2-table-wrap">
              <table className="p2-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Term</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {report.committedLog.map((one, at) => (
                    <tr key={at}>
                      <td>{at + 1}</td>
                      <td>{one.term}</td>
                      <td>
                        <code>{one.value}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4 className="p4-heading">What each node holds</h4>
          <div className="p2-table-wrap">
            <table className="p2-table">
              <thead>
                <tr>
                  <th scope="col">Node</th>
                  <th scope="col">Entries</th>
                  <th scope="col">Committed</th>
                  <th scope="col">Term</th>
                </tr>
              </thead>
              <tbody>
                {cluster.nodes.map((one) => (
                  <tr key={one.id} className={one.role === 'leader' ? 'p7-accepting' : undefined}>
                    <td>
                      <strong>{one.id}</strong> <span className="p2-faint">{ROLE_WORDS[one.role]}</span>
                    </td>
                    <td>{one.log.length}</td>
                    <td>{one.committed}</td>
                    <td>{one.term}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showing === 'events' && cluster !== null && (
        <>
          <h4 className="p4-heading">Everything that happened</h4>
          <div className="p7-events p7-scroll">
            {[...cluster.events].reverse().map((one, at) => (
              <div key={`${one.tick}-${at}`} className={`p7-event k-${one.kind}`}>
                <span className="p7-event-tick">{one.tick}</span>
                <span className="p7-event-kind">{one.kind.replace(/-/g, ' ')}</span>
                <span>{one.says}</span>
              </div>
            ))}
          </div>
          <p className="p4-says">
            There is no clock here. A tick is a step, timeouts are counted in ticks, and which node times out first
            comes from the seed — so the same seed gives exactly the same run, every time.
          </p>
        </>
      )}
    </LabShell>
  )
}
