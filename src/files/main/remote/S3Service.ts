import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { z } from 'zod';
import { makeError } from '../../shared/errors';
import {
  S3ConnectionInputSchema,
  type S3ConnectionInput,
  type S3ConnectionInfo,
} from '../../shared/s3';
import type { Logger } from '../log';
import { S3Client, type S3ClientConfig } from './s3';
import { NO_SECRET_STORAGE, type SecretBox } from './secrets';
import type { KvStore } from './RemoteService';
import type { SecureStorageState } from '../../shared/remote';

/**
 * S3 connection management: definitions (no secrets), secrets encrypted with
 * OS secure storage, a pool of authenticated S3Client instances.
 *
 * Mirrors RemoteService but for S3-compatible object storage.
 */

const StoredS3Schema = z.object({
  id: z.string().regex(/^[a-z0-9]{8,32}$/),
  name: z.string().min(1).max(80),
  provider: z.string().min(1).max(32),
  endpoint: z.string().min(1).max(512),
  region: z.string().min(1).max(64),
  accessKeyId: z.string().min(1).max(256),
  secure: z.boolean(),
  bucket: z.string().max(256),
  accountId: z.string().max(256),
  pathStyle: z.boolean(),
  secretMode: z.enum(['stored', 'ask']),
  createdMs: z.number(),
});
type StoredS3 = z.infer<typeof StoredS3Schema>;

const KEY_CONNECTIONS = 's3.connections.v1';
const secretKey = (id: string) => `s3.secret.${id}`;

/** Connections unused for this long are closed. */
const IDLE_MS = 10 * 60 * 1000;

interface Pooled { client: S3Client; lastUsed: number }

export interface S3ServiceOptions {
  kv: KvStore;
  secrets?: SecretBox;
  log?: Logger;
  /** Tests: shorter timeouts. */
  connectTimeoutMs?: number;
}

export class S3Service extends EventEmitter {
  private pool = new Map<string, Pooled>();
  /** "Ask every time" secrets, for this session only. */
  private session = new Map<string, string>();
  private idleTimer: NodeJS.Timeout;
  private readonly box: SecretBox;

  constructor(private readonly o: S3ServiceOptions) {
    super();
    this.box = o.secrets ?? NO_SECRET_STORAGE;
    this.idleTimer = setInterval(() => this.closeIdle(), 60_000);
    this.idleTimer.unref();
  }

  // ------------------------------------------------------------------ definitions

  private stored(): StoredS3[] {
    const raw = this.o.kv.getKv<unknown[]>(KEY_CONNECTIONS, []);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((r) => {
      const p = StoredS3Schema.safeParse(r);
      return p.success ? [p.data] : [];
    });
  }

  private conn(id: string): StoredS3 {
    const c = this.stored().find((x) => x.id === id);
    if (!c) throw makeError('not_found', 's3.connection', { message: 'This S3 connection no longer exists.' });
    return c;
  }

  storage(): SecureStorageState {
    return this.box.state();
  }

  private storedSecret(id: string): string | undefined {
    const enc = this.o.kv.getKv<string | null>(secretKey(id), null);
    if (!enc || !this.box.state().available) return undefined;
    try {
      return this.box.decrypt(enc);
    } catch {
      return undefined;
    }
  }

  private info(c: StoredS3): S3ConnectionInfo {
    return {
      id: c.id,
      name: c.name,
      provider: c.provider,
      endpoint: c.endpoint,
      region: c.region,
      accessKeyId: c.accessKeyId,
      secure: c.secure,
      bucket: c.bucket,
      accountId: c.accountId,
      pathStyle: c.pathStyle,
      secretMode: c.secretMode,
      hasSecret: !!this.o.kv.getKv<string | null>(secretKey(c.id), null),
      connected: !!this.pool.get(c.id)?.client.alive,
    };
  }

  list(): S3ConnectionInfo[] {
    return this.stored().map((c) => this.info(c));
  }

  get(id: string): S3ConnectionInfo {
    return this.info(this.conn(id));
  }

