/**
 * Distributed event traces and their causal order.
 *
 * Events are generated from a script, stamped with vector clocks, and then ordered twice: once
 * from the clocks and once from an independent reachability closure over the send/receive graph.
 * Reporting happens-before from the partial order rather than a global timeline is the whole
 * point, so the explorer also counts what a naive timestamp order would get wrong.
 */

export const SCENARIOS = {
  'late-delivery': {
    label: 'Late delivery across three processes',
    procs: ['writer', 'replica', 'observer'],
    script: [
      { p: 0, kind: 'local', name: 'write x' },
      { p: 0, kind: 'send', to: 1, name: 'replicate' },
      { p: 2, kind: 'local', name: 'sample x' },
      { p: 1, kind: 'recv', from: 0, name: 'replicate' },
      { p: 1, kind: 'send', to: 2, name: 'publish' },
      { p: 2, kind: 'recv', from: 1, name: 'publish' },
      { p: 2, kind: 'local', name: 'report' },
      { p: 0, kind: 'local', name: 'ack' },
    ],
  },
  'concurrent-updates': {
    label: 'Concurrent updates, no shared clock',
    procs: ['node-a', 'node-b', 'coordinator'],
    script: [
      { p: 0, kind: 'local', name: 'update a' },
      { p: 1, kind: 'local', name: 'update b' },
      { p: 0, kind: 'send', to: 2, name: 'a→c' },
      { p: 1, kind: 'send', to: 2, name: 'b→c' },
      { p: 2, kind: 'recv', from: 0, name: 'a→c' },
      { p: 2, kind: 'recv', from: 1, name: 'b→c' },
      { p: 2, kind: 'local', name: 'merge' },
      { p: 1, kind: 'local', name: 'update b later' },
    ],
  },
  chain: {
    label: 'A long causal chain with a side branch',
    procs: ['origin', 'middle', 'tail', 'side'],
    script: [
      { p: 0, kind: 'local', name: 'start' },
      { p: 0, kind: 'send', to: 1, name: 'hop 1' },
      { p: 0, kind: 'send', to: 3, name: 'side note' },
      { p: 1, kind: 'recv', from: 0, name: 'hop 1' },
      { p: 1, kind: 'send', to: 2, name: 'hop 2' },
      { p: 3, kind: 'recv', from: 0, name: 'side note' },
      { p: 2, kind: 'recv', from: 1, name: 'hop 2' },
      { p: 2, kind: 'local', name: 'finish' },
      { p: 3, kind: 'local', name: 'log' },
    ],
  },
};

/** Vector clocks along a script, plus the graph edges that define causality independently. */
export function trace(name) {
  const scenario = SCENARIOS[name];
  const clocks = scenario.procs.map(() => scenario.procs.map(() => 0));
  const events = [];
  const pending = new Map();
  let lastOfProcess = scenario.procs.map(() => null);

  scenario.script.forEach((op, index) => {
    clocks[op.p][op.p] += 1;
    if (op.kind === 'recv') {
      const message = pending.get(`${op.from}->${op.p}`);
      if (message) clocks[op.p] = clocks[op.p].map((value, i) => Math.max(value, message[i]));
      if (message) clocks[op.p][op.p] += 1;
    }
    const event = { index, p: op.p, kind: op.kind, name: op.name, slot: events.filter((e) => e.p === op.p).length, vc: [...clocks[op.p]], from: op.from ?? null, to: op.to ?? null };
    events.push(event);
    if (op.kind === 'send') pending.set(`${op.p}->${op.to}`, [...clocks[op.p]]);
    const previous = lastOfProcess[op.p];
    if (previous != null) event.previous = previous;
    lastOfProcess[op.p] = index;
  });

  // A receive pairs with the most recent unmatched send from that process.
  events.forEach((event) => {
    if (event.kind !== 'recv') return;
    const sender = events.filter((other) => other.kind === 'send' && other.p === event.from && other.to === event.p && other.index < event.index).pop();
    event.partner = sender ? sender.index : null;
    if (sender) sender.partner = event.index;
  });

  const edges = events.map(() => []);
  events.forEach((event) => {
    if (event.previous != null) edges[event.previous].push(event.index);
    if (event.partner != null && event.kind === 'send') edges[event.index].push(event.partner);
  });

  // Independent reachability closure: transitive closure by breadth-first search.
  const reach = events.map((_, start) => {
    const seen = new Set();
    const queue = [...edges[start]];
    while (queue.length) {
      const next = queue.shift();
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...edges[next]);
    }
    return seen;
  });

  // Layer index: the longest causal chain reaching each event.
  const layer = events.map(() => 0);
  events.forEach((event) => { edges[event.index].forEach((next) => { layer[next] = Math.max(layer[next], layer[event.index] + 1); }); });

  const clockOrder = (a, b) => a.vc.every((value, i) => value <= b.vc[i]) && a.vc.some((value, i) => value < b.vc[i]);
  const pairs = [];
  events.forEach((a) => events.forEach((b) => {
    if (a.index === b.index) return;
    if (reach[a.index].has(b.index)) pairs.push({ from: a.index, to: b.index, clocks: clockOrder(a, b) });
  }));

  const concurrent = [];
  events.forEach((a) => events.forEach((b) => { if (a.index < b.index && !reach[a.index].has(b.index) && !reach[b.index].has(a.index)) concurrent.push([a.index, b.index]); }));

  // What a total order built from local timestamps would get wrong.
  const totalOrder = [...events].sort((a, b) => a.slot - b.slot || a.p - b.p);
  const position = new Map(totalOrder.map((event, rank) => [event.index, rank]));
  const inversions = pairs.filter((pair) => position.get(pair.to) < position.get(pair.from));

  return { scenario, events, edges, reach, layer, pairs, concurrent, inversions, totalOrder: totalOrder.map((event) => event.index) };
}

