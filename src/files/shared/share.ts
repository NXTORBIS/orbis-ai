import { z } from 'zod';

/**
 * "Share on local network": a temporary, read-only (unless uploads are
 * allowed) HTTP server in the main process. Types shared by the main process
 * and the share panel.
 */

export const SHARE_EXPIRY = ['10m', '1h', 'never'] as const;
export type ShareExpiry = (typeof SHARE_EXPIRY)[number];
export const EXPIRY_MS: Record<ShareExpiry, number | null> = { '10m': 10 * 60_000, '1h': 60 * 60_000, never: null };

/** Largest upload size limit that can be chosen (per request), in MB. */
export const SHARE_UPLOAD_MAX_MB = 100 * 1024;

/** An IPv4 or IPv6 literal (no zone id, no brackets). Validated again against the live interface list. */
const ipLiteral = z.string().min(2).max(45).regex(/^[0-9a-fA-F:.]+$/, 'Not an IP address.');

export const ShareStartSchema = z.object({
  paths: z.array(z.string().min(1).max(32767)).min(1).max(1000),
  /** Addresses of the interfaces to listen on (ignored when allInterfaces is true). */
  addresses: z.array(ipLiteral).max(16),
  /** Listen on every IPv4 interface (0.0.0.0). Only when the user explicitly chose it. */
  allInterfaces: z.boolean(),
  expiry: z.enum(SHARE_EXPIRY),
  /** Serve items whose names start with a dot inside shared folders. */
  includeHidden: z.boolean(),
  /** Allow uploads into this folder (off unless given). */
  upload: z.object({ folder: z.string().min(1).max(32767), maxMB: z.number().int().min(1).max(SHARE_UPLOAD_MAX_MB) }).optional(),
});
export type ShareStartRequest = z.infer<typeof ShareStartSchema>;

export interface ShareInterface {
  /** Interface name as the system reports it (eth0, wlan0, en0…). */
  name: string;
  address: string;
  family: 'IPv4' | 'IPv6';
  /** Loopback: only this computer can connect. */
  internal: boolean;
  /** A private (LAN) address: 10/8, 172.16/12, 192.168/16, IPv6 unique-local fc00::/7. */
  private: boolean;
}

export interface ShareInterfaces {
  interfaces: ShareInterface[];
  /** Address chosen by default: the first private, non-loopback IPv4 address (none when there is no such address). */
  defaultAddress?: string;
}

export interface ShareActivity {
  ms: number;
  /** Remote IP address of the device that made the request. */
  from: string;
  kind: 'page' | 'download' | 'zip' | 'upload' | 'denied' | 'blocked';
  /** What was requested (item name, or "wrong link"). */
  name: string;
  bytes?: number;
  /** Partial download (Range request). */
  range?: boolean;
  status: 'ok' | 'failed' | 'incomplete' | 'refused';
  detail?: string;
}

export interface ShareSnapshot {
  id: string;
  createdMs: number;
  /** When the share stops by itself (null: until stopped or Orbis Files quits). */
  expiresMs: number | null;
  state: 'running' | 'stopped';
  stoppedMs?: number;
  stopReason?: 'stopped' | 'expired' | 'quit' | 'error';
  port: number;
  allInterfaces: boolean;
  /** Links to give to the other device, one per listening address, with a QR code (SVG data URL). */
  urls: Array<{ address: string; interfaceName: string; url: string; qr: string }>;
  items: Array<{ name: string; kind: 'file' | 'directory'; size?: number }>;
  includeHidden: boolean;
  upload?: { folder: string; maxBytes: number };
  activity: ShareActivity[];
  stats: { requests: number; downloads: number; bytesSent: number; uploads: number; bytesReceived: number; denied: number };
}

/** Sent to the windows when a device uploaded a file into a share's folder. */
export interface ShareUploadEvent {
  shareId: string;
  from: string;
  name: string;
  savedAs: string;
  bytes: number;
}
