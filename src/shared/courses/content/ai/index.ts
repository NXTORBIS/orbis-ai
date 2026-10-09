import type { Assessment, Course, Module } from '../../types.ts'
import { AI_CONCEPTS } from './concepts.ts'
import { AI_UNIT_1 } from './unit1.ts'
import { AI_UNIT_2 } from './unit2.ts'
import { AI_UNIT_3 } from './unit3.ts'
import { AI_UNIT_4 } from './unit4.ts'
import { AI_UNIT_5 } from './unit5.ts'
import { AI_UNIT_6 } from './unit6.ts'
import { AI_UNIT_7 } from './unit7.ts'
import { AI_UNIT_8 } from './unit8.ts'
import { AI_UNIT_9 } from './unit9.ts'
import { AI_UNIT_10 } from './unit10.ts'
import { AI_UNIT_11 } from './unit11.ts'
import { AI_UNIT_12 } from './unit12.ts'
import { AI_UNIT_13 } from './unit13.ts'
import { AI_PROJECTS } from './projects.ts'

/**
 * Course 02 — Artificial Intelligence: From Foundations to Modern AI.
 *
 * ## Nothing here is counted by hand
 *
 * `lessonCount` and `estimatedMinutes` are recomputed by `cleanCourse` from the actual content, and the final
 * assessment pool is gathered from the lessons rather than typed out — so no number in this file can disagree
 * with what is really there, and a question renamed in a unit cannot leave the final paper asking for something
 * that does not exist.
 *
 * ## The same pass mark as Course 01
 *
 * Eighty per cent, for module quizzes and for the final assessment, with mastery required as well as completion.
 * A second grading system would make the two courses incomparable, and the existing one is the right shape.
 *
 * ## Why the units are in this order
 *
 * Data before modelling, because every later failure traces back to it. Evaluation before the clever models,
 * because a learner who cannot tell a working model from one that looks like it works will believe whatever the
 * clever model tells them. Mathematics placed where it is needed rather than in a block at the front. And
 * attention before language models, because an LLM is a transformer trained on one objective and teaching it any
 * other way leaves people with a magical account of what these systems are.
 */

const MODULES: readonly Module[] = [
  AI_UNIT_1,
  AI_UNIT_2,
  AI_UNIT_3,
  AI_UNIT_4,
  AI_UNIT_5,
  AI_UNIT_6,
  AI_UNIT_7,
  AI_UNIT_8,
  AI_UNIT_9,
  AI_UNIT_10,
  AI_UNIT_11,
  AI_UNIT_12,
  AI_UNIT_13,
  AI_PROJECTS
]

/**
 * The final paper's pool.
 *
 * Gathered from the lessons, so it cannot name a question that has been renamed or removed. Beginner questions
 * are excluded: a final assessment made of the first unit's definition checks would pass somebody who had read
 * Unit 01 and stopped.
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
  id: 'ai.final',
  title: 'Final assessment',
  questionIds: POOL,
  /*
   * Forty-five, from a pool several times that size.
   *
   * Far fewer than the pool holds, so a second attempt is a different paper — retaking until one fixed set of
   * questions is memorised would measure memory of the paper rather than understanding of the subject.
   */
  ask: Math.min(45, POOL.length),
  passScore: 0.8,
  minutes: 75
}

