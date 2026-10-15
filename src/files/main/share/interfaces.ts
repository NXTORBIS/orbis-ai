import os from 'node:os';
import net from 'node:net';
import type { ShareInterface, ShareInterfaces } from '../../shared/share';

/**
 * Network interfaces a share can listen on, read from the system
 * (os.networkInterfaces). IPv6 link-local addresses (fe80::/10) are left out:
 * they need a zone id and cannot be typed into a phone's browser.
 */

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(address)) return /^f[cd][0-9a-f]{2}:/i.test(address); // unique local fc00::/7
  return false;
}

export function listShareInterfaces(source: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): ShareInterfaces {
  const out: ShareInterface[] = [];
  for (const [name, addrs] of Object.entries(source)) {
    for (const a of addrs ?? []) {
      const family = a.family === 'IPv4' || (a.family as unknown) === 4 ? 'IPv4' : 'IPv6';
      if (family === 'IPv6' && /^fe[89ab][0-9a-f]:/i.test(a.address)) continue; // link-local
      if (a.address.includes('%')) continue;
      out.push({ name, address: a.address, family, internal: a.internal, private: isPrivateAddress(a.address) });
    }
  }
  // Private LAN IPv4 first, then other external addresses, loopback last.
  const rank = (i: ShareInterface) => (i.internal ? 3 : i.private && i.family === 'IPv4' ? 0 : i.family === 'IPv4' ? 1 : 2);
  out.sort((x, y) => rank(x) - rank(y));
  const def = out.find((i) => !i.internal && i.private && i.family === 'IPv4');
  return { interfaces: out, defaultAddress: def?.address };
}

/** The host part of a URL for an address (IPv6 in brackets). */
export function urlHost(address: string, port: number): string {
  return net.isIPv6(address) ? `[${address}]:${port}` : `${address}:${port}`;
}
