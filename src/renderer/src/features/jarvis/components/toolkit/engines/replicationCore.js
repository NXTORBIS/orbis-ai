/**
 * DNA replication engine — a fork-level simulation rather than a diagram.
 *
 * Origins fire, forks advance at a fixed rate in both directions, each carrying a
 * continuously extended leading strand and a lagging strand built from Okazaki fragments.
 * Every fragment needs its own RNA primer at its 5′ end, and on a linear chromosome the primer
 * at the very end cannot be replaced — the end-replication problem, measured here rather than
 * asserted. A circular genome has no ends and wraps around at its origin of replication.
 */

const BASES = ['A', 'C', 'G', 'T'];
export const COMPLEMENT = { A: 'T', T: 'A', G: 'C', C: 'G' };
export const TRANSCRIBED = { A: 'U', T: 'A', G: 'C', C: 'G' };

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function makeGenome({ length = 6000, seed = 7, repeatBias = 0 } = {}) {
  const random = makeRandom(seed);
  const out = new Array(length);
  let last = 'A';
  for (let i = 0; i < length; i += 1) {
    last = random() < repeatBias ? last : BASES[Math.floor(random() * 4)];
    out[i] = last;
  }
  return out.join('');
}

export function complementStrand(sequence) {
  let out = '';
  for (const base of sequence) out += COMPLEMENT[base] ?? 'N';
  return out;
}

export const DEFAULT_SETTINGS = {
  genomeLength: 4000,
  origins: 1,
  forkRate: 80,
  fragmentLength: 180,
  primerLength: 10,
  linear: true,
  seed: 7,
};

