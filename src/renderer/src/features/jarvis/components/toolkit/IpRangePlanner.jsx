import { useMemo, useState } from 'react';
import { Network, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const toInt = (ip) => {
  const parts = String(ip).trim().split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return null;
  return ((parts[0] * 16777216) + (parts[1] * 65536) + (parts[2] * 256) + parts[3]) >>> 0;
};

const toIp = (value) => [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');

const parseCidr = (value) => {
  const text = String(value).trim();
  const [ipPart, prefixPart] = text.split('/');
  const ip = toInt(ipPart);
  if (ip === null) return null;
  const prefix = Math.max(0, Math.min(32, Number(prefixPart === undefined ? 32 : prefixPart)));
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return {
    text, ip, prefix, mask, network, broadcast,
    hostCount: prefix >= 31 ? (prefix === 32 ? 1 : 2) : Math.pow(2, 32 - prefix) - 2,
    maskIp: toIp(mask),
    wildcard: toIp(~mask >>> 0),
    first: prefix >= 31 ? network : network + 1,
    last: prefix >= 31 ? broadcast : broadcast - 1,
    private: (network >>> 24) === 10 || (network >>> 20) === 0xac1 || ((network >>> 16) & 0xfff0) === 0xc0a8,
    reserved: (network >>> 24) === 127 || (network >>> 24) === 0,
  };
};

const overlaps = (a, b) => {
  const first = a.prefix <= b.prefix ? a : b;
  const second = a.prefix <= b.prefix ? b : a;
  return (second.network & first.mask) >>> 0 === first.network;
};

const blank = () => ({ id: Math.random().toString(36).slice(2), cidr: '10.0.0.0/24' });

export default function IpRangePlanner() {
  const [mode, setMode] = useState('inspect');
  const [cidr, setCidr] = useState('10.20.0.0/20');
  const [checkIp, setCheckIp] = useState('10.20.5.14');
  const [newPrefix, setNewPrefix] = useState('24');
  const [blocks, setBlocks] = useState([
    { id: 'a', cidr: '10.0.0.0/16' },
    { id: 'b', cidr: '10.0.1.0/24' },
    { id: 'c', cidr: '10.0.2.0/24' },
    { id: 'd', cidr: '192.168.1.0/24' },
  ]);
  const [vpc, setVpc] = useState('10.0.0.0/16');
  const [azCount, setAzCount] = useState('3');
  const [tiers, setTiers] = useState([
    { id: 't1', name: 'public', prefix: '24' },
    { id: 't2', name: 'private app', prefix: '22' },
    { id: 't3', name: 'data', prefix: '24' },
  ]);

  const setBlock = (id, value) => setBlocks((current) => current.map((row) => (row.id === id ? { ...row, cidr: value } : row)));
  const setTier = (id, key, value) => setTiers((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const inspect = useMemo(() => parseCidr(cidr), [cidr]);

  const result = useMemo(() => {
    const parsedBlocks = blocks.map((row) => ({ ...row, parsed: parseCidr(row.cidr) })).filter((row) => row.parsed);
    const pairs = [];
    for (let first = 0; first < parsedBlocks.length; first += 1) {
      for (let second = first + 1; second < parsedBlocks.length; second += 1) {
        const a = parsedBlocks[first].parsed;
        const b = parsedBlocks[second].parsed;
        if (overlaps(a, b)) {
          pairs.push({
            a: parsedBlocks[first].cidr,
            b: parsedBlocks[second].cidr,
            kind: a.network === b.network && a.prefix === b.prefix ? 'identical' : a.prefix < b.prefix ? 'contains' : 'contained',
          });
        }
      }
    }

    const check = toInt(checkIp);
    const containing = parsedBlocks.filter((row) => check !== null && (check & row.parsed.mask) >>> 0 === row.parsed.network);

    const splitTarget = inspect ? Math.max(inspect.prefix, Math.min(32, Number(newPrefix) || 24)) : 24;
    const splitCount = inspect ? Math.pow(2, splitTarget - inspect.prefix) : 0;
    const splitRows = inspect && splitCount > 0 && splitCount <= 64
      ? Array.from({ length: splitCount }, (unused, index) => {
        const size = Math.pow(2, 32 - splitTarget);
        const network = (inspect.network + index * size) >>> 0;
        return {
          index: index + 1,
          cidr: toIp(network) + '/' + splitTarget,
          first: splitTarget >= 31 ? toIp(network) : toIp(network + 1),
          last: splitTarget >= 31 ? toIp(network + size - 1) : toIp(network + size - 2),
          hosts: splitTarget >= 31 ? (splitTarget === 32 ? 1 : 2) : size - 2,
        };
      })
      : [];

    const vpcParsed = parseCidr(vpc);
    const azs = Math.max(1, Math.min(6, Number(azCount) || 3));
    let cursor = vpcParsed ? vpcParsed.network : 0;
    const plan = [];
    const planWarnings = [];
    tiers.forEach((tier) => {
      const tierPrefix = Math.max(vpcParsed ? vpcParsed.prefix : 16, Math.min(32, Number(tier.prefix) || 24));
      const perAzPrefix = tierPrefix + Math.ceil(Math.log2(azs));
      if (perAzPrefix > 32) {
        planWarnings.push(tier.name + ' cannot be split across ' + azs + ' availability zones at a /' + tierPrefix + '. Use a shorter prefix for that tier.');
        return;
      }
      const perAzSize = Math.pow(2, 32 - perAzPrefix);
      for (let index = 0; index < azs; index += 1) {
        const network = cursor;
        plan.push({
          tier: tier.name,
          az: 'AZ ' + String.fromCharCode(97 + index),
          cidr: toIp(network) + '/' + perAzPrefix,
          first: toIp(network + 1),
          last: toIp(network + perAzSize - 2),
          hosts: perAzSize - 2,
        });
        cursor = (cursor + perAzSize) >>> 0;
      }
    });

    const vpcSize = vpcParsed ? Math.pow(2, 32 - vpcParsed.prefix) : 0;
    const used = cursor - (vpcParsed ? vpcParsed.network : 0);
    const utilisation = vpcSize ? (used / vpcSize) * 100 : 0;
    if (utilisation > 100) planWarnings.push('The tiers do not fit inside ' + vpc + '. They need ' + used.toLocaleString() + ' addresses against ' + vpcSize.toLocaleString() + ' available.');
    if (plan.some((row) => row.hosts > 250) && plan.some((row) => row.tier.includes('public'))) planWarnings.push('A public tier larger than a /24 wastes addresses that could go to private subnets.');
    if (tiers.some((row) => Number(row.prefix) < (vpcParsed ? vpcParsed.prefix : 16))) planWarnings.push('A tier prefix is shorter than the VPC prefix, which cannot be allocated.');

    return {
      parsedBlocks, pairs, containing, check, splitTarget, splitCount, splitRows, plan, planWarnings, utilisation, used, vpcSize,
      overlapChart: parsedBlocks.map((row) => ({ label: row.cidr, value: row.parsed.hostCount })),
    };
  }, [blocks, checkIp, cidr, newPrefix, vpc, azCount, tiers, inspect]);

  const report = useMemo(() => {
    if (mode === 'inspect' && inspect) {
      return [
        inspect.text,
        'Network address ' + toIp(inspect.network) + ' · broadcast ' + toIp(inspect.broadcast),
        'Usable hosts ' + inspect.first + ' to ' + toIp(inspect.last) + ' (' + inspect.hostCount.toLocaleString() + ' addresses)',
        'Subnet mask ' + inspect.maskIp + ' · wildcard ' + inspect.wildcard,
        inspect.private ? 'This is a private range, not routable on the public internet.' : inspect.reserved ? 'This is a reserved or special-purpose range.' : 'This is a public range.',
      ].join('\n');
    }
    if (mode === 'overlap') {
      return [
        result.parsedBlocks.length + ' ranges checked, ' + result.pairs.length + ' overlapping pair' + (result.pairs.length === 1 ? '' : 's'),
        '',
        ...result.pairs.map((pair) => pair.a + ' and ' + pair.b + ' — ' + pair.kind),
        result.containing.length ? '' : '',
        result.containing.length ? checkIp + ' falls inside ' + result.containing.map((row) => row.cidr).join(' and ') : checkIp + ' is outside every range listed',
      ].join('\n');
    }
    if (mode === 'split') {
      return [
        inspect ? inspect.text : '',
        'Split at /' + result.splitTarget + ' gives ' + result.splitCount + ' subnets',
        '',
        ...result.splitRows.map((row) => row.index + '. ' + row.cidr + '  ' + row.first + ' to ' + row.last + '  (' + row.hosts + ' hosts)'),
      ].join('\n');
    }
    return [
      'VPC ' + vpc + ' across ' + azCount + ' availability zones',
      '',
      ...result.plan.map((row) => row.tier.padEnd(14, ' ') + row.az.padEnd(8, ' ') + row.cidr + '  ' + row.first + ' to ' + row.last + '  (' + row.hosts + ' hosts)'),
      '',
      'Utilisation ' + result.utilisation.toFixed(1) + '% of the VPC',
      ...result.planWarnings.map((line) => '· ' + line),
    ].join('\n');
  }, [mode, inspect, result, checkIp, vpc, azCount]);

  return (
    <ToolShell
      toolId="ip-range-planner"
      icon={Network}
      title="IP Range & Subnet Planner"
      desc="Inspect any CIDR, check whether ranges overlap, split a block into subnets or lay out VPC tiers across availability zones with the usable host ranges spelled out."
      state={{ mode, cidr, checkIp, newPrefix, blocks, vpc, azCount, tiers }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (typeof restored.cidr === 'string') setCidr(restored.cidr);
        if (typeof restored.checkIp === 'string') setCheckIp(restored.checkIp);
        if (restored.newPrefix !== undefined) setNewPrefix(String(restored.newPrefix));
        if (Array.isArray(restored.blocks) && restored.blocks.length) setBlocks(restored.blocks);
        if (typeof restored.vpc === 'string') setVpc(restored.vpc);
        if (restored.azCount !== undefined) setAzCount(String(restored.azCount));
        if (Array.isArray(restored.tiers) && restored.tiers.length) setTiers(restored.tiers);
      }}
      exportText={report}
      exportName="ip-plan.txt"
    >
      <Seg
        value={mode}
        onChange={setMode}
        options={[{ value: 'inspect', label: 'Inspect a range' }, { value: 'overlap', label: 'Check overlaps' }, { value: 'split', label: 'Split into subnets' }, { value: 'plan', label: 'Plan a VPC' }]}
      />

      {mode === 'inspect' && (
        <>
          <Field label="IPv4 address or CIDR">
            <input value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="10.20.0.0/20" className="h-9 w-full max-w-sm rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </Field>
          {inspect ? (
            <>
              <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
                <Hero
                  label="Usable addresses"
                  value={inspect.hostCount.toLocaleString()}
                  sub={toIp(inspect.network) + ' is the network address and ' + toIp(inspect.broadcast) + ' the broadcast, leaving ' + inspect.first + ' to ' + toIp(inspect.last) + ' for hosts. The mask is ' + inspect.maskIp + ' with a wildcard of ' + inspect.wildcard + '.'}
                />
                <Ring
                  value={32 - inspect.prefix}
                  max={32}
                  label="Host bits"
                  sub={'A /' + inspect.prefix + ' leaves ' + (32 - inspect.prefix) + ' bits for addresses, so 2^' + (32 - inspect.prefix) + ' total addresses including network and broadcast'}
                />
              </div>
              <Panel className="!p-3">
                <div className="space-y-1.5 font-mono-j text-[11px]">
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Network address</span><span>{toIp(inspect.network)}</span></div>
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Broadcast address</span><span>{toIp(inspect.broadcast)}</span></div>
                  <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>First usable host</span><span className="text-cyan-j">{inspect.first}</span></div>
                  <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Last usable host</span><span className="text-cyan-j">{toIp(inspect.last)}</span></div>
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Subnet mask</span><span>{inspect.maskIp}</span></div>
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Wildcard mask</span><span>{inspect.wildcard}</span></div>
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Total addresses</span><span>{Math.pow(2, 32 - inspect.prefix).toLocaleString()}</span></div>
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Scope</span><span>{inspect.private ? 'private RFC1918' : inspect.reserved ? 'reserved or special purpose' : 'public'}</span></div>
                  <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Address entered</span><span>{toIp(inspect.ip)}</span></div>
                </div>
                <div className="mt-2">
                  <CopyBtn value={report} label="Copy the breakdown" />
                </div>
              </Panel>
            </>
          ) : (
            <Panel className="!p-3">
              <p className="text-[11px] text-amber-200">That is not a valid IPv4 address or CIDR. Use four octets and an optional prefix, such as 10.20.0.0/20.</p>
            </Panel>
          )}
        </>
      )}

      {mode === 'overlap' && (
        <>
          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Ranges to compare</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">{result.parsedBlocks.length} valid</span>
            </div>
            <div className="space-y-2">
              {blocks.map((row) => {
                const parsed = parseCidr(row.cidr);
                return (
                  <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-3">
                    <Field label="CIDR"><input value={row.cidr} onChange={(e) => setBlock(row.id, e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                    <Field label="Detail">
                      <div className="flex h-9 items-center font-mono-j text-[11px] text-muted-foreground">{parsed ? toIp(parsed.network) + ' to ' + toIp(parsed.broadcast) + ' · ' + parsed.hostCount + ' hosts' : 'invalid'}</div>
                    </Field>
                    <div className="flex items-end">
                      <button type="button" onClick={() => setBlocks((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => setBlocks((current) => [...current, blank()])} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
              <Plus className="h-3.5 w-3.5" /> Add a range
            </button>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">Overlap results</span>
                <CopyBtn value={report} label="Copy" />
              </div>
              {result.pairs.length === 0 ? (
                <p className="text-[11px] text-emerald-200">No overlaps. Every range is disjoint, which is what you need before peering networks or merging address plans.</p>
              ) : (
                <div className="space-y-1.5">
                  {result.pairs.map((pair) => (
                    <div key={pair.a + pair.b} className="rounded-lg border border-rose-400/40 bg-rose-400/5 px-2.5 py-1.5 text-[11px]">
                      <span className="font-mono-j text-rose-200">{pair.a}</span>
                      <span className="text-muted-foreground"> and </span>
                      <span className="font-mono-j text-rose-200">{pair.b}</span>
                      <span className="text-muted-foreground"> — {pair.kind}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Overlapping ranges cannot be routed between each other cleanly, which is why every VPC, on-premises network and VPN pool in an organisation needs one documented
                addressing plan.
              </p>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Is this address inside any range</div>
              <Field label="Address to test">
                <input value={checkIp} onChange={(e) => setCheckIp(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
              </Field>
              <div className="mt-3">
                {result.containing.length ? (
                  <div className="space-y-1.5">
                    {result.containing.map((row) => (
                      <div key={row.id} className="rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5 text-[11px]">
                        <span className="font-mono-j text-cyan-j">{checkIp}</span>
                        <span className="text-muted-foreground"> is inside </span>
                        <span className="font-mono-j">{row.cidr}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">{checkIp} is outside every range listed above.</p>
                )}
              </div>
            </Panel>
          </div>
        </>
      )}

      {mode === 'split' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Range to split"><input value={cidr} onChange={(e) => setCidr(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="New prefix"><input value={newPrefix} onChange={(e) => setNewPrefix(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Subnets produced">
              <div className="flex h-9 items-center font-mono-j text-sm text-cyan-j">{(result.splitCount || 0).toLocaleString()}</div>
            </Field>
          </div>
          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Subnet allocation</span>
              <CopyBtn value={report} label="Copy" />
            </div>
            {result.splitRows.length ? (
              <div className="max-h-80 space-y-1 overflow-auto">
                {result.splitRows.map((row) => (
                  <div key={row.cidr} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
                    <span className="w-8 text-muted-foreground">{row.index}</span>
                    <span className="w-32 text-cyan-j">{row.cidr}</span>
                    <span className="text-muted-foreground">{row.first} to {row.last}</span>
                    <span className="ml-auto">{row.hosts} hosts</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-amber-200">
                {result.splitCount > 64
                  ? 'That split produces ' + result.splitCount.toLocaleString() + ' subnets, which is too many to list usefully. The allocation is a simple count: 2^' + result.splitTarget + ' minus ' + (inspect ? inspect.prefix : 0) + ' bits.'
                  : 'Enter a valid CIDR and a prefix longer than its own to split it.'}
              </p>
            )}
          </Panel>
        </>
      )}

      {mode === 'plan' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="VPC CIDR"><input value={vpc} onChange={(e) => setVpc(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Availability zones"><input value={azCount} onChange={(e) => setAzCount(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="VPC utilisation">
              <div className={'flex h-9 items-center font-mono-j text-sm ' + (result.utilisation > 100 ? 'text-rose-300' : 'text-cyan-j')}>{result.utilisation.toFixed(1)}%</div>
            </Field>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Tiers</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">{tiers.length} tiers × {azCount} zones</span>
            </div>
            <div className="space-y-2">
              {tiers.map((row) => (
                <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-3">
                  <Field label="Tier name"><input value={row.name} onChange={(e) => setTier(row.id, 'name', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
                  <Field label="Prefix per tier"><input value={row.prefix} onChange={(e) => setTier(row.id, 'prefix', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                  <div className="flex items-end">
                    <button type="button" onClick={() => setTiers((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTiers((current) => [...current, { id: Math.random().toString(36).slice(2), name: 'tier ' + (current.length + 1), prefix: '24' }])}
              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
            >
              <Plus className="h-3.5 w-3.5" /> Add a tier
            </button>
          </Panel>

          {result.planWarnings.length > 0 && (
            <Panel className="!p-3 !border-amber-400/50">
              <div className="space-y-1 text-[11px] text-amber-200">
                {result.planWarnings.map((line) => <p key={line}>· {line}</p>)}
              </div>
            </Panel>
          )}

          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Subnet plan</span>
              <CopyBtn value={report} label="Copy the plan" />
            </div>
            <div className="max-h-80 space-y-1 overflow-auto">
              {result.plan.map((row) => (
                <div key={row.tier + row.az} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
                  <span className="w-24 truncate text-muted-foreground">{row.tier}</span>
                  <span className="w-12">{row.az}</span>
                  <span className="w-32 text-cyan-j">{row.cidr}</span>
                  <span className="text-muted-foreground">{row.first} to {row.last}</span>
                  <span className="ml-auto">{row.hosts} hosts</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Each tier is split evenly across the zones, which keeps failure domains symmetric and makes the plan easy to extend when a fourth zone is added.
            </p>
          </Panel>
        </>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Mode" value={mode} mono />
        <Stat label="Ranges" value={String(result.parsedBlocks.length)} mono sub={result.pairs.length + ' overlapping pairs'} />
        <Stat label="Hosts in plan" value={result.plan.reduce((sum, row) => sum + row.hosts, 0).toLocaleString()} mono sub={result.plan.length + ' subnets'} />
        <Stat label="VPC utilisation" value={result.utilisation.toFixed(1) + '%'} mono sub={'of ' + result.vpcSize.toLocaleString() + ' addresses'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Planning addresses that survive contact with reality</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Write the whole plan down before allocating anything. Overlapping ranges discovered during a peering exercise are expensive to unpick.</p>
            <p>· Keep the plan inside RFC1918 space: 10.0.0.0/8 for the largest estates, 172.16.0.0/12 and 192.168.0.0/16 for smaller ones and for home links.</p>
            <p>· Never use the same range on both sides of a VPN. That is the single most common cause of a connection that establishes but carries no traffic.</p>
            <p>· Reserve the first and last subnet of each block for infrastructure and future expansion rather than filling from one end.</p>
            <p>· Cloud subnets reserve five addresses per subnet, so a /24 gives 251 usable rather than 254. Plan for the real figure.</p>
            <p>· Leave a documented gap between environments: 10.10 for production, 10.20 for staging, 10.30 for development. Gaps are cheap; overlaps are not.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Sizing rules worth remembering</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A /24 gives 254 usable addresses. A /25 gives 126, a /26 gives 62, a /27 gives 30, a /28 gives 14. Halving the block halves the hosts.</p>
            <p>· Database and data tiers need far fewer addresses than application tiers but benefit from headroom for replicas and migration cut-overs.</p>
            <p>· Kubernetes clusters consume address space quickly: each pod and each service can take one. Size a cluster subnet generously from the start.</p>
            <p>· Load balancers and NAT gateways need dedicated subnets in most cloud designs, and they need one per zone for resilience.</p>
            <p>· A /20 per tier inside a /16 VPC is a common shape: sixteen /20 blocks fit, which covers four tiers across multiple environments.</p>
            <p>· Growth is the thing that breaks plans. Doubling a subnet later is possible; moving everything to a new range is a project.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'VPC', value: vpc },
                { label: 'Zones', value: azCount },
                { label: 'Subnets', value: String(result.plan.length) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>network = address AND mask · broadcast = network OR NOT mask</p>
          <p>total addresses = 2^(32 − prefix) · usable = total − 2, except /31 and /32</p>
          <p>two ranges overlap when the smaller block contains the other network address</p>
          <p>splitting a /p block at /q produces 2^(q − p) subnets, each with 2^(32 − q) addresses</p>
          <p>splitting across n zones adds ceil(log2 n) bits, so each zone subnet is that much smaller</p>
          <p className="text-cyan-j">{inspect ? 'Check: /' + inspect.prefix + ' leaves ' + (32 - inspect.prefix) + ' host bits, giving 2^' + (32 - inspect.prefix) + ' = ' + Math.pow(2, 32 - inspect.prefix).toLocaleString() + ' addresses, of which ' + inspect.hostCount + ' are usable.' : ''}</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          IPv4 only, with standard classless arithmetic and no subnet-zero restrictions. Cloud providers reserve a handful of addresses per subnet for their own use, so leave
          headroom against the raw figures shown here.
        </p>
      </Panel>
    </ToolShell>
  );
}