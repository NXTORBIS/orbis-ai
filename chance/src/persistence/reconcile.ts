/**
 * Reconciling a stored or imported configuration against a tool's defaults.
 *
 * Every configuration that reaches a tool screen comes through here: ones
 * restored from IndexedDB, ones opened from an exported file, and ones carried
 * by an example or template. The schema in ./schema.ts has already checked that
 * the file is well formed, is not nested too deeply and holds no non-finite
 * number. What it cannot check is the SHAPE a particular tool expects, because
 * that is per-tool knowledge the schema does not have.
 *
 * So this is the last gate before a screen is handed values it will compute
 * with, and it was previously doing less than it looked like it was doing: it
 * filled in missing keys and then took every present key verbatim, whatever
 * type it held. An investigation carrying `steps: "soon"` or a nested object
 * where a number belonged went straight to the screen, which would read
 * `NaN`, or crash, or render something meaningless — and crucially it would do
 * so having been told the configuration was fine, since a file is only
 * "repaired" when a key is absent.
 *
 * It now checks each value against the type of the default it is replacing,
 * and treats a mismatch exactly as it treats a missing key: fall back to the
 * default and count it, so the interface says plainly that something was
 * reset. Falling back is the right move rather than coercing, because there is
 * no honest coercion from "soon" to a number of steps — and substituting a
 * plausible-looking number is precisely what this project forbids.
 *
 * What this deliberately does NOT do is bound magnitudes. A tool's admissible
 * range is per-field knowledge that lives with the field, and inventing a
 * central cap here would quietly alter legitimate values. An absurd magnitude
 * is instead the engine's to refuse, which it does through its own documented
 * work limits (RQMC_WORK_LIMIT, NETWORK_LIMITS, GP_LIMITS and the rest), and
 * the screens with expensive knobs clamp them locally and say so.
 */

/** The kinds this reconciliation can tell apart. */
type ValueKind = 'array' | 'object' | 'number' | 'string' | 'boolean' | 'other';

function kindOf(value: unknown): ValueKind {
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  return 'other';
}

/**
 * True when `stored` can stand in for a default of the same position.
 *
 * Numbers must additionally be finite. The schema rejects a non-finite number
 * in an imported file, but a configuration can also arrive from IndexedDB,
 * which was written by an older build of this application, and a `NaN`
 * reaching a chart axis is the defect that produced `x="NaN"` in the SVG
 * before.
 */
function isCompatible(stored: unknown, fallback: unknown): boolean {
  const wanted = kindOf(fallback);
  const got = kindOf(stored);
  if (wanted !== got) return false;
  if (wanted === 'number') return Number.isFinite(stored as number);
  return true;
}

export interface ReconciledConfig {
  value: Record<string, unknown>;
  /** How many settings were reset, whether missing or of the wrong shape. */
  repaired: number;
}

export function reconcileConfig(defaults: Record<string, unknown>, stored: unknown): ReconciledConfig {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
    return { value: structuredClone(defaults), repaired: Object.keys(defaults).length };
  }
  const source = stored as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let repaired = 0;
  for (const [key, fallback] of Object.entries(defaults)) {
    const present = key in source && source[key] !== undefined && source[key] !== null;
    if (present && isCompatible(source[key], fallback)) {
      out[key] = source[key];
    } else {
      out[key] = structuredClone(fallback);
      repaired++;
    }
  }
  // Extra keys the stored configuration carries are kept, so a file written by
  // a newer build is not silently stripped on a round trip through an older
  // one. They have no default to be checked against, and no screen reads them.
  for (const [key, value] of Object.entries(source)) if (!(key in out)) out[key] = value;
  return { value: out, repaired };
}
