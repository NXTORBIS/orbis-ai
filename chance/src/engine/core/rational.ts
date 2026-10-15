/**
 * Exact rational arithmetic on arbitrary-precision integers.
 *
 * User-entered probabilities ("0.25", "25%", "1/4", "2.5e-3") are all rational,
 * so basic probability calculations can be performed exactly and shown both as
 * a reduced fraction and as a decimal. Denominators are always positive and
 * fractions are always kept in lowest terms.
 */
import { EngineError } from './result';

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Above this many decimal digits in numerator or denominator we stop exact arithmetic. */
export const MAX_RATIONAL_DIGITS = 400;

export class Rational {
  readonly num: bigint;
  readonly den: bigint;

  private constructor(num: bigint, den: bigint) {
    this.num = num;
    this.den = den;
  }

  static of(num: bigint | number, den: bigint | number = 1n): Rational {
    let n = typeof num === 'number' ? Rational.intToBig(num) : num;
    let d = typeof den === 'number' ? Rational.intToBig(den) : den;
    if (d === 0n) throw new EngineError('Division by zero in exact arithmetic.', 'division-by-zero');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    if (g > 1n) {
      n /= g;
      d /= g;
    }
    return new Rational(n, d);
  }

  private static intToBig(x: number): bigint {
    if (!Number.isInteger(x)) throw new EngineError(`Expected an integer, received ${x}.`);
    return BigInt(x);
  }

  static readonly ZERO = new Rational(0n, 1n);
  static readonly ONE = new Rational(1n, 1n);

  /**
   * Convert a finite JavaScript number to the rational number given by its
   * shortest round-trip decimal representation (so 0.1 becomes 1/10, not the
   * binary approximation).
   */
  static fromNumber(x: number): Rational {
    if (!Number.isFinite(x)) throw new EngineError('Cannot represent a non-finite number exactly.');
    const parsed = Rational.parse(String(x));
    if (!parsed) throw new EngineError(`Cannot represent ${x} exactly.`);
    return parsed;
  }

  /**
   * Parse a decimal ("0.25", "-1.5e-3"), percentage ("25%"), or fraction ("1/4",
   * "3 / 8") string. Returns null if the text is not a recognised numeric form.
   */
  static parse(text: string): Rational | null {
    const s = text.trim().replace(/,/g, '').replace(/\s+/g, ' ');
    if (!s) return null;
    const pct = /^(.+?)\s*%$/.exec(s);
    if (pct) {
      const inner = Rational.parse(pct[1]);
      return inner ? inner.div(Rational.of(100n)) : null;
    }
    const frac = /^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*\/\s*([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i.exec(s);
    if (frac) {
      const a = Rational.parse(frac[1]);
      const b = Rational.parse(frac[2]);
      if (!a || !b || b.isZero()) return null;
      return a.div(b);
    }
    const dec = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
    if (!dec) return null;
    const [, sign, intPart = '', fracPart = '', expPart] = dec;
    if (!intPart && !fracPart) return null;
    const exp = expPart ? parseInt(expPart, 10) : 0;
    if (Math.abs(exp) > 300) return null;
    let num = BigInt((intPart || '0') + fracPart);
    let den = 10n ** BigInt(fracPart.length);
    if (exp > 0) num *= 10n ** BigInt(exp);
    if (exp < 0) den *= 10n ** BigInt(-exp);
    if (sign === '-') num = -num;
    return Rational.of(num, den);
  }

  isZero(): boolean {
    return this.num === 0n;
  }

  isNegative(): boolean {
    return this.num < 0n;
  }

  isInteger(): boolean {
    return this.den === 1n;
  }

  private check(r: Rational): Rational {
    const digits = Math.max(r.num.toString().length, r.den.toString().length);
    if (digits > MAX_RATIONAL_DIGITS) {
      throw new EngineError(
        'Exact fraction became too large to represent; use the decimal result instead.',
        'precision',
      );
    }
    return r;
  }

  add(o: Rational): Rational {
    return this.check(Rational.of(this.num * o.den + o.num * this.den, this.den * o.den));
  }

  sub(o: Rational): Rational {
    return this.check(Rational.of(this.num * o.den - o.num * this.den, this.den * o.den));
  }

  mul(o: Rational): Rational {
    return this.check(Rational.of(this.num * o.num, this.den * o.den));
  }

  div(o: Rational): Rational {
    if (o.isZero()) throw new EngineError('Division by zero.', 'division-by-zero');
    return this.check(Rational.of(this.num * o.den, this.den * o.num));
  }

  neg(): Rational {
    return new Rational(-this.num, this.den);
  }

  pow(k: number): Rational {
    if (!Number.isInteger(k) || k < 0) throw new EngineError('Exponent must be a non-negative integer.');
    return this.check(Rational.of(this.num ** BigInt(k), this.den ** BigInt(k)));
  }

  compare(o: Rational): number {
    const l = this.num * o.den;
    const r = o.num * this.den;
    return l < r ? -1 : l > r ? 1 : 0;
  }

  equals(o: Rational): boolean {
    return this.num === o.num && this.den === o.den;
  }

  min(o: Rational): Rational {
    return this.compare(o) <= 0 ? this : o;
  }

  max(o: Rational): Rational {
    return this.compare(o) >= 0 ? this : o;
  }

  /**
   * Nearest double.
   *
   * When both parts convert to finite doubles, a single division is the most
   * accurate route (each conversion is correctly rounded, so the result is
   * within about one unit in the last place). Only when a part overflows does
   * the value need scaling, and the two parts are then reduced *separately* to
   * about 20 significant digits. Scaling by a single combined power of ten
   * would be wrong for very small values, because that power underflows to
   * zero long before the result does: 1/10^310 is a representable subnormal,
   * but 10^-310 computed on its own already loses most of its precision.
   */
  toNumber(): number {
    if (this.num === 0n) return 0;
    const n = Number(this.num);
    const d = Number(this.den);
    if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) return n / d;

    const KEEP = 20;
    const numDigits = (this.num < 0n ? -this.num : this.num).toString().length;
    const denDigits = this.den.toString().length;
    const numDrop = Math.max(0, numDigits - KEEP);
    const denDrop = Math.max(0, denDigits - KEEP);
    const scaledNum = Number(this.num / 10n ** BigInt(numDrop));
    const scaledDen = Number(this.den / 10n ** BigInt(denDrop));
    if (scaledDen === 0) return this.num < 0n ? -Infinity : Infinity;
    // Apply the leftover exponent in two halves so neither overflows nor
    // underflows before the other can compensate.
    const exponent = numDrop - denDrop;
    const half = Math.trunc(exponent / 2);
    return (scaledNum / scaledDen) * 10 ** half * 10 ** (exponent - half);
  }

  /** "a/b" or "a" for integers. */
  toFractionString(): string {
    return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`;
  }

  /** True when the fraction is short enough to be meaningful to display. */
  isDisplayable(maxDigits = 12): boolean {
    return this.num.toString().length <= maxDigits && this.den.toString().length <= maxDigits;
  }
}
