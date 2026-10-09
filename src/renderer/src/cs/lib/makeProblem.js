/**
 * Asking Orion for a new problem, and checking it before it is offered.
 *
 * NOT the user's file -- theirs has no such thing; its sixteen problems were the whole library. This is the
 * joining-up: the rules live in `src/shared/cs/generated.ts`, where they can be tested without a screen, and
 * this reaches the two things only a window has -- Orion, and the execution service.
 *
 * ## The order matters
 *
 * 1. Ask, with every existing title named so it does not write one of them again.
 * 2. Check the shape. Free, so it happens before a single execution is spent.
 * 3. **Run its own reference solution against its own tests.** This is the check worth having: a model will
 *    happily write a problem whose expected output no correct program prints, and nothing about that looks
 *    wrong on screen. If its two answers disagree, the problem is discarded and the reason is said out loud.
 * 4. Keep it, numbered after the written ones, with the XP taken from the studio's table.
 *
 * Three attempts at most, and only for a failure worth retrying -- a reply that would not parse, or a reference
 * that disagreed with its own tests. Orion being unreachable is not retried, because asking again does not make
 * it reachable.
 */
import {
  promptFor,
  readReply,
  checkShape,
  checkAgainstReference,
  assemble,
  isRefusal
} from '../../../../shared/cs/generated.ts'
import { runCode } from './execute.js'
import { everyTitle, highestNumber, keepProblem } from './library.js'
import { LANGUAGES, getLanguage } from './languages.js'

/** Starter code for every language, from the studio's own templates. Not from the model. */
function starterFor() {
  const out = {}
  for (const language of LANGUAGES) {
    try {
      out[language.id] = language.starter('solution')
    } catch {
      // A template that throws is not worth failing a problem over; that language simply starts empty.
    }
  }
  return out
}

/** Asks Orion once. Returns the text, or throws. */
async function ask(prompt) {
  const api = typeof window !== 'undefined' ? window.api : null
  if (!api || typeof api.physicsAsk !== 'function') {
    throw new Error('Orion is not reachable from here, so no new problem can be written.')
  }
  const text = await api.physicsAsk(String(prompt), null)
  if (text === null || text === undefined || String(text).trim() === '') {
    throw new Error('Orion did not answer.')
  }
  return String(text)
}

/** Runs one program with one lot of input, in the shape the checker wants. */
const runner = (language) => async (source, stdin) => {
  const got = await runCode({ language, sourceCode: source, stdin })
  if (got.verdict === 'Compilation Error' || got.verdict === 'Runtime Error' || got.verdict === 'Execution Error') {
    return { stdout: '', origin: got.origin === 'ran' ? 'ran' : 'predicted', broke: got.message || got.stderr || got.compileOutput || got.verdict }
  }
  return { stdout: got.stdout ?? '', origin: got.origin === 'ran' ? 'ran' : 'predicted' }
}

/**
 * One attempt at a new problem.
 *
 * `say` is called with each step so the screen can show what is happening -- checking a reference against four
 * tests takes four readings, and silence for that long reads as a hang.
 */
export async function makeProblem({ about, difficulty = 'Medium', language = 'python', say = () => {} } = {}) {
  const known = getLanguage(language) ? language : 'python'
  const titles = everyTitle()
  const prompt = promptFor({ about: String(about || 'anything you like'), difficulty, avoid: titles, language: known })

  let attempt = 0
  let lastSaid = null

  while (attempt < 3) {
    attempt += 1
    say(attempt === 1 ? 'Asking Orion for a problem…' : `Asking again (attempt ${attempt} of 3)…`)

    let text
    try {
      text = await ask(attempt === 1 ? prompt : `${prompt}\n\nYour last attempt was rejected: ${lastSaid}\nFix exactly that.`)
    } catch (error) {
      // Orion being unreachable will not improve on a second ask.
      return { ok: false, says: error instanceof Error ? error.message : String(error), fix: null }
    }

    const read = readReply(text)
    if (isRefusal(read)) {
      lastSaid = read.problem
      continue
    }

    const shaped = checkShape(read.held, { avoid: titles })
    if (isRefusal(shaped)) {
      lastSaid = `${shaped.problem} ${shaped.fix}`
      // A shape fault is worth one more ask: it is usually a missing field rather than a refusal.
      continue
    }

    say(`Checking Orion's own solution against its ${shaped.tests.length} tests…`)
    const checked = await checkAgainstReference(shaped, runner(known))
    if (isRefusal(checked)) {
      lastSaid = `${checked.problem} ${checked.fix}`
      continue
    }

    const problem = assemble({
      proposed: shaped,
      difficulty,
      checkedBy: checked.checkedBy,
      language: known,
      after: highestNumber(),
      starter: starterFor()
    })

    const kept = keepProblem(problem)
    if (!kept.ok) {
      lastSaid = kept.says
      continue
    }

    return {
      ok: true,
      problem,
      says:
        checked.checkedBy === 'ran'
          ? `"${problem.title}" is ready. Orion's own solution was run against all ${problem.tests.length} of its tests and agreed with every one.`
          : `"${problem.title}" is ready. Orion's own solution was checked against all ${problem.tests.length} of its tests by reading it — which is a strong sign, not a proof, because nothing ran.`
    }
  }

  return {
    ok: false,
    says: 'Orion could not write a problem that held up.',
    fix: lastSaid
  }
}
