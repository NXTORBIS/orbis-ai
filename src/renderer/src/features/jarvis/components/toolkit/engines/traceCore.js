/**
 * Distributed traces.
 *
 * A trace is a set of intervals with a parent relation, and the useful question is never
 * "which span is longest" but "which span would shorten the request if it were fixed". That is
 * the synchronous waiting timeline. Interval unions prevent overlap from being double-counted;
 * latest-finishing branches are attributed under a nested fork/join model. Async spans
 * are linked rather than contained, so they are excluded from both the self-time subtraction
 * and the containment invariant — which is what a message queue actually does to a trace.
 */

import { measureTrace, traceWhatIf } from '@jarvis/components/toolkit/engines/traceAnalysis';

const rng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const SERVICES = {
  gateway: { label: 'api-gateway', kind: 'edge' },
  auth: { label: 'auth-service', kind: 'service' },
  cart: { label: 'cart-service', kind: 'service' },
  catalog: { label: 'catalog-service', kind: 'service' },
  pricing: { label: 'pricing-service', kind: 'service' },
  checkout: { label: 'checkout-service', kind: 'service' },
  payment: { label: 'payment-provider', kind: 'external' },
  inventory: { label: 'inventory-service', kind: 'service' },
  postgres: { label: 'orders-db', kind: 'database' },
  ledger: { label: 'ledger-db', kind: 'database' },
  redis: { label: 'session-cache', kind: 'cache' },
  queue: { label: 'order-events', kind: 'queue' },
  notifier: { label: 'notifier', kind: 'service' },
  search: { label: 'search-index', kind: 'service' },
};

const spec = (service, name, work, extra = {}) => ({ service, name, work, ...extra });
const children = (items, { parallel = false } = {}) => ({ items, parallel });

const scene = (seed) => {
  const random = rng(seed);
  const spans = [];
  let counter = 0;
  const state = { injected: null, notes: [] };
  const add = (parent, service, name, start, duration, kind = 'server', status = 'ok', async = false) => {
    counter += 1;
    const id = `sp${counter}`;
    spans.push({ id, parent, service, name, start, duration, kind, status, async });
    return id;
  };
  const place = (nodes, parent, start, parallel) => {
    let cursor = start;
    let end = start;
    nodes.forEach((node) => {
      const at = parallel ? start : cursor;
      const work = Math.max(0.2, node.work * (1 + (random() * 2 - 1) * (node.jitter ?? 0.18)));
      const id = add(parent, node.service, node.name, at, work, node.kind ?? 'client', node.status ?? 'ok', node.async === true);
      if (node.mark) state.injected = id;
      let finished = at + work;
      if (node.children) {
        const childStart = at + (node.offset != null ? node.offset : work * 0.12);
        const childEnd = place(node.children.items, id, childStart, node.children.parallel);
        finished = Math.max(finished, childEnd + 0.3);
        const current = spans.find((span) => span.id === id);
        current.duration = Math.max(current.duration, finished - at);
        current.start = at;
      }
      if (parallel) end = Math.max(end, finished);
      else {
        cursor = finished + (node.gap ?? 0.25);
        end = cursor;
      }
    });
    return end;
  };
  const close = (id, tail = 1.5) => {
    const root = spans.find((span) => span.id === id);
    const finish = Math.max(...spans.filter((span) => !span.async).map((span) => span.start + span.duration));
    root.duration = Math.max(root.duration, finish - root.start + tail);
  };
  return { spans, state, add, place, close, random };
};

const CHECKOUT = {
  label: 'Checkout across services',
  note: 'A request that fans out to a cart, a pricing quote and a payment, with one database query that has lost its index.',
  build: (seed, options) => {
    const ctx = scene(seed);
    const root = ctx.add(null, 'gateway', 'POST /checkout', 0, 4, 'server');
    ctx.place([
      spec('auth', 'verify session', 3.5, { children: children([spec('redis', 'GET session', 1.6, { kind: 'client' })]) }),
      spec('cart', 'load cart', 8, {
        children: children([
          spec('postgres', 'SELECT cart_items', options.slowQuery ? 118 : 7, { kind: 'client', mark: options.slowQuery }),
          spec('catalog', 'hydrate products', 11, { children: children([spec('search', 'POST /_search', 9, { kind: 'client' })]) }),
        ], { parallel: true }),
      }),
      spec('pricing', 'quote order', 14, { children: children([spec('ledger', 'SELECT rates', 9, { kind: 'client' })]) }),
      spec('inventory', 'reserve stock', 10),
      spec('payment', 'authorise', 186, { kind: 'external' }),
      spec('postgres', 'INSERT order', 12, { kind: 'client' }),
    ], root, 1.5, false);
    ctx.close(root, 2.2);
    return ctx;
  },
};

