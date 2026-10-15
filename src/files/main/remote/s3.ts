import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { makeError } from '../../shared/errors';
import type { S3Bucket, S3ListResult, S3PresignedUrl } from '../../shared/s3';
import { s3KeyParts } from '../../shared/s3';
import { networkError, remoteError } from './types';
import { parseXml, type XmlElement } from './xml';

/**
 * S3-compatible object storage client. Implements the S3 REST API using
 * AWS Signature Version 4 signing. No AWS SDK dependency: all signing and
 * HTTP calls are done with Node's built-in crypto and https modules.
 */

// ------------------------------------------------------------------ SigV4

const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** YYYYMMDD */
function dateStamp(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/** YYYYMMDDTHHMMSSZ */
function amzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/** URI-encode per AWS rules (RFC 3986, but encode / when encodeSlash is true). */
export function uriEncode(s: string, encodeSlash = true): string {
  return s.replace(/[^A-Za-z0-9_.~-]/g, (c) => {
    if (c === '/' && !encodeSlash) return '/';
    const bytes = Buffer.from(c, 'utf8');
    let out = '';
    for (const b of bytes) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    return out;
  });
}

/** Build the canonical query string (sorted, URI-encoded key=value pairs). */
function canonicalQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .join('&');
}

/** Derive the SigV4 signing key. */
export function signingKey(secretKey: string, dateStr: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStr);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export interface SignedHeaders {
  authorization: string;
  'x-amz-date': string;
  'x-amz-content-sha256': string;
  [key: string]: string;
}

export interface SignInput {
  method: string;
  path: string;
  queryParams?: Record<string, string>;
  headers: Record<string, string>;
  payloadHash?: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  date?: Date;
}

/**
 * Sign an HTTP request with AWS Signature Version 4.
 * Returns the Authorization, x-amz-date and x-amz-content-sha256 headers.
 */
