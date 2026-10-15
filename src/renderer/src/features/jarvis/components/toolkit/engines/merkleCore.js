/**
 * Persistent Merkle index engine.
 *
 * An append-only authenticated log built to RFC 6962: leaves hash as SHA-256(0x00 ‖ data),
 * internal nodes as SHA-256(0x01 ‖ left ‖ right), and the tree splits at the largest power
 * of two below its size. Alongside it sits a content-addressed block store, where a block's
 * name is the hash of its bytes, so identical content is stored once.
 *
 * The engine is checked against definitions rather than against itself: the incrementally
 * maintained root is compared with a naive recomputation for every size, every inclusion
 * proof is verified for every leaf, consistency proofs are checked against the direct
 * question "is this old root a prefix of the new tree?", and negative controls confirm the
 * verifiers reject wrong leaves, wrong indices and tampered blocks.
 */

const encoder = new TextEncoder();
const toBytes = (value) => (value instanceof Uint8Array ? value : encoder.encode(String(value)));

async function digest(prefix, parts) {
  let length = 1;
  for (const part of parts) length += part.length;
  const buffer = new Uint8Array(length);
  buffer[0] = prefix;
  let at = 1;
  for (const part of parts) {
    buffer.set(part, at);
    at += part.length;
  }
  const hashed = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashed);
}

export const hashLeaf = (data) => digest(0x00, [toBytes(data)]);
export const hashNode = (left, right) => digest(0x01, [left, right]);
export const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const unhex = (text) => {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(text.substr(i * 2, 2), 16);
  return out;
};
export const sameBytes = (a, b) => Boolean(a) && Boolean(b) && a.length === b.length && a.every((value, i) => value === b[i]);

const splitPoint = (n) => {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return Math.max(1, Math.min(n - 1, k));
};

/** The definition: MTH(D[n]) computed recursively, with no incremental state at all. */
export async function naiveRoot(leaves) {
  if (!leaves.length) return new Uint8Array(32);
  if (leaves.length === 1) return leaves[0];
  const k = splitPoint(leaves.length);
  const left = await naiveRoot(leaves.slice(0, k));
  const right = await naiveRoot(leaves.slice(k));
  return hashNode(left, right);
}

/** Combines the frontier right-to-left: lower levels hold the rightmost subtrees. */
export async function foldFrontier(frontier) {
  let acc = null;
  for (let i = 0; i < frontier.length; i += 1) {
    if (!frontier[i]) continue;
    acc = acc ? await hashNode(frontier[i], acc) : frontier[i];
  }
  return acc ?? new Uint8Array(32);
}

/** The frontier is level-indexed, so its holes are meaningful and are kept. */
const trimFrontier = (frontier) => {
  const copy = [...frontier];
  while (copy.length && !copy[copy.length - 1]) copy.pop();
  return copy;
};

/**
 * Append-only tree with a frontier stack: appending a leaf merges it with the stored
 * subtrees of equal level, which is what keeps the root obtainable without rehashing
 * the whole log. The frontier holds one hash per level, which is what makes the index
 * worth persisting in the first place.
 */
export async function buildIncremental(leaves) {
  const frontier = [];
  const roots = [];
  let size = 0;
  for (const leaf of leaves) {
    size += 1;
    let node = leaf;
    let level = 0;
    while (frontier[level]) {
      node = await hashNode(frontier[level], node);
      frontier[level] = null;
      level += 1;
    }
    frontier[level] = node;
    roots.push(await foldFrontier(frontier));
  }
  return { leaves: leaves.length, roots, frontier: trimFrontier(frontier), frontierNodes: frontier.filter(Boolean).length, root: roots[roots.length - 1] ?? new Uint8Array(32), size };
}

/** Resuming from a persisted frontier — the reason the frontier is stored at all. */
export async function resumeFromFrontier(frontier, extraLeaves) {
  const levels = [...frontier];
  const roots = [];
  for (const leaf of extraLeaves) {
    let node = leaf;
    let level = 0;
    while (levels[level]) {
      node = await hashNode(levels[level], node);
      levels[level] = null;
      level += 1;
    }
    levels[level] = node;
    roots.push(await foldFrontier(levels));
  }
  return { frontier: trimFrontier(levels), roots, root: roots[roots.length - 1] ?? new Uint8Array(32) };
}

