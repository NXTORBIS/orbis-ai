/**
 * Sequence assembly: a k-mer spectrum, a de Bruijn graph over canonical k-mers,
 * unitig compaction, and the statistics that decide whether the result is any good.
 *
 * Reads are taken as they come, in the orientation they arrived in — which is what a
 * real read set looks like, because sequencing reads both strands. The graph therefore
 * contains a path for each strand and the contig list is collapsed back to one of each
 * reverse-complement pair, rather than pretending the strand problem away by
 * canonicalising k-mers (which silently invents branches).
 *
 * Honest limits: this is a compact assembler for modest read sets, not a production
 * pipeline. It has no paired-end handling, no scaffolding and no polishing step, and
 * every reported figure comes from the reads in front of it.
 */

import { SearchStopped, makeRng, yieldToBrowser } from './run';

const COMPLEMENT = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
const BASES = ['A', 'C', 'G', 'T'];

export function reverseComplement(sequence) {
  let out = '';
  for (let i = sequence.length - 1; i >= 0; i -= 1) out += COMPLEMENT[sequence[i]] ?? 'N';
  return out;
}

export function canonicalKmer(kmer) {
  const reverse = reverseComplement(kmer);
  return kmer <= reverse ? kmer : reverse;
}

export function randomGenome(length, seed = 7, gcBias = 0.5) {
  const random = makeRng(seed);
  const half = gcBias / 2;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const roll = random();
    if (roll < half) out += 'G';
    else if (roll < gcBias) out += 'C';
    else if (roll < gcBias + (1 - gcBias) / 2) out += 'A';
    else out += 'T';
  }
  return out;
}

/** Sequencing in miniature: fixed-length reads at random positions, optional errors. */
export function simulateReads(genome, { readLength = 150, coverage = 20, errorRate = 0, bothStrands = true, seed = 11 } = {}) {
  const random = makeRng(seed);
  const count = Math.max(1, Math.round((genome.length * coverage) / Math.max(20, readLength)));
  const reads = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(random() * Math.max(1, genome.length - readLength + 1));
    let read = genome.slice(start, start + readLength);
    if (errorRate > 0) {
      let mutated = '';
      for (const base of read) {
        if (random() < errorRate) {
          const alternatives = BASES.filter((b) => b !== base);
          mutated += alternatives[Math.floor(random() * alternatives.length)];
        } else {
          mutated += base;
        }
      }
      read = mutated;
    }
    // Half the reads come off the other strand, as they do from a real sequencer.
    if (bothStrands && random() < 0.5) read = reverseComplement(read);
    if (read.length >= 32) reads.push(read);
  }
  return reads;
}

export function parseFasta(text) {
  const records = [];
  let current = null;
  String(text || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('>')) {
      current = { name: trimmed.slice(1).trim() || `sequence ${records.length + 1}`, sequence: '' };
      records.push(current);
      return;
    }
    const sequence = trimmed.replace(/[^ACGTNacgtn]/g, '').toUpperCase();
    if (!sequence) return;
    if (!current) {
      current = { name: 'pasted sequence', sequence: '' };
      records.push(current);
    }
    current.sequence += sequence;
  });
  return records.filter((record) => record.sequence.length);
}

export function kmerSpectrum(reads, k, canonicalise = true) {
  const spectrum = new Map();
  reads.forEach((read) => {
    for (let i = 0; i + k <= read.length; i += 1) {
      const raw = read.slice(i, i + k);
      if (raw.includes('N')) continue;
      const key = canonicalise ? canonicalKmer(raw) : raw;
      spectrum.set(key, (spectrum.get(key) ?? 0) + 1);
    }
  });
  return spectrum;
}

export function contigStats(contigs) {
  const lengths = contigs.map((contig) => contig.length).sort((a, b) => b - a);
  const totalBases = lengths.reduce((sum, length) => sum + length, 0);
  let running = 0;
  let n50 = 0;
  for (const length of lengths) {
    running += length;
    if (running >= totalBases / 2) {
      n50 = length;
      break;
    }
  }
  const gc = totalBases
    ? contigs.reduce((sum, contig) => sum + [...contig].filter((base) => base === 'G' || base === 'C').length, 0) / totalBases
    : 0;
  return { count: contigs.length, totalBases, longest: lengths[0] ?? 0, n50, gc };
}

