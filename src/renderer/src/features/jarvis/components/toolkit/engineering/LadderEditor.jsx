import { Button } from '@jarvis/components/ui/button';
import { Panel } from '@jarvis/components/toolkit/shared';
import { ADDRESSES, COIL_TYPES, CONTACT_TYPES, addBranch, addContact, addRung, removeBranch, removeContact, removeRung, updateRung } from '@jarvis/components/toolkit/engineering/ladderCore';

const SELECT = 'rounded-lg border border-border bg-card/60 px-2 py-1 text-xs';

/** Edit the rungs: contacts in series and parallel, and the coil each rung drives. */
export default function LadderEditor({ program, setProgram, draft, setDraft }) {
  const update = (index, rung) => setProgram(updateRung(program, index, rung));

  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Program editor</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Contact
            <select aria-label="Contact type" className={SELECT} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
              {Object.entries(CONTACT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Address
            <select aria-label="Contact address" className={SELECT} value={draft.addr} onChange={(e) => setDraft({ ...draft, addr: e.target.value })}>
              {ADDRESSES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <Button size="sm" variant="outline" onClick={() => setProgram(addRung(program))}>Add rung</Button>
        </div>
      </div>

      <div className="space-y-3">
        {program.rungs.map((rung, index) => (
          <div key={rung.id || index} className="tk-glass-panel space-y-2 rounded-xl p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono-j text-[11px] text-muted-foreground">R{index + 1}</span>
              <input
                aria-label={`Rung ${index + 1} label`}
                className="min-w-[10rem] flex-1 rounded-lg border border-border bg-card/60 px-2 py-1 text-xs"
                value={rung.label}
                onChange={(e) => update(index, { ...rung, label: e.target.value })}
              />
              <Button size="sm" variant="outline" onClick={() => update(index, addBranch(rung))}>Parallel branch</Button>
              <Button size="sm" variant="outline" disabled={program.rungs.length <= 1} onClick={() => setProgram(removeRung(program, index))}>Delete rung</Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {rung.branches.map((branch, b) => (
                <div key={b} className="flex flex-wrap items-center gap-1 rounded-lg border border-border/70 bg-card/40 p-1.5">
                  <span className="px-1 text-[10px] text-muted-foreground">{b === 0 ? 'series' : `∥ ${b}`}</span>
                  {branch.map((contact, c) => (
                    <button
                      key={c}
                      type="button"
                      title="Remove this contact"
                      onClick={() => update(index, removeContact(rung, b, c))}
                      className="rounded-md border border-border/70 bg-card/60 px-2 py-1 font-mono-j text-[10px] hover:border-cyan-j/60 hover:text-foreground"
                    >
                      {contact.type === 'NC' ? '⊘ ' : '— '}{contact.addr} ✕
                    </button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => update(index, addContact(rung, b, { ...draft }))}>+ contact</Button>
                  {rung.branches.length > 1 && <Button size="sm" variant="ghost" onClick={() => update(index, removeBranch(rung, b))}>remove</Button>}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {rung.coils.map((coil, c) => (
                <div key={c} className="flex items-center gap-1">
                  <select
                    aria-label="Coil type"
                    className={SELECT}
                    value={coil.type}
                    onChange={(e) => update(index, { ...rung, coils: rung.coils.map((existing, i) => (i === c ? { ...existing, type: e.target.value, preset: e.target.value === 'TON' || e.target.value === 'CTU' ? (existing.preset ?? 3) : undefined } : existing)) })}
                  >
                    {Object.entries(COIL_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <select
                    aria-label="Coil address"
                    className={SELECT}
                    value={coil.addr}
                    onChange={(e) => update(index, { ...rung, coils: rung.coils.map((existing, i) => (i === c ? { ...existing, addr: e.target.value } : existing)) })}
                  >
                    {ADDRESSES.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  {(coil.type === 'TON' || coil.type === 'CTU') && (
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      preset
                      <input
                        aria-label="Preset"
                        type="number"
                        min="0.1"
                        step="0.1"
                        className="w-20 rounded-lg border border-border bg-card/60 px-2 py-1 text-xs"
                        value={coil.preset ?? 3}
                        onChange={(e) => update(index, { ...rung, coils: rung.coils.map((existing, i) => (i === c ? { ...existing, preset: Number(e.target.value) } : existing)) })}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}