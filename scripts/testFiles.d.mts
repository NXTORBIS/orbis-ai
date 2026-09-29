/**
 * Types for the test file list.
 *
 * The list itself is plain JavaScript because the test runner loads it before any type stripping is in play, and this
 * declaration is what lets `src/shared/testSuite.test.ts` check it against the files on disk.
 */
export declare const TEST_FILES: string[]
