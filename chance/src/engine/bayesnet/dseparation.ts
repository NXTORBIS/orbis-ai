/**
 * d-separation by the Bayes-ball / reachability algorithm (Koller & Friedman,
 * algorithm 3.1), iteratively.
 *
 * The boolean answer is the cheap part. What makes the answer useful is the
 * active path: when X and Y are dependent given Z, the trail along which
 * information flows is the explanation, and it is returned.
 */
import { EngineError } from '../core/result';
import { DiGraph, ancestorsOf, childrenMap } from './graph';

/** Direction of travel at a node: arrived from a child (up) or a parent (down). */
type Dir = 'up' | 'down';

export interface ActivePath {
  /** Node sequence of the trail, from an X node to a Y node. */
  nodes: string[];
  /** Human-readable trail with arrow directions, e.g. "A <- C -> B". */
  description: string;
  /** Why each intermediate node lets the trail through. */
  reasons: string[];
}

export interface DSeparationResult {
  x: string[];
  y: string[];
  z: string[];
  /** True when every trail between X and Y is blocked by Z. */
  separated: boolean;
  /** Empty when separated; otherwise at least one trail that stays active. */
  activePaths: ActivePath[];
  /** All nodes reachable from X given Z (the dependence frontier). */
  reachable: string[];
  explanation: string;
}

function checkNodes(g: DiGraph, ids: readonly string[], label: string): string[] {
  const known = new Set(g.nodes);
  for (const id of ids) {
    if (!known.has(id)) {
      throw new EngineError(`d-separation set ${label} names an unknown node "${id}".`, 'unknown');
    }
  }
  return [...new Set(ids)];
}

/**
 * Decide X ⫫ Y | Z. Overlap between the sets is a modelling error, not a
 * question with an answer, so it is refused.
 */
export function dSeparated(
  graph: DiGraph,
  xs: readonly string[],
  ys: readonly string[],
  zs: readonly string[] = [],
): DSeparationResult {
  const x = checkNodes(graph, xs, 'X');
  const y = checkNodes(graph, ys, 'Y');
  const z = checkNodes(graph, zs, 'Z');
  if (x.length === 0 || y.length === 0) {
    throw new EngineError('d-separation needs at least one node in each of X and Y.', 'required');
  }
  const zSet = new Set(z);
  for (const n of x) {
    if (y.includes(n)) {
      throw new EngineError(`"${n}" is in both X and Y; a variable is never independent of itself.`, 'conflict');
    }
    if (zSet.has(n)) throw new EngineError(`"${n}" is in both X and the conditioning set Z.`, 'conflict');
  }
  for (const n of y) {
    if (zSet.has(n)) throw new EngineError(`"${n}" is in both Y and the conditioning set Z.`, 'conflict');
  }

  const children = childrenMap(graph);
  const parents = graph.parents;
  // A = Z and every ancestor of Z: at these nodes a v-structure is active.
  const ancestorsOfZ = new Set<string>([...z, ...ancestorsOf(graph, z)]);

  const ySet = new Set(y);
  const visited = new Set<string>();
  const predecessor = new Map<string, { from: string; dir: Dir } | null>();
  const reachable = new Set<string>();
  const found: ActivePath[] = [];

  const stack: { node: string; dir: Dir }[] = x.map((n) => ({ node: n, dir: 'up' }));
  for (const n of x) predecessor.set(stateKey(n, 'up'), null);

  while (stack.length) {
    const { node, dir } = stack.pop()!;
    const k = stateKey(node, dir);
    if (visited.has(k)) continue;
    visited.add(k);
    if (!zSet.has(node)) {
      reachable.add(node);
      if (ySet.has(node)) found.push(tracePath(graph, predecessor, node, dir));
    }
    const push = (next: string, nextDir: Dir): void => {
      const nk = stateKey(next, nextDir);
      if (visited.has(nk) || predecessor.has(nk)) return;
      predecessor.set(nk, { from: node, dir });
      stack.push({ node: next, dir: nextDir });
    };
    if (dir === 'up' && !zSet.has(node)) {
      for (const p of parents.get(node) ?? []) push(p, 'up');
      for (const c of children.get(node) ?? []) push(c, 'down');
    } else if (dir === 'down') {
      if (!zSet.has(node)) for (const c of children.get(node) ?? []) push(c, 'down');
      // A collider is active exactly when it or one of its descendants is in Z.
      if (ancestorsOfZ.has(node)) for (const p of parents.get(node) ?? []) push(p, 'up');
    }
  }

  for (const n of x) reachable.delete(n);
  const separated = found.length === 0;
  const zText = z.length ? `given {${z.join(', ')}}` : 'with nothing conditioned on';
  const explanation = separated
    ? `{${x.join(', ')}} is d-separated from {${y.join(', ')}} ${zText}: every trail between them is blocked, ` +
      `so the model implies they are conditionally independent.`
    : `{${x.join(', ')}} is NOT d-separated from {${y.join(', ')}} ${zText}. Active trail: ${found[0].description}.`;

  return { x, y, z, separated, activePaths: found, reachable: [...reachable].sort(), explanation };
}

function stateKey(node: string, dir: Dir): string {
  return `${dir}:${node}`;
}

function tracePath(
  graph: DiGraph,
  predecessor: ReadonlyMap<string, { from: string; dir: Dir } | null>,
  node: string,
  dir: Dir,
): ActivePath {
  const nodes: string[] = [];
  let cursor: { node: string; dir: Dir } | null = { node, dir };
  while (cursor) {
    nodes.push(cursor.node);
    const prev = predecessor.get(stateKey(cursor.node, cursor.dir));
    cursor = prev ? { node: prev.from, dir: prev.dir } : null;
  }
  nodes.reverse();
  const parts: string[] = [nodes[0]];
  const reasons: string[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    const aToB = (graph.parents.get(b) ?? []).includes(a);
    parts.push(aToB ? '->' : '<-', b);
    if (i >= 2) {
      const prev = nodes[i - 2];
      const prevToA = (graph.parents.get(a) ?? []).includes(prev);
      if (prevToA && !aToB) {
        reasons.push(`"${a}" is a collider on this trail and is conditioned on (or has a conditioned descendant), ` +
          `which ACTIVATES the trail rather than blocking it.`);
      } else if (!prevToA && aToB) {
        reasons.push(`"${a}" is a common cause (fork) of "${prev}" and "${b}" and is not conditioned on.`);
      } else {
        reasons.push(`"${a}" is a mediator on a causal chain and is not conditioned on.`);
      }
    }
  }
  return { nodes, description: parts.join(' '), reasons };
}
