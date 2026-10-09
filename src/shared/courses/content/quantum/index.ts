import type { Assessment, Course, Module } from '../../types.ts'
import { QUANTUM_CONCEPTS } from './concepts.ts'
import { Q_UNIT_1 } from './unit1.ts'
import { Q_UNIT_2 } from './unit2.ts'
import { Q_UNIT_3 } from './unit3.ts'
import { Q_UNIT_4 } from './unit4.ts'
import { Q_UNIT_5 } from './unit5.ts'
import { Q_UNIT_6 } from './unit6.ts'
import { Q_UNIT_7 } from './unit7.ts'
import { Q_UNIT_8 } from './unit8.ts'
import { Q_UNIT_9 } from './unit9.ts'
import { Q_UNIT_10 } from './unit10.ts'
import { Q_UNIT_11 } from './unit11.ts'
import { Q_UNIT_12 } from './unit12.ts'
import { Q_UNIT_13 } from './unit13.ts'
import { Q_UNIT_14 } from './unit14.ts'
import { Q_UNIT_15 } from './unit15.ts'
import { Q_UNIT_16 } from './unit16.ts'
import { Q_PROJECTS } from './projects.ts'

/**
 * Course 03 — Quantum Computing: From Qubits to Quantum Algorithms.
 *
 * ## The same engine, the same grading
 *
 * Nothing here is a second course system. The modules, lessons, blocks and questions are the structures Course 01
 * and Course 02 use; `cleanCourse` recomputes every count; the pass mark is the existing eighty per cent, for
 * module quizzes and for the final paper alike. A third grading scheme would make the three courses
 * incomparable for no gain.
 *
 * ## Nothing in this course fakes a quantum result
 *
 * Every circuit, state, measurement, algorithm, noise channel and syndrome in the laboratories is computed by
 * `src/shared/quantum/` — a real state-vector simulator with ninety-four tests behind it, including a test for
 * every gate and for complete circuits. Where a thing cannot be computed, the tool refuses rather than
 * approximating quietly: above twenty-four qubits it declines, an inverse of a measured circuit is refused, and
 * coherence times violating T2 <= 2*T1 are rejected as describing no possible device.
 *
 * And every result carries its mode -- exact, sampled or noisy. **There is no hardware behind any of it**, the
 * course says so in Unit 15 and again in the projects, and no lesson presents a simulated number as a measured
 * one.
 *
 * ## Why the units are in this order
 *
 * Measurement before gates, because a learner who thinks a qubit holds a hidden bit will mis-read every
 * subsequent circuit. Entanglement before algorithms, because every algorithm uses it. Interference before
 * Grover, because interference is the mechanism and "tries everything at once" is what people believe when they
 * were not shown it. Noise and error correction before hardware and the variational algorithms, because those
 * last two only make sense as responses to noise.
 *
 * The four untrue sentences introduced in Unit 01 are refused one at a time as the evidence arrives, and
 * collected again in the final lesson -- each paired with the experiment that settles it, not with an argument.
 */

const MODULES: readonly Module[] = [
  Q_UNIT_1,
  Q_UNIT_2,
  Q_UNIT_3,
  Q_UNIT_4,
  Q_UNIT_5,
  Q_UNIT_6,
  Q_UNIT_7,
  Q_UNIT_8,
  Q_UNIT_9,
  Q_UNIT_10,
  Q_UNIT_11,
  Q_UNIT_12,
  Q_UNIT_13,
  Q_UNIT_14,
  Q_UNIT_15,
  Q_UNIT_16,
  Q_PROJECTS
]

/**
 * The final paper's pool.
 *
 * Gathered from the lessons rather than typed out, so it cannot ask for a question that has been renamed.
 * Beginner questions are excluded: a paper made of the first unit's definition checks would pass somebody who
 * read Unit 01 and stopped.
 */
function assessmentPool(): string[] {
  const out: string[] = []
  for (const unit of MODULES) {
    for (const lesson of unit.lessons) {
      for (const question of lesson.questions) {
        if (question.difficulty === 'beginner') continue
        out.push(question.id)
      }
    }
  }
  return out
}

const POOL = assessmentPool()

const ASSESSMENT: Assessment = {
  id: 'quantum.final',
  title: 'Final assessment',
  questionIds: POOL,
  // Far fewer than the pool holds, so a second attempt is a different paper.
  ask: Math.min(45, POOL.length),
  passScore: 0.8,
  minutes: 75
}

