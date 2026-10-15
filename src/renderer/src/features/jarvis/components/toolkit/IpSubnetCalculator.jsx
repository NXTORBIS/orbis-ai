import { useState } from 'react';
import { Network } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Stat, CopyBtn } from './shared';

function ipToInt(ip) { return ip.split('.').reduce((a, o) => (a << 8) + parseInt(o, 10) >>> 0, 0); }
function intToIp(n) { return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.'); }

export default function IpSubnetCalculator() {
  const [ip, setIp] = useState('192.168.1.10');
  const [cidr, setCidr] = useState(24);
  const [err, setErr] = useState(null);

  const validIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every((o) => +o >= 0 && +o <= 255);
  const c = Math.max(0, Math.min(32, +cidr || 0));
  const mask = c === 0 ? 0 : (0xffffffff << (32 - c)) >>> 0;
  const base = validIp ? (ipToInt(ip) & mask) >>> 0 : null;
  const broadcast = base != null ? (base | (~mask >>> 0)) >>> 0 : null;
  const hosts = c >= 31 ? (c === 31 ? 2 : c === 32 ? 1 : 0) : (Math.pow(2, 32 - c) - 2);
  const first = base != null && c < 31 ? (base + 1) >>> 0 : base;
  const last = broadcast != null && c < 31 ? (broadcast - 1) >>> 0 : broadcast;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Network} title="IP / Subnet Calculator" desc="IPv4 CIDR calculator — network, broadcast, host range and counts." />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="mb-1 block text-xs text-muted-foreground">IP address</span>
          <Input value={ip} onChange={(e) => { setIp(e.target.value); setErr(validIp ? null : 'Invalid IP'); }} placeholder="192.168.1.10" className="w-44" />
        </label>
        <label className="block"><span className="mb-1 block text-xs text-muted-foreground">CIDR /</span>
          <Input type="number" min="0" max="32" value={cidr} onChange={(e) => setCidr(e.target.value)} className="w-20" />
        </label>
      </div>
      {!validIp && <p className="text-xs text-red-500">Enter a valid IPv4 address.</p>}
      {validIp && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Network address" value={intToIp(base)} mono />
          <Stat label="Broadcast address" value={intToIp(broadcast)} mono />
          <Stat label="Subnet mask" value={intToIp(mask)} mono />
          <Stat label="Wildcard mask" value={intToIp(~mask >>> 0)} mono />
          <Stat label="First usable" value={intToIp(first)} mono />
          <Stat label="Last usable" value={intToIp(last)} mono />
          <Stat label="Usable hosts" value={hosts.toLocaleString()} mono />
          <Stat label="CIDR" value={`/${c}`} mono />
          <Stat label="IP class" value={+ip.split('.')[0] <= 127 ? 'A' : +ip.split('.')[0] <= 191 ? 'B' : +ip.split('.')[0] <= 223 ? 'C' : 'Other'} />
        </div>
      )}
      {validIp && <CopyBtn value={`${intToIp(base)}/${c}`} label="Copy network CIDR" />}
    </div>
  );
}