/**
 * A processor: an instruction set, registers, an arithmetic unit, a pipeline and a cache.
 *
 * ## It executes, rather than animating
 *
 * Programs are assembled into instructions and then run. Registers hold real values, memory holds real bytes, a
 * branch is taken because the comparison said so. The pipeline diagram is produced by *scheduling* the instructions
 * through five stages with the hazards worked out, not by drawing a picture of what a pipeline usually looks like —
 * so a stall appears in the diagram because the scheduler could not avoid it.
 *
 * ## The hazards are the subject, so they are found rather than assumed
 *
 * A data hazard is detected by comparing what one instruction writes against what the next ones read, at the stage
 * each of them needs it. Forwarding is modelled as an option: turn it off and the same program takes measurably more
 * cycles, and the diagram shows exactly where. That difference is the single most useful thing a processor laboratory
 * can show, and it only means anything if both numbers are measured.
 *
 * ## The cache is simulated against the real address stream
 *
 * Every load and store the program performs goes through the cache model, which has a real line size, a real
 * associativity and a real replacement policy. The hit rate reported is the hit rate that happened. A program that
 * walks an array with a stride larger than the line size genuinely misses every time, and this will show that.
 *
 * ## What it is not
 *
 * A teaching machine, and it says so. The instruction set is small and regular — closer to MIPS than to anything
 * shipped — there is no operating system, no interrupts, no virtual memory, no out-of-order execution and no
 * branch predictor beyond the one simple scheme. Cycle counts are in cycles, never in nanoseconds.
 *
 * Pure. No Electron, no DOM.
 */

export interface ProcessorError {
  error: string
  says: string
  fix: string
  /** Which line of the program, when the problem is in the program. */
  line?: number
}

export const isProcessorError = (value: unknown): value is ProcessorError =>
  typeof value === 'object' && value !== null && 'error' in value && 'says' in value && 'fix' in value

const refuse = (error: string, says: string, fix: string, line?: number): ProcessorError => ({
  error,
  says,
  fix,
  ...(line === undefined ? {} : { line })
})

export const PROCESSOR_LIMITS = Object.freeze({
  /** Registers, named r0 to r15. r0 is always zero, as on most real machines. */
  registers: 16,
  /** Words of memory. */
  memory: 4_096,
  instructions: 512,
  /** Cycles one run may take, so a loop that never ends is stopped rather than hanging. */
  cycles: 200_000,
  /** The widest a word is. Everything wraps at 32 bits, signed. */
  bits: 32
})

const WRAP = 2 ** 32
/** Brings a number into signed 32-bit range, which is what the hardware would do. */
const wrap = (value: number): number => {
  const made = ((value % WRAP) + WRAP) % WRAP
  return made >= WRAP / 2 ? made - WRAP : made
}

// ---------------------------------------------------------------- the instruction set

export type OpKind =
  // arithmetic and logic, register to register
  | 'add'
  | 'sub'
  | 'mul'
  | 'and'
  | 'or'
  | 'xor'
  | 'sll'
  | 'srl'
  | 'slt'
  // with a constant
  | 'addi'
  | 'andi'
  | 'ori'
  | 'slti'
  // moving values
  | 'li'
  | 'mov'
  // memory
  | 'lw'
  | 'sw'
  // control
  | 'beq'
  | 'bne'
  | 'blt'
  | 'j'
  | 'jal'
  | 'jr'
  // and stopping
  | 'nop'
  | 'halt'

interface OpFacts {
  /** What it does, said the way somebody would explain it. */
  about: string
  /** How it is written. */
  form: string
  /** Which stage the result is ready at, for working out forwarding. */
  readyAt: 'execute' | 'memory' | 'never'
  /** Whether it writes a register, and reads which operands. */
  writes: boolean
  reads: readonly ('a' | 'b')[]
  /** True when it may change where execution goes next. */
  branches: boolean
  /** True when it touches memory. */
  memory: 'read' | 'write' | 'none'
}