const FANOUT = {
  label: 'Fan-out across forty product fetches',
  note: 'One parent issuing many parallel children: the wall time barely moves, but every child still contributes to the total work done.',
  build: (seed) => {
    const ctx = scene(seed);
    const root = ctx.add(null, 'gateway', 'GET /cart/summary', 0, 3, 'server');
    const items = Array.from({ length: 40 }, (_, index) => spec('catalog', `GET /product/${index + 1}`, 8 + (index % 5), { kind: 'client' }));
    ctx.place([
      spec('auth', 'verify session', 3, { children: children([spec('redis', 'GET session', 1.4, { kind: 'client' })]) }),
      spec('cart', 'load cart', 6, { children: children(items, { parallel: true }) }),
      spec('pricing', 'summarise', 9),
    ], root, 1.2, false);
    ctx.close(root, 2);
    return ctx;
  },
};

const RETRY = {
  label: 'Retry storm on a flaky dependency',
  note: 'A downstream call that fails and is retried with backoff inside the request: the wasted time is visible as sibling spans that did no useful work.',
  build: (seed) => {
    const ctx = scene(seed);
    const root = ctx.add(null, 'gateway', 'POST /pay', 0, 3, 'server');
    const attempts = [spec('payment', 'authorise (attempt 1)', 150, { kind: 'external', status: 'error' }), spec('payment', 'authorise (attempt 2)', 150, { kind: 'external', status: 'error' }), spec('payment', 'authorise (attempt 3)', 46, { kind: 'external' })];
    ctx.place([
      spec('auth', 'verify session', 3, {}),
      spec('checkout', 'charge', 20, {
        children: children([
          ...attempts,
        ]),
      }),
      spec('postgres', 'INSERT payment', 11, { kind: 'client' }),
    ], root, 1.4, false);
    ctx.close(root, 2);
    return ctx;
  },
};

const QUEUE = {
  label: 'Message queue, consumed after the request',
  note: 'The producer returns before the consumer runs: the consumer is linked to the trace, not nested inside it, so wall-clock latency and total work tell different stories.',
  build: (seed) => {
    const ctx = scene(seed);
    const root = ctx.add(null, 'gateway', 'POST /orders', 0, 3, 'server');
    let producer = null;
    ctx.place([
      spec('auth', 'verify session', 3, {}),
      spec('checkout', 'place order', 12, { children: children([spec('postgres', 'INSERT order', 9, { kind: 'client' })]) }),
      spec('queue', 'publish order.created', 2.5, { kind: 'producer' }),
    ], root, 1.2, false);
    producer = ctx.spans.find((span) => span.name.startsWith('publish'));
    ctx.close(root, 1.8);
    const consumerTime = ctx.spans.find(span => span.id === root).duration + 14;
    const consumer = ctx.add(producer ? producer.id : root, 'notifier', 'send receipt', consumerTime, 46, 'consumer', 'ok', true);
    ctx.add(consumer, 'queue', 'SELECT message', consumerTime + 4, 6, 'client');
    ctx.add(consumer, 'payment', 'settle', consumerTime + 12, 24, 'external');
    return ctx;
  },
};

const NPLUSONE = {
  label: 'N+1 queries behind one page',
  note: 'A parent that should issue one query issues one per row: no single span dominates, and the critical path runs straight through the stack of them.',
  build: (seed) => {
    const ctx = scene(seed);
    const root = ctx.add(null, 'gateway', 'GET /orders', 0, 3, 'server');
    ctx.place([
      spec('auth', 'verify session', 3, {}),
      spec('orders', 'list orders', 5, {
        children: children([
          spec('postgres', 'SELECT orders', 14, { kind: 'client', mark: true }),
          ...Array.from({ length: 12 }, (_, index) => spec('postgres', `SELECT customer ${index + 1}`, 9, { kind: 'client' })),
        ]),
      }),
    ], root, 1.2, false);
    ctx.close(root, 2);
    return ctx;
  },
};

