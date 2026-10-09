/**
 * Running code in other languages, and what to do when that is not possible.
 *
 * ## Three ways a result can come back, and they are never confused
 *
 * - **`ran`** — a real execution. Judge0 CE compiled and ran it in its own sandbox and sent back the real stdout,
 *   the real exit code, the real time and memory. This is the only kind of result that is a fact.
 * - **`predicted`** — Orion read the code and said what it thinks it would print. It is a guess. It is labelled a
 *   guess everywhere it appears, it never fills in a time or a memory figure, and it is never shown as output.
 * - **`refused`** — neither was possible, and the card says which one failed and why.
 *
 * The single rule this file exists to enforce: **a prediction is never presented as a run.** A learner who cannot
 * tell which they are looking at has been given something worse than nothing, because they will trust the wrong
 * one at the moment it matters.
 *
 * ## Nothing runs on this computer
 *
 * Code goes to Judge0's sandbox over the network, or to a model. Orbis never executes somebody's C or Python on
 * the machine it is running on, whatever the language and whoever wrote it.
 *
 * ## Input
 *
 * Standard input is sent with the submission, so a program that reads is given what to read — which is most of the
 * exercises anybody is set. A prediction is given the same input in the question, so the two kinds of answer are
 * at least asked the same thing.
 *
 * Pure: shapes, mapping and the honesty rules. The network call lives in the main process.
 */

export interface ExecutionError {
  error: 'unsupported-language' | 'too-big' | 'input' | 'unavailable' | 'timeout' | 'provider'
  message: string
  fix: string
}

export const isExecutionError = (value: unknown): value is ExecutionError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>) && 'fix' in (value as Record<string, unknown>)

const fail = (error: ExecutionError['error'], message: string, fix: string): ExecutionError => ({ error, message, fix })

export const LIMITS = Object.freeze({ source: 64_000, stdin: 16_000, output: 100_000, polls: 40, pollMs: 500 })

export type LanguageId =
  | 'python' | 'cpp' | 'c' | 'java' | 'csharp' | 'go' | 'rust' | 'typescript' | 'javascript'
  | 'fsharp' | 'haskell' | 'php' | 'ruby' | 'kotlin' | 'swift' | 'scala' | 'perl' | 'lua' | 'r' | 'sql'

export interface Language {
  id: LanguageId
  name: string
  /** Judge0 CE's own number for it. Absent means Judge0 cannot run it and only a prediction is possible. */
  judge0: number | null
  category: 'General' | 'Web' | 'Systems' | 'Functional' | 'Scripting' | 'Data'
  /** The file ending, for the editor and for naming a download. */
  extension: string
  /** What the editor should highlight it as. */
  syntax: string
  /** A program that prints something and reads a line, so the input box is obviously connected to something. */
  starter: string
}

const starter = (body: string): string => body