export const AI_COURSE: Course = {
  id: 'orbis.ai.02',
  title: 'Artificial Intelligence: From Foundations to Modern AI',
  subtitle: 'From what the words mean to building and evaluating a system yourself',
  shortDescription:
    'Artificial intelligence as a technical discipline: data, machine learning, deep learning, vision, language, transformers, large language models, retrieval, agents, engineering, safety and evaluation — with five projects and a capstone.',
  description:
    'A complete course in artificial intelligence for somebody who can program and has not done this before. It starts ' +
    'with what the words actually mean and why the field turned to learning from data, then works through the material in ' +
    'the order that makes it comprehensible: data and its faults, machine learning, evaluation and overfitting, learning ' +
    'without labels, the mathematics where it is needed, neural networks, vision, language, attention, large language ' +
    'models, generative models and retrieval, and finally agents, engineering, safety and evaluation.\n\n' +
    'It is not a prompt-engineering course. Prompting appears in Unit 12, after there is enough understanding for it to be ' +
    'more than a list of tricks, and it is taught as part of system design rather than as a skill in itself.\n\n' +
    'Every unit is built to be used: the mathematics is introduced where it is needed and every symbol is named in words, ' +
    'the laboratories are real ones you can change parameters in, and the hard parts are stated rather than smoothed over. ' +
    'Where something is genuinely unresolved — why models hallucinate, why fairness definitions conflict, why a benchmark ' +
    'score is weak evidence — the course says so and says what to do anyway.\n\n' +
    'It ends with five projects and a capstone you design yourself. The capstone does not pass because it runs; it passes ' +
    'when you can say why it works, where it fails, how you measured it, and what you would not trust it with.',
  category: 'Artificial Intelligence',
  subcategory: 'Machine learning and AI systems',
  difficulty: 'intermediate',
  // Recomputed from the content by cleanCourse; placeholders the loader overwrites.
  lessonCount: 0,
  moduleCount: MODULES.length,
  estimatedMinutes: 0,
  language: 'en',
  tags: [
    'artificial intelligence',
    'machine learning',
    'deep learning',
    'neural networks',
    'computer vision',
    'nlp',
    'transformers',
    'llm',
    'generative ai',
    'rag',
    'agents',
    'ai safety',
    'evaluation'
  ],
  origin: 'orbis',
  version: 1,
  icon: 'brain',
  cover: { from: '#1d4e89', to: '#0b1220' },
  updatedAt: 0,
  createdAt: 0,
  objectives: [
    'Say what an AI system is doing, in mechanical terms, rather than by its label',
    'Inspect a dataset and find the faults that will ruin a model before you train one',
    'Split, train and evaluate honestly, and recognise leakage and overfitting from the evidence',
    'Choose metrics and thresholds from the cost of each kind of mistake',
    'Explain neural networks, convolution, embeddings, attention and transformers, and trace an input through each',
    'Explain why a language model fabricates, and build systems that do not depend on it being right unaided',
    'Build a retrieval-augmented system and measure retrieval separately from generation',
    'Build an agent whose dangerous actions are bounded by code rather than by instructions',
    'Evaluate a system with no single right answer, using your own cases and written criteria',
    'Carry out error analysis, and turn a pile of mistakes into a ranked list of actions',
    'Assess risk, fairness and robustness, and decide where a person must stay in the loop',
    'Design, build, evaluate and defend a complete AI system of your own'
  ],
  skills: [
    'Data inspection, cleaning and representation',
    'Train/validation/test discipline and leakage detection',
    'Supervised learning: regression and classification',
    'Model evaluation, thresholds, calibration and error analysis',
    'Unsupervised learning and dimensionality reduction',
    'The mathematics of learning: dot products, probability, gradients',
    'Neural networks, backpropagation and training diagnosis',
    'Convolutional networks and the vision tasks',
    'Tokenisation, embeddings and semantic similarity',
    'Attention and transformer architecture',
    'Large language models: sampling, context, fine-tuning, grounding',
    'Generative models: autoencoders, GANs, diffusion',
    'Prompt design, structured output and injection defence',
    'Retrieval-augmented generation and retrieval evaluation',
    'Agent design, tool use and permission boundaries',
    'AI system engineering, observability and reproducibility',
    'Safety, fairness, robustness and human oversight',
    'Evaluation design for open-ended systems'
  ],
  prerequisites: [
    'Course 01 — Python Programming: From Zero to Developer, or equivalent programming ability.',
    'No previous AI, machine learning or statistics is assumed. The mathematics is introduced where it is needed.',
    'Arithmetic and a willingness to work through a small calculation by hand.'
  ],
  audience:
    'Programmers who want to understand AI as engineering rather than as a set of products, and anybody who has used these tools and wants to know what is actually happening inside them.',
  modules: [...MODULES],
  concepts: [...AI_CONCEPTS],
  completion: {
    requiredLessons: true,
    lessonShare: 1,
    // Empty means every module's quiz, which is what is wanted here.
    requiredQuizzes: [],
    quizPass: 0.8,
    needsAssessment: true,
    /*
     * Mastery as well as completion.
     *
     * Reading every lesson and scraping every quiz once is not the same as understanding the material, and 0.7
     * average mastery across the course's concepts is reachable by somebody who learned it and not by somebody
     * who clicked through.
     */
    masteryAtLeast: 0.7,
    requiredProjects: ['u14']
  },
  assessment: ASSESSMENT,
  certificate: true
}