const SERIAL = {
  label: 'Serial fan-out that should be parallel',
  note: 'Independent calls issued one after another: the fix is not to speed anything up but to stop waiting, which the critical path shows directly.',
  build: (seed) => {
    const ctx = scene(seed);
    const root = ctx.add(null, 'gateway', 'GET /dashboard', 0, 3, 'server');
    ctx.place([
      ...Array.from({ length: 6 }, (_, index) => spec('catalog', `panel ${index + 1}`, 42, { kind: 'client' })),
    ], root, 1.2, false);
    ctx.close(root, 2);
    return ctx;
  },
};

export const SCENARIOS = {
  checkout: CHECKOUT,
  fanout: FANOUT,
  retry: RETRY,
  queue: QUEUE,
  'n-plus-one': NPLUSONE,
  serial: SERIAL,
};

/** Canonical spans are milliseconds relative to a common trace origin. */
export function buildTrace(name,options={}) {
  const scenario=SCENARIOS[name]||SCENARIOS.checkout;
  const ctx=scenario.build(Math.max(1,Math.round(Number(options.seed)||3)),{slowQuery:options.slowQuery!==false});
  return {...measureTrace(ctx.spans),name,label:scenario.label,note:scenario.note};
}

export function traceAnalyze(options={}) {
  let trace;
  if(options.input?.trim()) {
    const input=JSON.parse(options.input);
    trace={...measureTrace(Array.isArray(input)?input:input.spans),name:'custom',label:'Pasted distributed trace',note:'Canonical nested synchronous spans; detached async work is shown but excluded from request latency. Timestamp-derived critical attribution assumes fork/join waiting; parent metadata is not a general dependency graph.'};
  } else trace=buildTrace(options.scenario,{seed:options.seed,slowQuery:options.slowQuery});
  const contributions=new Map();
  for(const segment of trace.segments)contributions.set(segment.id,(contributions.get(segment.id)||0)+segment.duration);
  return {...trace,contributions:Object.fromEntries(contributions),whatIf:trace.spans.map(s=>({id:s.id,halved:traceWhatIf(trace,s.id,0.5)})),spansById:Object.fromEntries(trace.spans.map(s=>[s.id,s]))};
}

export function verifyTrace() {
  const checks=[],push=(label,ok,detail)=>checks.push({label,ok,detail});
  const root={id:'r',parent:null,service:'gateway',name:'request',start:0,duration:100};
  const sequential=measureTrace([root,{id:'a',parent:'r',service:'A',name:'call',start:10,duration:30},{id:'b',parent:'r',service:'B',name:'call',start:45,duration:45}]);
  const parallel=measureTrace([root,{id:'a',parent:'r',service:'A',name:'call',start:10,duration:30},{id:'b',parent:'r',service:'B',name:'call',start:10,duration:70}]);
  push('Sequential critical attribution includes both serial calls',sequential.path.includes('a')&&sequential.path.includes('b'),'30 + 45 ms of downstream latency; 25 ms in gateway.');
  push('Parallel branches select the latest-finishing wait',!parallel.path.includes('a')&&parallel.path.includes('b'),'B finishes at 80 ms; A at 40 ms.');
  push('Overlapping child intervals use union, not summed durations',parallel.spans.find(s=>s.id==='r').self===30,'100 − union([10,40],[10,80]) = 30 ms');
  push('Optimizing a noncritical parallel branch gives no predicted speedup',Math.abs(traceWhatIf(parallel,'a',0.5)-100)<1e-9,'Shortening A cannot shorten the join with B.');
  push('Fork/join what-if matches the known sequential and parallel answers',traceWhatIf(sequential,'a',0.5)===85&&traceWhatIf(parallel,'b',0.5)===65,'85 ms serial; 65 ms parallel.');
  const scenarios=Object.keys(SCENARIOS).map(name=>buildTrace(name));
  push('Every scenario attributes exactly the synchronous request wall time',scenarios.every(t=>Math.abs(t.segments.reduce((a,s)=>a+s.duration,0)-t.wall)<1e-7),`${scenarios.length} timestamp-derived models`);
  const queue=buildTrace('queue');
  push('Detached consumer runs after response and is excluded from its path',queue.spans.some(s=>s.async&&s.start>queue.wall)&&!queue.path.some(id=>queue.spans.find(s=>s.id===id).async),'Consumer work remains visible in the waterfall.');
  push('N+1 query families are detected after normalizing numeric IDs',buildTrace('n-plus-one').repeats.some(p=>p.count===12),'SELECT customer # ×12; a diagnostic pattern, not proof.');
  return {checks};
}