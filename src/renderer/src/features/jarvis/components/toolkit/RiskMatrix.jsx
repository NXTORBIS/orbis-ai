import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const DEFAULT_RISKS = [
  { id: 'r1', name: 'Key supplier goes out of business', likelihood: '3', impact: '5', owner: 'Operations', mitigation: 'Qualify a second supplier and hold six weeks of critical stock' },
  { id: 'r2', name: 'Payment provider outage during peak', likelihood: '2', impact: '5', owner: 'Engineering', mitigation: 'Fallback provider configured and tested quarterly' },
  { id: 'r3', name: 'Senior engineer leaves', likelihood: '3', impact: '4', owner: 'Engineering', mitigation: 'Documentation in the repo and two people able to cover each service' },
  { id: 'r4', name: 'Support volume doubles after launch', likelihood: '4', impact: '2', owner: 'Support', mitigation: 'Help centre articles written before launch' },
  { id: 'r5', name: 'Data protection complaint', likelihood: '2', impact: '5', owner: 'Legal', mitigation: 'Retention schedule enforced in code, not in a policy document' },
];

const BANDS = [
  { max: 4, label: 'low', tone: 'emerald', action: 'Accept and monitor. Review annually.' },
  { max: 9, label: 'medium', tone: 'cyan', action: 'Mitigate with a named owner and a review date.' },
  { max: 14, label: 'high', tone: 'amber', action: 'Act before the next quarter. Contingency plan required.' },
  { max: 25, label: 'extreme', tone: 'rose', action: 'Act now. Escalate to the top of the organisation.' },
];

const bandFor = (score) => BANDS.find((entry) => score <= entry.max) || BANDS[3];

