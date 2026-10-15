import { useState } from 'react';
import { AlertTriangle, KeyRound, Loader, ShieldCheck } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Input } from '@jarvis/components/ui/input';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Area, Field, Panel, Stat } from './shared';

async function sha1Hex(text) {
  const buffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function mask(password) {
  if (password.length <= 3) return '•'.repeat(password.length);
  return password.slice(0, 2) + '•'.repeat(Math.max(3, password.length - 3)) + password.slice(-1);
}

function verdict(count) {
  if (count === 0) {
    return {
      tone: 'emerald',
      label: 'Not found in the breach corpus',
      advice: 'This exact password does not appear in the corpus. That is not a promise of safety — it only means it has not surfaced in a known breach. Length and uniqueness still do the real work.',
    };
  }
  if (count <= 10) {
    return {
      tone: 'amber',
      label: 'Seen ' + count + ' times in breaches',
      advice: 'Rare, but it has leaked at least once. Any password that appears in breach data has to be treated as public, whatever it was protecting.',
    };
  }
  if (count < 10000) {
    return {
      tone: 'amber',
      label: 'Seen ' + count.toLocaleString() + ' times in breaches',
      advice: 'Well represented in breach data, so it sits high up in the cracking dictionaries. Change it anywhere it is still in use.',
    };
  }
  return {
    tone: 'rose',
    label: 'Seen ' + count.toLocaleString() + ' times in breaches',
    advice: 'Extremely common. Credential-stuffing tools try passwords like this first, in the first milliseconds of an attack.',
  };
}

const REPORT_HEAD = 'Password breach check — Have I Been Pwned range API (k-anonymity)';

export default function PasswordBreachCheck() {
  const [single, setSingle] = useState('');
  const [list, setList] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (passwords, keep) => {
    const unique = Array.from(new Set(passwords.filter((value) => String(value).length)));
    if (!unique.length) return;
    setBusy(true);
    setError('');
    try {
      const hashed = [];
      for (const password of unique) hashed.push({ password, hash: await sha1Hex(password) });
      const prefixes = Array.from(new Set(hashed.map((item) => item.hash.slice(0, 5))));
      const buckets = {};
      await Promise.all(prefixes.map(async (prefix) => {
        const response = await fetch('https://api.pwnedpasswords.com/range/' + prefix);
        if (!response.ok) throw new Error('The breach database could not be reached. Check the connection and try again.');
        buckets[prefix] = await response.text();
      }));
      const found = hashed.map((item) => {
        const suffix = item.hash.slice(5);
        const row = (buckets[item.hash.slice(0, 5)] || '').split('\n').find((line) => line.split(':')[0].trim() === suffix);
        return { key: item.hash.slice(0, 8) + item.password.length, preview: mask(item.password), count: row ? Number(row.split(':')[1]) : 0 };
      });
      setResults(keep ? [...found, ...results] : [...results, ...found]);
    } catch (err) {
      setError(err.message || 'The check could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const worst = results.reduce((max, row) => Math.max(max, row.count), 0);
  const breached = results.filter((row) => row.count > 0).length;
  const report = [
    REPORT_HEAD,
    '',
    'Checked ' + results.length + ' password' + (results.length === 1 ? '' : 's') + '. ' + breached + ' found in breach data.',
    '',
    ...results.map((row) => row.preview.padEnd(18) + (row.count ? row.count.toLocaleString() + ' appearances — change it' : 'not found')),
    '',
    'Only the first five characters of each SHA-1 hash left this device. The password itself was never sent.',
  ].join('\n');

  return (
    <ToolShell
      toolId="password-breach"
      icon={KeyRound}
      title="Password Breach Check"
      desc="Find out whether a password has already appeared in a known data breach. The password never leaves your device — only the first five characters of its hash are sent, which is the same privacy model Have I Been Pwned was designed around."
      state={{ single, list }}
      onRestore={(restored) => {
        if (typeof restored.single === 'string') setSingle(restored.single);
        if (typeof restored.list === 'string') setList(restored.list);
      }}
      exportText={report}
      exportName="password-breach-check.txt"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <Field label="Check one password" hint="Nothing is sent except an anonymous hash prefix.">
            <div className="flex gap-2">
              <Input
                type="password"
                value={single}
                autoComplete="off"
                onChange={(event) => setSingle(event.target.value)}
                placeholder="Type the password to test"
                onKeyDown={(event) => { if (event.key === 'Enter') run([single], false); }}
              />
              <Button type="button" onClick={() => run([single], false)} disabled={busy || !single}>
                {busy ? <Loader className="h-4 w-4 animate-spin" /> : 'Check'}
              </Button>
            </div>
          </Field>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Safe practice, in order: check it here, then change it everywhere it is reused. A password that has appeared in a breach is public forever.
          </p>
        </Panel>

        <Panel className="!p-3">
          <Field label="Or check a list" hint="One password per line. Each is hashed locally; matching happens against the returned hash suffixes.">
            <Area value={list} onChange={setList} rows={4} mono placeholder={'one per line\nold-work-password\nsomething-you-reuse'} />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => run(list.split('\n').map((line) => line.trim()), false)}
              disabled={busy || !list.trim()}
            >
              {busy ? <Loader className="h-4 w-4 animate-spin" /> : 'Check the list'}
            </Button>
            {results.length > 0 && (
              <Button type="button" variant="outline" onClick={() => setResults([])}>Clear results</Button>
            )}
          </div>
        </Panel>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
            <Hero
              tone={worst === 0 ? 'emerald' : worst < 10000 ? 'amber' : 'rose'}
              label={worst === 0 ? 'Clean so far' : 'Most appearances for one password'}
              value={worst.toLocaleString()}
              unit="records"
              sub={results.length + ' checked · ' + breached + ' found in breach data'}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Checked" value={String(results.length)} mono sub="unique passwords" />
              <Stat label="In breaches" value={String(breached)} mono sub={breached ? 'change these' : 'none found'} />
              <Stat label="Clean" value={String(results.length - breached)} mono sub="no known appearances" />
              <Stat label="Worst offence" value={worst ? 'critical' : 'none'} mono sub={worst ? 'top of cracking lists' : 'keep it unique'} />
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Results, worst first</div>
            <div className="space-y-1.5">
              {[...results].sort((a, b) => b.count - a.count).map((row) => {
                const card = verdict(row.count);
                return (
                  <div key={row.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
                    <span className="font-mono-j text-xs">{row.preview}</span>
                    <span className={card.tone === 'rose' ? 'font-mono-j text-xs text-rose-400' : card.tone === 'amber' ? 'font-mono-j text-xs text-amber-400' : 'font-mono-j text-xs text-emerald-400'}>
                      {card.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3">
              <Pills
                items={[
                  { label: 'Checked', value: String(results.length) },
                  { label: 'Breached', value: String(breached), tone: breached ? 'rose' : undefined },
                  { label: 'Method', value: 'k-anonymity' },
                ]}
              />
            </div>
          </Panel>
        </>
      )}

      <Panel className="!p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium">
          <ShieldCheck className="h-3.5 w-3.5 text-cyan-j" /> How this stays private
        </div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· The password is hashed with SHA-1 in your browser, using the Web Crypto API. The password itself is never transmitted, never stored and never logged.</p>
          <p>· Only the first five hex characters of that hash are sent — about 800 possible hashes share them, so any single request covers hundreds of unrelated passwords.</p>
          <p>· The service returns every hash suffix in that range, and the comparison happens here. The server learns a five-character prefix and nothing about what you typed.</p>
          <p>· This is the k-anonymity model published by Have I Been Pwned. The corpus is roughly a billion leaked credentials from thousands of breaches.</p>
          <p>· Nothing is saved. Closing the tab clears everything, and the shared-link state for this tool carries only what you typed, so do not save a preset containing a real password.</p>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What to do with a hit</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Change it wherever it is still in use, starting with email and anything financial — email is the reset path for everything else.</p>
            <p>· Change the same password on every other site too. Reuse is what turns one leaked password into twenty compromised accounts.</p>
            <p>· Turn on two-factor authentication. It defeats credential stuffing even when the password is already public.</p>
            <p>· Check sessions and connected apps on the affected account. A breach often means someone has been inside already, not that they might get in.</p>
            <p>· A password can be strong and still be breached. Strength protects against guessing; only uniqueness protects against leakage.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading the numbers honestly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The count is how many times that exact password appears in the corpus — not how many accounts were breached.</p>
            <p>· Anything above a few hundred appearances is effectively in every cracking wordlist with a high priority.</p>
            <p>· A zero result does not mean the password is good. A short or predictable password can be absent from breaches and still fall in seconds.</p>
            <p>· Absence from this corpus also means absence from the breaches that have been collected and published. Plenty of breaches are never disclosed.</p>
            <p>· Re-running the check after a few months is worth doing — new breaches are added continuously.</p>
          </div>
        </Panel>
      </div>
    </ToolShell>
  );
}