export async function replicate(options = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...options };
  const { origins, forkRate, fragmentLength, primerLength, linear } = settings;
  const genome = options.genome ?? makeGenome({ length: settings.genomeLength, seed: settings.seed });
  const length = genome.length;

  // origins sit on a regular lattice around the genome, with a fixed offset so runs are comparable
  const originPositions = [];
  for (let i = 0; i < origins; i += 1) {
    const base = Math.round(((i + 0.5) / origins) * length);
    originPositions.push(Math.max(1, Math.min(length - 2, base)));
  }

  const coverage = new Uint8Array(length);
  const forks = originPositions.flatMap((position, originIndex) => [-1, 1].map((direction) => ({
    origin: originIndex,
    originPosition: position,
    direction,
    position,
    leading: [],
    leadingPositions: [],
    fragments: [],
    laggingStart: direction > 0 ? position + 1 : position,
    reached: false,
    telomereLoss: 0,
  })));

  // the origin itself is copied once, by the fork that leaves it first
  for (const position of originPositions) coverage[position] = 1;
  for (const fork of forks) {
    if (fork.direction < 0) {
      fork.leading.push(COMPLEMENT[genome[fork.originPosition]] ?? 'N');
      fork.leadingPositions.push(fork.originPosition);
    }
  }

  const snapshots = [];
  const dt = 0.5;
  const maxSteps = Math.ceil((length / forkRate) * 4 + 60);
  let step = 0;
  let openForks = forks.slice();

  const primerStartFor = (fork, from, to) => {
    const used = Math.min(primerLength, to - from);
    // polymerase extends 5′ to 3′, so the primer sits at the end the fork has just passed
    return fork.direction > 0 ? to - used : from;
  };

  const emitFragments = (fork) => {
    for (;;) {
      const span = Math.abs(fork.position - fork.laggingStart);
      if (span < fragmentLength) break;
      const end = fork.laggingStart + fork.direction * fragmentLength;
      const from = Math.min(fork.laggingStart, end);
      const to = Math.max(fork.laggingStart, end);
      const bases = [];
      for (let i = from; i < to; i += 1) bases.push(COMPLEMENT[genome[i]] ?? 'N');
      const start = primerStartFor(fork, from, to);
      const primer = [];
      for (let i = 0; i < Math.min(primerLength, to - from); i += 1) primer.push(TRANSCRIBED[genome[start + i]] ?? 'N');
      fork.fragments.push({ fork: forks.indexOf(fork), from, to, length: to - from, bases, primer, primerReplaced: true });
      fork.laggingStart = end;
      if (Math.abs(fork.position - fork.laggingStart) < 1) break;
    }
  };

  while (openForks.length && step < maxSteps) {
    step += 1;
    const stepBases = Math.max(1, Math.round(forkRate * dt));
    const finished = [];

    for (const fork of openForks) {
      for (let i = 0; i < stepBases; i += 1) {
        const raw = fork.position + fork.direction;
        const nextPosition = linear ? raw : (raw + length) % length;
        if (linear && (raw < 0 || raw > length - 1)) break;
        if (coverage[nextPosition] > 0) break;   // the fork stops where it meets another fork
        coverage[nextPosition] += 1;
        fork.leading.push(COMPLEMENT[genome[nextPosition]] ?? 'N');
        fork.leadingPositions.push(nextPosition);
        fork.position = nextPosition;
        if (!linear && fork.leading.length >= length) break;
      }
      emitFragments(fork);
      if (linear ? fork.position <= 0 || fork.position >= length - 1 : fork.leading.length >= length) fork.reached = true;
      finished.push(fork);
    }

    openForks = finished.filter((fork) => {
      if (fork.reached) return false;
      const raw = fork.position + fork.direction;
      if (linear && (raw < 0 || raw > length - 1)) return false;
      const nextPosition = linear ? raw : (raw + length) % length;
      return coverage[nextPosition] === 0;
    });

    snapshots.push({
      t: step * dt,
      forks: forks.map((fork) => ({ position: fork.position, origin: fork.origin, direction: fork.direction, originPosition: fork.originPosition, done: !openForks.includes(fork), fragments: fork.fragments.length })),
    });

    if (step % 8 === 0) {
      options.onProgress?.({ phase: 'Extending forks', done: snapshots.length, total: Math.ceil(maxSteps / 8), elapsed: step * dt, openForks: openForks.length });
      if (options.signal?.aborted) throw new Error('Replication was stopped.');
      await pause();
    }
  }

  // whatever lies between the last fragment boundary and the fork is the final, shorter fragment
  for (const fork of forks) {
    const span = Math.abs(fork.position - fork.laggingStart);
    if (span > 0) {
      const from = Math.min(fork.laggingStart, fork.position);
      // the block reaches the base the fork is standing on, so the bound is exclusive at position + 1
      const to = Math.max(fork.laggingStart, fork.position) + 1;
      const bases = [];
      for (let i = from; i < to; i += 1) bases.push(COMPLEMENT[genome[i]] ?? 'N');
      const start = primerStartFor(fork, from, to);
      const used = Math.min(primerLength, to - from);
      const primer = [];
      for (let i = 0; i < used; i += 1) primer.push(TRANSCRIBED[genome[start + i]] ?? 'N');
      const atChromosomeEnd = linear && (fork.direction > 0 ? fork.position >= length - 1 : fork.position <= 0);
      fork.fragments.push({ fork: forks.indexOf(fork), from, to, length: to - from, bases, primer, primerReplaced: !atChromosomeEnd });
      fork.laggingStart = fork.position;
      fork.telomereLoss = atChromosomeEnd ? used : 0;
    }
  }

  const leadingBases = forks.reduce((sum, fork) => sum + fork.leading.length, 0);
  const fragments = forks.flatMap((fork) => fork.fragments);
  const laggingBases = fragments.reduce((sum, fragment) => sum + fragment.length, 0);
  const covered = coverage.reduce((sum, count) => sum + count, 0);
  const gaps = coverage.reduce((sum, count) => sum + (count === 0 ? 1 : 0), 0);
  const overlaps = coverage.reduce((sum, count) => sum + (count > 1 ? 1 : 0), 0);

  let complementErrors = 0;
  for (const fork of forks) {
    for (let i = 0; i < fork.leading.length; i += 1) {
      if (fork.leading[i] !== COMPLEMENT[genome[fork.leadingPositions[i]]]) complementErrors += 1;
    }
    for (const fragment of fork.fragments) {
      for (let i = 0; i < fragment.length; i += 1) {
        if (fragment.bases[i] !== COMPLEMENT[genome[fragment.from + i]]) complementErrors += 1;
      }
      const start = primerStartFor(fork, fragment.from, fragment.to);
      for (let i = 0; i < fragment.primer.length; i += 1) {
        if (fragment.primer[i] !== TRANSCRIBED[genome[start + i]]) complementErrors += 1;
      }
    }
  }

  const elapsed = step * dt;
  const analytic = linear
    ? Math.max(...originPositions.map((position) => Math.max(position, length - 1 - position))) / forkRate
    : length / (2 * origins) / forkRate;
  const longestFork = forks.reduce((max, fork) => Math.max(max, fork.leading.length), 0);
  const rateAchieved = elapsed ? longestFork / elapsed : 0;
  const fragmentLengths = fragments.map((fragment) => fragment.length).filter((value) => value > 0);
  const meanFragment = fragmentLengths.length ? fragmentLengths.reduce((sum, value) => sum + value, 0) / fragmentLengths.length : 0;
  const telomereLoss = forks.reduce((sum, fork) => sum + fork.telomereLoss, 0);
  const primersUnreplaced = fragments.filter((fragment) => !fragment.primerReplaced).length;

  return {
    settings,
    genomeHead: genome.slice(0, 120),
    genomeLength: length,
    origins: originPositions,
    elapsed,
    snapshots,
    forks: forks.map((fork) => ({
      origin: fork.origin,
      direction: fork.direction,
      originPosition: fork.originPosition,
      position: fork.position,
      leading: fork.leading.length,
      leadingSample: fork.leading.slice(0, 60).join(''),
      fragments: fork.fragments.length,
      lagging: fork.fragments.reduce((sum, fragment) => sum + fragment.length, 0),
    })),
    fragments: fragments.map((fragment) => ({ from: fragment.from, to: fragment.to, length: fragment.length, primer: fragment.primer.length, primerReplaced: fragment.primerReplaced })),
    coverage,
    stats: {
      covered,
      gaps,
      overlaps,
      leadingBases,
      laggingBases,
      fragments: fragments.length,
      meanFragment,
      minFragment: fragmentLengths.length ? Math.min(...fragmentLengths) : 0,
      maxFragment: fragmentLengths.length ? Math.max(...fragmentLengths) : 0,
      primers: fragments.length,
      primersUnreplaced,
      telomereLoss,
      complementErrors,
    },
    timing: {
      measured: elapsed,
      analytic,
      errorPercent: forkRate ? ((rateAchieved - forkRate) / forkRate) * 100 : 0,
      rateAchieved,
      longestFork,
    },
    check: {
      complete: gaps === 0 && overlaps === 0,
      noOverlap: overlaps === 0,
      complementary: complementErrors === 0,
      strandIdentity: leadingBases + laggingBases === covered * 2,
      fragmentsWithinRange: fragmentLengths.every((value) => value <= fragmentLength),
      onePrimerPerFragment: fragments.every((fragment) => fragment.primer.length > 0 && fragment.primer.length <= primerLength),
      telomeresAsExpected: linear ? telomereLoss > 0 : telomereLoss === 0,
    },
  };
}

