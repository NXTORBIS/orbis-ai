/**
 * File names, made safe and made unique.
 *
 * Lifted out of `chromiumCapabilities2.ts`, where the same two functions were module-local, because there are five
 * filename sanitisers in this repository and each one forgets a different character. This is the one; the others are
 * to be pointed at it as they are touched.
 *
 * Pure on purpose. `unique` takes a function that says whether a name is taken rather than looking at a disk, so it
 * can be tested with a Set and used against a folder, a ZIP's entry list or a dialog's suggestion alike.
 */

/** Characters no filesystem Orbis runs on will take in a name, plus the control range. */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]+/g

/** Names Windows reserves whatever the extension. A file called `con.csv` cannot be created there. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * A name a file can have, from whatever a person or a model typed.
 *
 * Forbidden characters become spaces, runs of space collapse, the ends are trimmed, trailing dots go (Windows strips
 * them silently, which makes `report.` and `report` the same file), and the result is cut to 80 characters so a
 * title the length of a paragraph does not become a path longer than the system allows.
 */
export function safeName(name: string, fallback = 'artifact'): string {
  const cleaned = String(name ?? '')
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 80)
    .trim()
  if (cleaned === '' || RESERVED.test(cleaned)) return fallback
  return cleaned
}

/**
 * `base` with `ext`, or `base (2)` with `ext`, and so on, up to the first name `exists` says is free.
 *
 * Counting starts at 2 because "report" and "report (1)" reads as though there were a "report (0)"; this is the
 * convention every desktop uses, and matching it means a person's own duplicates and Orbis's look the same.
 */
export function unique(base: string, ext: string, exists: (candidate: string) => boolean, limit = 10_000): string {
  const first = `${base}${ext}`
  if (!exists(first)) return first
  for (let n = 2; n <= limit; n++) {
    const candidate = `${base} (${n})${ext}`
    if (!exists(candidate)) return candidate
  }
  throw new Error(`Could not find a free name for "${base}${ext}" after ${limit} tries.`)
}
