/**
 * Tensor networks.
 *
 * A network of labelled tensors is a combinatorial object before it is a number: the order in
 * which the legs are summed decides whether the calculation costs a polynomial or an
 * exponential amount of work. So this engine keeps the two apart — the same network is
 * contracted along four orders, each step's cost and peak intermediate size are derived from
 * the index dimensions rather than measured after the fact, and the orders disagreeing about
 * the final number would be a bug in the contraction itself.
 */

const rng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const strides = (shape) => {
  const out = new Array(shape.length);
  let acc = 1;
  for (let i = shape.length - 1; i >= 0; i -= 1) {
    out[i] = acc;
    acc *= shape[i];
  }
  return out;
};

export const TOPOLOGIES = {
  'mps-norm': { label: 'MPS norm ⟨ψ|ψ⟩', note: 'A matrix-product state contracted with its conjugate. Contraction left to right keeps a chain of transfer matrices, and the cost is linear in the number of sites.' },
  'mps-ring': { label: 'Ring norm', note: 'The same chain closed into a ring: the optimal order has to break the cycle somewhere, so one edge is deliberately left until last.' },
  'peps-norm': { label: 'PEPS norm (2×2)', note: 'A two-dimensional network: no order avoids a large intermediate, which is exactly why two-dimensional systems are hard.' },
  'tree-norm': { label: 'Tree network', note: 'A five-site tree contracted with its real conjugate. Leaf-first orders can reduce intermediate rank; the comparison reports actual element counts including the original tensors.' },
  'random': { label: 'Random graph', note: 'A seeded random network with no structure to exploit: the order matters, and greedy and optimal disagree.' },
};

/** Builds a labelled tensor network with deterministic values. */
export function buildNetwork(name, { length = 4, chi = 3, d = 2, seed = 11 } = {}) {
  const random = rng(seed), tensors = [], dims = {}, layout = {};
  const add = (id, legs, position, source) => {
    legs.forEach(leg => { dims[leg] = leg.startsWith('p') ? d : chi; });
    const size = legs.reduce((a,leg)=>a*dims[leg],1);
    const values = source ? new Float64Array(source) : Float64Array.from({length:size},()=>random()*2-1);
    tensors.push({id,legs,values}); layout[id]=position;
    return values;
  };
  const edges = [];
  let positions;
  if (name === 'mps-norm' || name === 'mps-ring') {
    length = name === 'mps-ring' ? Math.max(3,length) : length;
    positions = Array.from({length},(_,s)=> name === 'mps-ring' ? [Math.cos(2*Math.PI*s/length),Math.sin(2*Math.PI*s/length)] : [s,0]);
    for(let s=0;s<length-1;s++) edges.push([s,s+1]);
    if(name==='mps-ring') edges.push([length-1,0]);
  } else if (name === 'peps-norm') { positions=[[0,0],[1,0],[0,1],[1,1]]; edges.push([0,1],[0,2],[1,3],[2,3]); }
  else if (name === 'tree-norm') { positions=[[0,0],[-1,1],[1,1],[-1.5,2],[1.5,2]]; edges.push([0,1],[0,2],[1,3],[2,4]); }
  else {
    positions = Array.from({length:Math.max(4,length)},(_,s)=>[Math.cos(2*Math.PI*s/Math.max(4,length)),Math.sin(2*Math.PI*s/Math.max(4,length))]);
    for(let s=0;s<positions.length-1;s++) edges.push([s,s+1]);
    for(let s=0;s<positions.length-2;s++) if(random()>0.5) edges.push([s,s+2]);
  }
  positions.forEach((position,s)=>{
    const bonds=edges.flatMap(([a,b],i)=> a===s||b===s ? [`b${i}`] : []);
    const values=add(`k${s}`,[`p${s}`,...bonds],position);
    add(`c${s}`,[`p${s}`,...bonds.map(leg=>`a${leg}`)],[position[0],position[1]+0.5],values);
  });
  const counts = {};
  tensors.forEach((tensor) => tensor.legs.forEach((leg) => { counts[leg] = (counts[leg] || 0) + 1; }));
  const open = Object.keys(counts).filter((leg) => counts[leg] === 1);
  const bonds = Object.keys(counts).filter((leg) => counts[leg] === 2);
  return {
    name,
    label: TOPOLOGIES[name] ? TOPOLOGIES[name].label : name,
    note: TOPOLOGIES[name] ? TOPOLOGIES[name].note : '',
    tensors,
    dims,
    layout,
    open,
    bonds,
    scalar: open.length === 0,
  };
}