export const OPS: Readonly<Record<OpKind, OpFacts>> = Object.freeze({
  add: { about: 'Adds two registers.', form: 'add rd, ra, rb', readyAt: 'execute', writes: true, reads: ['a', 'b'], branches: false, memory: 'none' },
  sub: { about: 'Subtracts the second register from the first.', form: 'sub rd, ra, rb', readyAt: 'execute', writes: true, reads: ['a', 'b'], branches: false, memory: 'none' },
  mul: { about: 'Multiplies two registers, keeping the low 32 bits.', form: 'mul rd, ra, rb', readyAt: 'execute', writes: true, reads: ['a', 'b'], branches: false, memory: 'none' },
  and: { about: 'Bitwise AND.', form: 'and rd, ra, rb', readyAt: 'execute', writes: true, reads: ['a', 'b'], branches: false, memory: 'none' },
  or: { about: 'Bitwise OR.', form: 'or rd, ra, rb', readyAt: 'execute', writes: true, reads: ['a', 'b'], branches: false, memory: 'none' },
  xor: { about: 'Bitwise XOR.', form: 'xor rd, ra, rb', readyAt: 'execute', writes: true, reads: ['a', 'b'], branches: false, memory: 'none' },
  sll: { about: 'Shifts left by the amount in a register.', form: 'sll rd, ra, rb', readyAt: 'execute', writes: true, reads: ['a', 'b'], branches: false, memory: 'none' },
  srl: { about: 'Shifts right by the amount in a register.', form: 'srl rd, ra, rb', readyAt: 'execute', writes: true, reads: ['a', 'b'], branches: false, memory: 'none' },
  slt: { about: 'Sets the destination to 1 when the first register is less than the second, otherwise 0.', form: 'slt rd, ra, rb', readyAt: 'execute', writes: true, reads: ['a', 'b'], branches: false, memory: 'none' },
  addi: { about: 'Adds a constant to a register.', form: 'addi rd, ra, n', readyAt: 'execute', writes: true, reads: ['a'], branches: false, memory: 'none' },
  andi: { about: 'Bitwise AND with a constant.', form: 'andi rd, ra, n', readyAt: 'execute', writes: true, reads: ['a'], branches: false, memory: 'none' },
  ori: { about: 'Bitwise OR with a constant.', form: 'ori rd, ra, n', readyAt: 'execute', writes: true, reads: ['a'], branches: false, memory: 'none' },
  slti: { about: 'Sets the destination to 1 when the register is less than a constant.', form: 'slti rd, ra, n', readyAt: 'execute', writes: true, reads: ['a'], branches: false, memory: 'none' },
  li: { about: 'Puts a constant into a register.', form: 'li rd, n', readyAt: 'execute', writes: true, reads: [], branches: false, memory: 'none' },
  mov: { about: 'Copies one register into another.', form: 'mov rd, ra', readyAt: 'execute', writes: true, reads: ['a'], branches: false, memory: 'none' },
  lw: { about: 'Loads a word from memory. The result is not ready until the memory stage, which is why a load is the one instruction forwarding cannot always save.', form: 'lw rd, n(ra)', readyAt: 'memory', writes: true, reads: ['a'], branches: false, memory: 'read' },
  sw: { about: 'Stores a register into memory.', form: 'sw rb, n(ra)', readyAt: 'never', writes: false, reads: ['a', 'b'], branches: false, memory: 'write' },
  beq: { about: 'Branches when two registers are equal.', form: 'beq ra, rb, label', readyAt: 'never', writes: false, reads: ['a', 'b'], branches: true, memory: 'none' },
  bne: { about: 'Branches when two registers differ.', form: 'bne ra, rb, label', readyAt: 'never', writes: false, reads: ['a', 'b'], branches: true, memory: 'none' },
  blt: { about: 'Branches when the first register is less than the second.', form: 'blt ra, rb, label', readyAt: 'never', writes: false, reads: ['a', 'b'], branches: true, memory: 'none' },
  j: { about: 'Jumps.', form: 'j label', readyAt: 'never', writes: false, reads: [], branches: true, memory: 'none' },
  jal: { about: 'Jumps, keeping the return address in r15.', form: 'jal label', readyAt: 'execute', writes: true, reads: [], branches: true, memory: 'none' },
  jr: { about: 'Jumps to the address in a register. How a function returns.', form: 'jr ra', readyAt: 'never', writes: false, reads: ['a'], branches: true, memory: 'none' },
  nop: { about: 'Does nothing for one instruction.', form: 'nop', readyAt: 'never', writes: false, reads: [], branches: false, memory: 'none' },
  halt: { about: 'Stops.', form: 'halt', readyAt: 'never', writes: false, reads: [], branches: false, memory: 'none' }
})

export const OP_KINDS: readonly OpKind[] = Object.freeze(Object.keys(OPS) as OpKind[])

export interface Instruction {
  at: number
  kind: OpKind
  /** Destination register, or null. */
  rd: number | null
  /** First source register, or null. */
  ra: number | null
  /** Second source register, or null. */
  rb: number | null
  /** The constant, offset or branch target. */
  value: number | null
  /** The line it was written on, for reporting. */
  line: number
  /** The original text, so a trace can show what was written. */
  text: string
}

export interface Program {
  instructions: readonly Instruction[]
  labels: Readonly<Record<string, number>>
  notes: readonly string[]
}

const registerOf = (text: string): number | null => {
  const found = /^r(\d{1,2})$/i.exec(text.trim())
  if (found === null) return null
  const n = Number(found[1])
  return n >= 0 && n < PROCESSOR_LIMITS.registers ? n : null
}

/**
 * Turns written assembly into instructions.
 *
 * Two passes, because a label may be used before it is defined — which is how every assembler works and how a
 * backwards loop is written.
 */
