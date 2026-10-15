import { useEffect, useState } from 'react';
import { Field, Seg } from '@jarvis/components/toolkit/shared';

export default function WaveSweepControls({ spec, view, curve, onChange }) {
  const [drafts,setDrafts]=useState({});
  useEffect(()=>setDrafts({}),[view.variable,view.low,view.high]);
  const field=spec.fields.find(f=>f.key===view.variable);
  const updateBound=(key,raw)=>{setDrafts(previous=>({...previous,[key]:raw}));if(raw!==''&&Number.isFinite(Number(raw)))onChange({...view,[key]:Number(raw)});};
  return <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <Field label="Explore one input"><select value={view.variable} aria-label="Sweep input" onChange={e=>onChange({...view,variable:e.target.value,low:null,high:null})} className="w-full rounded-lg border border-input bg-card p-2 text-xs">{spec.fields.filter(f=>!f.options).map(f=><option value={f.key} key={f.key}>{f.label}</option>)}</select></Field>
    {['low','high'].map(key=><Field key={key} label={key==='low'?'Sweep starts at':'Sweep ends at'}><input type="number" aria-label={key==='low'?'Sweep lower bound':'Sweep upper bound'} min={field.min} max={field.max} step={field.step} value={drafts[key]??view[key]??curve[key]} onChange={e=>updateBound(key,e.target.value)} onBlur={()=>setDrafts(previous=>{const next={...previous};delete next[key];return next;})} className="w-full rounded-lg border border-input bg-card p-2 font-mono text-xs" /></Field>)}
    <div className="space-y-2"><Seg value={view.scale} onChange={scale=>onChange({...view,scale})} options={[{value:'linear',label:'Linear'},{value:'log',label:'Logarithmic'}]} /><button type="button" onClick={()=>onChange({...view,low:null,high:null,scale:'linear'})} className="block text-[11px] text-cyan-j underline underline-offset-4">Automatic range</button></div>
  </div>;
}