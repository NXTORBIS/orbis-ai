import React, { useState, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from './ui/router.jsx';
import PageTitle from './ui/PageTitle.jsx';
import { getCode } from './lib/qec/codes.js';
import { getDecoder } from './lib/qec/decoders.js';

import CodeSelector from './qec/CodeSelector.jsx';
import CodeInfoPanel from './qec/CodeInfoPanel.jsx';
import StateSetup from './qec/StateSetup.jsx';
import NoisePanel from './qec/NoisePanel.jsx';
import SyndromeTable from './qec/SyndromeTable.jsx';
import SingleTrialPanel from './qec/SingleTrialPanel.jsx';
import MonteCarloPanel from './qec/MonteCarloPanel.jsx';
import ThresholdPanel from './qec/ThresholdPanel.jsx';
import CircuitView from './qec/CircuitView.jsx';
import MathPanel from './qec/MathPanel.jsx';
import ComparisonPanel from './qec/ComparisonPanel.jsx';
import ResultsDashboard from './qec/ResultsDashboard.jsx';
import AIExplanation from './qec/AIExplanation.jsx';
import ExportPanel from './qec/ExportPanel.jsx';

export default function QECLab() {
  const [codeId, setCodeId] = useState('steane');
  const [logicalState, setLogicalState] = useState({ preset: '0', a: '1', b: '0', normalized: true });
  const [model, setModel] = useState({ type: 'depolarizing', p: 0.01, pX: 0.01, pY: 0.01, pZ: 0.01 });
  const [fault, setFault] = useState({ faulty: false, pMeas: 0.01, uniform: false });
  const [seed, setSeed] = useState(12345);
  const [mcResults, setMcResults] = useState(null);
  const [threshold, setThreshold] = useState(null);

  const code = useMemo(() => getCode(codeId), [codeId]);
  const lookup = useMemo(() => getDecoder(code, 'lookup'), [code]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Link to="/studios/physics" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Physics Studio · Quantum Mechanics · Quantum Information
      </Link>
      <PageTitle title="Quantum Error Correction Lab" subtitle="Stabilizer codes · real syndrome extraction, decoding & fault-tolerant Monte Carlo — no AI in the engine" />

      <div className="mt-4 space-y-4">
        <CodeSelector value={codeId} onChange={setCodeId} />
        <div className="grid gap-4 lg:grid-cols-2">
          <CodeInfoPanel code={code} />
          <StateSetup value={logicalState} onChange={setLogicalState} />
        </div>
        <NoisePanel model={model} onChange={setModel} fault={fault} onFaultChange={setFault} />
        <div className="grid gap-4 lg:grid-cols-2">
          <CircuitView code={code} />
          <SyndromeTable code={code} lookup={lookup} />
        </div>
        <SingleTrialPanel code={code} model={model} fault={fault} seed={seed} onSeed={setSeed} />
        <MonteCarloPanel code={code} model={model} fault={fault} seed={seed} onSeed={setSeed} onResults={setMcResults} />
        <ThresholdPanel code={code} model={model} fault={fault} seed={seed} onSeed={setSeed} onThreshold={setThreshold} />
        <ResultsDashboard code={code} model={model} fault={fault} seed={seed} results={mcResults} threshold={threshold} />
        <ComparisonPanel model={model} fault={fault} seed={seed} />
        <AIExplanation code={code} model={model} fault={fault} results={mcResults} threshold={threshold} />
        <ExportPanel code={code} model={model} fault={fault} seed={seed} results={mcResults} threshold={threshold} />
        <MathPanel />
      </div>

      <p className="mt-6 text-center text-[10px] text-muted-foreground">
        Every numerical value is computed by a deterministic stabilizer engine (binary symplectic Pauli algebra, GF(2) syndrome decoding). No fabricated data, no AI in the computation. The AI Explanation button only interprets already-calculated results.
      </p>
    </div>
  );
}