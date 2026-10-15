import { useMemo, useState } from 'react';
import { Divide } from 'lucide-react';
import { ToolHeader, Field, Stat, Panel, CopyBtn } from './shared';

const isPrime = (n) => {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
};

function factorize(n) {
  const factors = [];
  let rest = n;
  for (let p = 2; p * p <= rest; p = p === 2 ? 3 : p + 2) {
    let power = 0;
    while (rest % p === 0) { rest /= p; power++; }
    if (power) factors.push([p, power]);
  }
  if (rest > 1) factors.push([rest, 1]);
  return factors;
}

export default function PrimeFactorizer() {
  const [input, setInput] = useState('3600');

  const n = Math.floor(Math.abs(Number(input)));
  const data = useMemo(() => {
    if (!Number.isFinite(n) || n < 1 || n > 1e12) return null;
    const factors = n === 1 ? [] : factorize(n);
    const divisorCount = factors.reduce((acc, [, p]) => acc * (p + 1), 1);
    const divisorSum = factors.reduce((acc, [prime, power]) => acc * ((prime ** (power + 1) - 1) / (prime - 1)), 1);
    const pairs = [];
    for (let i = 1; i * i <= n && pairs.length < 24; i++) if (n % i === 0) { pairs.push([i, n / i]); }
    const nextPrimes = [];
    for (let candidate = n + 1; nextPrimes.length < 5 && candidate < n + 5000; candidate++) if (isPrime(candidate)) nextPrimes.push(candidate);
    return { factors, divisorCount, divisorSum, pairs, nextPrimes, prime: isPrime(n), digits: String(n).length };
  }, [n]);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Divide} title="Prime Factorizer" desc="Break a number into primes, then count and list its divisors." />
      <Field label="Whole number" hint="Up to 1,000,000,000,000">
        <input value={input} onChange={(e) => setInput(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>
      {data ? (
        <>
          <Panel>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Prime factorisation</span>
              <CopyBtn value={data.factors.map(([p, e]) => (e > 1 ? `${p}^${e}` : `${p}`)).join(' × ') || '1'} label="Copy factors" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data.factors.length === 0 && <span className="font-display text-xl text-cyan-j">1</span>}
              {data.factors.map(([prime, power], i) => (
                <span key={prime} className="flex items-center gap-2">
                  <span className="rounded-lg border border-cyan-j/30 bg-cyan-j/10 px-2.5 py-1 font-display text-base text-cyan-j">
                    {prime}{power > 1 && <sup className="text-[10px]">{power}</sup>}
                  </span>
                  {i < data.factors.length - 1 && <span className="text-muted-foreground">×</span>}
                </span>
              ))}
              <span className="ml-1 text-sm text-muted-foreground">= {n.toLocaleString()}</span>
            </div>
          </Panel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Prime?" value={data.prime ? 'Yes — it is prime' : 'No — composite'} />
            <Stat label="Distinct primes" value={String(data.factors.length)} />
            <Stat label="Divisor count" value={String(data.divisorCount)} />
            <Stat label="Sum of divisors" value={data.divisorSum.toLocaleString()} />
            <Stat label="Largest prime factor" value={data.factors.length ? String(data.factors[data.factors.length - 1][0]) : '—'} />
            <Stat label="Digits" value={String(data.digits)} />
            <Stat label="Square root" value={Math.sqrt(n).toFixed(4)} />
            <Stat label="Perfect square?" value={Number.isInteger(Math.sqrt(n)) ? 'Yes' : 'No'} />
          </div>
          <Panel>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Factor pairs {data.pairs.length >= 24 && '(first 24)'}</div>
            <div className="flex flex-wrap gap-1.5">
              {data.pairs.map(([a, b]) => (
                <span key={a} className="rounded-md bg-secondary px-2 py-1 font-mono-j text-xs">{a} × {b}</span>
              ))}
            </div>
          </Panel>
          <Stat label="Next five primes" value={data.nextPrimes.join(', ')} mono />
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Enter a whole number between 1 and 1,000,000,000,000.</div>
      )}
    </div>
  );
}