const merge = (a, b, dims) => {
  const shared = a.legs.filter((leg) => b.legs.includes(leg));
  const outLegs = [...a.legs.filter((leg) => !shared.includes(leg)), ...b.legs.filter((leg) => !shared.includes(leg))];
  const product = (legs) => legs.reduce((acc, leg) => acc * dims[leg], 1);
  return { shared, outLegs, cost: product([...shared, ...outLegs]), elements: product(outLegs), rank: outLegs.length };
};

export function contractPair(a, b, dims) {
  const { shared, outLegs } = merge(a, b, dims);
  const aShape = a.legs.map((leg) => dims[leg]);
  const bShape = b.legs.map((leg) => dims[leg]);
  const outShape = outLegs.map((leg) => dims[leg]);
  const sharedShape = shared.map((leg) => dims[leg]);
  const sa = strides(aShape);
  const sb = strides(bShape);
  const so = strides(outShape);
  const ss = strides(sharedShape);
  const size = outShape.reduce((x, y) => x * y, 1) || 1;
  const sharedTotal = sharedShape.reduce((x, y) => x * y, 1) || 1;
  const aOutPos = a.legs.map((leg) => outLegs.indexOf(leg));
  const bOutPos = b.legs.map((leg) => outLegs.indexOf(leg));
  const aSharePos = a.legs.map((leg) => shared.indexOf(leg));
  const bSharePos = b.legs.map((leg) => shared.indexOf(leg));
  const values = new Float64Array(size);
  const outIndex = new Array(outShape.length).fill(0);
  const shareIndex = new Array(sharedShape.length).fill(0);
  for (let o = 0; o < size; o += 1) {
    let remainder = o;
    for (let i = 0; i < outShape.length; i += 1) {
      const stride = so[i];
      outIndex[i] = stride > 0 ? Math.floor(remainder / stride) % outShape[i] : 0;
      remainder -= outIndex[i] * stride;
    }
    let acc = 0;
    for (let t = 0; t < sharedTotal; t += 1) {
      let value = t;
      for (let i = 0; i < sharedShape.length; i += 1) {
        const stride = ss[i];
        shareIndex[i] = stride > 0 ? Math.floor(value / stride) % sharedShape[i] : 0;
        value -= shareIndex[i] * stride;
      }
      let offsetA = 0;
      for (let i = 0; i < a.legs.length; i += 1) offsetA += (aOutPos[i] >= 0 ? outIndex[aOutPos[i]] : shareIndex[aSharePos[i]]) * sa[i];
      let offsetB = 0;
      for (let i = 0; i < b.legs.length; i += 1) offsetB += (bOutPos[i] >= 0 ? outIndex[bOutPos[i]] : shareIndex[bSharePos[i]]) * sb[i];
      acc += a.values[offsetA] * b.values[offsetB];
    }
    values[o] = acc;
  }
  return { id: `${a.id}·${b.id}`, legs: outLegs, values, sources: [...(a.sources || [a.id]), ...(b.sources || [b.id])] };
}

/** Greedy order: at every step take the pair that leaves the smallest intermediate. */
export function orderGreedy(network, by = 'elements') {
  const nodes = network.tensors.map((tensor) => ({ id: tensor.id, legs: tensor.legs, sources: [tensor.id] }));
  const steps = [];
  let cost = 0;
  let peak = Math.max(...nodes.map((node) => node.legs.reduce((acc, leg) => acc * network.dims[leg], 1)));
  while (nodes.length > 1) {
    let best = null;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const metric = merge(nodes[i], nodes[j], network.dims);
        const connects = metric.shared.length > 0;
        const score = (connects ? 0 : 1e12) + (by === 'cost' ? metric.cost : metric.elements);
        if (!best || score < best.score) best = { i, j, score, metric, a: nodes[i], b: nodes[j] };
      }
    }
    if (!best) break;
    cost += best.metric.cost;
    peak = Math.max(peak, best.metric.elements);
    steps.push({ a: best.a.id, b: best.b.id, shared: best.metric.shared, out: best.metric.outLegs, cost: best.metric.cost, elements: best.metric.elements, rank: best.metric.rank });
    const merged = { id: `${best.a.id}+${best.b.id}`, legs: best.metric.outLegs, sources: [...best.a.sources, ...best.b.sources] };
    nodes.splice(best.j, 1);
    nodes.splice(best.i, 1);
    nodes.push(merged);
  }
  return { id: by === 'cost' ? 'greedy-work' : 'greedy-memory', label: by === 'cost' ? 'Greedy (by work)' : 'Greedy (by memory)', steps, cost, peak, final: nodes[0]?.legs ?? [] };
}

