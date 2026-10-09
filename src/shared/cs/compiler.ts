/**
 * A whole small language: text in, tokens, a tree, and output.
 *
 * ## Why all four stages are kept
 *
 * "Compilers turn code into a tree" is a sentence; watching `3 + 4 * 2` become seven tokens, then a tree where the
 * multiplication sits *below* the addition, then the number 11, is the thing itself. So every stage is returned —
 * the token list, the tree, and the output — rather than only the answer. The tree is what shows precedence, and
 * precedence is the part nobody believes until they see it.
 *
 * ## Errors carry the position, always
 *
 * A compiler that says "syntax error" has taught nothing. Every refusal here says which character or which token,
 * what was expected, and what was found — because finding the mistake is most of what using a compiler is.
 *
 * ## What this is not
 *
 * A toy language, deliberately: numbers, variables, four operators, comparison, `if`/`else` and `print`. No
 * functions, no loops, no strings, no types. It is the shape of a compiler, not a language anybody should write in,
 * and the laboratory says so rather than implying otherwise.
 *
 * Pure. No clock, no randomness, no host access.
 */

export interface CompilerError {
  error: 'lex' | 'parse' | 'run' | 'too-big' | 'input'
  message: string
  /** Where it went wrong: a character index for lexing, a token index for parsing. Null when it is neither. */
  at: number | null
  /** What to do about it. Never "try again". */
  fix: string
}

export const isCompilerError = (value: unknown): value is CompilerError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>) && 'fix' in (value as Record<string, unknown>)

const fail = (error: CompilerError['error'], message: string, fix: string, at: number | null = null): CompilerError => ({ error, message, at, fix })

export const LIMITS = Object.freeze({ source: 20_000, tokens: 8_000, depth: 60, steps: 100_000, output: 500 })

/** The words the language reserves. Everything else that looks like a name is a name. */
export const KEYWORDS: readonly string[] = Object.freeze(['let', 'if', 'else', 'print', 'while'])

export type TokenKind = 'number' | 'keyword' | 'name' | 'operator' | 'punctuation' | 'end'

export interface Token {
  kind: TokenKind
  /** The text exactly as it was written. */
  text: string
  /** A number token's value. Absent otherwise. */
  value?: number
  /** Where it starts in the source, so the screen can point at it. */
  from: number
  to: number
  /** Which line it is on, 1-based. */
  line: number
}

// ---------------------------------------------------------------- stage one: text into tokens

/**
 * Split the source into tokens.
 *
 * One pass, character by character. The only subtlety is the two-character operators (`>=`, `<=`, `==`, `!=`),
 * which have to be checked before the one-character ones or `>=` lexes as `>` followed by `=` and the parser
 * reports a mistake on the wrong thing.
 */
