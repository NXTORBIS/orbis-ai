/**
 * Runs the 7-Zip command line (7-Zip 24.09 compiled to WebAssembly, package
 * "7z-wasm") against real directories mounted into its virtual file system.
 * This module has no Electron dependency; it runs inside a worker thread in
 * the app and directly in tests.
 */

import SevenZipFactory from '7z-wasm';

const SevenZip = SevenZipFactory as unknown as (opts: Record<string, unknown>) => Promise<SevenZipModule>;

interface SevenZipFS {
  mkdir(p: string): void;
  mount(type: unknown, opts: { root: string }, mountpoint: string): void;
  chdir(p: string): void;
  writeFile(p: string, data: string): void;
  chmod(p: string, mode: number, dontFollow?: boolean): void;
}
interface SevenZipModule {
  FS: SevenZipFS;
  NODEFS: unknown;
  callMain(args: string[]): number | undefined;
}

export interface SevenZipJob {
  args: string[];
  /** Real directories exposed to 7-Zip at the given virtual paths. */
  mounts: Array<{ real: string; virt: string }>;
  cwd?: string;
  /** Files created in memory before running (e.g. list files for -i@). */
  files?: Array<{ virt: string; text: string }>;
  /**
   * Archive password. Kept out of `args` so a recorded or logged command line
   * never contains it; it is added as a single argv element (`-p<password>`)
   * only when 7-Zip is called, with no shell involved. Read commands without a
   * password get an empty `-p` so 7-Zip never waits for a prompt.
   */
  password?: string;
}

const READ_COMMANDS = new Set(['l', 't', 'x', 'e']);

/** The argv 7-Zip receives: `args` with the password switch inserted after the command. */
export function argvWithPassword(args: string[], password: string | undefined): string[] {
  if (args.some((a) => /^-p/.test(a))) throw new Error('Pass archive passwords through job.password, not in args.');
  const [cmd, ...rest] = args;
  if (cmd === undefined) return args;
  if (password !== undefined) return [cmd, `-p${password}`, ...rest];
  return READ_COMMANDS.has(cmd) ? [cmd, '-p', ...rest] : args;
}

/** Remove a secret from text that will be shown or recorded (7-Zip does not echo passwords; this is a safety net). */
export function scrubSecret(text: string, secret: string | undefined): string {
  return secret && secret.length >= 3 ? text.split(secret).join('•••') : text;
}

export interface SevenZipResult {
  code: number;
  stdout: string[];
  stderr: string[];
}

function mkdirs(fs: SevenZipFS, p: string): void {
  let cur = '';
  for (const seg of p.split('/').filter(Boolean)) {
    cur += `/${seg}`;
    try {
      fs.mkdir(cur);
    } catch {
      /* exists */
    }
  }
}

export async function exec7z(wasmBinary: Uint8Array, job: SevenZipJob, onLine?: (line: string, stream: 'out' | 'err') => void): Promise<SevenZipResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let code = 0;
  const mod = await SevenZip({
    wasmBinary,
    print: (raw: string) => {
      const l = scrubSecret(raw, job.password);
      stdout.push(l);
      onLine?.(l, 'out');
    },
    printErr: (raw: string) => {
      const l = scrubSecret(raw, job.password);
      stderr.push(l);
      onLine?.(l, 'err');
    },
    stdin: () => null,
    quit: (c: number) => {
      code = c;
    },
    noExitRuntime: false,
  });
  // 7-Zip WASM sets mode 000 on folders extracted from tar; ignore those chmods so sub-folders stay writable.
  const chmod = mod.FS.chmod.bind(mod.FS);
  mod.FS.chmod = (p: string, mode: number, dontFollow?: boolean) => {
    if (mode) chmod(p, mode, dontFollow);
  };
  for (const m of job.mounts) {
    mkdirs(mod.FS, m.virt);
    mod.FS.mount(mod.NODEFS, { root: m.real }, m.virt);
  }
  for (const f of job.files ?? []) {
    mkdirs(mod.FS, f.virt.slice(0, f.virt.lastIndexOf('/')));
    mod.FS.writeFile(f.virt, f.text);
  }
  if (job.cwd) mod.FS.chdir(job.cwd);
  try {
    const r = mod.callMain(argvWithPassword(job.args, job.password));
    if (typeof r === 'number') code = r;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (typeof status === 'number') code = status;
    else {
      stderr.push(scrubSecret(String((err as Error).message ?? err), job.password));
      code = 2;
    }
  }
  return { code, stdout, stderr };
}