/** Left-to-right order, the sweep a chain is normally contracted with. */
export function orderSweep(network) {
  const order = [...network.tensors].sort((a, b) => {
    const pa = network.layout[a.id] || [0, 0];
    const pb = network.layout[b.id] || [0, 0];
    return pa[0] - pb[0] || pa[1] - pb[1];
  });
  const steps = [];
  let cost = 0;
  let peak = 0;
  let current = order[0] ? { id: order[0].id, legs: order[0].legs, sources: [order[0].id] } : null;
  peak = current ? current.legs.reduce((acc, leg) => acc * network.dims[leg], 1) : 0;
  for (let i = 1; i < order.length; i += 1) {
    const metric = merge(current, order[i], network.dims);
    cost += metric.cost;
    peak = Math.max(peak, metric.elements);
    steps.push({ a: current.id, b: order[i].id, shared: metric.shared, out: metric.outLegs, cost: metric.cost, elements: metric.elements, rank: metric.rank });
    current = { id: `${current.id}+${order[i].id}`, legs: metric.outLegs, sources: [...current.sources, order[i].id] };
  }
  return { id: 'sweep', label: 'Left-to-right sweep', steps, cost, peak, final: current ? current.legs : [] };
}

/**
 * Optimal order by dynamic programming over subsets. The intermediate of any subset is fixed by
 * the legs that leave it, so the best cost for a subset can be built from its splits.
 */
export function orderOptimal(network) {
  const tensors = network.tensors;
  const count = tensors.length;
  if (count > 9) return null;
  const open = new Map();
  for (let mask = 1; mask < 1 << count; mask += 1) {
    const counts = {};
    for (let i = 0; i < count; i += 1) {
      if (!(mask & (1 << i))) continue;
      tensors[i].legs.forEach((leg) => { counts[leg] = (counts[leg] || 0) + 1; });
    }
    const inside = Object.keys(counts);
    const legs = inside.filter((leg) => {
      let outside = 0;
      for (let i = 0; i < count; i += 1) {
        if (mask & (1 << i)) continue;
        if (tensors[i].legs.includes(leg)) outside += 1;
      }
      return outside > 0 || counts[leg] === 1;
    });
    open.set(mask, { legs, elements: legs.reduce((acc, leg) => acc * network.dims[leg], 1), counts });
  }
  const best = new Float64Array(1 << count).fill(Infinity);
  const split = new Array(1 << count).fill(0);
  for (let i = 0; i < count; i += 1) best[1 << i] = 0;
  for (let mask = 1; mask < 1 << count; mask += 1) {
    if ((mask & (mask - 1)) === 0) continue;
    let optimum = Infinity;
    let pick = 0;
    for (let sub = (mask - 1) & mask; sub > 0; sub = (sub - 1) & mask) {
      const other = mask ^ sub;
      if (!other) continue;
      const left = open.get(sub);
      const right = open.get(other);
      const straddling = left.legs.filter((leg) => right.legs.includes(leg));
      const cost = left.elements * right.elements / straddling.reduce((acc,leg)=>acc*network.dims[leg],1);
      const total = best[sub] + best[other] + cost;
      if (total < optimum) {
        optimum = total;
        pick = sub;
      }
      void straddling;
    }
    best[mask] = optimum;
    split[mask] = pick;
  }
  const steps = [];
  const build = (mask) => {
    if ((mask & (mask - 1)) === 0) {
      const i = Math.log2(mask);
      return { id: tensors[i].id, legs: tensors[i].legs, label: tensors[i].id, sources: [tensors[i].id] };
    }
    const sub = split[mask];
    const a = build(sub);
    const b = build(mask ^ sub);
    const metric = merge(a, b, network.dims);
    steps.push({ a: a.id, b: b.id, shared: metric.shared, out: metric.outLegs, cost: metric.cost, elements: metric.elements, rank: metric.rank });
    return { id: `${a.id}+${b.id}`, legs: metric.outLegs, sources: [...a.sources, ...b.sources] };
  };
  if (count > 1) build((1 << count) - 1);
  let cost = 0;
  let peak = 0;
  steps.forEach((step) => {
    cost += step.cost;
    peak = Math.max(peak, step.elements);
  });
  return { id: 'optimal', label: 'Dynamic programming (exact)', steps, cost, peak, final: open.get((1 << count) - 1).legs };
}