export function tokenise(source: string): Token[] | CompilerError {
  if (typeof source !== 'string') return fail('input', 'The source has to be text.', 'Type something to compile.')
  if (source.length > LIMITS.source) {
    return fail('too-big', `That is ${source.length.toLocaleString('en-GB')} characters, which is more than this compiles.`, `Use at most ${LIMITS.source.toLocaleString('en-GB')}.`)
  }

  const out: Token[] = []
  let at = 0
  let line = 1

  const TWO = ['>=', '<=', '==', '!=']
  const ONE = '+-*/%<>='
  const PUNCT = '{}();,'

  while (at < source.length) {
    const here = source[at]

    if (here === '\n') {
      line += 1
      at += 1
      continue
    }
    if (/\s/.test(here)) {
      at += 1
      continue
    }

    // A comment runs to the end of the line. Written as // because that is what people type.
    if (here === '/' && source[at + 1] === '/') {
      while (at < source.length && source[at] !== '\n') at += 1
      continue
    }

    if (/[0-9]/.test(here)) {
      const from = at
      let text = ''
      while (at < source.length && /[0-9]/.test(source[at])) text += source[at++]
      // A decimal point, but only when a digit follows it — so `1.` is a number and a stray dot, not a bad number.
      if (source[at] === '.' && /[0-9]/.test(source[at + 1] ?? '')) {
        text += source[at++]
        while (at < source.length && /[0-9]/.test(source[at])) text += source[at++]
      }
      out.push({ kind: 'number', text, value: Number(text), from, to: at, line })
      continue
    }

    if (/[A-Za-z_]/.test(here)) {
      const from = at
      let text = ''
      while (at < source.length && /[A-Za-z0-9_]/.test(source[at])) text += source[at++]
      out.push({ kind: KEYWORDS.includes(text) ? 'keyword' : 'name', text, from, to: at, line })
      continue
    }

    const pair = source.slice(at, at + 2)
    if (TWO.includes(pair)) {
      out.push({ kind: 'operator', text: pair, from: at, to: at + 2, line })
      at += 2
      continue
    }

    if (ONE.includes(here)) {
      out.push({ kind: 'operator', text: here, from: at, to: at + 1, line })
      at += 1
      continue
    }

    if (PUNCT.includes(here)) {
      out.push({ kind: 'punctuation', text: here, from: at, to: at + 1, line })
      at += 1
      continue
    }

    return fail('lex', `"${here}" is not a character this language uses.`, 'Remove it, or check for a stray symbol.', at)
  }

  if (out.length > LIMITS.tokens) {
    return fail('too-big', `That is ${out.length.toLocaleString('en-GB')} tokens.`, `Use at most ${LIMITS.tokens.toLocaleString('en-GB')}.`)
  }
  out.push({ kind: 'end', text: '', from: source.length, to: source.length, line })
  return out
}

// ---------------------------------------------------------------- stage two: tokens into a tree

export type Node =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'binary'; operator: string; left: Node; right: Node }
  | { kind: 'let'; name: string; value: Node }
  | { kind: 'assign'; name: string; value: Node }
  | { kind: 'print'; value: Node }
  | { kind: 'if'; test: Node; then: Node[]; otherwise: Node[] | null }
  | { kind: 'while'; test: Node; body: Node[] }
  | { kind: 'program'; body: Node[] }

/**
 * Build the tree.
 *
 * Recursive descent, with one function per level of precedence — comparison calls addition, addition calls
 * multiplication, multiplication calls the atoms. That layering *is* the precedence: nothing else enforces it, and
 * it is why `3 + 4 * 2` comes out as an addition whose right side is a multiplication rather than the other way
 * round.
 */
