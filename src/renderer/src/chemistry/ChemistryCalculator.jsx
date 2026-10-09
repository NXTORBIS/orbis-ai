import { useState } from 'react';
import { molarMass } from './lib/chemistry.js';
import { renderFormula } from './lib/formulaRender.jsx';
import PageTitle from './ui/PageTitle.jsx';

const TABS = ['Molar Mass','Moles','Molarity','pH','Gas Law','Dilution','% Composition'];
const inputCls = 'w-full rounded-lg border border-border bg-card/70 px-3 py-2 text-sm outline-none focus:border-cyan-j/60';

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs text-muted-foreground">{label}</span>{children}</label>;
}

function Result({ children }) {
  return <div className="mt-5 rounded-xl border border-cyan-j/30 bg-cyan-j/10 px-4 py-3 text-lg font-semibold text-cyan-j">{children}</div>;
}

export default function ChemistryCalculator() {
  const [tab, setTab] = useState('Molar Mass');

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageTitle title="CHEMISTRY CALCULATOR" subtitle="Volume 6 · Molar mass, moles, molarity, pH, gas laws, dilution" />
      <div className="scrollbar-thin mb-5 flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition ${tab === t ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/60 bg-card/50'}`}>{t}</button>
        ))}
      </div>
      <div className="glass glass-border rounded-2xl p-6">
        {tab === 'Molar Mass' && <MolarMassCalc />}
        {tab === 'Moles' && <MolesCalc />}
        {tab === 'Molarity' && <MolarityCalc />}
        {tab === 'pH' && <PHCalc />}
        {tab === 'Gas Law' && <GasCalc />}
        {tab === 'Dilution' && <DilutionCalc />}
        {tab === '% Composition' && <CompCalc />}
      </div>
    </div>
  );
}

function MolarMassCalc() {
  const [f, setF] = useState('H2SO4');
  const { mass } = molarMass(f);
  return (
    <div>
      <Field label="Chemical formula"><input className={inputCls} value={f} onChange={(e) => setF(e.target.value)} /></Field>
      <Result>{mass ? `${mass.toFixed(3)} g/mol` : 'Invalid formula'} — {renderFormula(f)}</Result>
    </div>
  );
}

function MolesCalc() {
  const [f, setF] = useState('NaCl');
  const [mass, setMass] = useState('58.5');
  const { mass: mm } = molarMass(f);
  const m = parseFloat(mass);
  const moles = mm && m ? m / mm : 0;
  return (
    <div className="space-y-3">
      <Field label="Formula"><input className={inputCls} value={f} onChange={(e) => setF(e.target.value)} /></Field>
      <Field label="Mass (g)"><input className={inputCls} type="number" value={mass} onChange={(e) => setMass(e.target.value)} /></Field>
      <div className="text-xs text-muted-foreground">Molar mass: {mm ? mm.toFixed(3) : '—'} g/mol</div>
      <Result>{moles ? `${moles.toFixed(4)} mol` : 'Enter valid values'}</Result>
    </div>
  );
}

function MolarityCalc() {
  const [moles, setMoles] = useState('1');
  const [vol, setVol] = useState('1000');
  const m = parseFloat(moles), v = parseFloat(vol);
  const M = m && v ? m / (v / 1000) : 0;
  return (
    <div className="space-y-3">
      <Field label="Moles of solute"><input className={inputCls} type="number" value={moles} onChange={(e) => setMoles(e.target.value)} /></Field>
      <Field label="Volume of solution (mL)"><input className={inputCls} type="number" value={vol} onChange={(e) => setVol(e.target.value)} /></Field>
      <Result>{M ? `${M.toFixed(4)} M` : 'Enter valid values'}</Result>
    </div>
  );
}

function PHCalc() {
  const [h, setH] = useState('0.001');
  const conc = parseFloat(h);
  const ph = conc > 0 ? -Math.log10(conc) : 0;
  return (
    <div className="space-y-3">
      <Field label="[H⁺] concentration (mol/L)"><input className={inputCls} type="number" value={h} onChange={(e) => setH(e.target.value)} /></Field>
      <Result>pH = {conc > 0 ? ph.toFixed(3) : '—'} {ph < 7 ? '(acidic)' : ph > 7 ? '(basic)' : '(neutral)'}</Result>
    </div>
  );
}

function GasCalc() {
  const [p, setP] = useState('1');
  const [v, setV] = useState('22.4');
  const [t, setT] = useState('273');
  const P = parseFloat(p), V = parseFloat(v), T = parseFloat(t);
  const n = P && V && T ? (P * V) / (0.0821 * T) : 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="P (atm)"><input className={inputCls} type="number" value={p} onChange={(e) => setP(e.target.value)} /></Field>
        <Field label="V (L)"><input className={inputCls} type="number" value={v} onChange={(e) => setV(e.target.value)} /></Field>
        <Field label="T (K)"><input className={inputCls} type="number" value={t} onChange={(e) => setT(e.target.value)} /></Field>
      </div>
      <div className="text-xs text-muted-foreground">PV = nRT, R = 0.0821 L·atm/(mol·K)</div>
      <Result>n = {n ? n.toFixed(4) + ' mol' : 'Enter values'}</Result>
    </div>
  );
}

function DilutionCalc() {
  const [m1, setM1] = useState('2');
  const [v1, setV1] = useState('100');
  const [m2, setM2] = useState('0.5');
  const M1 = parseFloat(m1), V1 = parseFloat(v1), M2 = parseFloat(m2);
  const V2 = M1 && V1 && M2 ? (M1 * V1) / M2 : 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="M₁ (initial)"><input className={inputCls} type="number" value={m1} onChange={(e) => setM1(e.target.value)} /></Field>
        <Field label="V₁ (mL)"><input className={inputCls} type="number" value={v1} onChange={(e) => setV1(e.target.value)} /></Field>
        <Field label="M₂ (final)"><input className={inputCls} type="number" value={m2} onChange={(e) => setM2(e.target.value)} /></Field>
      </div>
      <div className="text-xs text-muted-foreground">M₁V₁ = M₂V₂</div>
      <Result>V₂ = {V2 ? V2.toFixed(2) + ' mL' : 'Enter values'}</Result>
    </div>
  );
}

function CompCalc() {
  const [f, setF] = useState('H2O');
  const { mass, breakdown } = molarMass(f);
  return (
    <div>
      <Field label="Formula"><input className={inputCls} value={f} onChange={(e) => setF(e.target.value)} /></Field>
      {mass ? (
        <div className="mt-4 space-y-2">
          {breakdown.map((b) => (
            <div key={b.symbol} className="flex justify-between text-sm">
              <span className="font-medium">{b.symbol}</span>
              <span>{((b.contribution / mass) * 100).toFixed(2)}%</span>
            </div>
          ))}
        </div>
      ) : <p className="mt-4 text-sm text-muted-foreground">Invalid formula</p>}
    </div>
  );
}