/** Longest suffix of `left` that is also a prefix of `right`. */
function overlapLength(left, right) {
  const ceiling = Math.min(left.length, right.length);
  for (let length = ceiling; length >= 1; length -= 1) {
    if (left.slice(left.length - length) === right.slice(0, length)) return length;
  }
  return 0;
}

/**
 * Greedy overlap merging, the step that turns graph fragments into a sequence: two
 * contigs sharing at least a k-mer are joined, in whichever orientation overlaps. This
 * is also what reunites the two strands into a single contig.
 */
export function mergeContigs(contigs, minOverlap) {
  const pool = contigs.slice().sort((a, b) => b.length - a.length);
  const used = new Array(pool.length).fill(false);
  const merged = [];
  for (let i = 0; i < pool.length; i += 1) {
    if (used[i]) continue;
    used[i] = true;
    let current = pool[i];
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < pool.length; j += 1) {
        if (used[j]) continue;
        let bestOverlap = 0;
        let bestResult = null;
        [pool[j], reverseComplement(pool[j])].forEach((oriented) => {
          const tail = overlapLength(current, oriented);
          if (tail >= minOverlap && tail > bestOverlap) {
            bestOverlap = tail;
            bestResult = current + oriented.slice(tail);
          }
          const head = overlapLength(oriented, current);
          if (head >= minOverlap && head > bestOverlap) {
            bestOverlap = head;
            bestResult = oriented.slice(0, oriented.length - head) + current;
          }
        });
        if (bestResult) {
          current = bestResult;
          used[j] = true;
          changed = true;
        }
      }
    }
    merged.push(current);
  }
  return merged.sort((a, b) => b.length - a.length);
}

/**
 * How much of a known reference the contigs actually explain: every contig is looked
 * for verbatim in both orientations, and the reference bases it covers are marked.
 */
export function referenceCoverage(contigs, reference) {
  const covered = new Uint8Array(reference.length);
  let longestMatch = 0;
  let exactContigs = 0;
  contigs.forEach((contig) => {
    let matched = false;
    [contig, reverseComplement(contig)].forEach((orientation) => {
      let from = reference.indexOf(orientation);
      while (from >= 0) {
        matched = true;
        longestMatch = Math.max(longestMatch, orientation.length);
        for (let i = from; i < Math.min(from + orientation.length, covered.length); i += 1) covered[i] = 1;
        from = reference.indexOf(orientation, from + 1);
      }
    });
    if (matched) exactContigs += 1;
  });
  let coveredBases = 0;
  covered.forEach((flag) => { coveredBases += flag; });
  return {
    coveredBases,
    fraction: reference.length ? coveredBases / reference.length : 0,
    longestMatch,
    exactContigs,
  };
}

/**
 * The assembler. Counting and graph construction hand control back to the browser as
 * they go, so a large read set stays cancellable and can report progress.
 */
