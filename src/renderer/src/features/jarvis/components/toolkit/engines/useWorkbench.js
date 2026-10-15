import { useEffect, useRef, useState } from 'react';
import useVizEngine from '@jarvis/components/toolkit/engines/useVizEngine';

export default function useWorkbench(kind, defaults) {
  const [state, setState] = useState(defaults), [result, setResult] = useState(null);
  const engine = useVizEngine(), started = useRef(false);
  const run = async (setup = state) => { started.current=true; setResult(null); const value = await engine.run({ ...setup, kind, action: 'analyze' }); if (value) setResult(value); };
  useEffect(() => { if(!started.current)run(defaults); return () => engine.cancel(); }, []);
  const change = setup => { setState(setup); setResult(null); if(engine.busy)engine.cancel(); };
  const restore = setup => {
    if (!setup || typeof setup !== 'object') return;
    const next = Object.fromEntries(Object.entries(defaults).map(([k,v]) => [k, typeof setup[k] === typeof v ? setup[k] : v]));
    setState(next);run(next);
  };
  return { state, setState: change, result, engine, run: () => run(state), restore, reset: () => { setState(defaults);run(defaults); } };
}