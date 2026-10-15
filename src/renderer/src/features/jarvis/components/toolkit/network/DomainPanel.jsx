import { useState } from 'react';
import { Award, Search } from 'lucide-react';
import { Pills } from '../kit/premium';
import { base44 } from '@jarvis/api/base44Client';
import { Field, Panel, Stat } from '../shared';
import { hostOf } from './netUtils';

const days = (from, to) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
const dateOnly = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '—');

export default function DomainPanel({ target, onReport }) {
  const [domain, setDomain] = useState(hostOf(target) || 'example.com');
  const [reg, setReg] = useState(null);
  const [certs, setCerts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lookup = async () => {
    const value = hostOf(domain);
    if (!value) return;
    setLoading(true);
    setError('');
    setReg(null);
    setCerts(null);
    try {
      const [registration, certificates] = await Promise.all([
        base44.functions.invoke('netCheck', { action: 'rdap', domain: value }),
        base44.functions.invoke('netCheck', { action: 'cert', domain: value }),
      ]);
      const r = registration.data;
      const c = certificates.data;
      setReg(r);
      setCerts(c);
      if (r?.error || c?.error) setError(r?.error || c?.error);
      if (r && !r.error) {
        const age = r.created ? Math.round(-days(new Date().toISOString(), r.created) / 365.25 * 10) / 10 : null;
        onReport?.(
          `${r.domain}\nRegistrar ${r.registrar || 'not published'} · created ${dateOnly(r.created)} · expires ${dateOnly(r.expires)}\nAge ${age ?? '—'} years · status ${(r.status || []).join(', ') || '—'}\nName servers ${(r.nameservers || []).join(', ') || '—'}\nCertificates on record ${c?.count ?? '—'}${c?.certificates?.[0] ? ` · latest valid to ${dateOnly(c.certificates[0].notAfter)}` : ''}`,
        );
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const ageYears = reg?.created ? Math.round((-days(new Date().toISOString(), reg.created) / 365.25) * 10) / 10 : null;
  const expiresIn = reg?.expires ? days(new Date().toISOString(), reg.expires) : null;
  const latest = certs?.certificates?.[0];

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Domain">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && lookup()}
            spellCheck={false}
            className="h-9 w-64 rounded-md border border-input bg-transparent px-3 font-mono-j text-xs"
          />
        </Field>
        <button
          type="button"
          onClick={lookup}
          disabled={loading || !domain.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          <Search className="h-3.5 w-3.5" /> {loading ? 'Asking the registry…' : 'Check domain & certificate'}
        </button>
      </div>

      {error && <Panel className="border-amber-500/30 text-[11px] text-amber-500">{error}</Panel>}

      {reg && !reg.error && (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Registrar" value={reg.registrar || 'not published'} />
            <Stat label="Registered" value={dateOnly(reg.created)} mono />
            <Stat label="Domain age" value={ageYears != null ? `${ageYears} years` : '—'} mono />
            <Stat
              label="Renewal due"
              value={dateOnly(reg.expires)}
              sub={expiresIn != null ? `in ${expiresIn} days` : ''}
              mono
            />
          </div>
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Registry record</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Name servers</div>
                <div className="mt-1 space-y-0.5 font-mono-j text-[10px]">
                  {(reg.nameservers || []).length ? reg.nameservers.map((n) => <div key={n}>{n}</div>) : <span className="text-muted-foreground">not published</span>}
                </div>
              </div>
              <div className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status codes</div>
                <div className="mt-1">
                  <Pills items={(reg.status || []).slice(0, 6).map((s) => ({ label: s, tone: /hold|pending|delete/i.test(s) ? 'rose' : undefined }))} />
                  {!reg.status?.length && <span className="text-[11px] text-muted-foreground">not published</span>}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              A domain younger than a few months, registered with a privacy proxy and already holding a payment page, is a pattern worth pausing
              over.
            </p>
          </Panel>
        </>
      )}

      {certs && !certs.error && (
        <Panel className="!p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium">
            <Award className="h-3.5 w-3.5 text-cyan-j" /> Certificates issued for this domain
            <span className="font-mono-j text-[10px] text-muted-foreground">{certs.count} on record</span>
          </div>
          {latest && (
            <div className="mb-2 rounded-lg border border-cyan-j/30 bg-cyan-j/5 px-2.5 py-2 text-[11px]">
              Latest: <span className="font-mono-j text-cyan-j">{latest.issuer || 'unknown issuer'}</span> · valid{' '}
              <span className="font-mono-j">{dateOnly(latest.notBefore)} → {dateOnly(latest.notAfter)}</span>
              <span className={days(new Date().toISOString(), latest.notAfter) < 21 ? ' text-rose-400' : ' text-emerald-400'}>
                {' '}({days(new Date().toISOString(), latest.notAfter)} days left)
              </span>
            </div>
          )}
          <div className="max-h-64 space-y-1 overflow-auto">
            {certs.certificates.map((cert, index) => {
              const left = days(new Date().toISOString(), cert.notAfter);
              return (
                <div key={`${cert.notBefore}-${index}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px]">{cert.issuer || 'unknown issuer'}</span>
                  <span className="font-mono-j text-[10px] text-muted-foreground">{dateOnly(cert.notBefore)} → {dateOnly(cert.notAfter)}</span>
                  <span className={`font-mono-j text-[10px] ${left < 0 ? 'text-muted-foreground' : left < 21 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {left < 0 ? 'expired' : `${left}d left`}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Read from public certificate-transparency logs — the record of every certificate a CA has issued. If the newest certificate here is
            about to expire, the site is about to start failing for visitors; if the issuer is not one you recognise, that is a red flag.
          </p>
        </Panel>
      )}

      <Panel className="border-amber-500/30">
        <p className="text-[11px] text-amber-500">
          A browser cannot read a live TLS handshake, so the negotiated protocol version, cipher suite and full chain are not shown here — those
          need a direct socket. What is shown is the public record around the certificate (issuer, validity window, how many names it covers) plus,
          in the Headers tab, whether HSTS is enforced. Together that answers the questions people actually have: is it still valid, is it about to
          break, and is it configured properly.
        </p>
      </Panel>
    </>
  );
}