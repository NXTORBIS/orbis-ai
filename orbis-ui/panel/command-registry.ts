/**
 * The capability registry, as the built-in pages see it.
 *
 * One list, not two. The registry itself lives in src/shared/commandCenter.ts, where it is typed and tested; this file
 * exists only so esbuild can hand the same code to a chrome:// page, which cannot read TypeScript. A second copy kept
 * in step by hand is a second copy that will not be.
 */
export * from '../../src/shared/commandCenter.ts'