export function parse(tokens: readonly Token[]): Node | CompilerError {
  let at = 0
  let depth = 0

  const here = (): Token => tokens[Math.min(at, tokens.length - 1)]
  const problem = (message: string, fix: string): CompilerError => fail('parse', message, fix, at)

  const eat = (kind: TokenKind, text?: string): Token | CompilerError => {
    const token = here()
    if (token.kind !== kind || (text !== undefined && token.text !== text)) {
      const wanted = text !== undefined ? `"${text}"` : kind
      const got = token.kind === 'end' ? 'the end of the program' : `${token.kind} "${token.text}"`
      return problem(`Expected ${wanted} but found ${got}, on line ${token.line}.`, `Add the ${wanted} that is missing.`)
    }
    at += 1
    return token
  }

  /** Comparison: the loosest-binding level, so it is tried first and everything else nests inside it. */
  const comparison = (): Node | CompilerError => {
    const left = sum()
    if (isCompilerError(left)) return left
    const token = here()
    if (token.kind === 'operator' && ['<', '>', '<=', '>=', '==', '!='].includes(token.text)) {
      at += 1
      const right = sum()
      if (isCompilerError(right)) return right
      return { kind: 'binary', operator: token.text, left, right }
    }
    return left
  }

  const sum = (): Node | CompilerError => {
    let left = product()
    if (isCompilerError(left)) return left
    while (here().kind === 'operator' && ['+', '-'].includes(here().text)) {
      const operator = here().text
      at += 1
      const right = product()
      if (isCompilerError(right)) return right
      left = { kind: 'binary', operator, left, right }
    }
    return left
  }

  const product = (): Node | CompilerError => {
    let left = atom()
    if (isCompilerError(left)) return left
    while (here().kind === 'operator' && ['*', '/', '%'].includes(here().text)) {
      const operator = here().text
      at += 1
      const right = atom()
      if (isCompilerError(right)) return right
      left = { kind: 'binary', operator, left, right }
    }
    return left
  }

  const atom = (): Node | CompilerError => {
    const token = here()
    if (token.kind === 'number') {
      at += 1
      return { kind: 'number', value: token.value ?? 0 }
    }
    if (token.kind === 'name') {
      at += 1
      return { kind: 'name', name: token.text }
    }
    if (token.kind === 'operator' && token.text === '-') {
      // Negation, written as 0 - x so the tree has one shape of arithmetic node rather than two.
      at += 1
      const inner = atom()
      if (isCompilerError(inner)) return inner
      return { kind: 'binary', operator: '-', left: { kind: 'number', value: 0 }, right: inner }
    }
    if (token.kind === 'punctuation' && token.text === '(') {
      at += 1
      const inner = comparison()
      if (isCompilerError(inner)) return inner
      const closed = eat('punctuation', ')')
      if (isCompilerError(closed)) return closed
      return inner
    }
    return problem(
      `Expected a number, a name or "(" but found ${token.kind === 'end' ? 'the end of the program' : `"${token.text}"`}, on line ${token.line}.`,
      'An expression has to start with something that has a value.'
    )
  }

  const block = (): Node[] | CompilerError => {
    const opened = eat('punctuation', '{')
    if (isCompilerError(opened)) return opened
    const body: Node[] = []
    while (!(here().kind === 'punctuation' && here().text === '}')) {
      if (here().kind === 'end') return problem('The program ended inside a block.', 'Add the closing "}".')
      const one = statement()
      if (isCompilerError(one)) return one
      body.push(one)
    }
    at += 1
    return body
  }

  const statement = (): Node | CompilerError => {
    depth += 1
    if (depth > LIMITS.depth) {
      depth -= 1
      return fail('parse', `Nested more than ${LIMITS.depth} deep.`, 'Flatten it out.', at)
    }
    const made = statementInner()
    depth -= 1
    return made
  }

  const statementInner = (): Node | CompilerError => {
    const token = here()

    if (token.kind === 'keyword' && token.text === 'let') {
      at += 1
      const name = eat('name')
      if (isCompilerError(name)) return name
      const equals = eat('operator', '=')
      if (isCompilerError(equals)) return equals
      const value = comparison()
      if (isCompilerError(value)) return value
      const semi = eat('punctuation', ';')
      if (isCompilerError(semi)) return semi
      return { kind: 'let', name: name.text, value }
    }

    if (token.kind === 'keyword' && token.text === 'print') {
      at += 1
      const value = comparison()
      if (isCompilerError(value)) return value
      const semi = eat('punctuation', ';')
      if (isCompilerError(semi)) return semi
      return { kind: 'print', value }
    }

    if (token.kind === 'keyword' && token.text === 'if') {
      at += 1
      const test = comparison()
      if (isCompilerError(test)) return test
      const then = block()
      if (isCompilerError(then)) return then
      let otherwise: Node[] | null = null
      if (here().kind === 'keyword' && here().text === 'else') {
        at += 1
        const made = block()
        if (isCompilerError(made)) return made
        otherwise = made
      }
      return { kind: 'if', test, then, otherwise }
    }

    if (token.kind === 'keyword' && token.text === 'while') {
      at += 1
      const test = comparison()
      if (isCompilerError(test)) return test
      const body = block()
      if (isCompilerError(body)) return body
      return { kind: 'while', test, body }
    }

    // An assignment to a name that already exists: `x = x + 1;`
    if (token.kind === 'name' && tokens[at + 1]?.kind === 'operator' && tokens[at + 1]?.text === '=') {
      at += 2
      const value = comparison()
      if (isCompilerError(value)) return value
      const semi = eat('punctuation', ';')
      if (isCompilerError(semi)) return semi
      return { kind: 'assign', name: token.text, value }
    }

    return problem(
      `A statement cannot start with ${token.kind === 'end' ? 'the end of the program' : `"${token.text}"`}, on line ${token.line}.`,
      'Statements start with let, print, if, while, or a name being assigned to.'
    )
  }

  const body: Node[] = []
  while (here().kind !== 'end') {
    const one = statement()
    if (isCompilerError(one)) return one
    body.push(one)
  }
  return { kind: 'program', body }
}

