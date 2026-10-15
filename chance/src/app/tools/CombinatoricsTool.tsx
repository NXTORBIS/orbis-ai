/**
 * Counting and combinatorics: exact selection counts, plus a probability
 * reading of the result where one applies.
 */
import { useMemo } from 'react';
import { SELECTION_MODES, count, factorial, formatCount, multinomial, type SelectionMode } from '../../engine/combinatorics/counting';
import { Card, DataTable, Notice, NumberField, SelectField, TextField } from '../../ui/primitives';
import { formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';

export interface CombinatoricsConfig {
  mode: SelectionMode | 'factorial' | 'multinomial';
  n: number;
  k: number;
  /** Group sizes for the multinomial mode, entered as text. */
  groups: string;
}

export const COMBINATORICS_DEFAULT: CombinatoricsConfig = { mode: 'unordered-no-repeat', n: 52, k: 5, groups: '1, 4, 4, 2' };

export function CombinatoricsTool({ config }: { config: CombinatoricsConfig }) {
  const app = useApp();
  const set = (patch: Partial<CombinatoricsConfig>) => app.updateConfig({ ...config, ...patch });

  const parsedGroups = useMemo(
    () =>
      config.groups
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number),
    [config.groups],
  );

  const result = useMemo(() => {
    try {
      if (config.mode === 'factorial') return { ok: true as const, value: factorial(config.n), extra: null };
      if (config.mode === 'multinomial') {
        if (parsedGroups.some((g) => !Number.isInteger(g) || g < 0)) {
          return { ok: false as const, error: 'Enter group sizes as whole numbers of 0 or more, separated by commas.' };
        }
        if (!parsedGroups.length) return { ok: false as const, error: 'Enter at least one group size.' };
        return { ok: true as const, value: multinomial(parsedGroups), extra: null };
      }
      const main = count(config.mode, config.n, config.k);
      // All four selection counts, so the differences between them are visible.
      const comparison = SELECTION_MODES.map((m) => {
        try {
          return { mode: m, result: count(m.id, config.n, config.k) };
        } catch {
          return { mode: m, result: null };
        }
      });
      return { ok: true as const, value: main, extra: comparison };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [config.mode, config.n, config.k, parsedGroups]);

  const modeInfo = SELECTION_MODES.find((m) => m.id === config.mode);
  const showsNk = config.mode !== 'factorial' && config.mode !== 'multinomial';

  return (
    <>
      <ToolHeader toolId="combinatorics" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="What are you counting?">
            <SelectField
              label="Counting problem"
              value={config.mode}
              onChange={(mode) => set({ mode: mode as CombinatoricsConfig['mode'] })}
              options={[
                ...SELECTION_MODES.map((m) => ({ value: m.id as string, label: m.label })),
                { value: 'factorial', label: 'Factorial (arrangements of n distinct items)' },
                { value: 'multinomial', label: 'Arrangements of a multiset (repeated items)' },
              ]}
              hint={
                modeInfo?.description ??
                (config.mode === 'factorial'
                  ? 'The number of ways to arrange n distinct items in a row.'
                  : 'The number of distinct arrangements when some items are identical — for example the letters of a word.')
              }
            />
            {showsNk && (
              <>
                <NumberField label="Items to choose from" symbol="n" value={config.n} onChange={(n) => set({ n })} min={0} max={2_000_000} integer />
                <NumberField label="Items chosen" symbol="k" value={config.k} onChange={(k) => set({ k })} min={0} max={2_000_000} integer />
              </>
            )}
            {config.mode === 'factorial' && (
              <NumberField label="Number of items" symbol="n" value={config.n} onChange={(n) => set({ n })} min={0} max={1_000_000} integer hint="Exact up to 20,000; above that an accurate approximation is shown." />
            )}
            {config.mode === 'multinomial' && (
              <TextField
                label="Group sizes"
                value={config.groups}
                onChange={(groups) => set({ groups })}
                hint='Comma-separated counts of identical items. For MISSISSIPPI: "1, 4, 4, 2" (one M, four I, four S, two P).'
                monospace
              />
            )}
          </Card>
          <AiAssistPanel capability="interpretQuestion" context="Pick the counting problem above: the description under each option says when it applies." />
        </div>

        <div className="oc-stack">
          {!result.ok && <Notice tone="error">{result.error}</Notice>}
          {result.ok && (
            <>
              <Card title="Result">
                <div className="oc-result-hero">
                  <span className="oc-result-hero__label">Number of possibilities</span>
                  <span className="oc-result-hero__value">{formatCount(result.value)}</span>
                  <span className="oc-result-hero__detail">
                    {result.value.formula}
                    {result.value.digits > 1 ? ` · ${result.value.digits.toLocaleString('en-US')} digits` : ''}
                  </span>
                </div>
                {result.value.note && <Notice tone={result.value.exact === null ? 'warning' : 'info'}>{result.value.note}</Notice>}
                {result.value.exact !== null && result.value.digits > 50 && (
                  <Notice tone="info" title="The exact value">
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, overflowWrap: 'anywhere', margin: 0 }}>{result.value.exact.toString()}</p>
                  </Notice>
                )}
                {result.value.exact !== null && result.value.exact > 0n && (
                  <p className="oc-chart-note">
                    If every possibility were equally likely, each one would have probability 1 ÷ {formatCount(result.value)} ={' '}
                    {formatValue(1 / result.value.approx, 4)}. Equal likelihood is an assumption about the process, not a consequence of the count.
                  </p>
                )}
              </Card>

              {result.extra && (
                <Card title="How the four counting problems compare" hint={`With n = ${config.n} and k = ${config.k}.`}>
                  <DataTable
                    caption="Comparison of counting methods"
                    columns={[
                      { key: 'm', header: 'Problem', render: (r) => (r as Cmp).mode.label },
                      { key: 'f', header: 'Formula', render: (r) => <code>{(r as Cmp).mode.formula}</code> },
                      { key: 'c', header: 'Count', numeric: true, render: (r) => ((r as Cmp).result ? formatCount((r as Cmp).result!) : 'not applicable') },
                    ]}
                    rows={result.extra as Cmp[]}
                  />
                  <p className="oc-chart-note">
                    Order and repetition are separate choices, and they change the answer substantially. Deciding which applies is usually the harder part of a
                    counting problem.
                  </p>
                </Card>
              )}

              <Card title="Worked meaning" variant="inset">
                <p style={{ fontSize: 12.5, margin: 0 }}>{explain(config, result.value.formula)}</p>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface Cmp {
  mode: (typeof SELECTION_MODES)[number];
  result: ReturnType<typeof count> | null;
}

function explain(config: CombinatoricsConfig, formula: string): string {
  const { n, k } = config;
  switch (config.mode) {
    case 'ordered-no-repeat':
      return `There are ${n} choices for the first position, ${Math.max(0, n - 1)} for the second, and so on down to ${Math.max(0, n - k + 1)} for the ${ordinal(k)}. Multiplying those gives ${formula}.`;
    case 'ordered-repeat':
      return `Each of the ${k} positions can be filled in ${n} ways independently, because repetition is allowed. That gives ${n} multiplied by itself ${k} times.`;
    case 'unordered-no-repeat':
      return `There are ${formulaPermutation(n, k)} ordered arrangements, but every unordered selection of ${k} items can be arranged in ${k}! ways. Dividing removes that duplication, which is why the formula has k! in the denominator.`;
    case 'unordered-repeat':
      return `Think of ${k} identical selections distributed among ${n} types. Representing the split with ${n - 1} dividers gives ${k} + ${n - 1} positions, of which ${k} are selections — hence ${formula}.`;
    case 'factorial':
      return `The first position can be filled in ${n} ways, the next in ${Math.max(0, n - 1)}, and so on down to 1. The product of all of them is ${n}!.`;
    case 'multinomial':
      return `If all items were distinct there would be ${config.groups.split(/[,\s]+/).filter(Boolean).reduce((a, b) => a + Number(b), 0)}! arrangements. Each group of identical items can be permuted among itself without producing a new arrangement, so we divide by the factorial of each group size.`;
  }
}

function formulaPermutation(n: number, k: number): string {
  return `P(${n}, ${k})`;
}

function ordinal(k: number): string {
  const suffix = k % 10 === 1 && k % 100 !== 11 ? 'st' : k % 10 === 2 && k % 100 !== 12 ? 'nd' : k % 10 === 3 && k % 100 !== 13 ? 'rd' : 'th';
  return `${k}${suffix}`;
}
