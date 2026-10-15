/**
 * Editor for a row-stochastic transition matrix, with per-row sum feedback and
 * a non-colour indicator (an icon and the numeric sum) for invalid rows.
 */
import { Button, Notice, RawNumberInput } from '../../../ui/primitives';
import { Icon } from '../../../ui/icons';
import type { Issue } from '../../../engine/core/result';

export function MatrixEditor({
  states,
  matrix,
  onChange,
  issues,
  maxStates = 10,
  context,
  title = 'Transition probabilities',
}: {
  states: string[];
  matrix: number[][];
  onChange(states: string[], matrix: number[][]): void;
  issues: Issue[];
  maxStates?: number;
  /**
   * Which matrix this is, when a screen shows more than one. The sequential
   * decisions screen renders an editor per action, and without this every
   * matrix gave its cells the identical accessible name — "Probability of
   * moving from Good to Good" in all of them — so a screen reader could not
   * tell which action's matrix a cell belonged to. Pass the action's name.
   */
  context?: string;
  /** Heading for this editor, when a screen shows more than one. */
  title?: string;
}) {
  const within = context ? ` under ${context}` : '';
  const n = states.length;

  const setCell = (i: number, j: number, value: number) => {
    const next = matrix.map((row, ri) => (ri === i ? row.map((v, cj) => (cj === j ? value : v)) : [...row]));
    onChange(states, next);
  };

  const renameState = (i: number, name: string) => {
    onChange(
      states.map((s, j) => (j === i ? name : s)),
      matrix,
    );
  };

  const addState = () => {
    const nextStates = [...states, `State ${n + 1}`];
    // New row: all probability stays in the new state; new column: zero.
    const nextMatrix = [...matrix.map((row) => [...row, 0]), [...new Array<number>(n).fill(0), 1]];
    onChange(nextStates, nextMatrix);
  };

  const removeState = (i: number) => {
    const nextStates = states.filter((_, j) => j !== i);
    const nextMatrix = matrix.filter((_, ri) => ri !== i).map((row) => row.filter((_, cj) => cj !== i));
    onChange(nextStates, nextMatrix);
  };

  const normaliseRow = (i: number) => {
    const sum = matrix[i].reduce((a, b) => a + (Number.isFinite(b) ? Math.max(0, b) : 0), 0);
    if (sum <= 0) return;
    const next = matrix.map((row, ri) => (ri === i ? row.map((v) => (Number.isFinite(v) ? Math.max(0, v) / sum : 0)) : [...row]));
    onChange(states, next);
  };

  return (
    <div className="oc-field">
      <span className="oc-field__label">{title}</span>
      <p className="oc-field__hint" style={{ marginTop: 0, marginBottom: 'var(--s2)' }}>
        Row <em>i</em>, column <em>j</em> is the probability of moving from state <em>i</em> to state <em>j</em> in one step. Each row must sum to 1.
      </p>

      <div style={{ overflowX: 'auto', paddingBottom: 'var(--s2)' }}>
        <div className="oc-matrix-grid" style={{ gridTemplateColumns: `minmax(90px, 120px) repeat(${n}, minmax(62px, 1fr)) 72px 28px`, minWidth: 'max-content' }}>
          <div />
          {states.map((s, j) => (
            <div key={`h-${j}`} className="oc-matrix-cell" style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`To ${s}`}>
              {s}
            </div>
          ))}
          <div className="oc-matrix-cell" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
            Row sum
          </div>
          <div />

          {states.map((s, i) => {
            const sum = matrix[i]?.reduce((a, b) => a + (Number.isFinite(b) ? b : NaN), 0) ?? NaN;
            const bad = !Number.isFinite(sum) || Math.abs(sum - 1) > 1e-9;
            return (
              <div key={`r-${i}`} style={{ display: 'contents' }}>
                <input
                  className="oc-matrix-input"
                  style={{ textAlign: 'left' }}
                  value={s}
                  maxLength={40}
                  aria-label={`Name of state ${i + 1}${within}`}
                  onChange={(e) => renameState(i, e.target.value)}
                />
                {states.map((_, j) => (
                  <RawNumberInput
                    key={`c-${i}-${j}`}
                    value={matrix[i]?.[j] ?? 0}
                    min={0}
                    max={1}
                    ariaLabel={`Probability of moving from ${s} to ${states[j]}${within}`}
                    onChange={(v) => setCell(i, j, v)}
                  />
                ))}
                <div
                  className="oc-matrix-cell"
                  style={{ color: bad ? 'var(--status-warning)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}
                  title={bad ? 'This row does not sum to 1' : 'This row is valid'}
                >
                  {bad && <Icon name="alert" size={11} />}
                  {Number.isFinite(sum) ? sum.toFixed(3) : '—'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {bad && Number.isFinite(sum) && sum > 0 && (
                    <Button icon="reset" size="sm" variant="ghost" title={`Scale row ${i + 1} to sum to 1`} onClick={() => normaliseRow(i)} />
                  )}
                  {n > 2 && <Button icon="trash" size="sm" variant="ghost" title={`Remove ${s}`} onClick={() => removeState(i)} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="oc-btn-row" style={{ marginTop: 'var(--s2)' }}>
        <Button icon="plus" size="sm" disabled={n >= maxStates} onClick={addState}>
          Add a state
        </Button>
        {n >= maxStates && <span className="oc-muted" style={{ fontSize: 11.5, alignSelf: 'center' }}>Maximum {maxStates} states in this editor.</span>}
      </div>

      {issues.length > 0 && (
        <div style={{ marginTop: 'var(--s3)' }}>
          <Notice tone="error" title="The transition matrix is not valid" items={issues.map((i) => i.message)} />
        </div>
      )}
    </div>
  );
}