// ---------------------------------------------------------------- stage three: run the tree

export interface RunResult {
  /** Everything `print` produced, in order. */
  output: readonly string[]
  /** Every variable and its final value. */
  variables: Readonly<Record<string, number>>
  /** How many tree nodes were evaluated. The cost of the program, counted rather than guessed. */
  steps: number
}

export function run(tree: Node): RunResult | CompilerError {
  const variables: Record<string, number> = {}
  const output: string[] = []
  let steps = 0
  let stopped: CompilerError | null = null

  const value = (node: Node): number => {
    if (stopped) return 0
    steps += 1
    if (steps > LIMITS.steps) {
      stopped = fail('run', `It did more than ${LIMITS.steps.toLocaleString('en-GB')} steps and was stopped.`, 'Check for a loop that never ends.')
      return 0
    }

    switch (node.kind) {
      case 'number':
        return node.value
      case 'name': {
        if (!(node.name in variables)) {
          stopped = fail('run', `"${node.name}" has no value yet.`, `Declare it first: let ${node.name} = 0;`)
          return 0
        }
        return variables[node.name]
      }
      case 'binary': {
        const left = value(node.left)
        const right = value(node.right)
        switch (node.operator) {
          case '+':
            return left + right
          case '-':
            return left - right
          case '*':
            return left * right
          case '/':
            if (right === 0) {
              stopped = fail('run', 'Division by zero.', 'Check the value on the right of the /.')
              return 0
            }
            return left / right
          case '%':
            if (right === 0) {
              stopped = fail('run', 'Remainder by zero.', 'Check the value on the right of the %.')
              return 0
            }
            return left % right
          // Comparisons give 1 or 0, because this language has no separate true and false.
          case '<':
            return left < right ? 1 : 0
          case '>':
            return left > right ? 1 : 0
          case '<=':
            return left <= right ? 1 : 0
          case '>=':
            return left >= right ? 1 : 0
          case '==':
            return left === right ? 1 : 0
          case '!=':
            return left !== right ? 1 : 0
          default:
            stopped = fail('run', `"${node.operator}" is not an operator this runs.`, 'Use + - * / % < > <= >= == !=')
            return 0
        }
      }
      default:
        return 0
    }
  }

  const perform = (node: Node): void => {
    if (stopped) return
    steps += 1
    switch (node.kind) {
      case 'let':
      case 'assign':
        variables[node.name] = value(node.value)
        break
      case 'print': {
        const made = value(node.value)
        if (stopped) return
        if (output.length >= LIMITS.output) {
          stopped = fail('run', `It printed more than ${LIMITS.output} lines and was stopped.`, 'Print less, or check the loop.')
          return
        }
        output.push(Number.isInteger(made) ? String(made) : made.toPrecision(10).replace(/0+$/, '').replace(/\.$/, ''))
        break
      }
      case 'if':
        if (value(node.test) !== 0) node.then.forEach(perform)
        else node.otherwise?.forEach(perform)
        break
      case 'while': {
        // The step ceiling is what stops `while 1 { }`, and it is counted here as well as in `value`.
        while (!stopped && value(node.test) !== 0) {
          steps += 1
          if (steps > LIMITS.steps) {
            stopped = fail('run', `The loop did more than ${LIMITS.steps.toLocaleString('en-GB')} steps and was stopped.`, 'Check that the condition can become false.')
            return
          }
          node.body.forEach(perform)
        }
        break
      }
      case 'program':
        node.body.forEach(perform)
        break
      default:
        break
    }
  }

  perform(tree)
  if (stopped) return stopped
  return { output: Object.freeze([...output]), variables: Object.freeze({ ...variables }), steps }
}

// ---------------------------------------------------------------- all three, and the tree as text