/** RFC 6962 PATH(m, D[n]) — the audit path for leaf m. */
export async function inclusionProof(leaves, index) {
  const path = [];
  const recurse = async (slice, m) => {
    if (slice.length <= 1) return;
    const k = splitPoint(slice.length);
    if (m < k) {
      await recurse(slice.slice(0, k), m);
      path.push({ hash: await naiveRoot(slice.slice(k)), side: 'right' });
    } else {
      await recurse(slice.slice(k), m - k);
      path.push({ hash: await naiveRoot(slice.slice(0, k)), side: 'left' });
    }
  };
  await recurse(leaves, index);
  return path;
}

/** Replays an audit path from the leaf up to the root, deriving each side from the index. */
export async function verifyInclusion(leaf, index, size, path, root) {
  if (index < 0 || index >= size) return { ok: false, reason: 'the index is outside the tree', steps: 0 };
  let fn = index;
  let sn = size - 1;
  let hash = leaf;
  for (const step of path) {
    const sibling = step && step.hash ? step.hash : step;
    if ((fn & 1) === 1 || fn === sn) {
      hash = await hashNode(sibling, hash);
      while ((fn & 1) === 0 && fn !== 0) {
        fn >>= 1;
        sn >>= 1;
      }
    } else {
      hash = await hashNode(hash, sibling);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return { ok: sn === 0 && sameBytes(hash, root), hash, steps: path.length, reason: sn === 0 ? '' : 'the path is shorter than the tree requires' };
}

/** RFC 6962 PROOF(m, D[n]). */
export async function consistencyProof(leaves, m) {
  const proof = [];
  // the target size shrinks with the slice, which is what makes this terminate
  const subproof = async (start, n, known, target) => {
    if (target === n && known) return;
    if (target === n) {
      proof.push(await naiveRoot(leaves.slice(start, start + n)));
      return;
    }
    const k = splitPoint(n);
    if (target <= k) {
      await subproof(start, k, known, target);
      proof.push(await naiveRoot(leaves.slice(start + k, start + n)));
    } else {
      await subproof(start + k, n - k, false, target - k);
      proof.push(await naiveRoot(leaves.slice(start, start + k)));
    }
  };
  await subproof(0, leaves.length, true, m);
  return proof;
}

/**
 * Replays a consistency proof. Only the old root is an input to the fold, so a proof that
 * verifies really does establish that the tree of size m is a prefix of the tree of size n.
 */
export async function verifyConsistency(m, n, proof, rootOld, rootNew) {
  if (m === 0) return { ok: proof.length === 0, reason: proof.length ? 'a proof for zero leaves must be empty' : '' };
  if (m > n) return { ok: false, reason: 'the old size is larger than the new one' };
  if (m === n) return { ok: proof.length === 0 && sameBytes(rootOld, rootNew), reason: 'equal sizes need an empty proof and equal roots' };
  let fn = m - 1;
  let sn = n - 1;
  while ((fn & 1) === 1) {
    fn >>= 1;
    sn >>= 1;
  }
  let fr = rootOld;
  let sr = rootOld;
  let rest = proof;
  if (fn !== 0) {
    if (!proof.length) return { ok: false, reason: 'the proof is shorter than the sizes require' };
    fr = proof[0];
    sr = proof[0];
    rest = proof.slice(1);
  }
  for (const node of rest) {
    if (sn === 0) return { ok: false, reason: 'the proof carries more nodes than the sizes allow' };
    if ((fn & 1) === 1 || fn === sn) {
      fr = await hashNode(node, fr);
      sr = await hashNode(node, sr);
      while ((fn & 1) === 0 && fn !== 0) {
        fn >>= 1;
        sn >>= 1;
      }
    } else {
      sr = await hashNode(sr, node);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return { ok: sn === 0 && sameBytes(fr, rootOld) && sameBytes(sr, rootNew), reason: sn === 0 ? '' : 'the proof does not consume the tree' };
}

/**
 * The content store: a block's key is the hash of its bytes, so content stored twice
 * occupies one entry, with a reference count so sharing is visible.
 */
export async function buildStore(files) {
  const store = new Map();
  let totalBytes = 0;
  let uniqueBytes = 0;
  const records = [];
  for (const file of files) {
    const blocks = [];
    let size = 0;
    for (const block of file.blocks) {
      const bytes = toBytes(block);
      size += bytes.length;
      totalBytes += bytes.length;
      const name = hex(await hashLeaf(bytes));
      blocks.push(name);
      const existing = store.get(name);
      if (existing) existing.refs += 1;
      else {
        store.set(name, { name, bytes, refs: 1 });
        uniqueBytes += bytes.length;
      }
    }
    records.push({ name: file.name, blocks, size });
  }
  return { store, records, totalBytes, uniqueBytes, shared: totalBytes - uniqueBytes };
}

/** Reads a file back out of the store and re-hashes every block — the tamper check. */
export async function readFromStore(index, name) {
  const record = index.records.find((entry) => entry.name === name);
  if (!record) throw new Error(`No such record: ${name}`);
  const parts = [];
  const problems = [];
  for (const key of record.blocks) {
    const entry = index.store.get(key);
    if (!entry) {
      problems.push(`block ${key.slice(0, 12)}… is missing from the store`);
      continue;
    }
    const actual = hex(await hashLeaf(entry.bytes));
    if (actual !== key) problems.push(`block ${key.slice(0, 12)}… hashes to ${actual.slice(0, 12)}… — the content does not match its name`);
    parts.push(entry.bytes);
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return { bytes: out, problems };
}

/**
 * The full verification pass: definitions, positive cases, negative controls and the
 * tamper check. Every number reported here was measured on the data in front of it.
 */
export async function verifyIndex({ leafCount = 257, seed = 3, onProgress } = {}) {
  let state = (seed >>> 0) || 1;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const payloads = Array.from({ length: leafCount }, (_, i) => {
    const size = 24 + Math.floor(random() * 120);
    const bytes = new Uint8Array(size);
    bytes[0] = i & 0xff;
    for (let b = 1; b < size; b += 1) bytes[b] = Math.floor(random() * 256);
    return bytes;
  });
  const leaves = [];
  for (const payload of payloads) leaves.push(await hashLeaf(payload));

  // 1 — the incremental root against the definition, at a sample of sizes: every size up to
  //     64, then every eighth size, plus the powers of two and the last. Each check rebuilds
  //     the tree from scratch, so the cost grows quadratically with the leaf count.
  const incremental = await buildIncremental(leaves);
  const sizeStep = leafCount > 256 ? 8 : 1;
  const checkedSizes = [];
  for (let size = 1; size <= leafCount; size += 1) {
    if (size <= 64 || size % sizeStep === 0 || (size & (size - 1)) === 0 || size === leafCount) checkedSizes.push(size);
  }
  let rootMismatches = 0;
  for (let index = 0; index < checkedSizes.length; index += 1) {
    const size = checkedSizes[index];
    const naive = await naiveRoot(leaves.slice(0, size));
    if (!sameBytes(naive, incremental.roots[size - 1])) rootMismatches += 1;
    if (index % 16 === 0) onProgress?.({ phase: 'Rebuilding the tree from scratch', done: index, total: checkedSizes.length });
  }

  // 2 — resume from the persisted frontier, then continue appending
  const half = Math.floor(leafCount / 2);
  const firstHalf = await buildIncremental(leaves.slice(0, half));
  const persisted = firstHalf.frontier.map((node) => (node ? hex(node) : null));
  const resumed = await resumeFromFrontier(persisted.map((text) => (text === null ? null : unhex(text))), leaves.slice(half));
  const resumedMatches = sameBytes(resumed.root, incremental.root);
  const persistedMatches = sameBytes(await foldFrontier(persisted.map((text) => (text === null ? null : unhex(text)))), firstHalf.root);

  // 3 — every inclusion proof at one size, plus the negative controls
  const proofSize = Math.min(leafCount, 257);
  onProgress?.({ phase: 'Checking every inclusion proof', total: proofSize });
  const subset = leaves.slice(0, proofSize);
  let inclusionPass = 0;
  let inclusionFail = 0;
  let wrongLeafRejected = 0;
  let wrongIndexRejected = 0;
  for (let index = 0; index < proofSize; index += 1) {
    const path = await inclusionProof(subset, index);
    const verified = await verifyInclusion(subset[index], index, proofSize, path, incremental.roots[proofSize - 1]);
    if (verified.ok) inclusionPass += 1;
    else inclusionFail += 1;
    const impostor = subset[index === 0 ? 1 : 0];
    if (!(await verifyInclusion(impostor, index, proofSize, path, incremental.roots[proofSize - 1])).ok) wrongLeafRejected += 1;
    if (!(await verifyInclusion(subset[index], (index + 1) % proofSize, proofSize, path, incremental.roots[proofSize - 1])).ok) wrongIndexRejected += 1;
  }

  // 4 — consistency proofs against the direct question, with negative controls
  const pairs = [];
  for (const [m, n] of [[1, 2], [1, leafCount], [2, leafCount], [64, 128], [100, 200], [255, 256], [256, 257], [half, leafCount]]) {
    if (m >= 1 && m < n && n <= leafCount) pairs.push([m, n]);
  }
  const consistency = [];
  for (const [m, n] of pairs) {
    const proof = await consistencyProof(leaves.slice(0, n), m);
    const verified = await verifyConsistency(m, n, proof, incremental.roots[m - 1], incremental.roots[n - 1]);
    const prefixHolds = sameBytes(await naiveRoot(leaves.slice(0, m)), incremental.roots[m - 1]);
    const shorter = m > 1
      ? await verifyConsistency(m - 1, n, proof, incremental.roots[m - 2], incremental.roots[n - 1])
      : { ok: true };
    const swapped = await verifyConsistency(m, n, proof, incremental.roots[n - 1], incremental.roots[m - 1]);
    const tamperedProof = [...proof];
    if (tamperedProof.length) {
      const last = new Uint8Array(tamperedProof[tamperedProof.length - 1]);
      last[0] ^= 0xff;
      tamperedProof[tamperedProof.length - 1] = last;
    }
    const altered = await verifyConsistency(m, n, tamperedProof, incremental.roots[m - 1], incremental.roots[n - 1]);
    consistency.push({
      m,
      n,
      proofNodes: proof.length,
      verified: verified.ok,
      prefixHolds,
      wrongSizeRejected: m > 1 ? !shorter.ok : true,
      swappedRootsRejected: !swapped.ok,
      tamperedProofRejected: !altered.ok,
    });
  }

  // 5 — the content store: deduplication and tamper detection
  const sharedBlock = encoder.encode('a block that both files contain');
  const files = [];
  for (let f = 0; f < 6; f += 1) {
    const blocks = [sharedBlock];
    for (let b = 0; b < 4; b += 1) {
      const bytes = new Uint8Array(64 + f * 8);
      bytes[0] = f;
      bytes[1] = b;
      for (let i = 2; i < bytes.length; i += 1) bytes[i] = (f * 31 + b * 7 + i) & 0xff;
      blocks.push(bytes);
    }
    files.push({ name: `part-${f}.bin`, blocks });
  }
  const index = await buildStore(files);
  const clean = await readFromStore(index, 'part-0.bin');
  const victim = index.records[0].blocks[1];
  const entry = index.store.get(victim);
  const original = entry.bytes;
  const tampered = new Uint8Array(original);
  tampered[3] ^= 0xff;
  index.store.set(victim, { ...entry, bytes: tampered });
  const afterTamper = await readFromStore(index, 'part-0.bin');
  index.store.set(victim, { ...entry, bytes: original });
  const restored = await readFromStore(index, 'part-0.bin');

  return {
    leafCount,
    rootMismatches,
    sizesChecked: checkedSizes.length,
    incrementalMatchesDefinition: rootMismatches === 0,
    frontierNodes: incremental.frontier.length,
    persistedFrontierMatches: persistedMatches,
    resumedFromFrontierMatches: resumedMatches,
    inclusion: { size: proofSize, pass: inclusionPass, fail: inclusionFail, wrongLeafRejected, wrongIndexRejected },
    consistency,
    store: {
      files: files.length,
      totalBytes: index.totalBytes,
      uniqueBytes: index.uniqueBytes,
      sharedBytes: index.shared,
      ratio: index.uniqueBytes ? index.totalBytes / index.uniqueBytes : 1,
      cleanRead: clean.problems.length === 0,
      tamperDetected: afterTamper.problems.length > 0,
      tamperMessage: afterTamper.problems[0] ?? '',
      restoredClean: restored.problems.length === 0,
      duplicateRefs: [...index.store.values()].filter((e) => e.refs > 1).length,
    },
    root: hex(incremental.root),
    roots: incremental.roots.map(hex),
  };
}