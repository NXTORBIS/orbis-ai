/**
 * Running code, through Orbis rather than a public sandbox.
 *
 * NOT the user's file. Theirs posts the code to `ce.judge0.com` straight from the browser — somebody else's
 * server, needing no key, and therefore seeing every program anybody writes. Orbis has its own execution service
 * and a rule that code never runs on this computer, so this is that service instead, keeping the shape their
 * pages expect.
 *
 * ## Two routes, and the result always says which
 *
 * A configured sandbox really compiles and really runs, and the result carries a running time and a memory
 * figure. Otherwise Orion reads the code and says what it would print — and that result carries **no** time and
 * **no** memory, because nothing ran and inventing them would be the easiest possible lie. `origin` is on every
 * result and the screens show it.
 *
 * Reading is the default and needs nothing set up, which is the point: it works for any language rather than for
 * the thirteen a sandbox happens to install.
 *
 * ## Judging is done here, against the problem's own tests
 *
 * Theirs sent a problem id to a backend that held the tests. The tests are in `problems.js`, in this window, so
 * each one is run and compared here. That gives a real per-test result — which passed, which failed, and what
 * the failing one printed instead — rather than one verdict from somewhere else. Hidden tests are run and
 * reported as hidden, never shown.
 */
// The library rather than the written sixteen, so a generated problem can be judged against its own tests.
import { PROBLEMS } from './library.js'

/** Their verdict words, so their screens need no changes. */
const VERDICT = {
  ok: 'Accepted',
  'wrong-output': 'Wrong Answer',
  'compile-error': 'Compilation Error',
  'runtime-error': 'Runtime Error',
  timeout: 'Time Limit Exceeded',
  memory: 'Memory Limit Exceeded',
  'provider-error': 'Execution Error'
}

const nothing = (message) => ({
  verdict: 'Execution Error',
  message,
  stdout: '',
  stderr: '',
  compileOutput: '',
  runtime: null,
  memory: null,
  exitCode: null,
  passed: null,
  total: null,
  origin: null,
  tests: null
})

const api = () => (typeof window !== 'undefined' ? window.api : null)

/** Whether anything can run or read code at all, and what it would do. */
export async function executionReady() {
  const bridge = api()
  if (!bridge || typeof bridge.executionReady !== 'function') {
    return { sandbox: false, orion: false, says: 'Code cannot be run or read from here.' }
  }
  try {
    return await bridge.executionReady()
  } catch (error) {
    return { sandbox: false, orion: false, says: error instanceof Error ? error.message : String(error) }
  }
}

/** Every language, and how each would be handled. Not a list of what is allowed. */
export async function languages() {
  const bridge = api()
  if (!bridge || typeof bridge.executionLanguages !== 'function') return { languages: [], notes: [] }
  try {
    return await bridge.executionLanguages()
  } catch {
    return { languages: [], notes: [] }
  }
}

/** One run, of one program, with one lot of input. */
export async function runCode({ language, sourceCode, stdin = '' }) {
  const bridge = api()
  if (!bridge || typeof bridge.runCode !== 'function') {
    return nothing('Code cannot be run from here: Orbis’s execution service is not reachable.')
  }

  let got
  try {
    got = await bridge.runCode({ language: String(language ?? ''), source: String(sourceCode ?? ''), stdin: String(stdin ?? '') })
  } catch (error) {
    return nothing(error instanceof Error ? error.message : String(error))
  }

  // The service reports a refusal rather than throwing, so it is read rather than caught.
  if (!got || typeof got !== 'object') return nothing('Nothing came back.')
  if (!('origin' in got)) {
    return nothing(got.says ?? got.problem ?? 'It would not run.')
  }

  return {
    verdict: VERDICT[got.verdict] ?? 'Execution Error',
    message: got.says ?? '',
    stdout: got.stdout ?? '',
    stderr: got.stderr ?? '',
    compileOutput: got.compileOutput ?? '',
    // Null for a reading, and the screens show that rather than a zero.
    runtime: got.seconds ?? null,
    memory: got.memoryKb ?? null,
    exitCode: got.exitCode ?? null,
    passed: null,
    total: null,
    origin: got.origin,
    notes: got.notes ?? [],
    tests: null
  }
}

/**
 * A submission, judged against the problem's own tests.
 *
 * Every test is run — the visible ones and the hidden ones — and the output compared after trimming trailing
 * whitespace, which is what a judge does rather than demanding a byte-exact match. The first failure is reported
 * with what it expected and what it got, unless it is hidden: then it says a hidden test failed and nothing more,
 * because showing it would hand over the answer.
 *
 * Stops at the first failure, like every judge, so a wrong solution does not pay for twenty readings.
 */
export async function submitProblem({ problemId, language, sourceCode }) {
  const problem = PROBLEMS.find((one) => one.id === problemId || one.slug === problemId)
  if (!problem) return nothing('That problem is not in the library.')

  const tests = Array.isArray(problem.tests) ? problem.tests : []
  if (tests.length === 0) return nothing('That problem has no tests, so nothing can be judged.')

  const results = []
  let passed = 0
  let origin = null

  for (const [i, test] of tests.entries()) {
    const got = await runCode({ language, sourceCode, stdin: test.input ?? '' })
    origin = got.origin ?? origin

    // Something stopped it running at all: that is the verdict, not a wrong answer.
    if (got.verdict !== 'Accepted' && got.verdict !== 'Wrong Answer') {
      return {
        ...got,
        passed,
        total: tests.length,
        tests: results,
        message: got.message || `${got.verdict} on test ${i + 1}.`
      }
    }

    const want = String(test.expected ?? '').replace(/\s+$/gm, '').trim()
    const mine = String(got.stdout ?? '').replace(/\s+$/gm, '').trim()
    const right = want === mine

    results.push({
      number: i + 1,
      hidden: test.hidden === true,
      right,
      // What it was given and what it should print, kept off a hidden test so the answer is not handed over.
      input: test.hidden === true ? null : (test.input ?? ''),
      expected: test.hidden === true ? null : want,
      got: test.hidden === true ? null : mine
    })

    if (right) {
      passed += 1
      continue
    }

    return {
      verdict: 'Wrong Answer',
      message: test.hidden === true
        ? `A hidden test failed. ${passed} of ${tests.length} passed.`
        : `Test ${i + 1} failed. It printed "${shorten(mine)}" and should print "${shorten(want)}".`,
      stdout: got.stdout ?? '',
      stderr: got.stderr ?? '',
      compileOutput: got.compileOutput ?? '',
      runtime: got.runtime ?? null,
      memory: got.memory ?? null,
      exitCode: got.exitCode ?? null,
      passed,
      total: tests.length,
      origin,
      notes: got.notes ?? [],
      tests: results
    }
  }

  return {
    verdict: 'Accepted',
    /*
     * The one sentence that matters, and it must not be quietly dropped.
     *
     * A pass decided by reading the code is not a pass decided by running it. Saying so is the difference
     * between a studio somebody can trust and one that flatters them.
     */
    message:
      origin === 'predicted'
        ? `All ${tests.length} tests pass — but this was checked by reading your code, not by running it.`
        : `All ${tests.length} tests pass.`,
    stdout: '',
    stderr: '',
    compileOutput: '',
    runtime: null,
    memory: null,
    exitCode: 0,
    passed,
    total: tests.length,
    origin,
    notes: [],
    tests: results
  }
}

const shorten = (text) => {
  const one = String(text ?? '').replace(/\n/g, '↵')
  return one.length > 60 ? one.slice(0, 57) + '…' : one
}
