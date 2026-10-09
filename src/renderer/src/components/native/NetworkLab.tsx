import { useEffect } from 'react'
import type { SurfaceProps } from './surfaces'
import LabShell, { Facts, Notes, Refused, didRefuse } from './LabShell'
import Plot from './Plot'
import { useSystems } from './useSystems'
import { Diagram } from './Draw'

/**
 * The Network Laboratory.
 *
 * ## The arithmetic is shown in binary, because that is where it lives
 *
 * A prefix is a count of leading bits, and seeing the mask beside the address in binary is the one thing that makes
 * subnetting stop being a table to memorise. The /31 and /32 cases get their own sentence, because they break the
 * rule everything else follows.
 *
 * ## Unplugging changes the route because the search ran again
 *
 * The path is found by Dijkstra over the links that are up. Pull a cable and a different path is found, or none is —
 * and "none" is reported as none rather than as an empty picture.
 */

interface Address {
  octets: readonly number[]
  value: number
  text: string
}

interface SubnetReport {
  address: Address
  prefix: number
  mask: Address
  network: Address
  broadcast: Address
  firstHost: Address | null
  lastHost: Address | null
  total: number
  usable: number
  addressClass: string
  private: boolean
  special: string | null
  says: string
  notes: readonly string[]
}

interface Device {
  id: string
  kind: string
  address?: string
}

interface Link {
  from: string
  to: string
  delayMs: number
  bandwidthMbps: number
  down?: boolean
}

interface Topology {
  devices: readonly Device[]
  links: readonly Link[]
  name?: string
}

interface Route {
  path: readonly string[]
  delayMs: number
  bottleneckMbps: number
  deliveryChance: number
  hops: number
  says: string
}

interface Exchange {
  at: number
  from: string
  to: string
  kind: string
  fields: Readonly<Record<string, string | number>>
  says: string
}

interface ProtocolRun {
  protocol: string
  exchanges: readonly Exchange[]
  totalMs: number
  roundTrips: number
  says: string
  notes: readonly string[]
}

interface Congestion {
  samples: readonly { round: number; window: number; threshold: number; phase: string; lost: boolean; delivered: number }[]
  averageWindow: number
  losses: number
  efficiency: number
  says: string
  notes: readonly string[]
}

interface Firewall {
  verdicts: readonly { packet: { from: string; to: string; port: number; protocol: string }; allowed: boolean; byRule: number | null; says: string }[]
  shadowedRules: readonly { rule: number; by: number }[]
  unusedRules: readonly number[]
  says: string
  notes: readonly string[]
}

/** The 32 bits of an address, grouped into octets, so the prefix can be drawn across them. */
const bitsOf = (value: number): string => (value >>> 0).toString(2).padStart(32, '0')