export function assemble(source: string): Program | ProcessorError {
  const lines = String(source).split('\n')
  const labels: Record<string, number> = {}
  const pending: { text: string; line: number }[] = []

  // First pass: find the labels and the instruction positions.
  for (let i = 0; i < lines.length; i += 1) {
    let text = lines[i].replace(/[;#].*$/, '').trim()
    if (text.length === 0) continue
    const labelled = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(text)
    if (labelled !== null) {
      const name = labelled[1]
      if (Object.prototype.hasOwnProperty.call(labels, name)) {
        return refuse('duplicate label', `"${name}" is used as a label twice.`, 'Give one of them a different name.', i + 1)
      }
      labels[name] = pending.length
      text = labelled[2].trim()
      if (text.length === 0) continue
    }
    if (pending.length >= PROCESSOR_LIMITS.instructions) {
      return refuse(
        'too long',
        `More than ${PROCESSOR_LIMITS.instructions} instructions.`,
        'Shorten the program, or use a loop instead of repeating it.',
        i + 1
      )
    }
    pending.push({ text, line: i + 1 })
  }

  if (pending.length === 0) return refuse('empty', 'There are no instructions.', 'Write something for it to run, such as: li r1, 5')

  // Second pass: read each instruction, resolving labels.
  const instructions: Instruction[] = []
  for (let at = 0; at < pending.length; at += 1) {
    const { text, line } = pending[at]
    const parts = text.split(/[\s,]+/).filter((one) => one.length > 0)
    const kind = parts[0].toLowerCase() as OpKind
    const facts = OPS[kind]
    if (facts === undefined) {
      return refuse(
        'unknown instruction',
        `"${parts[0]}" is not an instruction this processor has.`,
        `It knows: ${OP_KINDS.join(', ')}.`,
        line
      )
    }

    const made: Instruction = { at, kind, rd: null, ra: null, rb: null, value: null, line, text }
    const number = (token: string | undefined): number | null => {
      if (token === undefined) return null
      const trimmed = token.trim()
      if (Object.prototype.hasOwnProperty.call(labels, trimmed)) return labels[trimmed]
      const n = Number(trimmed)
      return Number.isFinite(n) ? Math.trunc(n) : null
    }
    const needRegister = (token: string | undefined, which: string): number | ProcessorError => {
      const n = token === undefined ? null : registerOf(token)
      if (n === null) {
        return refuse(
          'bad register',
          `${kind} wants a register for ${which}, and "${token ?? 'nothing'}" is not one.`,
          `Registers are r0 to r${PROCESSOR_LIMITS.registers - 1}. Written as: ${facts.form}`,
          line
        )
      }
      return n
    }

    switch (kind) {
      case 'add':
      case 'sub':
      case 'mul':
      case 'and':
      case 'or':
      case 'xor':
      case 'sll':
      case 'srl':
      case 'slt': {
        const rd = needRegister(parts[1], 'the destination')
        if (isProcessorError(rd)) return rd
        const ra = needRegister(parts[2], 'the first source')
        if (isProcessorError(ra)) return ra
        const rb = needRegister(parts[3], 'the second source')
        if (isProcessorError(rb)) return rb
        made.rd = rd
        made.ra = ra
        made.rb = rb
        break
      }
      case 'addi':
      case 'andi':
      case 'ori':
      case 'slti': {
        const rd = needRegister(parts[1], 'the destination')
        if (isProcessorError(rd)) return rd
        const ra = needRegister(parts[2], 'the source')
        if (isProcessorError(ra)) return ra
        const value = number(parts[3])
        if (value === null) return refuse('bad constant', `${kind} wants a number, and "${parts[3] ?? 'nothing'}" is not one.`, `Written as: ${facts.form}`, line)
        made.rd = rd
        made.ra = ra
        made.value = value
        break
      }
      case 'li': {
        const rd = needRegister(parts[1], 'the destination')
        if (isProcessorError(rd)) return rd
        const value = number(parts[2])
        if (value === null) return refuse('bad constant', `li wants a number, and "${parts[2] ?? 'nothing'}" is not one.`, 'Written as: li rd, n', line)
        made.rd = rd
        made.value = value
        break
      }
      case 'mov': {
        const rd = needRegister(parts[1], 'the destination')
        if (isProcessorError(rd)) return rd
        const ra = needRegister(parts[2], 'the source')
        if (isProcessorError(ra)) return ra
        made.rd = rd
        made.ra = ra
        break
      }
      case 'lw':
      case 'sw': {
        const first = needRegister(parts[1], kind === 'lw' ? 'the destination' : 'the value to store')
        if (isProcessorError(first)) return first
        // Written as n(ra), the way every assembler writes an offset from a base register.
        const addressing = /^(-?\d+)?\s*\(\s*(r\d{1,2})\s*\)$/i.exec(parts.slice(2).join(''))
        if (addressing === null) {
          return refuse(
            'bad address',
            `${kind} addresses memory as an offset from a register, and "${parts.slice(2).join(' ')}" is not that.`,
            `Written as: ${facts.form} — for example ${kind === 'lw' ? 'lw r1, 0(r2)' : 'sw r1, 4(r2)'}`,
            line
          )
        }
        const base = registerOf(addressing[2])
        if (base === null) return refuse('bad register', `"${addressing[2]}" is not a register.`, `Registers are r0 to r${PROCESSOR_LIMITS.registers - 1}.`, line)
        made.value = addressing[1] === undefined ? 0 : Number(addressing[1])
        made.ra = base
        if (kind === 'lw') made.rd = first
        else made.rb = first
        break
      }
      case 'beq':
      case 'bne':
      case 'blt': {
        const ra = needRegister(parts[1], 'the first register')
        if (isProcessorError(ra)) return ra
        const rb = needRegister(parts[2], 'the second register')
        if (isProcessorError(rb)) return rb
        const target = number(parts[3])
        if (target === null) {
          return refuse('unknown label', `There is nowhere called "${parts[3] ?? 'nothing'}" to branch to.`, 'Write a label somewhere, as in: loop:', line)
        }
        made.ra = ra
        made.rb = rb
        made.value = target
        break
      }
      case 'j':
      case 'jal': {
        const target = number(parts[1])
        if (target === null) return refuse('unknown label', `There is nowhere called "${parts[1] ?? 'nothing'}" to jump to.`, 'Write a label somewhere, as in: loop:', line)
        made.value = target
        if (kind === 'jal') made.rd = PROCESSOR_LIMITS.registers - 1
        break
      }
      case 'jr': {
        const ra = needRegister(parts[1], 'the register holding the address')
        if (isProcessorError(ra)) return ra
        made.ra = ra
        break
      }
      case 'nop':
      case 'halt':
        break
    }

    instructions.push(made)
  }

  const notes: string[] = []
  if (!instructions.some((one) => one.kind === 'halt')) {
    notes.push('There is no halt. The program will run to the end of the instructions and stop there, which is the same thing.')
  }
  const writesR0 = instructions.filter((one) => one.rd === 0)
  if (writesR0.length > 0) {
    notes.push(
      `${writesR0.length} instruction${writesR0.length === 1 ? '' : 's'} write${writesR0.length === 1 ? 's' : ''} to r0, which is always zero. The write is discarded, as it would be on a real machine.`
    )
  }

  return { instructions: Object.freeze(instructions), labels: Object.freeze(labels), notes: Object.freeze(notes) }
}

// ---------------------------------------------------------------- the arithmetic unit

export interface AluResult {
  value: number
  /** Flags, as a real unit would set them. */
  zero: boolean
  negative: boolean
  /** True when the result did not fit, which is what a real overflow flag means. */
  overflow: boolean
  carry: boolean
  /** What it did, in words. */
  says: string
}

/** One arithmetic or logical operation, with the flags a real unit would set. */
export function alu(kind: OpKind, a: number, b: number): AluResult | ProcessorError {
  let raw: number
  let carry = false
  switch (kind) {
    case 'add':
    case 'addi':
      raw = a + b
      carry = raw > 0x7fffffff || raw < -0x80000000
      break
    case 'sub':
      raw = a - b
      carry = raw > 0x7fffffff || raw < -0x80000000
      break
    case 'mul':
      raw = a * b
      break
    case 'and':
    case 'andi':
      raw = a & b
      break
    case 'or':
    case 'ori':
      raw = a | b
      break
    case 'xor':
      raw = a ^ b
      break
    case 'sll':
      // Only the low five bits of the shift amount matter, as on a real 32-bit machine.
      raw = a << (b & 31)
      break
    case 'srl':
      raw = a >>> (b & 31)
      break
    case 'slt':
    case 'slti':
      raw = a < b ? 1 : 0
      break
    case 'mov':
    case 'li':
      raw = b
      break
    default:
      return refuse('not arithmetic', `${kind} is not something the arithmetic unit does.`, 'It handles the arithmetic, logic and comparison instructions.')
  }

  const value = wrap(raw)
  return {
    value,
    zero: value === 0,
    negative: value < 0,
    // A result that changed when wrapped did not fit, which is exactly what overflow means.
    overflow: value !== raw,
    carry,
    says:
      value !== raw
        ? `${raw} does not fit in ${PROCESSOR_LIMITS.bits} bits, so it wrapped round to ${value}. That is what a real processor does, and why overflow has a flag of its own.`
        : `${a} ${kind} ${b} is ${value}.`
  }
}

// ---------------------------------------------------------------- cache

export type Replacement = 'lru' | 'fifo' | 'random'

export const REPLACEMENTS: readonly Replacement[] = Object.freeze(['lru', 'fifo', 'random'])

export interface CacheSettings {
  /** Total size, in words. */
  size: number
  /** Words per line. Bigger lines help a program that reads in order and hurt one that jumps about. */
  lineSize: number
  /** Lines per set. 1 is direct-mapped; size/lineSize is fully associative. */
  ways: number
  replacement: Replacement
}

interface Line {
  tag: number
  valid: boolean
  dirty: boolean
  /** When it was last used, and when it arrived, for the two deterministic policies. */
  usedAt: number
  filledAt: number
}

export interface CacheReport {
  reads: number
  writes: number
  hits: number
  misses: number
  /** A miss because nothing was there yet. Unavoidable. */
  coldMisses: number
  /** A miss because something else had taken the place. More associativity would help these. */
  conflictMisses: number
  /** Lines written back to memory because they had been changed. */
  writeBacks: number
  hitRate: number
  sets: number
  settings: CacheSettings
  says: string
  notes: readonly string[]
}

/**
 * A cache, against a real stream of addresses.
 *
 * The distinction between a cold miss and a conflict miss is kept because it is the one that tells you what to do: a
 * cold miss is unavoidable, and a conflict miss means the cache is laid out wrongly for this program. Reporting only
 * a total hit rate hides which of the two you have.
 */
export class Cache {
  private readonly lines: Line[][]
  private readonly settings: CacheSettings
  private readonly everSeen = new Set<number>()
  private clock = 0
  private counts = { reads: 0, writes: 0, hits: 0, misses: 0, cold: 0, conflict: 0, writeBacks: 0 }
  /** A fixed sequence, so the random policy is reproducible and a comparison is a comparison. */
  private seed = 1

  constructor(settings: CacheSettings) {
    this.settings = settings
    const sets = Math.max(1, Math.floor(settings.size / settings.lineSize / settings.ways))
    this.lines = Array.from({ length: sets }, () =>
      Array.from({ length: settings.ways }, () => ({ tag: -1, valid: false, dirty: false, usedAt: 0, filledAt: 0 }))
    )
  }

  get setCount(): number {
    return this.lines.length
  }

  private pick(set: Line[]): number {
    const free = set.findIndex((one) => !one.valid)
    if (free >= 0) return free
    if (this.settings.replacement === 'fifo') {
      let at = 0
      for (let i = 1; i < set.length; i += 1) if (set[i].filledAt < set[at].filledAt) at = i
      return at
    }
    if (this.settings.replacement === 'random') {
      // A fixed generator, so two runs of the same program give the same answer.
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
      return this.seed % set.length
    }
    let at = 0
    for (let i = 1; i < set.length; i += 1) if (set[i].usedAt < set[at].usedAt) at = i
    return at
  }

  /** One access. Returns whether it hit. */
  access(address: number, writing: boolean): boolean {
    this.clock += 1
    if (writing) this.counts.writes += 1
    else this.counts.reads += 1

    const lineNumber = Math.floor(address / this.settings.lineSize)
    const set = this.lines[lineNumber % this.lines.length]
    const tag = Math.floor(lineNumber / this.lines.length)

    const found = set.find((one) => one.valid && one.tag === tag)
    if (found !== undefined) {
      this.counts.hits += 1
      found.usedAt = this.clock
      if (writing) found.dirty = true
      return true
    }

    this.counts.misses += 1
    // Never seen this line before means nothing could have held it: a cold miss.
    if (this.everSeen.has(lineNumber)) this.counts.conflict += 1
    else this.counts.cold += 1
    this.everSeen.add(lineNumber)

    const at = this.pick(set)
    if (set[at].valid && set[at].dirty) this.counts.writeBacks += 1
    set[at] = { tag, valid: true, dirty: writing, usedAt: this.clock, filledAt: this.clock }
    return false
  }

  report(): CacheReport {
    const total = this.counts.hits + this.counts.misses
    const hitRate = total === 0 ? 0 : this.counts.hits / total
    const notes: string[] = []
    if (total === 0) notes.push('The program never touched memory, so the cache was never used.')
    else {
      if (this.counts.conflict > this.counts.cold) {
        notes.push(
          `More of the misses were conflicts (${this.counts.conflict}) than cold misses (${this.counts.cold}). A conflict miss means the line had been in the cache and something pushed it out — more ways, or a different line size, would help. A cold miss is unavoidable.`
        )
      } else if (this.counts.cold > 0 && this.counts.conflict === 0) {
        notes.push(
          `Every miss was a cold miss: the data had simply not been read before. No cache arrangement avoids those, so this is as well as a cache of this size can do on this program.`
        )
      }
      if (this.settings.ways === 1 && this.counts.conflict > 0) {
        notes.push('This cache is direct-mapped, so two addresses that land in the same set evict each other however much room there is elsewhere. Try two or four ways.')
      }
      if (this.counts.writeBacks > 0) {
        notes.push(`${this.counts.writeBacks} changed lines had to be written back to memory when they were evicted. That is traffic a read-only program does not generate.`)
      }
    }

    return {
      reads: this.counts.reads,
      writes: this.counts.writes,
      hits: this.counts.hits,
      misses: this.counts.misses,
      coldMisses: this.counts.cold,
      conflictMisses: this.counts.conflict,
      writeBacks: this.counts.writeBacks,
      hitRate,
      sets: this.lines.length,
      settings: this.settings,
      says:
        total === 0
          ? 'No memory accesses.'
          : `${this.counts.hits} of ${total} accesses hit — ${(hitRate * 100).toFixed(1)}%.`,
      notes: Object.freeze(notes)
    }
  }
}

// ---------------------------------------------------------------- execution

export interface Step {
  /** Which cycle of the single-cycle run. */
  n: number
  /** Where the instruction was. */
  at: number
  instruction: Instruction
  /** Registers after it ran. */
  registers: readonly number[]
  /** What the arithmetic unit did, where it did anything. */
  alu: AluResult | null
  /** The memory address touched, where any was. */
  address: number | null
  /** Whether the cache hit, where memory was touched. */
  cacheHit: boolean | null
  /** Where it went next, when that was not simply the next instruction. */
  branchedTo: number | null
  says: string
}

export interface RunReport {
  steps: readonly Step[]
  registers: readonly number[]
  /** Only the words the program actually touched, so a sparse memory is not a 4,096-entry list. */
  memory: Readonly<Record<number, number>>
  instructionsRun: number
  halted: boolean
  /** True when it hit the cycle ceiling, which almost always means a loop with no way out. */
  ranAway: boolean
  cache: CacheReport
  problem: ProcessorError | null
  says: string
  notes: readonly string[]
}

/**
 * Runs the program one instruction at a time, with no pipeline.
 *
 * This is the simple machine: fetch, do the whole thing, move on. It is what the pipeline is compared against, and
 * it is where correctness is established — if the program gives the wrong answer here, nothing about the pipeline
 * diagram matters.
 */
export function run(
  program: Program,
  options: { memory?: Readonly<Record<number, number>>; cache?: CacheSettings; cycles?: number } = {}
): RunReport {
  const registers = new Array<number>(PROCESSOR_LIMITS.registers).fill(0)
  const memory = new Map<number, number>()
  for (const [at, value] of Object.entries(options.memory ?? {})) {
    const address = Number(at)
    if (Number.isFinite(address) && address >= 0 && address < PROCESSOR_LIMITS.memory) memory.set(address, wrap(value))
  }
  const cache = new Cache(options.cache ?? { size: 64, lineSize: 4, ways: 1, replacement: 'lru' })
  const ceiling = Math.min(options.cycles ?? PROCESSOR_LIMITS.cycles, PROCESSOR_LIMITS.cycles)

  const steps: Step[] = []
  let at = 0
  let halted = false
  let ranAway = false
  let problem: ProcessorError | null = null

  for (let n = 0; n < ceiling; n += 1) {
    if (at < 0 || at >= program.instructions.length) break
    const instruction = program.instructions[at]
    if (instruction.kind === 'halt') {
      halted = true
      steps.push({
        n,
        at,
        instruction,
        registers: Object.freeze([...registers]),
        alu: null,
        address: null,
        cacheHit: null,
        branchedTo: null,
        says: 'Stopped.'
      })
      break
    }

    const a = instruction.ra === null ? 0 : registers[instruction.ra]
    const b = instruction.rb === null ? 0 : registers[instruction.rb]
    let made: AluResult | null = null
    let address: number | null = null
    let cacheHit: boolean | null = null
    let branchedTo: number | null = null
    let says = instruction.text

    switch (instruction.kind) {
      case 'add':
      case 'sub':
      case 'mul':
      case 'and':
      case 'or':
      case 'xor':
      case 'sll':
      case 'srl':
      case 'slt': {
        const result = alu(instruction.kind, a, b)
        if (isProcessorError(result)) {
          problem = result
          break
        }
        made = result
        if (instruction.rd !== null && instruction.rd !== 0) registers[instruction.rd] = result.value
        says = `r${instruction.rd} = ${result.value}`
        break
      }
      case 'addi':
      case 'andi':
      case 'ori':
      case 'slti': {
        const result = alu(instruction.kind, a, instruction.value ?? 0)
        if (isProcessorError(result)) {
          problem = result
          break
        }
        made = result
        if (instruction.rd !== null && instruction.rd !== 0) registers[instruction.rd] = result.value
        says = `r${instruction.rd} = ${result.value}`
        break
      }
      case 'li': {
        const value = wrap(instruction.value ?? 0)
        if (instruction.rd !== null && instruction.rd !== 0) registers[instruction.rd] = value
        says = `r${instruction.rd} = ${value}`
        break
      }
      case 'mov': {
        if (instruction.rd !== null && instruction.rd !== 0) registers[instruction.rd] = a
        says = `r${instruction.rd} = r${instruction.ra} = ${a}`
        break
      }
      case 'lw': {
        address = a + (instruction.value ?? 0)
        if (address < 0 || address >= PROCESSOR_LIMITS.memory) {
          problem = refuse(
            'bad address',
            `It tried to read word ${address}, and memory runs from 0 to ${PROCESSOR_LIMITS.memory - 1}.`,
            'Check what the base register holds — a loop that counts past the end of an array is the usual cause.',
            instruction.line
          )
          break
        }
        cacheHit = cache.access(address, false)
        const value = memory.get(address) ?? 0
        if (instruction.rd !== null && instruction.rd !== 0) registers[instruction.rd] = value
        says = `r${instruction.rd} = memory[${address}] = ${value}${cacheHit ? ' (cache hit)' : ' (cache miss)'}`
        break
      }
      case 'sw': {
        address = a + (instruction.value ?? 0)
        if (address < 0 || address >= PROCESSOR_LIMITS.memory) {
          problem = refuse(
            'bad address',
            `It tried to write word ${address}, and memory runs from 0 to ${PROCESSOR_LIMITS.memory - 1}.`,
            'Check what the base register holds.',
            instruction.line
          )
          break
        }
        cacheHit = cache.access(address, true)
        memory.set(address, b)
        says = `memory[${address}] = r${instruction.rb} = ${b}${cacheHit ? ' (cache hit)' : ' (cache miss)'}`
        break
      }
      case 'beq':
      case 'bne':
      case 'blt': {
        const taken = instruction.kind === 'beq' ? a === b : instruction.kind === 'bne' ? a !== b : a < b
        says = `${a} ${instruction.kind === 'beq' ? '==' : instruction.kind === 'bne' ? '!=' : '<'} ${b} is ${taken}, so ${taken ? `go to ${instruction.value}` : 'carry on'}`
        if (taken) branchedTo = instruction.value ?? at + 1
        break
      }
      case 'j':
        branchedTo = instruction.value ?? at + 1
        says = `go to ${branchedTo}`
        break
      case 'jal':
        if (instruction.rd !== null && instruction.rd !== 0) registers[instruction.rd] = at + 1
        branchedTo = instruction.value ?? at + 1
        says = `go to ${branchedTo}, keeping ${at + 1} in r${instruction.rd} to come back to`
        break
      case 'jr':
        branchedTo = a
        says = `go back to ${a}`
        break
      case 'nop':
        says = 'nothing'
        break
      default:
        break
    }

    steps.push({
      n,
      at,
      instruction,
      registers: Object.freeze([...registers]),
      alu: made,
      address,
      cacheHit,
      branchedTo,
      says
    })

    if (problem !== null) break
    at = branchedTo === null ? at + 1 : branchedTo
    if (n === ceiling - 1) ranAway = true
  }

  const notes: string[] = [...program.notes]
  if (ranAway) {
    notes.push(
      `It was still running after ${ceiling.toLocaleString()} instructions, so it was stopped. A loop whose condition never becomes false is the usual cause.`
    )
  }

  return {
    steps: Object.freeze(steps),
    registers: Object.freeze([...registers]),
    memory: Object.freeze(Object.fromEntries([...memory].sort((x, y) => x[0] - y[0]))),
    instructionsRun: steps.length,
    halted,
    ranAway,
    cache: cache.report(),
    problem,
    says:
      problem !== null
        ? `It stopped after ${steps.length} instructions: ${problem.says}`
        : halted
          ? `Halted after ${steps.length} instruction${steps.length === 1 ? '' : 's'}.`
          : ranAway
            ? `Stopped after ${steps.length} instructions without finishing.`
            : `Ran ${steps.length} instruction${steps.length === 1 ? '' : 's'} and reached the end.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- the pipeline

export type Stage = 'fetch' | 'decode' | 'execute' | 'memory' | 'writeback'

export const STAGES: readonly Stage[] = Object.freeze(['fetch', 'decode', 'execute', 'memory', 'writeback'])

export type HazardKind = 'data' | 'load-use' | 'control' | 'structural'

export interface Hazard {
  kind: HazardKind
  /** The cycle the stall or flush happened in. */
  cycle: number
  /** The instruction that had to wait, by its position in the issued order. */
  waiting: number
  /** What it was waiting for, where there was one. */
  because: number | null
  /** Which register was the problem. */
  register: number | null
  cyclesLost: number
  says: string
}

export interface Slot {
  /** Which instruction, by issue order. */
  issue: number
  instruction: Instruction
  /** Which cycle each stage happened in. Null where the instruction was flushed before reaching it. */
  stages: Readonly<Record<Stage, number | null>>
  /** Cycles this instruction spent stalled before it could move on. */
  stalled: number
  /** True when a branch before it meant it should never have been fetched. */
  flushed: boolean
}

export interface PipelineReport {
  slots: readonly Slot[]
  cycles: number
  instructions: number
  /** Cycles per instruction. 1.0 is the ideal a five-stage pipeline aims at. */
  cpi: number
  hazards: readonly Hazard[]
  stallCycles: number
  flushedInstructions: number
  forwarding: boolean
  /** What it would have taken with no pipeline at all: five cycles each. */
  withoutPipeline: number
  says: string
  notes: readonly string[]
}

/**
 * Schedules the executed instruction sequence through five stages.
 *
 * ## Why it schedules what actually ran
 *
 * The pipeline is worked out over the trace from `run`, not over the program text. That matters for a loop: the
 * instructions in the body execute many times, and the hazards between one iteration and the next are real hazards
 * that a static reading of the program would miss entirely.
 *
 * ## Where the stalls come from
 *
 * A data hazard is a register written by one instruction and read by a later one. With forwarding, the value can be
 * handed from the stage that produced it to the stage that needs it, and only a load is a problem — because a load's
 * value is not known until the memory stage, one cycle too late for the instruction immediately behind it. Without
 * forwarding, the reader has to wait until the writer's writeback stage, which costs more. Both are computed.
 */
export function pipeline(report: RunReport, options: { forwarding?: boolean; predictTaken?: boolean } = {}): PipelineReport {
  const forwarding = options.forwarding !== false
  const slots: Slot[] = []
  const hazards: Hazard[] = []

  /** When each register's value becomes available, in cycles. */
  const readyAt = new Map<number, { cycle: number; from: number }>()
  let nextFetch = 1
  let stallCycles = 0
  let flushed = 0

  for (let issue = 0; issue < report.steps.length; issue += 1) {
    const step = report.steps[issue]
    const instruction = step.instruction
    const facts = OPS[instruction.kind]

    let fetch = nextFetch
    let decode = fetch + 1

    // What this instruction reads, and when it needs it.
    const sources: number[] = []
    if (facts.reads.includes('a') && instruction.ra !== null) sources.push(instruction.ra)
    if (facts.reads.includes('b') && instruction.rb !== null) sources.push(instruction.rb)

    let stalled = 0
    for (const register of sources) {
      // r0 is always zero and never actually written, so it is never a hazard.
      if (register === 0) continue
      const held = readyAt.get(register)
      if (held === undefined) continue

      /*
       * The cycle this instruction needs the value in.
       *
       * With forwarding it needs it at the start of execute; without, it must wait for the writer's writeback to have
       * finished, because the register file is only correct after that.
       */
      const neededIn = decode + 1
      const availableIn = held.cycle
      if (availableIn > neededIn) {
        const lost = availableIn - neededIn
        stalled = Math.max(stalled, lost)
        const writer = report.steps[held.from]
        const loadUse = writer !== undefined && writer.instruction.kind === 'lw'
        hazards.push({
          kind: loadUse && forwarding ? 'load-use' : 'data',
          cycle: neededIn,
          waiting: issue,
          because: held.from,
          register,
          cyclesLost: lost,
          says:
            loadUse && forwarding
              ? `${instruction.text} needs r${register}, which the load before it does not have until its memory stage. Forwarding cannot send a value back in time, so this one cycle is unavoidable — the only fix is to put an unrelated instruction between them.`
              : forwarding
                ? `${instruction.text} needs r${register} from instruction ${held.from}, and had to wait ${lost} cycle${lost === 1 ? '' : 's'} for it.`
                : `${instruction.text} needs r${register} from instruction ${held.from}. With no forwarding it must wait for that value to be written back, which costs ${lost} cycle${lost === 1 ? '' : 's'}.`
        })
      }
    }

    decode += stalled
    stallCycles += stalled

    const execute = decode + 1
    const memory = execute + 1
    const writeback = memory + 1

    // When this instruction's own result becomes usable.
    if (facts.writes && instruction.rd !== null && instruction.rd !== 0) {
      const available = forwarding ? (facts.readyAt === 'memory' ? memory + 1 : execute + 1) : writeback + 1
      readyAt.set(instruction.rd, { cycle: available, from: issue })
    }

    slots.push({
      issue,
      instruction,
      stages: Object.freeze({ fetch, decode, execute, memory, writeback }),
      stalled,
      flushed: false
    })

    nextFetch = fetch + 1 + stalled

    /*
     * A taken branch means the instructions already fetched behind it were the wrong ones.
     *
     * Two of them, on a five-stage pipeline where the branch resolves in execute. They are counted as flushed and the
     * next instruction cannot be fetched until the branch has resolved — which is the control hazard, and the reason
     * branch prediction exists.
     */
    if (facts.branches && step.branchedTo !== null) {
      const predicted = options.predictTaken === true
      if (!predicted) {
        const lost = 2
        flushed += lost
        stallCycles += lost
        hazards.push({
          kind: 'control',
          cycle: execute,
          waiting: issue + 1,
          because: issue,
          register: null,
          cyclesLost: lost,
          says: `${instruction.text} was taken, so the two instructions already fetched behind it were the wrong ones and had to be thrown away. This is why a processor guesses which way a branch will go.`
        })
        nextFetch = execute + 1
      }
    }
  }

  const cycles = slots.length === 0 ? 0 : Math.max(...slots.map((one) => one.stages.writeback ?? 0))
  const instructions = slots.length
  const cpi = instructions === 0 ? 0 : cycles / instructions
  const withoutPipeline = instructions * STAGES.length

  const notes: string[] = []
  const dataHazards = hazards.filter((one) => one.kind === 'data').length
  const loadUse = hazards.filter((one) => one.kind === 'load-use').length
  const control = hazards.filter((one) => one.kind === 'control').length

  if (instructions > 0) {
    notes.push(
      `${instructions} instructions in ${cycles} cycles is ${cpi.toFixed(2)} cycles each. A five-stage pipeline with nothing in its way manages 1.0; without a pipeline at all this would take ${withoutPipeline}.`
    )
  }
  if (loadUse > 0) {
    notes.push(
      `${loadUse} load-use stall${loadUse === 1 ? '' : 's'}. A load's value arrives one stage too late for the instruction right behind it, and forwarding cannot fix that — moving an unrelated instruction into the gap can.`
    )
  }
  if (dataHazards > 0 && !forwarding) {
    notes.push(
      `${dataHazards} data hazard${dataHazards === 1 ? '' : 's'}, all of which forwarding would remove or shorten. Turn it on and compare the cycle count.`
    )
  }
  if (control > 0) {
    notes.push(
      `${control} taken branch${control === 1 ? '' : 'es'}, costing ${control * 2} cycles between them. A branch predictor that guessed right would recover most of that.`
    )
  }
  if (hazards.length === 0 && instructions > 0) {
    notes.push('Nothing got in the way: every instruction moved through a stage per cycle. That is the best a five-stage pipeline can do.')
  }

  return {
    slots: Object.freeze(slots),
    cycles,
    instructions,
    cpi,
    hazards: Object.freeze(hazards),
    stallCycles,
    flushedInstructions: flushed,
    forwarding,
    withoutPipeline,
    says:
      instructions === 0
        ? 'Nothing ran.'
        : `${cycles} cycles for ${instructions} instructions — ${cpi.toFixed(2)} per instruction, with ${stallCycles} cycle${stallCycles === 1 ? '' : 's'} lost to hazards.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- programs worth having ready

export type Sample = 'count' | 'sum-array' | 'factorial' | 'fibonacci' | 'max-of-array' | 'stride-walk' | 'load-use' | 'branch-heavy'

export const SAMPLES: readonly Sample[] = Object.freeze([
  'count',
  'sum-array',
  'max-of-array',
  'factorial',
  'fibonacci',
  'load-use',
  'branch-heavy',
  'stride-walk'
])

export const SAMPLE_ABOUT: Readonly<Record<Sample, string>> = Object.freeze({
  count: 'Counts to ten. The simplest thing with a loop in it.',
  'sum-array': 'Adds up eight numbers in memory. Walks memory in order, so the cache does well.',
  'max-of-array': 'Finds the largest of eight numbers. A branch inside a loop, so branch cost shows up.',
  factorial: 'Works out 7! by repeated multiplication.',
  fibonacci: 'The first twelve Fibonacci numbers, written into memory.',
  'load-use': 'A load followed immediately by a use of what it loaded — the one stall forwarding cannot remove. Compare it with the same program with the instructions reordered.',
  'branch-heavy': 'A tight loop with a branch every few instructions, to show what control hazards cost.',
  'stride-walk': 'Reads memory with a large stride, so every access lands in a new cache line and almost everything misses. Change the line size and watch the hit rate move.'
})

export function sample(which: Sample): { source: string; memory: Readonly<Record<number, number>> } | ProcessorError {
  switch (which) {
    case 'count':
      return {
        source: `li r1, 0
li r2, 10
loop:
addi r1, r1, 1
blt r1, r2, loop
halt`,
        memory: {}
      }
    case 'sum-array':
      return {
        source: `li r1, 0        ; the running total
li r2, 0        ; where we are
li r3, 8        ; how many
loop:
lw r4, 0(r2)
add r1, r1, r4
addi r2, r2, 1
blt r2, r3, loop
sw r1, 100(r0)
halt`,
        memory: { 0: 5, 1: 12, 2: 7, 3: 3, 4: 19, 5: 2, 6: 8, 7: 44 }
      }
    case 'max-of-array':
      return {
        source: `li r1, 0        ; where we are
li r2, 8        ; how many
lw r3, 0(r1)    ; the largest so far
addi r1, r1, 1
loop:
lw r4, 0(r1)
blt r4, r3, skip
mov r3, r4
skip:
addi r1, r1, 1
blt r1, r2, loop
sw r3, 100(r0)
halt`,
        memory: { 0: 5, 1: 12, 2: 7, 3: 3, 4: 19, 5: 2, 6: 8, 7: 44 }
      }
    case 'factorial':
      return {
        source: `li r1, 1        ; the running product
li r2, 1        ; the multiplier
li r3, 7        ; up to
loop:
mul r1, r1, r2
addi r2, r2, 1
slti r4, r2, 8
bne r4, r0, loop
sw r1, 100(r0)
halt`,
        memory: {}
      }
    case 'fibonacci':
      return {
        source: `li r1, 0
li r2, 1
li r3, 0        ; where to write
li r4, 12       ; how many
loop:
sw r1, 0(r3)
add r5, r1, r2
mov r1, r2
mov r2, r5
addi r3, r3, 1
blt r3, r4, loop
halt`,
        memory: {}
      }
    case 'load-use':
      return {
        source: `li r2, 0
lw r1, 0(r2)
addi r3, r1, 1  ; needs r1 immediately: this is the stall
lw r4, 1(r2)
addi r5, r4, 1  ; and again
sw r3, 100(r0)
sw r5, 101(r0)
halt`,
        memory: { 0: 10, 1: 20 }
      }
    case 'branch-heavy':
      return {
        source: `li r1, 0
li r2, 20
loop:
addi r1, r1, 1
andi r3, r1, 1
bne r3, r0, odd
addi r4, r4, 1
j next
odd:
addi r5, r5, 1
next:
blt r1, r2, loop
halt`,
        memory: {}
      }
    case 'stride-walk': {
      // A stride of 16 words, so with a four-word line every read is a new line and almost nothing hits.
      const memory: Record<number, number> = {}
      for (let i = 0; i < 32; i += 1) memory[i * 16] = i + 1
      return {
        source: `li r1, 0        ; where we are
li r2, 512      ; past the end
li r3, 0        ; the running total
loop:
lw r4, 0(r1)
add r3, r3, r4
addi r1, r1, 16
blt r1, r2, loop
sw r3, 600(r0)
halt`,
        memory
      }
    }
    default:
      return refuse('unknown sample', `There is no program called "${String(which)}".`, `Try one of: ${SAMPLES.join(', ')}.`)
  }
}

export const PROCESSOR_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A teaching instruction set: small, regular and closer to MIPS than to anything that shipped. It has no floating point, no byte or half-word access and no privileged instructions.',
  'Costs are counted in cycles, never in nanoseconds. Turning cycles into time needs a clock rate, a process and a memory latency, none of which is modelled.',
  'The pipeline is the textbook five stages, in order, one instruction at a time. There is no out-of-order execution, no register renaming, no superscalar issue and no speculation beyond the one branch scheme.',
  'Memory responds in a single cycle whether the cache hit or missed. The cache reports what it would have done, and the cycle count does not charge for a miss.',
  'There is no operating system, no interrupts, no exceptions and no virtual memory. A bad address stops the program rather than trapping.',
  'The cache is one level. Real machines have two or three, with different sizes and latencies at each.'
])
