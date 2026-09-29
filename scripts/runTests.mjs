import { run } from 'node:test'
import { spec } from 'node:test/reporters'
import process from 'node:process'

import { TEST_FILES } from './testFiles.mjs'

/**
 * Runs the test suite.
 *
 * Through the programmatic runner rather than the command line, because the list of files is longer than a Windows
 * command line can hold -- 32 KB, which the suite passed. Naming the files in an npm script stopped working at that
 * point, and the failure was a cryptic "The command line is too long" rather than anything about tests.
 *
 * Concurrency is one: several of these drive a real browser and interfere with each other if run together.
 */
const stream = run({ files: TEST_FILES, concurrency: 1 })

let failures = 0
stream.on('test:fail', (event) => {
  if (event.todo === true || event.skip === true) return
  failures += 1
})

stream.compose(new spec()).pipe(process.stdout)

await new Promise((resolve) => {
  stream.on('end', resolve)
})

// Set the code rather than calling exit, so everything written to stdout is flushed first.
process.exitCode = failures > 0 ? 1 : 0