/** Contracts along an order and reports the number it lands on. */
export function contract(network, order) {
  const pool = new Map(network.tensors.map((tensor) => [tensor.id, { id: tensor.id, legs: tensor.legs, values: tensor.values, sources: [tensor.id] }]));
  let peak = Math.max(...network.tensors.map((tensor) => tensor.values.length));
  order.steps.forEach((step) => {
    const a = pool.get(step.a);
    const b = pool.get(step.b);
    if (!a || !b) throw new Error('The contraction order does not match the network.');
    const merged = contractPair(a, b, network.dims);
    pool.delete(step.a);
    pool.delete(step.b);
    merged.id = `${step.a}+${step.b}`;
    pool.set(merged.id, merged);
    peak = Math.max(peak, merged.values.length);
  });
  const result = [...pool.values()][0];
  // Canonicalize open axes in first-occurrence input order, independent of the contraction tree.
  if (result && network.open.length && result.legs.join('|') !== network.open.join('|')) {
    const sourceStride = strides(result.legs.map(l=>network.dims[l]));
    const targetStride = strides(network.open.map(l=>network.dims[l]));
    const reordered = new Float64Array(result.values.length);
    for(let i=0;i<reordered.length;i++) {
      const coords=network.open.map((l,k)=>Math.floor(i/targetStride[k])%network.dims[l]);
      const offset=result.legs.reduce((sum,l,k)=>sum+coords[network.open.indexOf(l)]*sourceStride[k],0);
      reordered[i]=result.values[offset];
    }
    result.legs=[...network.open]; result.values=reordered;
  }
  const squared = result ? result.values.reduce((sum, value) => sum + value * value, 0) : 0;
  return {
    legs: result ? result.legs : [],
    scalar: result && result.legs.length === 0 ? result.values[0] : null,
    norm: Math.sqrt(squared),
    elements: result ? result.values.length : 0,
    output: result ? Array.from(result.values) : [],
    peak,
  };
}

/** ⟨ψ|ψ⟩ of a chain by transfer matrices — a second, independent formulation. */
export function chainNormSquared(network) {
  const sites = network.tensors.length/2, d=network.dims.p0;
  let env=new Float64Array([1]), left=1;
  for(let s=0;s<sites;s++) {
    const tensor=network.tensors.find(t=>t.id===`k${s}`);
    const right=s===sites-1 ? 1 : network.dims[`b${s}`];
    const next=new Float64Array(right*right);
    for(let l=0;l<left;l++) for(let lb=0;lb<left;lb++) for(let r=0;r<right;r++) for(let rb=0;rb<right;rb++) for(let p=0;p<d;p++) {
      next[r*right+rb]+=env[l*left+lb]*tensor.values[(p*left+l)*right+r]*tensor.values[(p*left+lb)*right+rb];
    }
    env=next; left=right;
  }
  return env[0];
}

export function tensorNetAnalyze(options = {}) {
  const name=TOPOLOGIES[options.topology]?options.topology:'mps-norm';
  const length=Math.max(2,Math.min(4,Math.round(Number(options.length)||4))), chi=Math.max(1,Math.min(4,Math.round(Number(options.chi)||3))), d=Math.max(2,Math.min(3,Math.round(Number(options.d)||2)));
  const network = options.input?.trim() ? parseNetwork(options.input) : buildNetwork(name,{length,chi,d,seed:Number(options.seed)||11});
  const orders=[orderGreedy(network,'cost'),orderGreedy(network,'elements'),orderSweep(network)];
  const optimal=orderOptimal(network); if(optimal) orders.push(optimal);
  for(const order of orders) if(order.peak>250000 || order.cost>8000000) throw new Error('This contraction exceeds the local budget (250,000 intermediate elements / 8 million multiplies). Reduce dimensions or tensor count.');
  const results=orders.map(order=>({...order,...contract(network,order)}));
  const chosen=results.find(o=>o.id===options.order)||results.find(o=>o.id==='optimal')||results[0];
  const norms=results.map(o=>o.norm);
  return { name:options.input?.trim()?'custom':name, label:network.label, note:network.note, tensors:network.tensors.map(t=>({id:t.id,legs:t.legs,elements:t.values.length})), dims:network.dims, layout:network.layout, orders:results, steps:chosen.steps, orderLabel:chosen.label, order:chosen.id, cost:chosen.cost, peak:chosen.peak, norm:chosen.norm, scalar:chosen.scalar, output:chosen.output, outputLegs:chosen.legs, agreement:Math.max(...norms)-Math.min(...norms), open:network.open, reference:!options.input?.trim()&&name==='mps-norm'?chainNormSquared(network):null };
}