export const LANGUAGES: readonly Language[] = Object.freeze([
  {
    id: 'python', name: 'Python', judge0: 71, category: 'General', extension: 'py', syntax: 'python',
    starter: starter('name = input("What is your name? ")\nprint(f"Hello, {name}")\n\ntotal = sum(range(1, 11))\nprint("1 to 10 adds to", total)\n')
  },
  {
    id: 'cpp', name: 'C++', judge0: 54, category: 'General', extension: 'cpp', syntax: 'cpp',
    starter: starter('#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    string name;\n    getline(cin, name);\n    cout << "Hello, " << name << "\\n";\n\n    int total = 0;\n    for (int i = 1; i <= 10; i++) total += i;\n    cout << "1 to 10 adds to " << total << "\\n";\n}\n')
  },
  {
    id: 'c', name: 'C', judge0: 50, category: 'Systems', extension: 'c', syntax: 'c',
    starter: starter('#include <stdio.h>\n\nint main(void) {\n    char name[100];\n    if (fgets(name, sizeof name, stdin)) printf("Hello, %s", name);\n\n    int total = 0;\n    for (int i = 1; i <= 10; i++) total += i;\n    printf("1 to 10 adds to %d\\n", total);\n    return 0;\n}\n')
  },
  {
    id: 'java', name: 'Java', judge0: 62, category: 'General', extension: 'java', syntax: 'java',
    starter: starter('import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        if (in.hasNextLine()) System.out.println("Hello, " + in.nextLine());\n\n        int total = 0;\n        for (int i = 1; i <= 10; i++) total += i;\n        System.out.println("1 to 10 adds to " + total);\n    }\n}\n')
  },
  {
    id: 'csharp', name: 'C#', judge0: 51, category: 'General', extension: 'cs', syntax: 'csharp',
    starter: starter('using System;\n\nclass Program {\n    static void Main() {\n        var name = Console.ReadLine();\n        if (name != null) Console.WriteLine($"Hello, {name}");\n\n        var total = 0;\n        for (var i = 1; i <= 10; i++) total += i;\n        Console.WriteLine($"1 to 10 adds to {total}");\n    }\n}\n')
  },
  {
    id: 'go', name: 'Go', judge0: 60, category: 'Systems', extension: 'go', syntax: 'go',
    starter: starter('package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tin := bufio.NewScanner(os.Stdin)\n\tif in.Scan() {\n\t\tfmt.Println("Hello,", in.Text())\n\t}\n\n\ttotal := 0\n\tfor i := 1; i <= 10; i++ {\n\t\ttotal += i\n\t}\n\tfmt.Println("1 to 10 adds to", total)\n}\n')
  },
  {
    id: 'rust', name: 'Rust', judge0: 73, category: 'Systems', extension: 'rs', syntax: 'rust',
    starter: starter('use std::io::{self, BufRead};\n\nfn main() {\n    let stdin = io::stdin();\n    if let Some(Ok(name)) = stdin.lock().lines().next() {\n        println!("Hello, {}", name);\n    }\n\n    let total: i32 = (1..=10).sum();\n    println!("1 to 10 adds to {}", total);\n}\n')
  },
  {
    id: 'typescript', name: 'TypeScript', judge0: 74, category: 'Web', extension: 'ts', syntax: 'typescript',
    starter: starter('const lines: string[] = require("fs").readFileSync(0, "utf8").split("\\n");\nif (lines[0]) console.log(`Hello, ${lines[0]}`);\n\nconst total: number = [...Array(10)].reduce((out, _, at) => out + at + 1, 0);\nconsole.log("1 to 10 adds to", total);\n')
  },
  {
    id: 'javascript', name: 'JavaScript', judge0: 63, category: 'Web', extension: 'js', syntax: 'javascript',
    starter: starter('const lines = require("fs").readFileSync(0, "utf8").split("\\n");\nif (lines[0]) console.log(`Hello, ${lines[0]}`);\n\nconst total = [...Array(10)].reduce((out, _, at) => out + at + 1, 0);\nconsole.log("1 to 10 adds to", total);\n')
  },
  {
    id: 'ruby', name: 'Ruby', judge0: 72, category: 'Scripting', extension: 'rb', syntax: 'ruby',
    starter: starter('name = gets\nputs "Hello, #{name.strip}" if name\n\nputs "1 to 10 adds to #{(1..10).sum}"\n')
  },
  {
    id: 'php', name: 'PHP', judge0: 68, category: 'Scripting', extension: 'php', syntax: 'php',
    starter: starter('<?php\n$name = trim(fgets(STDIN) ?: "");\nif ($name !== "") echo "Hello, $name\\n";\n\n$total = array_sum(range(1, 10));\necho "1 to 10 adds to $total\\n";\n')
  },
  {
    id: 'haskell', name: 'Haskell', judge0: 61, category: 'Functional', extension: 'hs', syntax: 'haskell',
    starter: starter('main :: IO ()\nmain = do\n  name <- getLine\n  putStrLn ("Hello, " ++ name)\n  putStrLn ("1 to 10 adds to " ++ show (sum [1..10 :: Int]))\n')
  },
  {
    id: 'fsharp', name: 'F#', judge0: 87, category: 'Functional', extension: 'fsx', syntax: 'fsharp',
    starter: starter('let name = System.Console.ReadLine()\nif name <> null then printfn "Hello, %s" name\nprintfn "1 to 10 adds to %d" (List.sum [1..10])\n')
  },
  {
    id: 'kotlin', name: 'Kotlin', judge0: 78, category: 'General', extension: 'kt', syntax: 'kotlin',
    starter: starter('fun main() {\n    val name = readLine()\n    if (name != null) println("Hello, $name")\n    println("1 to 10 adds to ${(1..10).sum()}")\n}\n')
  },
  {
    id: 'swift', name: 'Swift', judge0: 83, category: 'General', extension: 'swift', syntax: 'swift',
    starter: starter('if let name = readLine() {\n    print("Hello, \\(name)")\n}\nprint("1 to 10 adds to", (1...10).reduce(0, +))\n')
  },
  {
    id: 'scala', name: 'Scala', judge0: 81, category: 'Functional', extension: 'scala', syntax: 'scala',
    starter: starter('object Main extends App {\n  val name = scala.io.StdIn.readLine()\n  if (name != null) println(s"Hello, $name")\n  println(s"1 to 10 adds to ${(1 to 10).sum}")\n}\n')
  },
  {
    id: 'perl', name: 'Perl', judge0: 85, category: 'Scripting', extension: 'pl', syntax: 'perl',
    starter: starter('my $name = <STDIN>;\nchomp $name if defined $name;\nprint "Hello, $name\\n" if $name;\n\nmy $total = 0;\n$total += $_ for 1..10;\nprint "1 to 10 adds to $total\\n";\n')
  },
  {
    id: 'lua', name: 'Lua', judge0: 64, category: 'Scripting', extension: 'lua', syntax: 'lua',
    starter: starter('local name = io.read()\nif name then print("Hello, " .. name) end\n\nlocal total = 0\nfor i = 1, 10 do total = total + i end\nprint("1 to 10 adds to " .. total)\n')
  },
  {
    id: 'r', name: 'R', judge0: 80, category: 'Data', extension: 'r', syntax: 'r',
    starter: starter('name <- readLines("stdin", n = 1)\nif (length(name) > 0) cat("Hello,", name, "\\n")\ncat("1 to 10 adds to", sum(1:10), "\\n")\n')
  },
  {
    id: 'sql', name: 'SQL (SQLite)', judge0: 82, category: 'Data', extension: 'sql', syntax: 'sql',
    starter: starter("CREATE TABLE marks (name TEXT, mark INTEGER);\nINSERT INTO marks VALUES ('Ada', 98), ('Grace', 95), ('Alan', 91);\nSELECT name, mark FROM marks ORDER BY mark DESC;\n")
  }
])

