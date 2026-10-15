import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Volume } from '../../shared/model';

/**
 * Volume discovery using platform sources. Nothing is invented: if a value
 * can't be read it is left undefined and the UI shows it as unavailable.
 */

const LINUX_REAL_FS = new Set([
  'ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'f2fs', 'zfs', 'jfs', 'reiserfs',
  'vfat', 'exfat', 'ntfs', 'ntfs3', 'fuseblk', 'hfsplus', 'apfs', 'udf', 'iso9660',
  'nfs', 'nfs4', 'cifs', 'smb3', 'sshfs', 'fuse.sshfs', 'fuse.rclone', '9p', 'virtiofs',
]);
const NETWORK_FS = new Set(['nfs', 'nfs4', 'cifs', 'smb3', 'sshfs', 'fuse.sshfs', 'fuse.rclone']);

function unescapeMount(s: string): string {
  return s.replace(/\\(\d{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

export interface MountLine {
  device: string;
  mountPath: string;
  fsType: string;
}

export function parseProcMounts(text: string): MountLine[] {
  const out: MountLine[] = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    out.push({ device: unescapeMount(parts[0]!), mountPath: unescapeMount(parts[1]!), fsType: parts[2]! });
  }
  return out;
}

async function capacity(p: string): Promise<{ totalBytes?: number; freeBytes?: number }> {
  try {
    const s = await fsp.statfs(p);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return {};
  }
}

async function linuxRemovable(device: string): Promise<boolean | undefined> {
  const m = /^\/dev\/([a-z]+)(\d+)?$/.exec(device) ?? /^\/dev\/(nvme\d+n\d+|mmcblk\d+)(p\d+)?$/.exec(device);
  if (!m) return undefined;
  try {
    const v = await fsp.readFile(`/sys/block/${m[1]}/removable`, 'utf8');
    return v.trim() === '1';
  } catch {
    return undefined;
  }
}

async function linuxVolumes(): Promise<Volume[]> {
  let text: string;
  try {
    text = await fsp.readFile('/proc/self/mounts', 'utf8');
  } catch {
    return rootOnly('/proc/self/mounts unavailable');
  }
  const mounts = parseProcMounts(text);
  const vols: Volume[] = [];
  const seenPaths = new Set<string>();
  for (const m of mounts) {
    const isRoot = m.mountPath === '/';
    const isUser = /^\/(media|mnt|run\/media)\//.test(m.mountPath) || m.mountPath.startsWith('/home');
    const realFs = LINUX_REAL_FS.has(m.fsType);
    if (!isRoot && !(realFs && (isUser || NETWORK_FS.has(m.fsType)))) continue;
    if (seenPaths.has(m.mountPath)) continue;
    seenPaths.add(m.mountPath);
    const cap = await capacity(m.mountPath);
    vols.push({
      id: `mount:${m.mountPath}`,
      label: isRoot ? 'File System' : path.basename(m.mountPath) || m.mountPath,
      mountPath: m.mountPath,
      fsType: m.fsType,
      ...cap,
      removable: isRoot ? false : (await linuxRemovable(m.device)) ?? (/^\/(media|run\/media)\//.test(m.mountPath) ? true : undefined),
      source: '/proc/self/mounts + statfs',
    });
  }
  if (!vols.some((v) => v.mountPath === '/')) vols.unshift(...(await rootOnly('root not listed in mounts')));
  return vols;
}

async function darwinVolumes(): Promise<Volume[]> {
  const vols: Volume[] = [];
  try {
    const names = await fsp.readdir('/Volumes');
    for (const n of names) {
      const p = path.join('/Volumes', n);
      const cap = await capacity(p);
      vols.push({ id: `mount:${p}`, label: n, mountPath: p, ...cap, source: '/Volumes + statfs' });
    }
  } catch {
    return rootOnly('/Volumes unavailable');
  }
  if (!vols.length) return rootOnly('/Volumes empty');
  return vols;
}

async function windowsVolumes(): Promise<Volume[]> {
  const vols: Volume[] = [];
  for (let c = 65; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    try {
      await fsp.access(root);
    } catch {
      continue;
    }
    const cap = await capacity(root);
    vols.push({ id: `drive:${root}`, label: `${String.fromCharCode(c)}:`, mountPath: root, ...cap, source: 'drive letters + statfs' });
  }
  return vols;
}

async function rootOnly(note: string): Promise<Volume[]> {
  const root = path.parse(process.cwd()).root;
  return [{ id: `mount:${root}`, label: 'File System', mountPath: root, ...(await capacity(root)), source: `fallback (${note})` }];
}

export async function listVolumes(platform: NodeJS.Platform = process.platform): Promise<Volume[]> {
  if (platform === 'linux') return linuxVolumes();
  if (platform === 'darwin') return darwinVolumes();
  if (platform === 'win32') return windowsVolumes();
  return rootOnly(`unsupported platform ${platform}`);
}
