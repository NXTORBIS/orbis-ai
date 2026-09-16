import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * What an update has got as far as, written down where a crash cannot lose it.
 *
 * Installing replaces the running application, so the interesting question is never "did it work" but "what if the
 * power goes out halfway". Each step is recorded before it is taken, so that whatever happens — Orbis crashing, the
 * updater crashing, the machine being switched off mid-install — the next start can look at the record and know
 * whether to carry on, to put the old version back, or to forget the whole thing.
 *
 * The record describes the application only. Nothing in here knows anything about a user's profiles, and recovery
 * never touches them.
 */

export type UpdateStep =
  | 'update-started'
  | 'package-verified'
  | 'staged'
  | 'install-started'
  | 'install-completed'
  | 'validation-started'
  | 'validation-completed'
  | 'completed'
  | 'rolled-back'

export interface UpdateTransaction {
  id: string
  step: UpdateStep
  /** What was installed, and what it replaced, so a rollback knows where to go back to. */
  fromVersion: string
  toVersion: string
  /** The verified package on disk. */
  packagePath: string
  /** The installer for the version being replaced, kept so it can be put back if the new one will not run. */
  rollbackPackagePath: string | null
  startedAt: number
  updatedAt: number
  /** Why it stopped, when it stopped badly. */
  problem?: string
  /** How many times this transaction has been attempted, so a broken update cannot loop for ever. */
  attempts: number
}

/** After this many goes, an update that keeps failing is given up rather than retried on every start. */
export const MAX_ATTEMPTS = 3

export type Recovery =
  | { action: 'none' }
  /** The install never got going, so the package is still good and it can simply be tried again. */
  | { action: 'retry-install'; transaction: UpdateTransaction }
  /** Files were being replaced when it stopped: the previous version goes back. */
  | { action: 'roll-back'; transaction: UpdateTransaction; reason: string }
  /** It finished but never confirmed it worked; confirming is all that is left. */
  | { action: 'validate'; transaction: UpdateTransaction }
  /** Nothing can be done with it any more, and it should be cleared away. */
  | { action: 'give-up'; transaction: UpdateTransaction; reason: string }

/**
 * What to do about a transaction found at startup. The rule is simple and cautious: anything interrupted while the
 * application was being replaced goes back to the version that was known to work.
 */
export function recoveryFor(transaction: UpdateTransaction | null): Recovery {
  if (!transaction) return { action: 'none' }
  if (transaction.step === 'completed' || transaction.step === 'rolled-back') return { action: 'none' }
  if (transaction.attempts >= MAX_ATTEMPTS) {
    return { action: 'give-up', transaction, reason: `the update to ${transaction.toVersion} failed ${transaction.attempts} times` }
  }

  switch (transaction.step) {
    case 'update-started':
    case 'package-verified':
    case 'staged':
      // Nothing had been replaced yet, so the installed Orbis is untouched and the package can be used again.
      return { action: 'retry-install', transaction }
    case 'install-started':
      return { action: 'roll-back', transaction, reason: 'Orbis stopped while the update was being installed' }
    case 'install-completed':
    case 'validation-started':
      // It was installed but never shown to work. Checking is what is left; failing that check rolls back.
      return { action: 'validate', transaction }
    case 'validation-completed':
      return { action: 'validate', transaction }
    default:
      return { action: 'give-up', transaction, reason: 'the update record does not make sense' }
  }
}

const isStep = (value: unknown): value is UpdateStep =>
  typeof value === 'string' &&
  ['update-started', 'package-verified', 'staged', 'install-started', 'install-completed', 'validation-started', 'validation-completed', 'completed', 'rolled-back'].includes(value)

/** Reads a stored record, refusing anything that does not make sense rather than acting on half of it. */
export function readTransaction(raw: unknown): UpdateTransaction | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<UpdateTransaction>
  if (typeof r.id !== 'string' || !r.id || !isStep(r.step)) return null
  if (typeof r.toVersion !== 'string' || typeof r.fromVersion !== 'string') return null
  if (typeof r.packagePath !== 'string') return null
  return {
    id: r.id,
    step: r.step,
    fromVersion: r.fromVersion,
    toVersion: r.toVersion,
    packagePath: r.packagePath,
    rollbackPackagePath: typeof r.rollbackPackagePath === 'string' ? r.rollbackPackagePath : null,
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
    ...(typeof r.problem === 'string' ? { problem: r.problem.slice(0, 500) } : {}),
    attempts: typeof r.attempts === 'number' && r.attempts >= 0 ? Math.min(r.attempts, 99) : 0
  }
}

/**
 * The record on disk. Every write goes to a temporary file first and is then moved into place, so a crash mid-write
 * leaves the previous record rather than half of a new one.
 */
export class UpdateJournal {
  private readonly file: string

  constructor(directory: string) {
    this.file = join(directory, 'update-transaction.json')
  }

  async read(): Promise<UpdateTransaction | null> {
    try {
      return readTransaction(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      return null
    }
  }

  private async write(transaction: UpdateTransaction): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.writing`
    await writeFile(temporary, JSON.stringify(transaction, null, 2))
    await rename(temporary, this.file)
  }

  /** Starts a transaction, or picks up the one already under way for the same release. */
  async begin(details: Omit<UpdateTransaction, 'step' | 'startedAt' | 'updatedAt' | 'attempts'>): Promise<UpdateTransaction> {
    const existing = await this.read()
    const now = Date.now()
    const transaction: UpdateTransaction = {
      ...details,
      step: 'update-started',
      startedAt: existing && existing.toVersion === details.toVersion ? existing.startedAt : now,
      updatedAt: now,
      attempts: existing && existing.toVersion === details.toVersion ? existing.attempts + 1 : 1
    }
    await this.write(transaction)
    return transaction
  }

  /** Records that a step has been reached. Written before the step is acted on, never after. */
  async record(step: UpdateStep, problem?: string): Promise<UpdateTransaction | null> {
    const current = await this.read()
    if (!current) return null
    const next: UpdateTransaction = { ...current, step, updatedAt: Date.now(), ...(problem ? { problem } : {}) }
    await this.write(next)
    return next
  }

  /** Forgets the transaction: it finished, or it is being given up on. */
  async clear(): Promise<void> {
    await rm(this.file, { force: true })
  }
}
