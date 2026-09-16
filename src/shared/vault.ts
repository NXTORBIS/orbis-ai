/**
 * The Orbis Search secrets vault: what it holds, and what it is allowed to say about itself.
 *
 * This is the part with no keys and no storage in it — the shapes of a secret, the settings, and the password
 * generator. Nothing here encrypts, decrypts or remembers anything, and nothing here ever sees a master password.
 *
 * The rule that matters most is in the types: a secret's *value* and a secret's *description of itself* are separate.
 * A name, a provider and a website can be listed while the vault is unlocked; the value is fetched one at a time, by
 * id, and only when somebody asks to see it.
 */

export type SecretKind = 'apiKey' | 'password' | 'login' | 'note' | 'recoveryCode' | 'custom'

export const SECRET_KINDS: SecretKind[] = ['apiKey', 'password', 'login', 'note', 'recoveryCode', 'custom']

export const KIND_LABEL: Record<SecretKind, string> = {
  apiKey: 'API key',
  password: 'Password',
  login: 'Login',
  note: 'Secure note',
  recoveryCode: 'Recovery code',
  custom: 'Custom secret'
}

/**
 * What a secret says about itself.
 *
 * Everything here is shown in the list, so none of it is the secret. A name, which provider it is for, which site it
 * belongs to and the username are how somebody finds the right entry; the value itself is never part of this.
 */
export interface SecretSummary {
  id: string
  kind: SecretKind
  name: string
  /** Who it is for: "Groq", "GitHub". The user's word, never a fixed list. */
  provider?: string
  website?: string
  username?: string
  category?: string
  tags: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
  /** How many fields a custom secret has, so the list can say so without saying what they are. */
  fieldCount?: number
}

/** A secret in full, which only exists in the window for as long as it is being looked at or edited. */
export interface SecretDetail extends SecretSummary {
  /** The one that matters: the key, the password, the note, the code. */
  value: string
  notes?: string
  /** A custom secret's own fields. */
  fields?: { name: string; value: string }[]
}

/** What the window sends when adding or changing one. */
export interface SecretInput {
  kind: SecretKind
  name: string
  value: string
  provider?: string
  website?: string
  username?: string
  notes?: string
  category?: string
  tags?: string[]
  favorite?: boolean
  fields?: { name: string; value: string }[]
}

// ---------------------------------------------------------------- locking

/** How long the vault stays unlocked with nothing happening. */
export const AUTO_LOCK_CHOICES = [0, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, -1] as const
export type AutoLockMs = (typeof AUTO_LOCK_CHOICES)[number]