export default function RiskMatrix() {
  const [risks, setRisks] = useState(DEFAULT_RISKS);
  const [showMatrix, setShowMatrix] = useState(true);

  const set = (id, key, value) => setRisks((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const parsed = risks.map((row) => {
      const likelihood = Math.max(1, Math.min(5, Number(row.likelihood) || 3));
      const impact = Math.max(1, Math.min(5, Number(row.impact) || 3));
      const score = likelihood * impact;
      return { ...row, likelihood, impact, score, band: bandFor(score) };
    }).sort((a, b) => b.score - a.score);

    const cells = [];
    for (let impact = 5; impact >= 1; impact -= 1) {
      for (let likelihood = 1; likelihood <= 5; likelihood += 1) {
        const score = likelihood * impact;
        cells.push({
          likelihood, impact, score, band: bandFor(score),
          risks: parsed.filter((row) => row.likelihood === likelihood && row.impact === impact),
        });
      }
    }

    const counts = BANDS.map((band) => ({
      label: band.label,
      value: parsed.filter((row) => row.band.label === band.label).length,
    }));

    const byOwner = {};
    parsed.forEach((row) => {
      const owner = row.owner || 'Unowned';
      byOwner[owner] = (byOwner[owner] || 0) + 1;
    });
    const ownerRows = Object.entries(byOwner).map(([label, value]) => ({ label, value }));

    const averageScore = parsed.length ? parsed.reduce((sum, row) => sum + row.score, 0) / parsed.length : 0;
    const topRisk = parsed[0];
    const unmitigated = parsed.filter((row) => !row.mitigation.trim());
    const unowned = parsed.filter((row) => !row.owner.trim());

    const warnings = [];
    if (unmitigated.length) warnings.push(unmitigated.length + ' risk' + (unmitigated.length === 1 ? ' has' : 's have') + ' no mitigation recorded. A risk register without actions is a list of worries.');
    if (unowned.length) warnings.push(unowned.length + ' risk' + (unowned.length === 1 ? ' has' : 's have') + ' no owner. Unowned risks are the ones that materialise.');
    if (topRisk && topRisk.score >= 15) warnings.push('The top risk scores ' + topRisk.score + ', which is extreme. It should have a decision recorded now rather than a note for later.');
    if (!warnings.length) warnings.push('Every risk has an owner and a mitigation, and nothing sits in the extreme band. Review dates would be the next improvement.');

    const report = [
      'Risk register — ' + parsed.length + ' risks, average score ' + averageScore.toFixed(1),
      '',
      ...parsed.map((row) => row.band.label.toUpperCase().padEnd(9, ' ') + 'score ' + String(row.score).padEnd(4, ' ') + row.name + ' (' + row.owner + ') — ' + row.mitigation),
      '',
      'By band: ' + counts.map((entry) => entry.label + ' ' + entry.value).join(' · '),
      'By owner: ' + ownerRows.map((entry) => entry.label + ' ' + entry.value).join(' · '),
      '',
      ...warnings,
    ].join('\n');

    return { parsed, cells, counts, ownerRows, averageScore, topRisk, unmitigated, unowned, warnings, report };
  }, [risks]);

  return (
    <ToolShell
      toolId="risk-matrix"
      icon={AlertTriangle}
      title="Risk Matrix & Register"
      desc="Likelihood against impact on a real five by five grid, with scores ranked, bands named, owners listed and every risk carrying the action that reduces it — plus the gaps flagged."
      state={{ risks, showMatrix }}
      onRestore={(restored) => {
        if (Array.isArray(restored.risks) && restored.risks.length) setRisks(restored.risks);
        if (typeof restored.showMatrix === 'boolean') setShowMatrix(restored.showMatrix);
      }}
      exportText={result.report}
      exportName="risk-register.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.topRisk && result.topRisk.score >= 15 ? 'rose' : result.topRisk && result.topRisk.score >= 10 ? 'amber' : 'emerald'}
          label="Highest risk score"
          value={String(result.topRisk ? result.topRisk.score : 0)}
          unit="of 25"
          sub={result.topRisk ? result.topRisk.name + ' — ' + result.topRisk.band.label + '. ' + result.topRisk.band.action : 'No risks recorded yet.'}
        />
        <Ring
          value={result.averageScore}
          max={25}
          tone={result.averageScore > 12 ? 'amber' : 'cyan'}
          label="Average score"
          sub={'Across ' + result.parsed.length + ' risks, with ' + result.unmitigated.length + ' lacking a mitigation and ' + result.unowned.length + ' without an owner'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Risk register</span>
          <button type="button" onClick={() => setShowMatrix((value) => !value)} className="rounded-lg border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground">
            {showMatrix ? 'Hide the grid' : 'Show the grid'}
          </button>
        </div>
        <div className="space-y-2">
          {risks.map((row) => (
            <div key={row.id} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
              <div className="grid gap-2 sm:grid-cols-5">
                <Field label="Risk"><input value={row.name} onChange={(e) => set(row.id, 'name', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
                <Field label="Likelihood 1-5"><input value={row.likelihood} onChange={(e) => set(row.id, 'likelihood', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Impact 1-5"><input value={row.impact} onChange={(e) => set(row.id, 'impact', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Owner"><input value={row.owner} onChange={(e) => set(row.id, 'owner', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
                <div className="flex items-end gap-2">
                  <span className="font-mono-j text-[11px] text-cyan-j">score {(Number(row.likelihood) || 0) * (Number(row.impact) || 0)}</span>
                  <button type="button" onClick={() => setRisks((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-1">
                <Field label="Mitigation">
                  <input value={row.mitigation} onChange={(e) => set(row.id, 'mitigation', e.target.value)} placeholder="What reduces it, and who does it" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" />
                </Field>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRisks((current) => [...current, { id: Math.random().toString(36).slice(2), name: 'New risk', likelihood: '3', impact: '3', owner: '', mitigation: '' }])}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add a risk
        </button>
      </Panel>

      {showMatrix && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The matrix — impact up, likelihood across</div>
          <div className="overflow-x-auto">
            <div className="min-w-[420px]">
              <div className="mb-1 flex gap-1 pl-10 text-[10px] text-muted-foreground">
                {[1, 2, 3, 4, 5].map((likelihood) => <div key={likelihood} className="flex-1 text-center">L{likelihood}</div>)}
              </div>
              {[5, 4, 3, 2, 1].map((impact) => (
                <div key={impact} className="mb-1 flex items-center gap-1">
                  <div className="w-9 text-[10px] text-muted-foreground">I{impact}</div>
                  {[1, 2, 3, 4, 5].map((likelihood) => {
                    const cell = result.cells.find((entry) => entry.likelihood === likelihood && entry.impact === impact);
                    const tint = cell.band.tone === 'rose' ? 'hsl(0 84% 60% / 0.22)'
                      : cell.band.tone === 'amber' ? 'hsl(38 92% 55% / 0.2)'
                        : cell.band.tone === 'cyan' ? 'hsl(189 100% 50% / 0.16)'
                          : 'hsl(160 60% 45% / 0.14)';
                    return (
                      <div
                        key={likelihood + '-' + impact}
                        className="flex-1 rounded-lg border border-border/60 px-2 py-2 text-center"
                        style={{ backgroundColor: tint }}
                        title={cell.risks.length ? cell.risks.map((row) => row.name).join(', ') : cell.band.label}
                      >
                        <div className="font-mono-j text-[13px]">{cell.score}</div>
                        <div className="text-[9px] text-muted-foreground">{cell.risks.length ? cell.risks.length + ' risk' + (cell.risks.length === 1 ? '' : 's') : cell.band.label}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Each cell shows the score and how many of your risks sit in it. Hover a cell to see which ones. The band wording follows the score, not the cell position, so the
            response is consistent across the whole register.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Risks by band</div>
          <Bars data={result.counts} format={(value) => String(value)} suffix=" risks" highlightLast={false} />
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            {BANDS.map((band) => (
              <p key={band.label}>· <span className="font-mono-j uppercase">{band.label}</span> — {band.action}</p>
            ))}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Ranked, worst first</span>
            <CopyBtn value={result.report} label="Copy the register" />
          </div>
          <div className="max-h-64 space-y-1 overflow-auto">
            {result.parsed.map((row) => (
              <div key={row.id} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="font-mono-j text-cyan-j">{row.score}</span>
                  <span className="truncate">{row.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">{row.band.label}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">{row.owner || 'unowned'} · {row.mitigation || 'no mitigation recorded'}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Risks" value={String(result.parsed.length)} mono sub={'average ' + result.averageScore.toFixed(1)} />
        <Stat label="Extreme or high" value={String(result.parsed.filter((row) => row.score > 9).length)} mono sub="need action now" />
        <Stat label="No mitigation" value={String(result.unmitigated.length)} mono sub="just a worry" />
        <Stat label="No owner" value={String(result.unowned.length)} mono sub="nobody is watching" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Owner load</div>
        <Bars data={result.ownerRows} format={(value) => String(value)} suffix=" risks" highlightLast={false} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          One owner carrying most of the register is a real risk in itself. Spread the load, and give each risk a single named person rather than a team.
        </p>
      </Panel>

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {result.warnings.map((line) => <p key={line}>· {line}</p>)}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Running a register that changes decisions</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Score likelihood and impact against clear definitions, not feelings. Define what a 4 in impact means in money, hours or reputation before you start.</p>
            <p>· Every risk needs one named owner. Shared ownership is the same as no ownership, and it is the fastest way for a register to rot.</p>
            <p>· Record the action, not just the risk. A register that only lists worries trains people to stop reading it.</p>
            <p>· Re-score on a schedule. Likelihood falls as mitigations land, and a register that never changes has stopped being reviewed.</p>
            <p>· Keep it short. Ten live risks with owners beat forty entries nobody has read since the workshop.</p>
            <p>· Separate the risk from the issue. If it has already happened, it is an issue and belongs in a different list with a different owner.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading the bands</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A score of 1 to 4 is background. Accept it, note it, and look again next year — but do not spend effort here while something scores 16.</p>
            <p>· 5 to 9 is where most real work happens: a named owner, a mitigation, and a review date.</p>
            <p>· 10 to 14 needs a decision before the next quarter, including what you will do if it lands anyway.</p>
            <p>· 15 or more needs action now and attention at the top. {result.topRisk && result.topRisk.score >= 15 ? 'Your top risk is in this band: ' + result.topRisk.name + '.' : 'Nothing in the register currently sits in this band.'}</p>
            <p>· Impact of 5 with likelihood of 1 still deserves a contingency plan, because the consequences do not care about the odds.</p>
            <p>· Watch for the opposite error too: a likelihood of 5 with an impact of 1 is usually noise that belongs in a process improvement, not a risk register.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Risks', value: String(result.parsed.length) },
                { label: 'Highest', value: String(result.topRisk ? result.topRisk.score : 0) },
                { label: 'Average', value: result.averageScore.toFixed(1) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>score = likelihood × impact, each scored 1 to 5, giving a range of 1 to 25</p>
          <p>bands: 1-4 low · 5-9 medium · 10-14 high · 15-25 extreme</p>
          <p>the grid places each risk by its likelihood across and its impact up</p>
          <p>owner load counts risks per named owner, with blank owners grouped as unowned</p>
          <p className="text-cyan-j">Check: the average score across {result.parsed.length} risks is {result.averageScore.toFixed(2)}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A simple multiplicative register, which is the most common approach and the easiest to explain. It does not weight by monetary exposure or account for correlated
          risks, so for anything with a financial threshold, keep a quantified risk model alongside it.
        </p>
      </Panel>
    </ToolShell>
  );
}