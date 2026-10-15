/** POSIX permission helpers shared by the main process and the UI. */

/** "rwxr-x---" style string for a mode, prefixed with the file type letter. */
export function permissionString(mode: number, kind: 'file' | 'directory' | 'symlink' | 'other'): string {
  const t = kind === 'directory' ? 'd' : kind === 'symlink' ? 'l' : kind === 'other' ? '?' : '-';
  const bits = ['r', 'w', 'x'];
  let s = '';
  for (let i = 8; i >= 0; i--) s += mode & (1 << i) ? bits[(8 - i) % 3] : '-';
  const chars = s.split('');
  if (mode & 0o4000) chars[2] = chars[2] === 'x' ? 's' : 'S';
  if (mode & 0o2000) chars[5] = chars[5] === 'x' ? 's' : 'S';
  if (mode & 0o1000) chars[8] = chars[8] === 'x' ? 't' : 'T';
  return t + chars.join('');
}

/** Apply a symbolic change ("u+x", "go-w", "a=r") to a mode; returns the new permission bits. */
export function applySymbolic(mode: number, spec: string): number {
  const m = /^([ugoa]*)([+\-=])([rwx]*)$/.exec(spec.trim());
  if (!m) throw new Error(`Invalid permission change: ${spec}`);
  const who = m[1] || 'a';
  const shifts: number[] = [];
  if (who.includes('u') || who.includes('a')) shifts.push(6);
  if (who.includes('g') || who.includes('a')) shifts.push(3);
  if (who.includes('o') || who.includes('a')) shifts.push(0);
  const bits = (m[3]!.includes('r') ? 4 : 0) | (m[3]!.includes('w') ? 2 : 0) | (m[3]!.includes('x') ? 1 : 0);
  let out = mode & 0o7777;
  for (const sh of shifts) {
    if (m[2] === '+') out |= bits << sh;
    else if (m[2] === '-') out &= ~(bits << sh);
    else out = (out & ~(7 << sh)) | (bits << sh);
  }
  return out;
}