export const QUANTUM_COURSE: Course = {
  id: 'orbis.quantum.03',
  title: 'Quantum Computing: From Qubits to Quantum Algorithms',
  subtitle: 'What a qubit actually is, what these machines can really do, and how to tell',
  shortDescription:
    'Quantum computing from classical bits to quantum algorithms, noise, error correction and hardware — with a real simulator behind every result, seven projects and a capstone you choose.',
  description:
    'A complete course in quantum computing for somebody who can program and has not done this before. It starts with ' +
    'classical bits and reversibility, then builds the actual object: amplitudes, phase, measurement, gates, ' +
    'entanglement, circuits, interference, the algorithms, noise, error correction, hardware and the variational ' +
    'methods, and finally simulation, cryptography and machine learning.\n\n' +
    'It does not say that a qubit is 0 and 1 at the same time, and it does not say that a quantum computer tries every ' +
    'answer at once. Both sentences are introduced in Unit 01 as things people say, and both are refused later by ' +
    'experiments you run: a Hadamard applied twice, and the success curve of Grover rotating past its peak.\n\n' +
    'Every number in the laboratories is computed by a real state-vector simulator, and labelled ideal, sampled or ' +
    'noisy. Nothing here runs on quantum hardware, the course says so, and where a calculation is beyond what can ' +
    'honestly be simulated the tool refuses rather than guessing.\n\n' +
    'It ends with seven projects — a qubit laboratory, Bell states, teleportation, Grover, phase estimation, a noise ' +
    'study and error correction — and a capstone you choose from ten tracks. A capstone does not pass because it ran: ' +
    'it passes when somebody else could reproduce it, the benchmark is present and fair, and the limitations are ' +
    'stated without being asked for.',
  category: 'Quantum Computing',
  subcategory: 'Quantum information and algorithms',
  difficulty: 'intermediate',
  // Recomputed from the content by cleanCourse; placeholders the loader overwrites.
  lessonCount: 0,
  moduleCount: MODULES.length,
  estimatedMinutes: 0,
  language: 'en',
  tags: [
    'quantum computing',
    'qubits',
    'superposition',
    'entanglement',
    'quantum gates',
    'quantum circuits',
    'grover',
    'shor',
    'quantum fourier transform',
    'quantum error correction',
    'quantum hardware',
    'vqe',
    'quantum cryptography'
  ],
  origin: 'orbis',
  version: 1,
  icon: 'atom',
  cover: { from: '#3b1d6e', to: '#0b1220' },
  updatedAt: 0,
  createdAt: 0,
  objectives: [
    'Write a quantum state, read its amplitudes, and say what a measurement would give',
    'Explain why a qubit is not a hidden bit, with the experiment that shows it',
    'Apply gates by hand and by circuit, and say why order matters',
    'Explain entanglement without a metaphor, and tell it apart from correlation',
    'Build, debug and cost a circuit in qubits, depth and two-qubit gates',
    'Trace an algorithm from preparation through marking and interference to measurement',
    'Implement Deutsch–Jozsa, Bernstein–Vazirani, Simon, Grover, the QFT and phase estimation',
    'Explain Shor in three stages and state honestly what it would really cost',
    'Say what quantum advantage means, where it applies, and where it does not',
    'Simulate noise, and explain why a phase error is the dangerous one',
    'Encode a logical qubit, read a syndrome, and say what a code cannot see',
    'Read a claim about quantum computing and say what it does and does not establish'
  ],
  skills: [
    'Complex amplitudes, normalisation and the Born rule',
    'Measurement, bases, shots and sampling error',
    'Single-qubit gates, rotations and the Bloch sphere',
    'Tensor products, multi-qubit states and controlled gates',
    'Entanglement, Bell states, density matrices and partial trace',
    'Circuit construction, simplification and debugging',
    'Interference as the mechanism of every quantum algorithm',
    'No-cloning, teleportation and superdense coding',
    'Oracles and phase kickback',
    'Grover and amplitude amplification, including over-rotation',
    'The quantum Fourier transform and phase estimation',
    'Shor, period finding and resource accounting',
    'Complexity, BQP and the limits of advantage',
    'Noise channels, coherence times and noise-aware design',
    'Stabilisers, the three-qubit code, the surface code and thresholds',
    'Hardware platforms, connectivity, native gates and benchmarking',
    'Variational algorithms: VQE, QAOA and barren plateaus',
    'Quantum simulation, chemistry, cryptography and BB84',
    'Experiment design, reproducible seeds and honest reporting'
  ],
  prerequisites: [
    'Course 01 — Python Programming: From Zero to Developer, or equivalent programming ability.',
    'Comfort with arithmetic and with working through a small calculation by hand. Complex numbers, vectors and matrices are taught where they are needed, in Units 02, 04 and 05.',
    'No physics is assumed.'
  ],
  audience:
    'Programmers who want to understand quantum computing as it is rather than as it is reported, and anybody who has read about it and wants to know which of the claims survive contact with an experiment.',
  modules: [...MODULES],
  concepts: [...QUANTUM_CONCEPTS],
  completion: {
    requiredLessons: true,
    lessonShare: 1,
    // Empty means every module's quiz.
    requiredQuizzes: [],
    quizPass: 0.8,
    needsAssessment: true,
    masteryAtLeast: 0.7,
    requiredProjects: ['q17']
  },
  assessment: ASSESSMENT,
  certificate: true
}