export const languageFor = (id: string): Language | null => LANGUAGES.find((one) => one.id === id) ?? null

export const CATEGORIES: readonly Language['category'][] = Object.freeze(['General', 'Web', 'Systems', 'Functional', 'Scripting', 'Data'])

// ---------------------------------------------------------------- what a result is

export type Verdict =
  | 'ok'
  | 'wrong-output'
  | 'compile-error'
  | 'runtime-error'
  | 'timeout'
  | 'memory'
  | 'provider-error'

/** How the answer was arrived at. The one field nothing is allowed to blur. */
export type Origin = 'ran' | 'predicted'

export interface RunResult {
  origin: Origin
  verdict: Verdict
  stdout: string
  stderr: string
  /** Compiler output, where there was any. */
  compileOutput: string
  exitCode: number | null
  /** Seconds. Null for a prediction, always — a guess has no runtime. */
  seconds: number | null
  /** Kilobytes. Null for a prediction, always. */
  memoryKb: number | null
  language: LanguageId
  /** Said on the card, above the output. Never omitted. */
  says: string
  notes: readonly string[]
}

/**
 * Judge0's status numbers, as its own documentation gives them.
 *
 * 1–2 are queued or running, 3 is accepted, 4 is a wrong answer against a test, 5 is time, 6 is compilation,
 * 7–12 are the various runtime signals, 13+ is the service itself failing.
 */
