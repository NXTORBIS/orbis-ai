/**
 * File encryption (.orbisenc) constants and the password strength hint shared
 * by the Encrypt dialog and the main process.
 */

export const ORBISENC_EXT = '.orbisenc';
/** Shortest password accepted for encrypting (decrypting accepts what was used). */
export const ENCRYPT_PASSWORD_MIN = 8;

export interface StrengthHint {
  /** Rough estimate in bits: length × log2(size of the character classes used). */
  bits: number;
  level: 'too-short' | 'weak' | 'fair' | 'good' | 'strong';
  label: string;
}

/**
 * A deliberately simple, honest estimate from length and character classes
 * only. It cannot know whether the password is a dictionary word, a common
 * password or reused elsewhere, so it never claims more than "strong by length
 * and variety".
 */
export function passwordStrength(pw: string): StrengthHint {
  const chars = [...pw];
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(pw)) pool += 32;
  if (/\s/.test(pw)) pool += 1;
  if (/[^\x00-\x7f]/.test(pw)) pool += 100;
  // Repeating one character adds little: count distinct runs, not raw length, for long repeats.
  const distinct = new Set(chars).size;
  const effective = Math.min(chars.length, distinct * 3);
  const bits = Math.round(effective * Math.log2(Math.max(pool, 1)));
  if (chars.length < ENCRYPT_PASSWORD_MIN) return { bits, level: 'too-short', label: `Too short — use at least ${ENCRYPT_PASSWORD_MIN} characters` };
  if (bits < 45) return { bits, level: 'weak', label: 'Weak — easy to guess with a fast computer' };
  if (bits < 65) return { bits, level: 'fair', label: 'Fair — longer is better' };
  if (bits < 90) return { bits, level: 'good', label: 'Good' };
  return { bits, level: 'strong', label: 'Strong by length and variety' };
}