export interface CompileReport {
  tokens: readonly Token[]
  tree: Node
  /** The tree drawn with indentation, which is what makes precedence visible. */
  drawn: string
  result: RunResult
  says: string
  notes: readonly string[]
}

/** The tree as indented text. Each line is one node; depth is the nesting. */
export function draw(node: Node, indent = 0): string {
  const pad = '  '.repeat(indent)
  switch (node.kind) {
    case 'number':
      return `${pad}${node.value}`
    case 'name':
      return `${pad}${node.name}`
    case 'binary':
      return `${pad}${node.operator}\n${draw(node.left, indent + 1)}\n${draw(node.right, indent + 1)}`
    case 'let':
      return `${pad}let ${node.name}\n${draw(node.value, indent + 1)}`
    case 'assign':
      return `${pad}${node.name} =\n${draw(node.value, indent + 1)}`
    case 'print':
      return `${pad}print\n${draw(node.value, indent + 1)}`
    case 'if':
      return [
        `${pad}if`,
        draw(node.test, indent + 1),
        `${pad}  then`,
        ...node.then.map((one) => draw(one, indent + 2)),
        ...(node.otherwise ? [`${pad}  else`, ...node.otherwise.map((one) => draw(one, indent + 2))] : [])
      ].join('\n')
    case 'while':
      return [`${pad}while`, draw(node.test, indent + 1), `${pad}  do`, ...node.body.map((one) => draw(one, indent + 2))].join('\n')
    case 'program':
      return node.body.map((one) => draw(one, indent)).join('\n')
    default:
      return `${pad}?`
  }
}

/** Count every node in the tree, so the card can say how big the program became. */
export function countNodes(node: Node): number {
  switch (node.kind) {
    case 'binary':
      return 1 + countNodes(node.left) + countNodes(node.right)
    case 'let':
    case 'assign':
    case 'print':
      return 1 + countNodes(node.value)
    case 'if':
      return 1 + countNodes(node.test) + node.then.reduce((out, one) => out + countNodes(one), 0) + (node.otherwise?.reduce((out, one) => out + countNodes(one), 0) ?? 0)
    case 'while':
      return 1 + countNodes(node.test) + node.body.reduce((out, one) => out + countNodes(one), 0)
    case 'program':
      return 1 + node.body.reduce((out, one) => out + countNodes(one), 0)
    default:
      return 1
  }
}

/** Text in, all three stages out. A failure at any stage is returned as itself, saying which stage. */
export function compile(source: string): CompileReport | CompilerError {
  const tokens = tokenise(source)
  if (isCompilerError(tokens)) return tokens
  const tree = parse(tokens)
  if (isCompilerError(tree)) return tree
  const result = run(tree)
  if (isCompilerError(result)) return result

  const kinds = tokens.reduce<Record<string, number>>((out, one) => ({ ...out, [one.kind]: (out[one.kind] ?? 0) + 1 }), {})
  return {
    tokens,
    tree,
    drawn: draw(tree),
    result,
    says: `${tokens.length - 1} tokens became a tree of ${countNodes(tree)} nodes, which ran in ${result.steps} steps and printed ${result.output.length} line${result.output.length === 1 ? '' : 's'}.`,
    notes: Object.freeze([
      `Tokens by kind: ${Object.entries(kinds)
        .filter(([kind]) => kind !== 'end')
        .map(([kind, count]) => `${count} ${kind}`)
        .join(', ')}.`,
      'The tree is where precedence lives: multiplication ends up below addition because the parser calls the multiplication level from inside the addition level, and nothing else enforces it.',
      'Numbers, names, + - * / %, comparison, if/else, while and print. No functions, no strings, no types — this is the shape of a compiler, not a language to write anything in.'
    ])
  }
}

/** What the laboratory starts with. Chosen because its tree shows precedence at a glance. */
export const EXAMPLE = `// precedence: the multiplication happens first
let x = 3 + 4 * 2;
let y = x - 1;

if x > y {
  print x;
} else {
  print y;
}

// a loop, to show the step count climb
let total = 0;
let n = 1;
while n <= 10 {
  total = total + n;
  n = n + 1;
}
print total;
`