export function parseNetwork(text) {
  const input=JSON.parse(text), dims=input.dims, tensors=input.tensors;
  if(!dims || !Array.isArray(tensors) || tensors.length<2 || tensors.length>8) throw new Error('Provide dimensions and 2–8 tensors with id, legs and numeric values.');
  if(Object.values(dims).some(d=>!Number.isInteger(d)||d<1||d>8)) throw new Error('Every index dimension must be an integer from 1 to 8.');
  const ids=new Set(), counts={}, layout={};
  const parsed=tensors.map((t,i)=>{
    if(typeof t.id!=='string'||!t.id||t.id.includes('+')||ids.has(t.id)) throw new Error('Tensor IDs must be unique, nonempty, and contain no + sign.');
    ids.add(t.id);
    if(!Array.isArray(t.legs)||new Set(t.legs).size!==t.legs.length||t.legs.some(l=>!Object.hasOwn(dims,l))) throw new Error('Each tensor needs unique leg names declared in dims.');
    const size=t.legs.reduce((a,l)=>a*dims[l],1);
    if(size>250000||!Array.isArray(t.values)||t.values.length!==size||t.values.some(v=>typeof v!=='number'||!Number.isFinite(v))) throw new Error('Tensor values must match their row-major dimensions and be finite numbers.');
    t.legs.forEach(l=>{counts[l]=(counts[l]||0)+1;}); layout[t.id]=[Math.cos(2*Math.PI*i/tensors.length),Math.sin(2*Math.PI*i/tensors.length)];
    return {...t,values:new Float64Array(t.values)};
  });
  if(Object.values(counts).some(v=>v>2)) throw new Error('Only pairwise bonds are supported; each index may occur in at most two tensors.');
  return {label:'Custom tensor network',note:'Dense real tensors; pairwise Einstein summation, no diagonal/self-trace indices.',tensors:parsed,dims,layout,open:Object.keys(counts).filter(l=>counts[l]===1),bonds:Object.keys(counts).filter(l=>counts[l]===2)};
}

export function verifyTensorNet() {
  const checks=[];
  const push=(label,ok,detail)=>checks.push({label,ok,detail});
  const chain=buildNetwork('mps-norm',{length:3,chi:2,d:2});
  const orders=[orderGreedy(chain,'cost'),orderGreedy(chain),orderSweep(chain),orderOptimal(chain)];
  const values=orders.map(o=>contract(chain,o).scalar);
  push('Four orders agree on the contraction',Math.max(...values)-Math.min(...values)<1e-9,values.map(v=>v.toFixed(6)).join(' / '));
  const ref=chainNormSquared(chain);
  push('MPS norm matches an independent transfer-matrix evaluation',Math.abs(values[0]-ref)<1e-9,`${values[0].toFixed(6)} vs ${ref.toFixed(6)}`);
  push('Exact order has no more multiplies than either greedy or sweep',orders.at(-1).cost<=Math.min(...orders.slice(0,-1).map(o=>o.cost)),`${orders.at(-1).cost} multiplies`);
  const simple=parseNetwork(JSON.stringify({dims:{i:2,j:2,k:2},tensors:[{id:'A',legs:['i','j'],values:[1,2,3,4]},{id:'B',legs:['j','k'],values:[5,6,7,8]}]}));
  const product=contract(simple,orderOptimal(simple));
  push('Open-index contraction reproduces matrix multiplication',JSON.stringify(product.output)===JSON.stringify([19,22,43,50]),'AB = [[19,22],[43,50]]');
  const tiny=buildNetwork('mps-norm',{length:2,chi:2,d:2});
  const exhaustive=pool=>{
    if(pool.length===1)return 0;
    let best=Infinity;
    for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++){
      const m=merge(pool[i],pool[j],tiny.dims);
      best=Math.min(best,m.cost+exhaustive([...pool.filter((_,k)=>k!==i&&k!==j),{legs:m.outLegs}]));
    }
    return best;
  };
  const optimum=orderOptimal(tiny).cost, brute=exhaustive(tiny.tensors);
  push('Dynamic programming agrees with exhaustive contraction trees',optimum===brute,`${optimum} vs ${brute} multiplies`);
  push('Every norm is nonnegative',values.every(v=>v>=0),'Conjugate tensors use the same real coefficients.');
  return {checks};
}