export async function assemble(reads, k, { minCount = 2, minContig = 120, onProgress, signal } = {}) {
  const spectrum = new Map();
  let readIndex = 0;
  for (const read of reads) {
    for (let i = 0; i + k <= read.length; i += 1) {
      const raw = read.slice(i, i + k);
      if (raw.includes('N')) continue;
      spectrum.set(raw, (spectrum.get(raw) ?? 0) + 1);
    }
    readIndex += 1;
    if (readIndex % 250 === 0) {
      await yieldToBrowser();
      onProgress?.({ phase: 'Counting k-mers', done: readIndex, total: reads.length });
      if (signal?.aborted) throw new SearchStopped('cancelled');
    }
  }

  const totalKmers = [...spectrum.values()].reduce((sum, count) => sum + count, 0);
  const distinctKmers = spectrum.size;
  const kept = new Set([...spectrum.entries()].filter(([, count]) => count >= minCount).map(([kmer]) => kmer));
  const filteredKmers = distinctKmers - kept.size;

  // Edges come from consecutive k-mer pairs; both ends must have survived the filter,
  // which is what removes most of the damage sequencing errors leave behind.
  const edges = new Map();
  reads.forEach((read) => {
    for (let i = 0; i + k < read.length; i += 1) {
      const left = read.slice(i, i + k);
      const right = read.slice(i + 1, i + k + 1);
      if (left.includes('N') || right.includes('N')) continue;
      const from = left;
      const to = right;
      if (!kept.has(from) || !kept.has(to)) continue;
      if (!edges.has(from)) edges.set(from, new Map());
      const bucket = edges.get(from);
      bucket.set(to, (bucket.get(to) ?? 0) + 1);
    }
  });

  // In-degree is the number of distinct predecessors, not the number of read
  // occurrences: a k-mer covered twenty times still has one predecessor, and counting
  // occurrences instead turns every node in the graph into a branch point.
  const indegree = new Map();
  edges.forEach((bucket) => bucket.forEach((_, to) => indegree.set(to, (indegree.get(to) ?? 0) + 1)));

  const nodes = [...edges.keys()];
  const inDegree = (node) => indegree.get(node) ?? 0;
  const outDegree = (node) => edges.get(node)?.size ?? 0;
  const branching = (node) => inDegree(node) !== 1 || outDegree(node) !== 1;

  await yieldToBrowser();
  onProgress?.({ phase: 'Compacting the graph', done: reads.length, total: reads.length });

  const visited = new Set();
  const unitigs = [];
  const extend = (start) => {
    let node = start;
    let sequence = start;
    visited.add(node);
    while (!branching(node)) {
      const nexts = edges.get(node);
      if (!nexts || nexts.size !== 1) break;
      const next = [...nexts.keys()][0];
      if (visited.has(next)) break;
      visited.add(next);
      sequence += next.slice(-1);
      node = next;
    }
    return sequence;
  };

  // Paths that begin at a branch point, then anything left over is a pure cycle.
  nodes.forEach((node) => {
    if (!branching(node) || visited.has(node)) return;
    visited.add(node);
    [...(edges.get(node)?.keys() ?? [])].forEach((next) => {
      if (visited.has(next)) return;
      unitigs.push(node + extend(next).slice(k - 1));
    });
  });
  nodes.forEach((node) => {
    if (visited.has(node) || outDegree(node) === 0 || inDegree(node) === 0) return;
    const sequence = extend(node);
    unitigs.push(sequence + sequence.slice(0, k - 1));
  });

  // Every path has a twin on the other strand, so one of each pair is reported.
  const reported = new Set();
  const collapsed = unitigs
    .sort((a, b) => b.length - a.length)
    .filter((sequence) => {
      const reverse = reverseComplement(sequence);
      if (reported.has(sequence) || reported.has(reverse)) return false;
      reported.add(sequence);
      return true;
    });
  const contigs = mergeContigs(
    collapsed.filter((sequence) => sequence.length >= Math.max(k * 2, minContig)),
    Math.max(40, k),
  );
  const stats = contigStats(contigs);

  // The k-mer spectrum: how many distinct k-mers occur once, twice, and so on. Error
  // k-mers sit on the left of this histogram; real sequence sits on the right.
  const bins = [[1, 1], [2, 2], [3, 4], [5, 9], [10, 19], [20, 49], [50, Infinity]];
  const spectrumBins = bins.map(([low, high]) => ({
    label: low === high ? String(low) : high === Infinity ? `${low}+` : `${low}–${high}`,
    value: [...spectrum.values()].filter((count) => count >= low && count <= Math.min(high, Number.MAX_SAFE_INTEGER)).length,
  }));

  return {
    contigs,
    allUnitigs: collapsed,
    collapsedFrom: unitigs.length,
    stats,
    spectrumBins,
    graph: {
      nodes: nodes.length,
      edges: [...edges.values()].reduce((sum, bucket) => sum + bucket.size, 0),
      totalKmers,
      distinctKmers,
      filteredKmers,
      keptKmers: kept.size,
      branching: nodes.filter(branching).length,
    },
  };
}