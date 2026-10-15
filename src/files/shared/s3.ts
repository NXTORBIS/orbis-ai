import { z } from 'zod';

/**
 * S3-compatible object storage: shared types for the main process and the
 * renderer. Connections are kept separate from SFTP/WebDAV/FTP remotes because
 * S3 is object storage (not a file system), has its own addressing (buckets +
 * keys), its own auth model (SigV4), and operations like multipart upload and
 * presigned URLs that have no equivalent in the remote file-system interface.
 */

// ------------------------------------------------------------------ providers

export interface S3ProviderPreset {
  name: string;
  /** Endpoint template; `{region}` is replaced with the chosen region, `{accountId}` with the user's input. */
  endpoint: string;
  regions?: string[];
  /** Shown under the endpoint field when it is editable (MinIO, custom). */
  note?: string;
  /** Whether the endpoint needs `{accountId}` (Cloudflare R2). */
  needsAccountId?: boolean;
  pathStyle?: boolean;
}

export const S3_PROVIDERS: Record<string, S3ProviderPreset> = {
  aws: {
    name: 'Amazon S3',
    endpoint: 's3.{region}.amazonaws.com',
    regions: [
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'af-south-1', 'ap-east-1', 'ap-south-1', 'ap-south-2',
      'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
      'ca-central-1', 'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-south-1', 'eu-south-2', 'eu-north-1',
      'me-south-1', 'me-central-1', 'sa-east-1',
    ],
  },
  backblaze: {
    name: 'Backblaze B2',
    endpoint: 's3.{region}.backblazeb2.com',
    regions: ['us-west-000', 'us-west-004', 'eu-central-003'],
    pathStyle: true,
  },
  minio: {
    name: 'MinIO',
    endpoint: '',
    note: 'Enter your MinIO server URL (e.g. minio.example.com:9000).',
    pathStyle: true,
  },
  digitalocean: {
    name: 'DigitalOcean Spaces',
    endpoint: '{region}.digitaloceanspaces.com',
    regions: ['nyc3', 'sfo3', 'ams3', 'sgp1', 'fra1'],
  },
  wasabi: {
    name: 'Wasabi',
    endpoint: 's3.{region}.wasabisys.com',
    regions: ['us-east-1', 'us-east-2', 'us-west-1', 'eu-central-1', 'eu-central-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1', 'ap-southeast-2'],
  },
  r2: {
    name: 'Cloudflare R2',
    endpoint: '{accountId}.r2.cloudflarestorage.com',
    needsAccountId: true,
    pathStyle: true,
  },
  custom: {
    name: 'Custom S3-Compatible',
    endpoint: '',
    note: 'Enter the endpoint of your S3-compatible storage server.',
    pathStyle: true,
  },
};

export type S3ProviderId = keyof typeof S3_PROVIDERS;
export const S3_PROVIDER_IDS = Object.keys(S3_PROVIDERS) as S3ProviderId[];

// ------------------------------------------------------------------ connection input

export const S3ConnectionInputSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{8,32}$/).optional(),
    name: z.string().trim().min(1).max(80),
    provider: z.string().min(1).max(32),
    /** Resolved endpoint host (no scheme, no path). */
    endpoint: z.string().trim().min(1).max(512),
    region: z.string().trim().min(1).max(64),
    accessKeyId: z.string().min(1).max(256).refine((s) => !/[\0\r\n]/.test(s), 'The access key ID cannot contain line breaks or null characters.'),
    /** Write-only: undefined keeps a stored secret, null removes it, a string replaces it. */
    secretAccessKey: z.string().min(1).max(1024).nullable().optional(),
    /** When true, use HTTPS (default true). */
    secure: z.boolean().default(true),
    /** Default bucket to open (optional; if empty, the bucket list is shown). */
    bucket: z.string().max(256).default(''),
    /** Cloudflare R2 account ID. */
    accountId: z.string().max(256).default(''),
    /** Use path-style addressing (required for MinIO, B2, R2). */
    pathStyle: z.boolean().default(false),
    /** 'stored': the secret is kept encrypted with the OS secure storage; 'ask': asked for when connecting. */
    secretMode: z.enum(['stored', 'ask']),
  })
  .strict();

export type S3ConnectionInput = z.input<typeof S3ConnectionInputSchema>;

/** Connection as the renderer sees it: never with a secret. */
export interface S3ConnectionInfo {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secure: boolean;
  bucket: string;
  accountId: string;
  pathStyle: boolean;
  secretMode: 'stored' | 'ask';
  hasSecret: boolean;
  connected: boolean;
}

// ------------------------------------------------------------------ S3 objects

export interface S3Bucket {
  name: string;
  creationDate?: string;
}

export interface S3Object {
  key: string;
  /** Display name (the last segment of the key). */
  name: string;
  /** Whether this is a "folder" (common prefix or zero-byte key ending with /). */
  isPrefix: boolean;
  size?: number;
  lastModified?: string;
  etag?: string;
  storageClass?: string;
}

export interface S3ListResult {
  objects: S3Object[];
  prefixes: string[];
  truncated: boolean;
  continuationToken?: string;
}

export interface S3PresignedUrl {
  url: string;
  expiresInSeconds: number;
}

/** Resolves the endpoint for a provider and region/accountId. */
export function resolveEndpoint(provider: S3ProviderId, region: string, accountId?: string): string {
  const preset = S3_PROVIDERS[provider];
  if (!preset?.endpoint) return '';
  return preset.endpoint
    .replace('{region}', region)
    .replace('{accountId}', accountId ?? '');
}

/** Parse a key into its "folder" prefix and "name" part. */
export function s3KeyParts(key: string): { prefix: string; name: string } {
  const k = key.endsWith('/') ? key.slice(0, -1) : key;
  const lastSlash = k.lastIndexOf('/');
  if (lastSlash < 0) return { prefix: '', name: k };
  return { prefix: k.slice(0, lastSlash + 1), name: k.slice(lastSlash + 1) };
}
