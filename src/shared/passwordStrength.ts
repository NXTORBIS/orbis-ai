/**
 * Whether a password is good enough, and how to say so.
 *
 * The rule here is length and unpredictability, not a checklist of character classes. "P@ssw0rd1" satisfies every
 * composition rule anyone has ever written and is one of the first things any attacker tries; "the seven red bicycles"
 * satisfies none of them and is enormously harder to guess. So this measures the things that actually matter -- how
 * long it is, how much of it is repetition, and whether it is something people commonly choose -- and refuses to
 * demand a capital letter and a symbol.
 *
 * Nothing here is a security boundary. The boundary is scrypt and AES-GCM in `main/vault/crypto.ts`. This only decides
 * what to let somebody choose, and what to tell them about it.
 */

/**
 * The shortest password Orbis will accept.
 *
 * Twelve rather than eight. Eight characters is within reach of an offline attack on a stolen file, and this credential
 * protects a file sitting on the person's own disk -- which is exactly the case where an attacker gets as many guesses
 * as they like.
 */
export const PASSWORD_MIN = 12

/** Long enough for any passphrase, short enough that a paste accident cannot become a denial of service. */
export const PASSWORD_MAX = 256

export type Strength = 'weak' | 'fair' | 'good' | 'strong'

export interface PasswordVerdict {
  /** Whether Orbis will accept it. */
  ok: boolean
  strength: Strength
  /** 0 to 4, for the meter. Not a security measurement; a way of drawing one. */
  score: number
  /** What to tell the person, or '' when there is nothing to say. One sentence, never a list of rules. */
  problem: string
  /** A nudge shown once it is acceptable but could be better. */
  advice: string
}

/**
 * Passwords people actually choose.
 *
 * Deliberately short. A real breach list has hundreds of millions of entries and belongs in a downloaded dataset, not
 * in a source file -- so this catches the handful that appear at the very top of every such list, and the scoring below
 * catches the broader shape of a bad choice. It is checked case-insensitively and after stripping trailing digits,
 * because "Password123" is "password".
 */
const COMMON = new Set([
  'password',
  'passwords',
  'passw0rd',
  'letmein',
  'welcome',
  'admin',
  'administrator',
  'qwerty',
  'qwertyuiop',
  'asdfgh',
  'asdfghjkl',
  'zxcvbn',
  'zxcvbnm',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'trustno',
  'starwars',
  'whatever',
  'freedom',
  'master',
  'shadow',
  'michael',
  'jennifer',
  'computer',
  'internet',
  'samsung',
  'google',
  'chrome',
  'firefox',
  'orbis',
  'orbisai',
  'secret',
  'changeme',
  'default',
  'login',
  'abc',
  'abcd',
  'abcdef',
  'abcdefg',
  'test',
  'testing',
  'hello',
  'hellothere'
])

/** Keyboard rows and sequences, for spotting a password that is just a walk across the keys. */
const RUNS = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

/** The recognisable core of a password: lowercased, with trailing digits and punctuation taken off. */
const core = (password: string): string =>
  password
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/[0-9]+$/, '')

/** How many distinct characters it uses, as a fraction of its length. "aaaaaaaaaaaa" scores very low. */
function variety(password: string): number {
  if (!password) return 0
  return new Set(password).size / password.length
}

/** The longest run of one repeated character. */
function longestRepeat(password: string): number {
  let most = 0
  let run = 0
  let last = ''
  for (const ch of password) {
    run = ch === last ? run + 1 : 1
    last = ch
    if (run > most) most = run
  }
  return most
}

/**
 * The shortest pattern the whole password is made of, or its full length when there is none.
 *
 * "aaaaaaaaaaaa" has a period of 1 and "alalalalalal" a period of 2. The second one defeats a check that only looks for
 * a repeated *character*, and is just as weak: it draws on an alphabet of two.
 */
function period(password: string): number {
  for (let size = 1; size <= Math.floor(password.length / 2); size++) {
    if (password.length % size !== 0) continue
    const unit = password.slice(0, size)
    if (unit.repeat(password.length / size) === password) return size
  }
  return password.length
}