/** Control runs at one, four and circular origins, each held against what replication predicts. */
export async function verifyReplication(options = {}) {
  const base = { ...DEFAULT_SETTINGS, genomeLength: 4000, forkRate: 80 };
  const single = await replicate({ ...base, linear: true, ...options });
  const multi = await replicate({ ...base, origins: 4, linear: true, ...options });
  const circular = await replicate({ ...base, linear: false, ...options });
  return {
    single,
    multi,
    circular,
    checks: [
      { label: 'Every base of the genome is copied exactly once', ok: single.check.complete, detail: `${single.stats.covered} of ${single.genomeLength} bases, ${single.stats.gaps} uncopied, ${single.stats.overlaps} copied twice` },
      { label: 'Every synthesised base is complementary to its template', ok: single.check.complementary && multi.check.complementary, detail: `${single.stats.complementErrors + multi.stats.complementErrors} mismatches across every leading base, fragment body and primer` },
      { label: 'Both daughter molecules are complete: every base sits on a leading and a lagging strand', ok: single.check.strandIdentity, detail: `${single.stats.leadingBases} leading + ${single.stats.laggingBases} lagging = ${single.stats.covered * 2} for ${single.stats.covered} template bases — each template base is copied once on each daughter molecule` },
      { label: 'No Okazaki fragment exceeds the fragment length', ok: single.check.fragmentsWithinRange && multi.check.fragmentsWithinRange, detail: `longest ${single.stats.maxFragment} bp, mean ${single.stats.meanFragment.toFixed(1)} bp` },
      { label: 'Each fragment carries exactly one primer', ok: single.check.onePrimerPerFragment && multi.check.onePrimerPerFragment, detail: `${single.stats.primers} fragments, ${single.stats.primersUnreplaced} primer(s) left unreplaced` },
      { label: 'The fork rate achieved matches the rate set', ok: Math.abs(single.timing.errorPercent) < 10, detail: `${single.timing.rateAchieved.toFixed(1)} bp/s against ${single.settings.forkRate} bp/s, from the longest fork of ${single.timing.longestFork} bases in ${single.elapsed.toFixed(1)} s` },
      { label: 'The time taken matches the distance the forks had to cover', ok: Math.abs(single.elapsed - single.timing.analytic) / single.timing.analytic < 0.1, detail: `${single.elapsed.toFixed(1)} s measured against ${single.timing.analytic.toFixed(1)} s from ${single.timing.longestFork} bases at ${single.settings.forkRate} bp/s` },
      { label: 'Four origins finish sooner than one', ok: multi.elapsed < single.elapsed, detail: `${single.elapsed.toFixed(1)} s with one origin, ${multi.elapsed.toFixed(1)} s with four` },
      { label: 'A circular genome is copied completely and loses nothing', ok: circular.check.complete && circular.stats.telomereLoss === 0, detail: `circular: ${circular.stats.gaps} gaps, ${circular.stats.telomereLoss} bp lost; linear loses ${single.stats.telomereLoss} bp` },
    ],
  };
}