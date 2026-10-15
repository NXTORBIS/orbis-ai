import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Seg, Area, Out, Panel, CopyBtn } from './shared';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (b64) => Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));

export default function TextEncryptor() {
  const [mode, setMode] = useState('encrypt');
  const [text, setText] = useState('Secret note for myself');
  const [password, setPassword] = useState('');
  const [out, setOut] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!password) { setErr('Enter a passphrase first'); return; }
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'encrypt') {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt);
        const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
        const payload = new Uint8Array(salt.length + iv.length + cipher.length);
        payload.set(salt, 0);
        payload.set(iv, salt.length);
        payload.set(cipher, salt.length + iv.length);
        setOut(toB64(payload));
      } else {
        const payload = fromB64(text);
        const salt = payload.slice(0, 16);
        const iv = payload.slice(16, 28);
        const cipher = payload.slice(28);
        const key = await deriveKey(password, salt);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
        setOut(dec.decode(plain));
      }
    } catch (e) {
      setOut('');
      setErr(mode === 'decrypt' ? 'Could not decrypt — wrong passphrase or damaged ciphertext' : 'Encryption failed in this browser');
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Lock} title="Text Encryptor" desc="Password-protected AES-256-GCM encryption using Web Crypto — nothing leaves your device." />
      <Seg value={mode} onChange={(v) => { setMode(v); setOut(''); setErr(null); }} options={[{ value: 'encrypt', label: 'Encrypt' }, { value: 'decrypt', label: 'Decrypt' }]} />
      <Field label={mode === 'encrypt' ? 'Plain text' : 'Ciphertext (Base64)'}>
        <Area value={text} onChange={setText} rows={5} mono placeholder={mode === 'encrypt' ? 'Type the text to protect…' : 'Paste the encrypted blob…'} />
      </Field>
      <Field label="Passphrase" hint="Keep it safe — without it the text cannot be recovered.">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>
      <Button size="sm" onClick={run} disabled={busy} className="gap-1.5">
        {busy ? 'Working…' : mode === 'encrypt' ? 'Encrypt text' : 'Decrypt text'}
      </Button>
      {err ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-500">{err}</div>
      ) : (
        out && (
          <Out label={mode === 'encrypt' ? 'Ciphertext (Base64)' : 'Recovered text'} value={out}>
            <span className="break-all whitespace-pre-wrap font-mono-j text-xs">{out}</span>
          </Out>
        )
      )}
      <Panel>
        <div className="text-xs text-muted-foreground">
          Format: 16-byte random salt + 12-byte IV + ciphertext, Base64 encoded. PBKDF2-SHA256 with 150,000 iterations protects the key.
        </div>
      </Panel>
      <CopyBtn value={out} label="Copy result" />
    </div>
  );
}