/** The longest stretch that walks along a keyboard row or the alphabet, forwards or backwards. */
function longestRun(password: string): number {
  const lower = password.toLowerCase()
  let most = 0
  for (const row of RUNS) {
    const back = [...row].reverse().join('')
    for (const source of [row, back]) {
      for (let length = 4; length <= lower.length; length++) {
        for (let at = 0; at + length <= lower.length; at++) {
          if (source.includes(lower.slice(at, at + length)) && length > most) most = length
        }
      }
    }
  }
  return most
}

/** Whether it is one of the passwords everybody picks, or that with some digits stuck on the end. */
export function isCommonPassword(password: string): boolean {
  const stem = core(password)
  if (!stem) return false
  if (COMMON.has(stem)) return true
  // "password1", "qwerty2024": the digits were already stripped by `core`, so this catches a common word with anything
  // non-alphanumeric between its letters as well.
  return COMMON.has(stem.replace(/[0-9]/g, ''))
}

/**
 * What Orbis thinks of a password.
 *
 * The refusals are few and each has a reason a person would accept: too short to resist an offline attack; a password
 * everybody uses; a single character held down; a walk across the keyboard. Everything else is allowed, and merely
 * described.
 */
export function judgePassword(password: string, name = ''): PasswordVerdict {
  const no = (problem: string): PasswordVerdict => ({ ok: false, strength: 'weak', score: 0, problem, advice: '' })

  if (!password) return no('')
  if (password.length > PASSWORD_MAX) return no(`Keep it under ${PASSWORD_MAX} characters.`)
  if (password.trim().length === 0) return no('A password of only spaces is not a password.')
  if (password.length < PASSWORD_MIN) {
    const short = PASSWORD_MIN - password.length
    return no(`${short} more character${short === 1 ? '' : 's'}. Length is what makes a password hard to guess.`)
  }
  if (isCommonPassword(password)) return no('That is one of the first passwords anyone would try. Choose another.')
  if (longestRepeat(password) >= Math.max(4, Math.ceil(password.length / 2))) {
    return no('That is mostly the same character repeated. Try a phrase instead.')
  }
  // A short pattern repeated is as guessable as a repeated character, and looks nothing like one.
  const unit = period(password)
  if (unit <= 3 && password.length / unit >= 4) {
    return no('That is a short pattern repeated. Try a phrase instead.')
  }
  if (longestRun(password) >= 6) return no('That is a walk across the keyboard. Try a phrase instead.')

  // The name is not a secret -- it is on the screen directly above this field. Taking every occurrence of it out and
  // seeing what is left catches the name, the name twice, and the name with a year on the end.
  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (cleanName.length >= 3) {
    const withoutName = core(password).split(cleanName).join('')
    if (withoutName.length < 4) {
      return no('That is essentially just your name. Choose something only you would think of.')
    }
  }

  // ---- acceptable, so how good is it -----------------------------------------------------------
  //
  // Length carries most of the weight, because it deserves most of the weight. Variety is a small correction for
  // "abababababab", which is long and predictable.
  let score = 1
  if (password.length >= 16) score++
  if (password.length >= 20) score++
  if (password.length >= 28) score++
  const spread = variety(password)
  if (spread < 0.35) score = Math.max(1, score - 1)
  if (/\s/.test(password.trim()) && password.length >= 16) score = Math.min(4, score + 1)

  const strength: Strength = score >= 4 ? 'strong' : score === 3 ? 'good' : score === 2 ? 'fair' : 'weak'
  const advice =
    score >= 4
      ? ''
      : password.length < 20
        ? 'A few more words would make this considerably harder to guess.'
        : 'Good. A longer phrase would be stronger still.'

  return { ok: true, strength, score, problem: '', advice }
}

/** Whether two entries of a password match, and what to say when they do not. */
export function confirmPassword(password: string, again: string): { ok: boolean; problem: string } {
  if (!again) return { ok: false, problem: '' }
  if (password !== again) return { ok: false, problem: 'Those do not match.' }
  return { ok: true, problem: '' }
}