export function verifyCausality() {
  const checks = [];
  const traces = Object.keys(SCENARIOS).map((name) => ({ name, data: trace(name) }));

  // 1. Happens-before is a strict partial order.
  const axioms = traces.map(({ name, data }) => {
    const { events, reach } = data;
    const irreflexive = events.every((event) => !reach[event.index].has(event.index));
    const antisymmetric = events.every((a) => [...reach[a.index]].every((target) => !reach[target].has(a.index)));
    const transitive = events.every((a) => [...reach[a.index]].every((b) => [...reach[b]].every((c) => reach[a.index].has(c))));
    return { name, irreflexive, antisymmetric, transitive };
  });
  checks.push({
    label: 'Happens-before is irreflexive, antisymmetric and transitive',
    ok: axioms.every((entry) => entry.irreflexive && entry.antisymmetric && entry.transitive),
    detail: `${axioms.length} traces, all three axioms checked over every event pair`,
  });

  // 2. The vector-clock rule and the graph closure must agree in both directions.
  const agreement = traces.map(({ name, data }) => {
    const { events, reach, pairs } = data;
    const byClock = new Set(pairs.filter((pair) => pair.clocks).map((pair) => `${pair.from}>${pair.to}`));
    const byGraph = new Set();
    events.forEach((a) => reach[a.index].forEach((target) => byGraph.add(`${a.index}>${target}`)));
    const missing = [...byGraph].filter((key) => !byClock.has(key));
    const extra = [...byClock].filter((key) => !byGraph.has(key));
    return { name, missing, extra };
  });
  checks.push({
    label: 'Vector-clock order equals the independently computed reachability closure',
    ok: agreement.every((entry) => entry.missing.length === 0 && entry.extra.length === 0),
    detail: agreement.map((entry) => `${entry.name}: ${entry.missing.length + entry.extra.length} disagreements`).join(' · '),
  });

  // 3. Every message is received strictly after it was sent.
  const deliveries = traces.every(({ data }) => data.events.filter((event) => event.kind === 'send').every((event) => event.partner != null && data.reach[event.index].has(event.partner)));
  checks.push({ label: 'Every receive is causally after its send', ok: deliveries, detail: 'checked against the closure, not the script order' });

  // 4. Concurrent events have incomparable clocks.
  const concurrency = traces.every(({ data }) => data.concurrent.every(([a, b]) => !(data.events[a].vc.every((value, i) => value <= data.events[b].vc[i])) && !(data.events[b].vc.every((value, i) => value <= data.events[a].vc[i]))));
  checks.push({ label: 'Concurrent events have incomparable vector clocks', ok: concurrency, detail: `${traces.reduce((total, entry) => total + entry.data.concurrent.length, 0)} concurrent pairs across the traces` });

  // 5. The layer index is the longest causal chain, recomputed from the edges alone.
  const layers = traces.map(({ name, data }) => {
    const best = data.events.map(() => 0);
    for (let pass = 0; pass < data.events.length; pass += 1) data.edges.forEach((targets, from) => targets.forEach((to) => { best[to] = Math.max(best[to], best[from] + 1); }));
    const mismatch = data.layer.filter((value, i) => value !== best[i]).length;
    return { name, mismatch, deepest: Math.max(...best) };
  });
  checks.push({ label: 'Layer index equals the longest causal chain to each event', ok: layers.every((entry) => entry.mismatch === 0), detail: layers.map((entry) => `${entry.name} depth ${entry.deepest}`).join(' · ') });

  // 6. A local-timestamp total order really does misorder causal pairs — which is the point of the tool.
  const inverted = traces.map(({ name, data }) => ({ name, count: data.inversions.length }));
  checks.push({ label: 'A local-timestamp total order misorders causal pairs (the reason for a partial order)', ok: inverted.some((entry) => entry.count > 0), detail: inverted.map((entry) => `${entry.name}: ${entry.count}`).join(' · ') });

  // 7. Causality is preserved by the clocks: a later event in the same process is always after.
  const program = traces.every(({ data }) => data.events.filter((event) => event.previous != null).every((event) => data.reach[event.previous].has(event.index)));
  checks.push({ label: 'Program order is respected by the causal order', ok: program, detail: 'each event is causally after its predecessor on the same process' });

  return { checks };
}