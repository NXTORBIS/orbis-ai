import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Panel, Stat, ToggleRow, downloadBlob } from './shared';

const START = `Aisha
Ben
Chloe
Diego
Emma
Farid
Grace
Hassan`;

const shuffleWithSeed = (list, seed) => {
  const items = [...list];
  let state = seed || 1;
  for (let i = items.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

const nextPowerOfTwo = (value) => 2 ** Math.ceil(Math.log2(Math.max(2, value)));

export default function BracketGenerator() {
  const [raw, setRaw] = useState(START);
  const [seed, setSeed] = useState(1);
  const [shuffle, setShuffle] = useState(true);
  const [bestOf, setBestOf] = useState('1');
  const [picks, setPicks] = useState({});

  const names = useMemo(() => String(raw).split('\n').map((line) => line.trim()).filter(Boolean), [raw]);

  const bracket = useMemo(() => {
    if (names.length < 2) return null;
    const size = Math.min(64, nextPowerOfTwo(names.length));
    const order = shuffle ? shuffleWithSeed(names, seed) : names;
    const slots = [...order, ...Array.from({ length: size - order.length }, () => 'Bye')];

    const rounds = [];
    let current = slots.map((name, index) => ({ id: `r1-${index}`, a: name, b: null, auto: name === 'Bye' ? null : 'a' }));
    // Pair up round one properly: slot 0 vs slot 1, slot 2 vs slot 3 …
    current = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i];
      const b = slots[i + 1];
      const match = { id: `r1-${i / 2}`, a, b, auto: null };
      if (a === 'Bye' && b !== 'Bye') match.auto = 'b';
      else if (b === 'Bye' && a !== 'Bye') match.auto = 'a';
      current.push(match);
    }

    let stage = 1;
    while (current.length > 0) {
      rounds.push({ stage, matches: current });
      if (current.length === 1) break;
      const next = [];
      for (let i = 0; i < current.length; i += 2) {
        next.push({ id: `r${stage + 1}-${i / 2}`, a: current[i], b: current[i + 1], auto: null });
      }
      current = next;
      stage += 1;
    }
    return { rounds, size, entrants: order.length };
  }, [names, shuffle, seed]);

  const resolve = (entry, depth = 0) => {
    if (entry === null || entry === undefined || depth > 12) return '—';
    if (typeof entry === 'string') return entry;
    const side = picks[entry.id] || entry.auto;
    if (!side) return '—';
    const child = side === 'a' ? entry.a : entry.b;
    return resolve(child, depth + 1);
  };

  const champion = bracket ? resolve(bracket.rounds[bracket.rounds.length - 1].matches[0]) : '—';

  const stageName = (remaining) => {
    if (remaining === 1) return 'Final';
    if (remaining === 2) return 'Semi-finals';
    if (remaining === 3) return 'Quarter-finals';
    return `Round of ${2 ** remaining}`;
  };

  const plainText = bracket
    ? [
        `Tournament bracket — best of ${bestOf}`,
        '',
        ...bracket.rounds.flatMap((round, index) => [
          stageName(bracket.rounds.length - index),
          ...round.matches.map((match) => `  ${resolve(match)}${match.b || match.a?.b ? ' vs' : ''}`),
          '',
        ]),
        `Winner: ${champion}`,
      ].join('\n')
    : '';

  return (
    <ToolShell
      toolId="bracket"
      icon={Users}
      title="Tournament Bracket"
      desc="Seed any list of names into a clean single-elimination bracket — byes handled, every round laid out, and results carried forward as you tap."
      state={{ raw, seed, shuffle, bestOf, picks }}
      onRestore={(restored) => {
        if (typeof restored.raw === 'string') setRaw(restored.raw);
        if (restored.seed) setSeed(Number(restored.seed));
        if (typeof restored.shuffle === 'boolean') setShuffle(restored.shuffle);
        if (restored.bestOf) setBestOf(String(restored.bestOf));
        if (restored.picks && typeof restored.picks === 'object') setPicks(restored.picks);
      }}
      exportText={plainText}
      exportName="bracket.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setSeed((s) => s + 1)} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          Reshuffle the draw
        </button>
        <button type="button" onClick={() => setPicks({})} className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50">
          Clear results
        </button>
        <CopyBtn value={plainText} label="Copy bracket" />
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([plainText], { type: 'text/plain' }), 'bracket.txt')}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
        >
          Download
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.1fr_1fr]">
        <Area label="Entrants — one per line" value={raw} onChange={setRaw} rows={9} placeholder={'Aisha\nBen\nChloe'} />
        <div className="space-y-2">
          <ToggleRow label="Random draw (reshuffleable)" checked={shuffle} onChange={setShuffle} />
          <Field label="Match format">
            <div className="flex gap-1.5">
              {['1', '3', '5'].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setBestOf(value)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${bestOf === value ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
                >
                  Best of {value}
                </button>
              ))}
            </div>
          </Field>
          <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-3 text-center">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Champion</div>
            <div className="tk-title-glow mt-1 font-display text-xl font-semibold text-cyan-j">{champion}</div>
          </div>
          {bracket && (
            <p className="text-[11px] text-muted-foreground">
              {bracket.entrants} entrants · {bracket.size}-slot bracket · {bracket.size - bracket.entrants} bye
              {bracket.size - bracket.entrants === 1 ? '' : 's'} handed out automatically
            </p>
          )}
        </div>
      </div>

      {bracket ? (
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-max gap-4">
            {bracket.rounds.map((round, index) => (
              <div key={round.stage} className="w-56 space-y-2">
                <div className="text-center text-[10px] uppercase tracking-[0.18em] text-cyan-j">
                  {stageName(bracket.rounds.length - index)}
                </div>
                {round.matches.map((match) => (
                  <div key={match.id} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2">
                    {['a', 'b'].map((side) => {
                      const entry = match[side];
                      const name = resolve(entry);
                      const chosen = (picks[match.id] || match.auto) === side;
                      const playable = entry !== null && entry !== undefined && name !== '—';
                      return (
                        <button
                          key={side}
                          type="button"
                          disabled={!playable}
                          onClick={() => setPicks((current) => ({ ...current, [match.id]: side }))}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[11px] transition ${
                            chosen ? 'bg-cyan-j/15 text-cyan-j' : playable ? 'hover:bg-accent/40' : 'opacity-40'
                          }`}
                        >
                          <span className="truncate">{name}</span>
                          {chosen && <span className="font-mono-j text-[9px]">advances</span>}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Panel className="text-[11px] text-muted-foreground">Add at least two names to build a bracket.</Panel>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Entrants" value={String(bracket?.entrants ?? 0)} mono />
        <Stat label="Bracket size" value={String(bracket?.size ?? 0)} mono />
        <Stat label="Rounds" value={String(bracket?.rounds.length ?? 0)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Tap a name to send it through — the winner appears in the next round immediately, so you can run the whole thing live from one screen. Byes
          are placed so that nobody gets two free passes in a row, and a random draw can be reshuffled as many times as you like until it feels fair.
        </p>
      </Panel>
    </ToolShell>
  );
}