export function verdictFor(statusId: number): Verdict {
  if (statusId === 3) return 'ok'
  if (statusId === 4) return 'wrong-output'
  if (statusId === 5) return 'timeout'
  if (statusId === 6) return 'compile-error'
  if (statusId >= 7 && statusId <= 12) return 'runtime-error'
  if (statusId === 13) return 'provider-error'
  return 'provider-error'
}

export const VERDICT_WORDS: Readonly<Record<Verdict, string>> = Object.freeze({
  ok: 'ran to the end',
  'wrong-output': 'ran, and the output did not match what was expected',
  'compile-error': 'did not compile',
  'runtime-error': 'started and then stopped with an error',
  timeout: 'was still running when the time ran out',
  memory: 'used more memory than it is allowed',
  'provider-error': 'could not be run'
})

/** Check the request before it is sent, so an obvious problem does not cost a network round trip. */
export function checkRequest(language: string, source: string, stdin: string): ExecutionError | null {
  const found = languageFor(language)
  if (!found) {
    return fail('unsupported-language', `"${language}" is not a language this offers.`, `Choose one of: ${LANGUAGES.map((one) => one.name).join(', ')}.`)
  }
  if (typeof source !== 'string' || source.trim() === '') {
    return fail('input', 'There is no code to run.', 'Type something first.')
  }
  if (source.length > LIMITS.source) {
    return fail('too-big', `That is ${source.length.toLocaleString('en-GB')} characters.`, `Use at most ${LIMITS.source.toLocaleString('en-GB')}.`)
  }
  if (stdin.length > LIMITS.stdin) {
    return fail('too-big', `The input is ${stdin.length.toLocaleString('en-GB')} characters.`, `Use at most ${LIMITS.stdin.toLocaleString('en-GB')}.`)
  }
  return null
}

/** Build the submission Judge0 expects. Base64 throughout, so no character can be mangled on the way. */
export function submissionFor(language: Language, source: string, stdin: string, encode: (text: string) => string): Record<string, unknown> {
  return {
    language_id: language.judge0,
    source_code: encode(source),
    stdin: encode(stdin),
    // Generous enough for a teaching exercise, small enough that a runaway loop comes back rather than hanging.
    cpu_time_limit: 5,
    wall_time_limit: 10,
    memory_limit: 256_000
  }
}

/** What Judge0 sends back, after decoding. */
export interface Judge0Reply {
  status?: { id?: number; description?: string }
  stdout?: string | null
  stderr?: string | null
  compile_output?: string | null
  message?: string | null
  time?: string | null
  memory?: number | null
  exit_code?: number | null
}

/**
 * A real result from Judge0's reply.
 *
 * Anything the provider did not send stays null. Filling in a plausible runtime because the field was empty would
 * be inventing a measurement, and this file exists to make that impossible.
 */
export function resultFrom(reply: Judge0Reply, language: LanguageId): RunResult {
  const statusId = reply.status?.id ?? 0
  const verdict = verdictFor(statusId)
  const stdout = (reply.stdout ?? '').slice(0, LIMITS.output)
  const stderr = (reply.stderr ?? '').slice(0, LIMITS.output)
  const compileOutput = (reply.compile_output ?? '').slice(0, LIMITS.output)
  const seconds = reply.time === null || reply.time === undefined ? null : Number(reply.time)

  return {
    origin: 'ran',
    verdict,
    stdout,
    stderr,
    compileOutput,
    exitCode: typeof reply.exit_code === 'number' ? reply.exit_code : null,
    seconds: Number.isFinite(seconds) ? seconds : null,
    memoryKb: typeof reply.memory === 'number' ? reply.memory : null,
    language,
    says:
      verdict === 'ok'
        ? `Ran${seconds !== null && Number.isFinite(seconds) ? ` in ${seconds}s` : ''}${typeof reply.memory === 'number' ? `, using ${Math.round(reply.memory / 1024)} MB` : ''}.`
        : verdict === 'compile-error'
          ? 'It did not compile. The compiler’s own message is below.'
          : verdict === 'timeout'
            ? 'It was still running when the time ran out, so it was stopped.'
            : verdict === 'runtime-error'
              ? `It started and then stopped: ${reply.status?.description ?? 'a runtime error'}.`
              : `${reply.status?.description ?? 'The service could not run it'}.`,
    notes: Object.freeze([
      'This really ran. The output, the time and the memory are what the sandbox measured, not a guess.',
      'It ran on Judge0’s machine, not on yours — Orbis never executes code from the editor on your computer.',
      ...(reply.message ? [`The service also said: ${reply.message}`] : [])
    ])
  }
}

