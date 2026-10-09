import React, { useState } from 'react';
import { ShieldCheck, Lock, Key, Hash, Eye, EyeOff, Copy, Check } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// Cybersecurity lab: hashing (Web Crypto), encoding (base64, hex), ciphers (Caesar, XOR, ROT13), password strength.
export default function CybersecurityLab() {
  const [tab, setTab] = useState('hash');
  const [input, setInput] = useState('Hello, World!');
  const [output, setOutput] = useState('');
  const [shift, setShift] = useState(3);
  const [xorKey, setXorKey] = useState('key');
  const [copied, setCopied] = useState(false);

  const compute = async () => {
    let res = '';
    if (tab === 'hash') {
      const enc = new TextEncoder().encode(input);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      res = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } else if (tab === 'base64') {
      res = btoa(String.fromCharCode(...new TextEncoder().encode(input)));
    } else if (tab === 'hex') {
      res = [...new TextEncoder().encode(input)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    } else if (tab === 'caesar') {
      res = input.replace(/[a-z]/gi, (c) => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + shift + 26) % 26) + base);
      });
    } else if (tab === 'rot13') {
      res = input.replace(/[a-z]/gi, (c) => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      });
    } else if (tab === 'xor') {
      const bytes = [...new TextEncoder().encode(input)];
      const keyBytes = [...new TextEncoder().encode(xorKey)];
      res = bytes.map((b, i) => (b ^ keyBytes[i % keyBytes.length]).toString(16).padStart(2, '0')).join(' ');
    }
    setOutput(res);
  };

  const decode = () => {
    try {
      if (tab === 'base64') setOutput(new TextDecoder().decode(new Uint8Array(atob(input).split('').map((c) => c.charCodeAt(0)))));
      else if (tab === 'hex') setOutput(new TextDecoder().decode(new Uint8Array(input.trim().split(/\s+/).map((h) => parseInt(h, 16)))));
      else if (tab === 'caesar') setOutput(input.replace(/[a-z]/gi, (c) => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base - shift + 26) % 26) + base);
      }));
      else if (tab === 'rot13') setOutput(input.replace(/[a-z]/gi, (c) => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      }));
      else if (tab === 'xor') {
        const bytes = input.trim().split(/\s+/).map((h) => parseInt(h, 16));
        const keyBytes = [...new TextEncoder().encode(xorKey)];
        setOutput(new TextDecoder().decode(new Uint8Array(bytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]))));
      }
    } catch (e) { setOutput('Error: ' + e.message); }
  };

  const copy = () => { navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  const TABS = [
    { id: 'hash', label: 'SHA-256', icon: Hash, encodeOnly: true },
    { id: 'base64', label: 'Base64', icon: Key },
    { id: 'hex', label: 'Hex', icon: Key },
    { id: 'caesar', label: 'Caesar', icon: Lock },
    { id: 'rot13', label: 'ROT13', icon: Lock },
    { id: 'xor', label: 'XOR', icon: Lock },
  ];
  const current = TABS.find((t) => t.id === tab);

  return (
    <LabShell icon={ShieldCheck} title="Cybersecurity" description="Hashing, encoding and cipher tools — SHA-256, Base64, Caesar, ROT13 and XOR encryption.">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => { setTab(t.id); setOutput(''); }}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${tab === t.id ? 'bg-cyan-j text-background' : 'border border-border text-muted-foreground hover:border-cyan-j/40'}`}>
                <t.icon className="size-3.5" /> {t.label}
              </button>
            ))}
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground">INPUT</label>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false}
              className="mt-1 h-40 w-full resize-none rounded-lg border border-border bg-card p-3 font-mono-j text-xs scrollbar-thin" />
          </div>
          {tab === 'caesar' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Shift:</span>
              <input type="range" min="1" max="25" value={shift} onChange={(e) => setShift(+e.target.value)} className="flex-1" />
              <span className="font-mono-j font-bold text-cyan-j">{shift}</span>
            </div>
          )}
          {tab === 'xor' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Key:</span>
              <input value={xorKey} onChange={(e) => setXorKey(e.target.value)} className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono-j text-xs" />
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={compute} className="flex items-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background hover:bg-cyan-j/90">
              {tab === 'hash' ? 'Hash' : 'Encode'}
            </button>
            {!current?.encodeOnly && <button onClick={decode} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-cyan-j/40">Decode</button>}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-3 flex-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground">OUTPUT</span>
              {output && <button onClick={copy} className="flex items-center gap-1 text-[10px] text-cyan-j hover:opacity-80">{copied ? <><Check className="size-3" /> Copied</> : <><Copy className="size-3" /> Copy</>}</button>}
            </div>
            <pre className="min-h-32 whitespace-pre-wrap break-all font-mono-j text-xs text-foreground/90">{output || 'Output appears here.'}</pre>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-xs">
            <div className="font-semibold">Password Strength</div>
            <PasswordStrength />
          </div>
        </div>
      </div>
    </LabShell>
  );
}

function PasswordStrength() {
  const [pw, setPw] = useState('P@ssw0rd123!');
  const [show, setShow] = useState(true);
  const score = (() => {
    let s = 0;
    if (pw.length >= 8) s++; if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw)) s++; if (/[A-Z]/.test(pw)) s++; if (/[0-9]/.test(pw)) s++; if (/[^a-zA-Z0-9]/.test(pw)) s++;
    return Math.min(s, 6);
  })();
  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong', 'Excellent'];
  const colors = ['bg-red-500', 'bg-red-500', 'bg-amber-500', 'bg-yellow-500', 'bg-lime-500', 'bg-emerald-500', 'bg-emerald-500'];
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)}
          className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono-j text-xs" />
        <button onClick={() => setShow(!show)} aria-label={show ? 'Hide it' : 'Show it'} title={show ? 'Hide it' : 'Show it'} aria-pressed={show} className="text-muted-foreground hover:text-foreground">{show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
      </div>
      <div className="mt-2 flex gap-1">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className={`h-1.5 flex-1 rounded ${i < score ? colors[score] : 'bg-muted'}`} />)}
      </div>
      <div className="mt-1 text-[11px] font-semibold" style={{ color: `hsl(${score * 25} 70% 50%)` }}>{labels[score]} · {score * 16}%</div>
    </div>
  );
}