export default function NetworkLab({ instance, onConfigure }: SurfaceProps): React.JSX.Element {
  const engines = useSystems()
  const values = instance?.values ?? {}

  const what = String(values.what ?? 'topology') as 'subnet' | 'topology' | 'protocol' | 'congestion' | 'firewall'
  const address = String(values.address ?? '192.168.1.10')
  const prefix = Number(values.prefix ?? 24)
  const splitInto = Number(values.splitInto ?? 4)
  const topology = String(values.topology ?? 'small-office')
  const from = String(values.from ?? 'pc1')
  const to = String(values.to ?? 'printer')
  const unplug = String(values.unplug ?? '')
  const protocol = String(values.protocol ?? 'name')
  const cached = values.cached === true
  const capacity = Number(values.capacity ?? 24)
  const congestionRounds = Number(values.congestionRounds ?? 60)
  const randomLoss = Number(values.randomLoss ?? 0)

  useEffect(() => {
    if (!engines.ready) return
    engines.ask({
      kind: 'networking',
      what,
      address,
      prefix,
      splitInto,
      topology: topology as never,
      from,
      to,
      unplug,
      protocol: protocol as never,
      cached,
      capacity,
      congestionRounds,
      randomLoss
    })
  }, [engines.ready, what, address, prefix, splitInto, topology, from, to, unplug, protocol, cached, capacity, congestionRounds, randomLoss])

  const held = engines.networking.value
  const made = (held?.subnet ?? null) as SubnetReport | null
  const pieces = didRefuse(held?.pieces) ? null : ((held?.pieces ?? null) as readonly SubnetReport[] | null)
  const built = (held?.topology ?? null) as Topology | null
  const route = didRefuse(held?.route) ? null : ((held?.route ?? null) as Route | null)
  const exchange = didRefuse(held?.protocol) ? null : ((held?.protocol ?? null) as ProtocolRun | null)
  const flow = (held?.congestion ?? null) as Congestion | null
  const rules = didRefuse(held?.firewall) ? null : ((held?.firewall ?? null) as Firewall | null)

  return (
    <LabShell
      title={
        what === 'subnet'
          ? 'Addresses'
          : what === 'topology'
            ? (built?.name ?? 'Network')
            : what === 'protocol'
              ? (exchange?.protocol ?? 'Protocol')
              : what === 'congestion'
                ? 'Congestion control'
                : 'Firewall'
      }
      summary={made?.says ?? route?.says ?? exchange?.says ?? flow?.says ?? rules?.says}
      refused={engines.networking.refused}
      broke={engines.networking.broke}
      busy={engines.networking.busy}
      waitingFor="Working it out…"
      ready={held !== null}
      assumptions={held?.assumptions as readonly string[] | undefined}
      instance={instance}
      onConfigure={onConfigure}
      aside={
        <>
          <Refused held={held?.route} />
          <Refused held={held?.pieces} />
          <Refused held={held?.protocol} />
          <Refused held={held?.firewall} />

          {made !== null && (
            <Facts
              title="The arithmetic"
              rows={[
                ['Address', made.address.text],
                ['Mask', made.mask.text],
                ['Network', `${made.network.text}/${made.prefix}`],
                ['Broadcast', made.broadcast.text],
                ['First usable', made.firstHost?.text ?? 'none'],
                ['Last usable', made.lastHost?.text ?? 'none'],
                ['Addresses in the block', made.total],
                ['Usable', made.usable],
                ['Class', made.addressClass],
                ['Private', made.private ? 'yes — never routed on the internet' : 'no']
              ]}
            />
          )}

          {route !== null && (
            <Facts
              title="The route"
              rows={[
                ['Hops', route.hops],
                ['One way', `${route.delayMs}ms`],
                ['Limited to', `${route.bottleneckMbps} Mbps`],
                ['Gets through', `${(route.deliveryChance * 100).toFixed(1)}%`]
              ]}
              about={route.says}
            />
          )}

          {exchange !== null && (
            <Facts
              title="What it cost"
              rows={[
                ['Messages', exchange.exchanges.length],
                ['Round trips', exchange.roundTrips],
                ['In all', `${exchange.totalMs}ms`]
              ]}
            />
          )}

          {flow !== null && (
            <Facts
              title="How well it used the path"
              rows={[
                ['Average window', flow.averageWindow.toFixed(1)],
                ['The path holds', capacity],
                ['Losses', flow.losses],
                ['Of what was possible', `${(flow.efficiency * 100).toFixed(0)}%`]
              ]}
            />
          )}

          {rules !== null && rules.shadowedRules.length > 0 && (
            <div className="p3-panel">
              <h4>Rules that can never match</h4>
              <ul className="p4-notes">
                {rules.shadowedRules.map((one) => (
                  <li key={one.rule}>
                    Rule {one.rule} is covered entirely by rule {one.by}, which comes first.
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Notes title="Worth knowing" notes={made?.notes ?? exchange?.notes ?? flow?.notes ?? rules?.notes} />
        </>
      }
    >
      {what === 'subnet' && made !== null && (
        <>
          <h4 className="p4-heading">Where the network ends and the host begins</h4>
          <div className="p5-bits">
            {[
              ['address', made.address.value],
              ['mask', made.mask.value],
              ['network', made.network.value],
              ['broadcast', made.broadcast.value]
            ].map(([label, value]) => (
              <div key={label as string} className="p5-bit-row">
                <span className="p5-bit-label">{label}</span>
                <span className="p5-bit-cells">
                  {bitsOf(value as number)
                    .split('')
                    .map((bit, index) => (
                      <span
                        key={index}
                        className={`p5-bit-cell${bit === '1' ? ' on' : ''}${index < made.prefix ? ' network' : ' host'}${
                          index > 0 && index % 8 === 0 ? ' octet' : ''
                        }`}
                      >
                        {bit}
                      </span>
                    ))}
                </span>
              </div>
            ))}
          </div>
          <ul className="p4-legend">
            <li>
              <span className="p4-swatch" style={{ background: 'var(--cyan)' }} aria-hidden="true" />
              the first {made.prefix} bits name the network
            </li>
            <li>
              <span className="p4-swatch" style={{ background: '#f0a33a' }} aria-hidden="true" />
              the remaining {32 - made.prefix} name the machine
            </li>
          </ul>

          {pieces !== null && pieces.length > 1 && (
            <>
              <h4 className="p4-heading">Split into {pieces.length}</h4>
              <div className="p2-table-wrap">
                <table className="p2-table">
                  <thead>
                    <tr>
                      <th>Network</th>
                      <th>First usable</th>
                      <th>Last usable</th>
                      <th>Broadcast</th>
                      <th>Usable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pieces.map((one) => (
                      <tr key={one.network.text}>
                        <td>
                          {one.network.text}/{one.prefix}
                        </td>
                        <td>{one.firstHost?.text ?? '—'}</td>
                        <td>{one.lastHost?.text ?? '—'}</td>
                        <td>{one.broadcast.text}</td>
                        <td className="p4-num">{one.usable}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {what === 'topology' && built !== null && (
        <>
          <h4 className="p4-heading">The network</h4>
          {/*
            * The network as a network.
            *
            * A list of machines and a list of cables is the same information and none of the shape, and the shape is
            * the subject: a ring and a star have the same devices and behave completely differently when one cable
            * goes. The route that was found is drawn along the cables it actually uses, so unplugging one and
            * watching the line move is the experiment this laboratory exists for.
            */}
          <Diagram
            height={240}
            nodes={built.devices.map((device) => ({
              id: device.id,
              label: device.id,
              // The address when it has one; the kind only when it adds something the name does not already say.
              note: device.address ?? (device.kind === device.id ? undefined : device.kind),
              group: route?.path.includes(device.id) === true ? 0 : device.kind === 'router' ? 2 : device.kind === 'switch' ? 3 : undefined
            }))}
            edges={built.links.map((link) => ({
              from: link.from,
              to: link.to,
              label: `${link.delayMs}ms`,
              faint: link.down === true,
              marked:
                route !== null &&
                route.path.some(
                  (one, at) =>
                    at < route.path.length - 1 &&
                    ((one === link.from && route.path[at + 1] === link.to) || (one === link.to && route.path[at + 1] === link.from))
                )
            }))}
            about={
              route === null
                ? `${built.devices.length} devices and ${built.links.length} cables.`
                : `The route taken is drawn through: ${route.path.join(' → ')}.`
            }
          />

          <h4 className="p4-heading">Each machine</h4>
          <div className="p5-devices">
            {built.devices.map((device) => (
              <div
                key={device.id}
                className={`p5-device ${device.kind}${route?.path.includes(device.id) ? ' on-route' : ''}`}
              >
                <strong>{device.id}</strong>
                <small>{device.kind}</small>
                {device.address !== undefined && <code>{device.address}</code>}
              </div>
            ))}
          </div>

          <h4 className="p4-heading">The cables</h4>
          <ul className="p5-links">
            {built.links.map((link, index) => {
              const onRoute =
                route !== null &&
                route.path.some((one, at) => at < route.path.length - 1 && ((one === link.from && route.path[at + 1] === link.to) || (one === link.to && route.path[at + 1] === link.from)))
              return (
                <li key={index} className={`${link.down === true ? 'down' : ''}${onRoute ? ' on-route' : ''}`}>
                  {link.from} <span aria-hidden="true">—</span> {link.to}
                  <small>
                    {link.delayMs}ms, {link.bandwidthMbps} Mbps
                    {link.down === true ? ' — unplugged' : ''}
                  </small>
                </li>
              )
            })}
          </ul>

          {route !== null ? (
            <p className="p4-says">{route.says}</p>
          ) : (
            <p className="p2-refused">
              <strong>No route.</strong> There is no way for a packet to get from {from} to {to} with the cables as
              they are.
            </p>
          )}
        </>
      )}

      {what === 'protocol' && exchange !== null && (
        <>
          <h4 className="p4-heading">Message by message</h4>
          <ol className="p5-exchange">
            {exchange.exchanges.map((one, index) => (
              <li key={index}>
                <div className="p5-exchange-head">
                  <span className="p5-exchange-at">{one.at}ms</span>
                  <strong>{one.kind}</strong>
                  <span className="p2-faint">
                    {one.from} <span aria-hidden="true">→</span> {one.to}
                  </span>
                </div>
                <p>{one.says}</p>
                {Object.keys(one.fields).length > 0 && (
                  <dl className="p5-fields">
                    {Object.entries(one.fields).map(([name, value]) => (
                      <span key={name}>
                        <dt>{name}</dt>
                        <dd>{String(value)}</dd>
                      </span>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {what === 'congestion' && flow !== null && (
        <>
          <Plot
            series={[
              { id: 'window', label: 'How much is in flight', points: flow.samples.map((one) => ({ x: one.round, y: one.window })) },
              {
                id: 'capacity',
                label: 'What the path holds',
                points: [
                  { x: 0, y: capacity },
                  { x: flow.samples.length - 1, y: capacity }
                ],
                dashed: true,
                colour: '#e05c5c'
              },
              {
                id: 'threshold',
                label: 'Where it stops doubling',
                points: flow.samples.map((one) => ({ x: one.round, y: one.threshold })),
                dashed: true,
                colour: '#f0a33a'
              }
            ]}
            xLabel="round trips"
            yLabel="packets"
            zero={0}
            markers={flow.samples.filter((one) => one.lost).slice(0, 8).map((one) => ({ x: one.round, label: 'lost' }))}
            about="The window doubles while it is below the threshold, then grows by one a round. A loss halves the threshold and drops it back to one — repeated, that is the sawtooth."
          />
          <p className="p4-says">{flow.says}</p>
        </>
      )}

      {what === 'firewall' && rules !== null && (
        <>
          <h4 className="p4-heading">What got through</h4>
          <div className="p2-table-wrap">
            <table className="p2-table">
              <thead>
                <tr>
                  <th>From</th>
                  <th>Port</th>
                  <th>Verdict</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {rules.verdicts.map((one, index) => (
                  <tr key={index}>
                    <td>{one.packet.from}</td>
                    <td className="p4-num">{one.packet.port}</td>
                    <td className={one.allowed ? 'p5-allowed' : 'p5-blocked'}>{one.allowed ? 'allowed' : 'blocked'}</td>
                    <td className="p2-faint">{one.says}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </LabShell>
  )
}