export function saidAutoLock(ms: number): string {
  if (ms === 0) return 'Immediately'
  if (ms < 0) return 'Never'
  const minutes = Math.round(ms / 60_000)
  return minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minute${minutes === 1 ? '' : 's'}`
}

export const normalizeAutoLock = (ms: unknown): AutoLockMs =>
  (AUTO_LOCK_CHOICES as readonly number[]).includes(ms as number) ? (ms as AutoLockMs) : 5 * 60_000

/** What the window is told about the vault. None of it is secret, and none of it is the password. */
export interface VaultStatus {
  /** Whether this profile has a vault at all; false means the setup screen. */
  exists: boolean
  unlocked: boolean
  /** Whether a way back in was set up. Not the question itself, which is only shown when asked for. */
  hasRecovery: boolean
  autoLockMs: AutoLockMs
  /** When it will lock itself, while unlocked. */
  locksAt?: number
  count?: number
}

// ---------------------------------------------------------------- what may be stored

const MAX_NAME = 120
const MAX_VALUE = 20_000
const MAX_NOTES = 20_000
const MAX_FIELDS = 40
export const MIN_MASTER_PASSWORD = 8

const tidy = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\r/g, '').trim().slice(0, max) : '')

/** A master password worth the name, or why it is not. */
export function checkMasterPassword(password: unknown): string | null {
  if (typeof password !== 'string' || !password) return 'Enter a master password.'
  if (password.length < MIN_MASTER_PASSWORD) return `A master password needs at least ${MIN_MASTER_PASSWORD} characters.`
  if (password.length > 1024) return 'That master password is too long.'
  return null
}

/** A secret from the window, made safe to store. Returns null when there is nothing worth storing. */
export function readSecretInput(raw: unknown): SecretInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = SECRET_KINDS.includes(r.kind as SecretKind) ? (r.kind as SecretKind) : 'custom'
  const name = tidy(r.name, MAX_NAME)
  const value = typeof r.value === 'string' ? r.value.slice(0, MAX_VALUE) : ''
  const fields = Array.isArray(r.fields)
    ? r.fields
        .map((f) => ({ name: tidy((f as { name?: unknown })?.name, MAX_NAME), value: typeof (f as { value?: unknown })?.value === 'string' ? ((f as { value: string }).value).slice(0, MAX_VALUE) : '' }))
        .filter((f) => f.name || f.value)
        .slice(0, MAX_FIELDS)
    : []
  // A secret with no name and nothing in it is not a secret.
  if (!name && !value && !fields.length) return null

  return {
    kind,
    name: name || 'Untitled',
    value,
    ...(tidy(r.provider, MAX_NAME) ? { provider: tidy(r.provider, MAX_NAME) } : {}),
    ...(tidy(r.website, 500) ? { website: tidy(r.website, 500) } : {}),
    ...(tidy(r.username, MAX_NAME) ? { username: tidy(r.username, MAX_NAME) } : {}),
    ...(tidy(r.notes, MAX_NOTES) ? { notes: tidy(r.notes, MAX_NOTES) } : {}),
    ...(tidy(r.category, MAX_NAME) ? { category: tidy(r.category, MAX_NAME) } : {}),
    tags: Array.isArray(r.tags) ? [...new Set(r.tags.map((t) => tidy(t, 40)).filter(Boolean))].slice(0, 20) : [],
    favorite: r.favorite === true,
    ...(fields.length ? { fields } : {})
  }
}

/** What a secret may say about itself in a list: everything except what it is. */
export function summarize(detail: SecretDetail): SecretSummary {
  const { value: _value, notes: _notes, fields, ...rest } = detail
  return { ...rest, ...(fields ? { fieldCount: fields.length } : {}) }
}

/**
 * Finding a secret by what it says about itself.
 *
 * Only the description is searched, never the value: somebody typing part of a password into a search box should not
 * have it match, and a search should never need the values to be decrypted at all.
 */
export function matchesSearch(summary: SecretSummary, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [summary.name, summary.provider, summary.website, summary.username, summary.category, KIND_LABEL[summary.kind], ...summary.tags]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return q.split(/\s+/).every((word) => haystack.includes(word))
}

// ---------------------------------------------------------------- making a password

export interface GeneratorOptions {
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
  /** Leaves out the characters people misread: O and 0, l and 1 and I. */
  avoidAmbiguous: boolean
  /** Anything else somebody wants in the alphabet. */
  extra?: string
}

export const MIN_GENERATED = 4
export const MAX_GENERATED = 128

export function defaultGenerator(): GeneratorOptions {
  return { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, avoidAmbiguous: false }
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/'
const AMBIGUOUS = /[O0l1I|`'"5S2Z8B]/g

/** The characters a password may be made of, given what was asked for. Empty when nothing was. */
export function alphabet(options: GeneratorOptions): string {
  let chars = ''
  if (options.uppercase) chars += UPPER
  if (options.lowercase) chars += LOWER
  if (options.numbers) chars += DIGITS
  if (options.symbols) chars += SYMBOLS
  if (options.extra) chars += options.extra
  if (options.avoidAmbiguous) chars = chars.replace(AMBIGUOUS, '')
  return [...new Set(chars)].join('')
}

/**
 * A password, from random bytes somebody else supplies.
 *
 * The randomness is handed in so this file stays pure and so the caller is the one choosing a real source — in Orbis
 * that is the platform's cryptographic generator, never Math.random.
 *
 * Bytes are rejected rather than folded when they do not divide evenly into the alphabet: taking a modulus of a random
 * byte quietly makes the first few characters more likely than the rest, which is exactly the kind of weakness nobody
 * notices until it matters.
 */
export function makePassword(options: GeneratorOptions, randomBytes: (n: number) => Uint8Array): string {
  const chars = alphabet(options)
  if (!chars) return ''
  const length = Math.max(MIN_GENERATED, Math.min(MAX_GENERATED, Math.round(options.length) || MIN_GENERATED))
  const limit = Math.floor(256 / chars.length) * chars.length

  let out = ''
  let pool = randomBytes(length * 2)
  let at = 0
  while (out.length < length) {
    if (at >= pool.length) {
      pool = randomBytes(length * 2)
      at = 0
    }
    const byte = pool[at++]
    if (byte < limit) out += chars[byte % chars.length]
  }
  return out
}

/** How hard a password would be to guess, in bits, given the alphabet it was drawn from. */
export function strengthBits(password: string, options: GeneratorOptions): number {
  const size = alphabet(options).length || 1
  return Math.round(password.length * Math.log2(size))
}