export function signRequest(input: SignInput): SignedHeaders {
  const date = input.date ?? new Date();
  const ds = dateStamp(date);
  const amz = amzDate(date);
  const service = input.service ?? 's3';
  const scope = `${ds}/${input.region}/${service}/aws4_request`;
  const payloadHash = input.payloadHash ?? UNSIGNED_PAYLOAD;

  // 1. Canonical headers: lowercase keys, sorted, trimmed values.
  const allHeaders: Record<string, string> = {
    ...input.headers,
    'x-amz-date': amz,
    'x-amz-content-sha256': payloadHash,
  };
  const sortedKeys = Object.keys(allHeaders).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = sortedKeys.map((k) => {
    const origKey = Object.keys(allHeaders).find((h) => h.toLowerCase() === k)!;
    return `${k}:${allHeaders[origKey]!.trim()}`;
  }).join('\n') + '\n';
  const signedHeaders = sortedKeys.join(';');

  // 2. Canonical request
  const qs = canonicalQueryString(input.queryParams ?? {});
  const canonicalRequest = [
    input.method,
    uriEncode(input.path, false),
    qs,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // 3. String to sign
  const stringToSign = [
    ALGORITHM,
    amz,
    scope,
    sha256(canonicalRequest),
  ].join('\n');

  // 4. Signing key and signature
  const key = signingKey(input.secretAccessKey, ds, input.region, service);
  const signature = crypto.createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');

  // 5. Authorization header
  const authorization = `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    'x-amz-date': amz,
    'x-amz-content-sha256': payloadHash,
  };
}

/**
 * Generate a presigned URL (GET only) for sharing.
 */
export function presignUrl(opts: {
  endpoint: string;
  secure: boolean;
  pathStyle: boolean;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  expiresInSeconds?: number;
}): S3PresignedUrl {
  const expires = opts.expiresInSeconds ?? 3600;
  const date = new Date();
  const ds = dateStamp(date);
  const amz = amzDate(date);
  const scope = `${ds}/${opts.region}/s3/aws4_request`;

  const host = opts.pathStyle
    ? opts.endpoint
    : `${opts.bucket}.${opts.endpoint}`;
  const objectPath = opts.pathStyle
    ? `/${opts.bucket}/${opts.key}`
    : `/${opts.key}`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${opts.accessKeyId}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };

  const qs = canonicalQueryString(queryParams);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    'GET',
    uriEncode(objectPath, false),
    qs,
    canonicalHeaders,
    'host',
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [ALGORITHM, amz, scope, sha256(canonicalRequest)].join('\n');
  const key = signingKey(opts.secretAccessKey, ds, opts.region, 's3');
  const signature = crypto.createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');

  const scheme = opts.secure ? 'https' : 'http';
  const encodedPath = objectPath.split('/').map((s) => uriEncode(s)).join('/');
  const url = `${scheme}://${host}${encodedPath}?${qs}&X-Amz-Signature=${signature}`;

  return { url, expiresInSeconds: expires };
}

// ------------------------------------------------------------------ XML helpers (using XmlElement)

/** Find a child element by local name (ignoring namespace). */
function xel(parent: XmlElement | undefined, name: string): XmlElement | undefined {
  return parent?.children.find((c) => c.name === name);
}

/** All children with a given local name. */
function xels(parent: XmlElement | undefined, name: string): XmlElement[] {
  return parent?.children.filter((c) => c.name === name) ?? [];
}

/** The text content of a named child element. */
function xtxt(parent: XmlElement | undefined, name: string): string | undefined {
  const child = xel(parent, name);
  return child ? allText(child) : undefined;
}

/** All text in an element and its descendants. */
function allText(el: XmlElement): string {
  return el.text + el.children.map(allText).join('');
}

/** Parse an S3 error response body into code + message. */
function parseS3Error(body: string): { Code?: string; Message?: string } | undefined {
  try {
    const xml = parseXml(body);
    const error = xml.name === 'Error' ? xml : xel(xml, 'Error');
    if (!error) return undefined;
    return { Code: xtxt(error, 'Code'), Message: xtxt(error, 'Message') };
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------ S3 client

export interface S3ClientConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  secure: boolean;
  pathStyle: boolean;
  /** Request timeout in ms (default 30 000). */
  timeoutMs?: number;
}

interface RequestOpts {
  method: string;
  bucket?: string;
  key?: string;
  queryParams?: Record<string, string>;
  body?: Buffer | string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** When true, return the raw response (for downloads). */
  rawResponse?: boolean;
}

/** Multipart upload: minimum part size is 5 MB. */
export const MULTIPART_THRESHOLD = 5 * 1024 * 1024;
const MULTIPART_PART_SIZE = 8 * 1024 * 1024;

export class S3Client {
  private alive_ = true;
  constructor(private readonly cfg: S3ClientConfig) {}

  get alive(): boolean { return this.alive_; }

  close(): void { this.alive_ = false; }

  // ---------------------------------------------------------------- low-level

  private hostAndPath(bucket?: string, key?: string): { host: string; path: string } {
    let host = this.cfg.endpoint;
    let p = '/';
    if (bucket) {
      if (this.cfg.pathStyle) {
        p = `/${bucket}`;
      } else {
        host = `${bucket}.${this.cfg.endpoint}`;
      }
    }
    if (key) p += (p.endsWith('/') ? '' : '/') + key.split('/').map((s) => uriEncode(s)).join('/');
    return { host, path: p };
  }

  private async request(opts: RequestOpts): Promise<{ status: number; headers: Record<string, string>; body: string; raw?: IncomingMessage }> {
    const { host, path: urlPath } = this.hostAndPath(opts.bucket, opts.key);
    const qs = opts.queryParams ? canonicalQueryString(opts.queryParams) : '';
    const fullPath = qs ? `${urlPath}?${qs}` : urlPath;
    const bodyBuf = opts.body ? (typeof opts.body === 'string' ? Buffer.from(opts.body) : opts.body) : Buffer.alloc(0);
    const payloadHash = sha256(bodyBuf);

    const reqHeaders: Record<string, string> = {
      host,
      ...(opts.headers ?? {}),
    };
    if (opts.body) {
      reqHeaders['content-length'] = String(bodyBuf.length);
    }

    const signed = signRequest({
      method: opts.method,
      path: urlPath,
      queryParams: opts.queryParams,
      headers: reqHeaders,
      payloadHash,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      region: this.cfg.region,
    });

    const allHeaders = { ...reqHeaders, ...signed };
    const mod = this.cfg.secure ? https : http;
    const timeout = this.cfg.timeoutMs ?? 30_000;

    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) return reject(makeError('cancelled', 's3.request'));

      const req = mod.request({
        hostname: host,
        port: this.cfg.secure ? 443 : undefined,
        path: fullPath,
        method: opts.method,
        headers: allHeaders,
        timeout,
      }, (res) => {
        if (opts.rawResponse) {
          resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string>, body: '', raw: res });
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string>,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', (err) => reject(networkError(err, 's3.request', this.cfg.endpoint)));
      });

      req.on('error', (err) => reject(networkError(err, 's3.request', this.cfg.endpoint)));
      req.on('timeout', () => {
        req.destroy();
        reject(remoteError('unavailable', 's3.request', `The S3 server at ${this.cfg.endpoint} did not respond in time.`, { retryable: true }));
      });

      if (opts.signal) {
        const abort = () => { req.destroy(); reject(makeError('cancelled', 's3.request')); };
        opts.signal.addEventListener('abort', abort, { once: true });
        req.on('close', () => opts.signal!.removeEventListener('abort', abort));
      }

      if (opts.body) req.write(bodyBuf);
      req.end();
    });
  }

  private checkStatus(res: { status: number; body: string }, operation: string): void {
    if (res.status >= 200 && res.status < 300) return;
    const err = parseS3Error(res.body);
    const code = err?.Code ?? '';
    const message = err?.Message ?? res.body.slice(0, 500);
    if (res.status === 403) throw remoteError('permission_denied', operation, `Access denied: ${message}`, { cause: `s3:${code}` });
    if (res.status === 404) throw remoteError('not_found', operation, `Not found: ${message}`, { cause: `s3:${code}` });
    if (res.status === 409) throw remoteError('already_exists', operation, `Conflict: ${message}`, { cause: `s3:${code}` });
    throw remoteError('io', operation, `S3 error ${res.status}: ${message}`, { cause: `s3:${code}`, retryable: res.status >= 500 });
  }

  // ---------------------------------------------------------------- bucket operations

  async listBuckets(signal?: AbortSignal): Promise<S3Bucket[]> {
    const res = await this.request({ method: 'GET', signal });
    this.checkStatus(res, 's3.listBuckets');
    const xml = parseXml(res.body);
    const root = xml.name === 'ListAllMyBucketsResult' ? xml : xel(xml, 'ListAllMyBucketsResult') ?? xml;
    const bucketsNode = xel(root, 'Buckets');
    if (!bucketsNode) return [];
    return xels(bucketsNode, 'Bucket').map((b) => ({
      name: xtxt(b, 'Name') ?? '',
      creationDate: xtxt(b, 'CreationDate'),
    }));
  }

  async getBucketLocation(bucket: string, signal?: AbortSignal): Promise<string> {
    const res = await this.request({
      method: 'GET',
      bucket,
      queryParams: { location: '' },
      signal,
    });
    this.checkStatus(res, 's3.getBucketLocation');
    const xml = parseXml(res.body);
    const root = xml.name === 'LocationConstraint' ? xml : xel(xml, 'LocationConstraint') ?? xml;
    return allText(root).trim() || 'us-east-1';
  }

  // ---------------------------------------------------------------- object listing

  async listObjects(bucket: string, prefix = '', opts?: { delimiter?: string; maxKeys?: number; continuationToken?: string; signal?: AbortSignal }): Promise<S3ListResult> {
    const params: Record<string, string> = { 'list-type': '2' };
    if (prefix) params.prefix = prefix;
    if (opts?.delimiter !== undefined) params.delimiter = opts.delimiter;
    else params.delimiter = '/';
    if (opts?.maxKeys) params['max-keys'] = String(opts.maxKeys);
    if (opts?.continuationToken) params['continuation-token'] = opts.continuationToken;

    const res = await this.request({ method: 'GET', bucket, queryParams: params, signal: opts?.signal });
    this.checkStatus(res, 's3.listObjects');

    const xml = parseXml(res.body);
    const root = xml.name === 'ListBucketResult' ? xml : xel(xml, 'ListBucketResult') ?? xml;

    const objects: import('../../shared/s3').S3Object[] = [];
    const prefixes: string[] = [];

    for (const child of root.children) {
      if (child.name === 'Contents') {
        const key = xtxt(child, 'Key') ?? '';
        if (!key) continue;
        const { name } = s3KeyParts(key);
        const sizeText = xtxt(child, 'Size');
        const isFolder = key.endsWith('/') && sizeText === '0';
        objects.push({
          key,
          name,
          isPrefix: isFolder,
          size: sizeText ? Number(sizeText) : undefined,
          lastModified: xtxt(child, 'LastModified') ?? undefined,
          etag: xtxt(child, 'ETag')?.replace(/"/g, '') ?? undefined,
          storageClass: xtxt(child, 'StorageClass') ?? undefined,
        });
      } else if (child.name === 'CommonPrefixes') {
        const p = xtxt(child, 'Prefix') ?? '';
        if (p) {
          prefixes.push(p);
          const { name } = s3KeyParts(p);
          objects.push({ key: p, name, isPrefix: true });
        }
      }
    }

    const truncated = xtxt(root, 'IsTruncated') === 'true';
    const continuationToken = xtxt(root, 'NextContinuationToken') ?? undefined;

    return { objects, prefixes, truncated, continuationToken };
  }

  // ---------------------------------------------------------------- object operations

  /** HEAD object: returns metadata without downloading the body. */
  async headObject(bucket: string, key: string, signal?: AbortSignal): Promise<{ size: number; lastModified?: string; etag?: string; contentType?: string }> {
    const res = await this.request({ method: 'HEAD', bucket, key, signal });
    this.checkStatus(res, 's3.headObject');
    return {
      size: Number(res.headers['content-length'] ?? 0),
      lastModified: res.headers['last-modified'],
      etag: (res.headers.etag ?? '').replace(/"/g, ''),
      contentType: res.headers['content-type'],
    };
  }

  /** GET object: returns a readable stream. */
  async getObject(bucket: string, key: string, opts?: { signal?: AbortSignal; range?: { start: number; end: number } }): Promise<{ stream: Readable; size: number; contentType?: string }> {
    const headers: Record<string, string> = {};
    if (opts?.range) headers.range = `bytes=${opts.range.start}-${opts.range.end}`;

    const res = await this.request({ method: 'GET', bucket, key, headers, signal: opts?.signal, rawResponse: true });
    if (res.status >= 300) {
      const chunks: Buffer[] = [];
      if (res.raw) {
        for await (const c of res.raw) chunks.push(c as Buffer);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      this.checkStatus({ status: res.status, body }, 's3.getObject');
    }
    return {
      stream: res.raw as Readable,
      size: Number(res.headers['content-length'] ?? 0),
      contentType: res.headers['content-type'],
    };
  }

  /** PUT object: upload a complete object (for small files). */
  async putObject(bucket: string, key: string, body: Buffer, opts?: { contentType?: string; signal?: AbortSignal }): Promise<{ etag: string }> {
    const headers: Record<string, string> = {};
    if (opts?.contentType) headers['content-type'] = opts.contentType;

    const res = await this.request({ method: 'PUT', bucket, key, body, headers, signal: opts?.signal });
    this.checkStatus(res, 's3.putObject');
    return { etag: (res.headers.etag ?? '').replace(/"/g, '') };
  }

  /** DELETE object. */
  async deleteObject(bucket: string, key: string, signal?: AbortSignal): Promise<void> {
    const res = await this.request({ method: 'DELETE', bucket, key, signal });
    if (res.status !== 204 && res.status !== 200) this.checkStatus(res, 's3.deleteObject');
  }

  /** COPY object (server-side copy). */
  async copyObject(bucket: string, sourceKey: string, destKey: string, opts?: { destBucket?: string; signal?: AbortSignal }): Promise<{ etag: string }> {
    const destBucket = opts?.destBucket ?? bucket;
    const source = `/${bucket}/${sourceKey}`;
    const res = await this.request({
      method: 'PUT',
      bucket: destBucket,
      key: destKey,
      headers: { 'x-amz-copy-source': uriEncode(source, false) },
      signal: opts?.signal,
    });
    this.checkStatus(res, 's3.copyObject');
    const xml = parseXml(res.body);
    const root = xml.name === 'CopyObjectResult' ? xml : xel(xml, 'CopyObjectResult') ?? xml;
    return { etag: (xtxt(root, 'ETag') ?? '').replace(/"/g, '') };
  }

  /** Create a "folder" by putting a zero-byte object with a trailing-slash key. */
  async createFolder(bucket: string, prefix: string, signal?: AbortSignal): Promise<void> {
    const key = prefix.endsWith('/') ? prefix : `${prefix}/`;
    await this.putObject(bucket, key, Buffer.alloc(0), { contentType: 'application/x-directory', signal });
  }

  /** Rename (copy + delete; S3 has no native rename). */
  async renameObject(bucket: string, oldKey: string, newKey: string, signal?: AbortSignal): Promise<void> {
    await this.copyObject(bucket, oldKey, newKey, { signal });
    await this.deleteObject(bucket, oldKey, signal);
  }

  // ---------------------------------------------------------------- multipart upload

  async createMultipartUpload(bucket: string, key: string, opts?: { contentType?: string; signal?: AbortSignal }): Promise<string> {
    const headers: Record<string, string> = {};
    if (opts?.contentType) headers['content-type'] = opts.contentType;

    const res = await this.request({
      method: 'POST',
      bucket,
      key,
      queryParams: { uploads: '' },
      headers,
      signal: opts?.signal,
    });
    this.checkStatus(res, 's3.createMultipartUpload');
    const xml = parseXml(res.body);
    const root = xml.name === 'InitiateMultipartUploadResult' ? xml : xel(xml, 'InitiateMultipartUploadResult') ?? xml;
    const uploadId = xtxt(root, 'UploadId');
    if (!uploadId) throw remoteError('io', 's3.createMultipartUpload', 'The server did not return an upload ID.');
    return uploadId;
  }

  async uploadPart(bucket: string, key: string, uploadId: string, partNumber: number, body: Buffer, signal?: AbortSignal): Promise<{ etag: string }> {
    const res = await this.request({
      method: 'PUT',
      bucket,
      key,
      queryParams: { partNumber: String(partNumber), uploadId },
      body,
      signal,
    });
    this.checkStatus(res, 's3.uploadPart');
    return { etag: (res.headers.etag ?? '').replace(/"/g, '') };
  }

  async completeMultipartUpload(bucket: string, key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>, signal?: AbortSignal): Promise<{ etag: string }> {
    const partsXml = parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('');
    const body = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;
    const res = await this.request({
      method: 'POST',
      bucket,
      key,
      queryParams: { uploadId },
      body: Buffer.from(body),
      headers: { 'content-type': 'application/xml' },
      signal,
    });
    this.checkStatus(res, 's3.completeMultipartUpload');
    const xml = parseXml(res.body);
    const root = xml.name === 'CompleteMultipartUploadResult' ? xml : xel(xml, 'CompleteMultipartUploadResult') ?? xml;
    return { etag: (xtxt(root, 'ETag') ?? '').replace(/"/g, '') };
  }

  async abortMultipartUpload(bucket: string, key: string, uploadId: string, signal?: AbortSignal): Promise<void> {
    const res = await this.request({
      method: 'DELETE',
      bucket,
      key,
      queryParams: { uploadId },
      signal,
    });
    if (res.status !== 204 && res.status !== 200) this.checkStatus(res, 's3.abortMultipartUpload');
  }

  /**
   * Upload a file using multipart upload if it exceeds the threshold.
   * Reports progress through the callback.
   */
  async uploadFile(
    bucket: string,
    key: string,
    data: Buffer,
    opts?: {
      contentType?: string;
      signal?: AbortSignal;
      onProgress?: (uploaded: number, total: number) => void;
    },
  ): Promise<{ etag: string }> {
    if (data.length <= MULTIPART_THRESHOLD) {
      opts?.onProgress?.(0, data.length);
      const result = await this.putObject(bucket, key, data, { contentType: opts?.contentType, signal: opts?.signal });
      opts?.onProgress?.(data.length, data.length);
      return result;
    }

    const uploadId = await this.createMultipartUpload(bucket, key, { contentType: opts?.contentType, signal: opts?.signal });
    const parts: Array<{ partNumber: number; etag: string }> = [];
    let uploaded = 0;

    try {
      const partCount = Math.ceil(data.length / MULTIPART_PART_SIZE);
      for (let i = 0; i < partCount; i++) {
        if (opts?.signal?.aborted) throw makeError('cancelled', 's3.uploadFile');
        const start = i * MULTIPART_PART_SIZE;
        const end = Math.min(start + MULTIPART_PART_SIZE, data.length);
        const partData = data.subarray(start, end);
        const { etag } = await this.uploadPart(bucket, key, uploadId, i + 1, Buffer.from(partData), opts?.signal);
        parts.push({ partNumber: i + 1, etag });
        uploaded += partData.length;
        opts?.onProgress?.(uploaded, data.length);
      }
      return await this.completeMultipartUpload(bucket, key, uploadId, parts, opts?.signal);
    } catch (err) {
      await this.abortMultipartUpload(bucket, key, uploadId).catch(() => {});
      throw err;
    }
  }

  /**
   * Upload from a readable stream with multipart upload.
   * Reads chunks into memory and uploads parts as they fill.
   */
  async uploadStream(
    bucket: string,
    key: string,
    stream: Readable,
    totalSize: number | undefined,
    opts?: {
      contentType?: string;
      signal?: AbortSignal;
      onProgress?: (uploaded: number, total: number | undefined) => void;
    },
  ): Promise<{ etag: string }> {
    if (totalSize !== undefined && totalSize <= MULTIPART_THRESHOLD) {
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      const data = Buffer.concat(chunks);
      return this.uploadFile(bucket, key, data, opts);
    }

    const uploadId = await this.createMultipartUpload(bucket, key, { contentType: opts?.contentType, signal: opts?.signal });
    const parts: Array<{ partNumber: number; etag: string }> = [];
    let uploaded = 0;
    let partNumber = 1;
    let buffer = Buffer.alloc(0);

    try {
      for await (const chunk of stream) {
        if (opts?.signal?.aborted) throw makeError('cancelled', 's3.uploadStream');
        buffer = Buffer.concat([buffer, chunk as Buffer]);

        while (buffer.length >= MULTIPART_PART_SIZE) {
          const partData = buffer.subarray(0, MULTIPART_PART_SIZE);
          buffer = buffer.subarray(MULTIPART_PART_SIZE);
          const { etag } = await this.uploadPart(bucket, key, uploadId, partNumber, Buffer.from(partData), opts?.signal);
          parts.push({ partNumber, etag });
          partNumber++;
          uploaded += partData.length;
          opts?.onProgress?.(uploaded, totalSize);
        }
      }

      if (buffer.length > 0) {
        const { etag } = await this.uploadPart(bucket, key, uploadId, partNumber, buffer, opts?.signal);
        parts.push({ partNumber, etag });
        uploaded += buffer.length;
        opts?.onProgress?.(uploaded, totalSize);
      }

      if (parts.length === 0) {
        await this.abortMultipartUpload(bucket, key, uploadId, opts?.signal);
        return this.putObject(bucket, key, Buffer.alloc(0), { contentType: opts?.contentType, signal: opts?.signal });
      }

      return await this.completeMultipartUpload(bucket, key, uploadId, parts, opts?.signal);
    } catch (err) {
      await this.abortMultipartUpload(bucket, key, uploadId).catch(() => {});
      throw err;
    }
  }

  /** Generate a presigned URL for downloading an object. */
  presignGetUrl(bucket: string, key: string, expiresInSeconds = 3600): S3PresignedUrl {
    return presignUrl({
      endpoint: this.cfg.endpoint,
      secure: this.cfg.secure,
      pathStyle: this.cfg.pathStyle,
      bucket,
      key,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      region: this.cfg.region,
      expiresInSeconds,
    });
  }
}