/**
 * A result built from what Orion said, when running was not possible.
 *
 * Note what this never does: it does not set `seconds`, it does not set `memoryKb`, and it does not set an exit
 * code. A guess has none of those, and leaving them null is what stops a prediction being mistaken for a run three
 * screens later.
 */
export function predictedResult(language: LanguageId, predicted: string, why: string): RunResult {
  return {
    origin: 'predicted',
    verdict: 'ok',
    stdout: predicted.slice(0, LIMITS.output),
    stderr: '',
    compileOutput: '',
    exitCode: null,
    seconds: null,
    memoryKb: null,
    language,
    says: 'This is what Orion thinks the code would print. It was not run.',
    notes: Object.freeze([
      `Nothing ran: ${why}`,
      'A model reading code is not a computer running it. It is often right and it is sometimes confidently wrong, and there is no way to tell which from the output alone.',
      'Anything that depends on the real machine — timing, memory, randomness, the system clock, floating-point detail — is exactly where a prediction goes wrong.',
      'Press Run again when the connection is back to get a real answer.'
    ])
  }
}

/** The question Orion is asked. Written here so it is one thing, reviewable, rather than scattered. */
export function predictionPrompt(language: Language, source: string, stdin: string): string {
  return [
    `Here is a ${language.name} program. Say exactly what it would print to standard output if it were run.`,
    '',
    'Rules for your answer:',
    '- Give only the output, exactly as it would appear, with nothing added.',
    '- No explanation, no code fences, no commentary before or after.',
    '- If the program would not compile or would stop with an error, say only: ERROR: followed by the message it would give.',
    '- If the output depends on something you cannot know — the time, randomness, the machine — say only: UNKNOWABLE: followed by the one thing that makes it so.',
    '',
    stdin.trim() === '' ? 'It is given no input.' : `It is given this on standard input:\n${stdin}`,
    '',
    `The program:\n${source}`
  ].join('\n')
}

/** Read Orion's reply into either a prediction or an honest refusal to predict. */
export function readPrediction(language: LanguageId, text: string, why: string): RunResult {
  const trimmed = text.trim()
  if (trimmed.startsWith('UNKNOWABLE:')) {
    return {
      ...predictedResult(language, '', why),
      verdict: 'provider-error',
      says: 'Orion could not say what this would print, and said why rather than guessing.',
      stderr: trimmed.replace(/^UNKNOWABLE:\s*/, ''),
      notes: Object.freeze([
        `Nothing ran: ${why}`,
        'Orion was asked what the code would print and answered that it cannot be known without running it. That is the right answer, and inventing output instead would have been worse.'
      ])
    }
  }
  if (trimmed.startsWith('ERROR:')) {
    return {
      ...predictedResult(language, '', why),
      verdict: 'runtime-error',
      stderr: trimmed.replace(/^ERROR:\s*/, ''),
      says: 'Orion thinks this would not run. It was not actually run, so this is a guess about the error too.',
      notes: Object.freeze([
        `Nothing ran: ${why}`,
        'A predicted error is still a prediction. The real compiler may disagree, in either direction.'
      ])
    }
  }
  // Strip a code fence if the model added one despite being asked not to.
  const cleaned = trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '')
  return predictedResult(language, cleaned, why)
}

/** What the editor should start with for a language. */
export const starterFor = (id: string): string => languageFor(id)?.starter ?? ''

export const EXECUTION_NOTES: readonly string[] = Object.freeze([
  'Code is sent to Judge0 CE, a free public sandbox, and run there. It never runs on your computer.',
  'When Judge0 cannot be reached, Orion is asked what the code would print instead — and the answer is labelled a prediction every single time, with no timing or memory figures, because it has none.',
  'Standard input is sent with the program, so anything that reads gets what you typed in the input box.'
])
