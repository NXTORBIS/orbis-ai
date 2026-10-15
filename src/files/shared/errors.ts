/**
 * Structured error model shared by the main process and the UI.
 *
 * Every failure that crosses the IPC boundary is converted to an OrbisErrorShape.
 * The UI renders `message`; diagnostic detail (`cause`) is kept for logs and the
 * "details" disclosure, never shown as a raw stack trace.
 */

export type ErrorCategory =
  | 'not_found'
  | 'permission_denied'
  | 'already_exists'
  | 'invalid_path'
  | 'invalid_name'
  | 'not_a_directory'
  | 'is_a_directory'
  | 'directory_not_empty'
  | 'no_space'
  | 'busy'
  | 'cross_device'
  | 'name_too_long'
  | 'loop'
  | 'cancelled'
  | 'unsupported'
  | 'unavailable'
  | 'validation'
  | 'io'
  | 'internal';

/** Whether the failed operation changed anything on disk. */
export type DataChanged = 'no' | 'yes' | 'partial' | 'unknown';

export interface OrbisErrorShape {
  category: ErrorCategory;
  /** Human-readable, user-facing sentence. */
  message: string;
  /** Operation identifier, e.g. "fs.rename". */
  operation: string;
  /** Path or object the error concerns, when safe to disclose. */
  target?: string;
  /** Underlying cause code/message for diagnostics (e.g. "EACCES"). */
  cause?: string;
  dataChanged: DataChanged;
  retryable: boolean;
  /** Identifier that links this error to a diagnostic log record. */
  errorId?: string;
  /** The item is password-protected; retry with a password (archives). */
  needsPassword?: boolean;
  /** A password was given and it was not accepted. */
  wrongPassword?: boolean;
}

export class OrbisError extends Error {
  readonly shape: OrbisErrorShape;
  constructor(shape: OrbisErrorShape) {
    super(shape.message);
    this.name = 'OrbisError';
    this.shape = shape;
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: OrbisErrorShape };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(error: OrbisErrorShape): Result<T> => ({ ok: false, error });

const CODE_MAP: Record<string, { category: ErrorCategory; retryable: boolean }> = {
  ENOENT: { category: 'not_found', retryable: false },
  EACCES: { category: 'permission_denied', retryable: false },
  EPERM: { category: 'permission_denied', retryable: false },
  EEXIST: { category: 'already_exists', retryable: false },
  ENOTDIR: { category: 'not_a_directory', retryable: false },
  EISDIR: { category: 'is_a_directory', retryable: false },
  ENOTEMPTY: { category: 'directory_not_empty', retryable: false },
  ENOSPC: { category: 'no_space', retryable: true },
  EDQUOT: { category: 'no_space', retryable: true },
  EBUSY: { category: 'busy', retryable: true },
  ETXTBSY: { category: 'busy', retryable: true },
  EXDEV: { category: 'cross_device', retryable: false },
  ENAMETOOLONG: { category: 'name_too_long', retryable: false },
  ELOOP: { category: 'loop', retryable: false },
  EINVAL: { category: 'invalid_path', retryable: false },
  EIO: { category: 'io', retryable: true },
  EROFS: { category: 'permission_denied', retryable: false },
  EMFILE: { category: 'busy', retryable: true },
  ENFILE: { category: 'busy', retryable: true },
  ENODEV: { category: 'unavailable', retryable: true },
  ENXIO: { category: 'unavailable', retryable: true },
  ABORT_ERR: { category: 'cancelled', retryable: true },
};

const CATEGORY_TEXT: Record<ErrorCategory, string> = {
  not_found: 'The item no longer exists at this location.',
  permission_denied: 'You do not have permission to do this here.',
  already_exists: 'An item with this name already exists.',
  invalid_path: 'The path is not valid.',
  invalid_name: 'The name is not valid.',
  not_a_directory: 'This location is not a folder.',
  is_a_directory: 'This is a folder, not a file.',
  directory_not_empty: 'The folder is not empty.',
  no_space: 'There is not enough free space on the destination.',
  busy: 'The item is in use or the system is busy. Try again.',
  cross_device: 'The source and destination are on different volumes.',
  name_too_long: 'The name or path is too long for this file system.',
  loop: 'The path contains a symbolic link loop.',
  cancelled: 'The operation was cancelled.',
  unsupported: 'This action is not supported here.',
  unavailable: 'This location or service is not available.',
  validation: 'The request was not valid.',
  io: 'A read or write error occurred.',
  internal: 'An unexpected error occurred.',
};

export function categoryMessage(category: ErrorCategory): string {
  return CATEGORY_TEXT[category];
}

/** Convert any thrown value into a structured error. */
export function toOrbisError(
  err: unknown,
  operation: string,
  target?: string,
  dataChanged: DataChanged = 'unknown',
): OrbisErrorShape {
  if (err instanceof OrbisError) return err.shape;
  const anyErr = err as { code?: string; message?: string; name?: string } | undefined;
  const code = anyErr?.code ?? (anyErr?.name === 'AbortError' ? 'ABORT_ERR' : undefined);
  const mapped = code ? CODE_MAP[code] : undefined;
  const category: ErrorCategory = mapped?.category ?? 'internal';
  return {
    category,
    message: CATEGORY_TEXT[category],
    operation,
    target,
    cause: code ? `${code}${anyErr?.message ? `: ${stripPaths(anyErr.message)}` : ''}` : anyErr?.message,
    dataChanged: category === 'cancelled' && dataChanged === 'unknown' ? 'unknown' : dataChanged,
    retryable: mapped?.retryable ?? false,
  };
}

export function makeError(
  category: ErrorCategory,
  operation: string,
  opts: Partial<Omit<OrbisErrorShape, 'category' | 'operation'>> = {},
): OrbisError {
  return new OrbisError({
    category,
    operation,
    message: opts.message ?? CATEGORY_TEXT[category],
    target: opts.target,
    cause: opts.cause,
    dataChanged: opts.dataChanged ?? 'no',
    retryable: opts.retryable ?? false,
    ...(opts.needsPassword ? { needsPassword: true } : {}),
    ...(opts.wrongPassword ? { wrongPassword: true } : {}),
  });
}

/** Node error messages embed full paths; the path is reported separately in `target`. */
function stripPaths(message: string): string {
  return message.replace(/'[^']*'/g, "'…'");
}