  /**
   * Create or update an S3 connection.
   */
  save(input: S3ConnectionInput): S3ConnectionInfo {
    const v = S3ConnectionInputSchema.parse(input);
    const all = this.stored();
    const prev = v.id ? all.find((c) => c.id === v.id) : undefined;
    if (v.id && !prev) throw makeError('not_found', 's3.save', { message: 'This S3 connection no longer exists.' });

    const secret = v.secretAccessKey;
    const wantsStore = v.secretMode === 'stored';
    if (wantsStore && typeof secret === 'string' && !this.box.state().available) {
      throw makeError('unavailable', 's3.save', { message: `${this.box.state().reason ?? 'Secure credential storage is not available.'} Choose "Ask every time".` });
    }

    const id = prev?.id ?? crypto.randomBytes(8).toString('hex');
    const next: StoredS3 = {
      id,
      name: v.name.trim(),
      provider: v.provider,
      endpoint: v.endpoint.trim(),
      region: v.region.trim(),
      accessKeyId: v.accessKeyId,
      secure: v.secure,
      bucket: v.bucket ?? '',
      accountId: v.accountId ?? '',
      pathStyle: v.pathStyle,
      secretMode: v.secretMode,
      createdMs: prev?.createdMs ?? Date.now(),
    };

    const serverChanged = !!prev && (prev.endpoint !== next.endpoint || prev.region !== next.region || prev.accessKeyId !== next.accessKeyId);
    this.o.kv.setKv(KEY_CONNECTIONS, prev ? all.map((c) => (c.id === id ? next : c)) : [...all, next]);

    if (!wantsStore || secret === null || (serverChanged && secret === undefined)) this.o.kv.setKv(secretKey(id), null);
    if (wantsStore && typeof secret === 'string') this.o.kv.setKv(secretKey(id), this.box.encrypt(secret));
    if (serverChanged || secret !== undefined) this.session.delete(id);
    if (typeof secret === 'string' && !wantsStore) this.session.set(id, secret);
    if (prev) this.disconnect(id);

    this.o.log?.info('s3.saved', { id, provider: next.provider, edited: !!prev });
    this.emit('changed');
    return this.info(next);
  }

  remove(id: string): void {
    this.conn(id);
    this.disconnect(id);
    this.session.delete(id);
    this.o.kv.setKv(secretKey(id), null);
    this.o.kv.setKv(KEY_CONNECTIONS, this.stored().filter((c) => c.id !== id));
    this.o.log?.info('s3.removed', { id });
    this.emit('changed');
  }

  // ------------------------------------------------------------------ connecting

  /**
   * Connect to an S3-compatible service. Returns the connection info.
   * If secretMode is 'ask', `secret` must be provided.
   */
  connect(id: string, secret?: string): S3ConnectionInfo {
    const c = this.conn(id);

    // Find the secret
    const secretKey_ = secret ?? this.session.get(id) ?? this.storedSecret(id);
    if (!secretKey_) {
      return { ...this.info(c), connected: false };
    }
    if (secret) this.session.set(id, secret);

    // Close any existing connection
    const existing = this.pool.get(id);
    if (existing) existing.client.close();

    const cfg: S3ClientConfig = {
      endpoint: c.endpoint,
      region: c.region,
      accessKeyId: c.accessKeyId,
      secretAccessKey: secretKey_,
      secure: c.secure,
      pathStyle: c.pathStyle,
      timeoutMs: this.o.connectTimeoutMs,
    };

    const client = new S3Client(cfg);
    this.pool.set(id, { client, lastUsed: Date.now() });
    this.o.log?.info('s3.connected', { id, endpoint: c.endpoint });
    this.emit('changed');
    return { ...this.info(c), connected: true };
  }

  disconnect(id: string): void {
    const pooled = this.pool.get(id);
    if (pooled) {
      pooled.client.close();
      this.pool.delete(id);
      this.o.log?.info('s3.disconnected', { id });
      this.emit('changed');
    }
  }

  /** Get the S3Client for a connected connection, touching its idle timer. */
  client(id: string): S3Client {
    const pooled = this.pool.get(id);
    if (!pooled || !pooled.client.alive) {
      throw makeError('unavailable', 's3.client', { message: 'This S3 connection is not active. Connect first.' });
    }
    pooled.lastUsed = Date.now();
    return pooled.client;
  }

  /** Whether there is an active client for the connection. */
  hasClient(id: string): boolean {
    const p = this.pool.get(id);
    return !!p && p.client.alive;
  }

  // ------------------------------------------------------------------ cleanup

  private closeIdle(): void {
    const now = Date.now();
    for (const [id, pooled] of this.pool) {
      if (now - pooled.lastUsed > IDLE_MS) {
        pooled.client.close();
        this.pool.delete(id);
        this.o.log?.info('s3.idle_closed', { id });
      }
    }
  }

  dispose(): void {
    clearInterval(this.idleTimer);
    for (const [, pooled] of this.pool) pooled.client.close();
    this.pool.clear();
  }
}
