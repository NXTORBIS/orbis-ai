import React, { useState } from 'react';
import { Sigma, Play, Plus, Check, X, Trash2 } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// DFA / NFA simulator: define states + transitions, test strings for acceptance.
const SAMPLE_DFA = {
  states: ['q0', 'q1', 'q2'],
  alphabet: ['0', '1'],
  transitions: { 'q0': { '0': 'q1', '1': 'q0' }, 'q1': { '0': 'q2', '1': 'q0' }, 'q2': { '0': 'q2', '1': 'q2' } },
  start: 'q0',
  accept: ['q2'],
};

export default function TheoryLab() {
  const [dfa, setDfa] = useState(SAMPLE_DFA);
  const [input, setInput] = useState('010');
  const [trace, setTrace] = useState([]);
  const [accepted, setAccepted] = useState(null);
  const [newSym, setNewSym] = useState('');

  const test = () => {
    const t = [{ state: dfa.start, pos: 0, sym: '→' }];
    let cur = dfa.start;
    for (let i = 0; i < input.length; i++) {
      const sym = input[i];
      if (!dfa.alphabet.includes(sym)) { setTrace([{ state: 'REJECT', pos: i, sym, error: `Symbol '${sym}' not in alphabet` }]); setAccepted(false); return; }
      const next = dfa.transitions[cur]?.[sym];
      if (!next) { setTrace([...t, { state: 'REJECT', pos: i, sym, error: `No transition from ${cur} on '${sym}'` }]); setAccepted(false); return; }
      cur = next;
      t.push({ state: cur, pos: i + 1, sym });
    }
    setTrace(t);
    setAccepted(dfa.accept.includes(cur));
  };

  const addSymbol = () => {
    const s = newSym.trim();
    if (!s || dfa.alphabet.includes(s)) return;
    setDfa((d) => ({ ...d, alphabet: [...d.alphabet, s] }));
    setNewSym('');
  };

  const setTransition = (state, sym, target) => {
    setDfa((d) => ({ ...d, transitions: { ...d.transitions, [state]: { ...d.transitions[state], [sym]: target || undefined } } }));
  };

  const toggleAccept = (state) => {
    setDfa((d) => ({ ...d, accept: d.accept.includes(state) ? d.accept.filter((s) => s !== state) : [...d.accept, state] }));
  };

  return (
    <LabShell icon={Sigma} title="Theory of Computation" description="DFA simulator — define states, transitions and accept states, then test if a string is accepted.">
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 text-xs font-semibold">Transition Table</div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  <th className="px-3 py-1.5 text-left text-[10px] text-muted-foreground">State</th>
                  {dfa.alphabet.map((s) => <th key={s} className="px-3 py-1.5 text-center text-[10px] text-muted-foreground">{s}</th>)}
                  <th className="px-3 py-1.5 text-center text-[10px] text-muted-foreground">Accept</th>
                </tr></thead>
                <tbody>
                  {dfa.states.map((st) => (
                    <tr key={st} className="border-b border-border/50">
                      <td className="px-3 py-1.5">
                        <span className={`font-mono-j font-bold ${st === dfa.start ? 'text-cyan-j' : ''}`}>{st}</span>
                        {st === dfa.start && <span className="ml-1 text-[9px] text-cyan-j">start</span>}
                      </td>
                      {dfa.alphabet.map((sym) => (
                        <td key={sym} className="px-1 py-1.5">
                          <select value={dfa.transitions[st]?.[sym] || ''} onChange={(e) => setTransition(st, sym, e.target.value)}
                            className="w-full rounded border border-border bg-background px-1 py-0.5 font-mono-j text-[11px] text-center">
                            <option value="">—</option>
                            {dfa.states.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => toggleAccept(st)} aria-label={`Make ${st} an accepting state, or stop it being one`} title="Accepting state" aria-pressed={dfa.accept.includes(st)} className={`rounded p-1 ${dfa.accept.includes(st) ? 'bg-emerald-500/20 text-emerald-400' : 'text-muted-foreground hover:text-foreground'}`}>
                          {dfa.accept.includes(st) ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {trace.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 text-xs font-semibold">Execution Trace</div>
              <div className="flex flex-wrap items-center gap-1 font-mono-j text-xs">
                {trace.map((step, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground">{step.sym} →</span>}
                    <span className={`rounded px-1.5 py-0.5 ${step.error ? 'bg-red-500/15 text-red-400' : dfa.accept.includes(step.state) ? 'bg-emerald-500/15 text-emerald-400' : 'bg-cyan-j/10 text-cyan-j'}`}>{step.state}</span>
                  </span>
                ))}
              </div>
              {trace.some((t) => t.error) && <div className="mt-2 text-xs text-red-400">{trace.find((t) => t.error).error}</div>}
              <div className={`mt-3 flex items-center gap-2 text-sm font-bold ${accepted ? 'text-emerald-400' : 'text-red-400'}`}>
                {accepted ? <><Check className="size-4" /> ACCEPTED</> : <><X className="size-4" /> REJECTED</>}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 text-xs font-semibold">Test String</div>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. 010"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono-j text-sm focus:border-cyan-j focus:outline-none" />
            <button onClick={test} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background hover:bg-cyan-j/90"><Play className="size-3.5" /> Test</button>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 text-xs font-semibold">Alphabet</div>
            <div className="flex flex-wrap items-center gap-1">
              {dfa.alphabet.map((s) => <span key={s} className="rounded bg-cyan-j/10 px-2 py-0.5 font-mono-j text-xs text-cyan-j">{s}</span>)}
            </div>
            <div className="mt-2 flex gap-1">
              <input value={newSym} onChange={(e) => setNewSym(e.target.value)} placeholder="add symbol" onKeyDown={(e) => e.key === 'Enter' && addSymbol()}
                className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono-j text-xs" />
              <button onClick={addSymbol} aria-label="Add a symbol to the alphabet" title="Add a symbol" className="rounded bg-cyan-j/10 px-2 py-1 text-cyan-j hover:bg-cyan-j/20"><Plus className="size-3.5" /></button>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-xs">
            <div className="font-semibold">Example: "contains 00"</div>
            <p className="mt-1 text-muted-foreground">This DFA accepts strings over {'{0,1}'} that contain "00" as a substring. Try: 010 (reject), 1001 (accept), 001 (accept).</p>
          </div>
        </div>
      </div>
    </LabShell>
  );
}