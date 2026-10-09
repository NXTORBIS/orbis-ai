import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { quizWanted, subjectOf, countIn, difficultyIn, USUALLY, FEWEST, MOST } from './ask.ts'
import { quizPrompt, readQuiz, checkQuestion, isQuizRefusal, type Quiz } from './build.ts'
import { mark, retryOf, howLong, type QuizAnswer } from './score.ts'

describe('what the message is asking for', () => {
  it('reads "quiz me on X" as something to answer here', () => {
    const got = quizWanted('quiz me on the water cycle')
    assert.equal(got?.kind, 'card')
    assert.equal(got?.about, 'the water cycle')
  })

  it('reads "write a quiz document" as a document', () => {
    const got = quizWanted('write a quiz document on photosynthesis')
    assert.equal(got?.kind, 'document')
    assert.equal(got?.about, 'photosynthesis')
  })

  it('treats a file named anywhere as a document, however the sentence starts', () => {
    // "Quiz me ... as a pdf" is asking for the file; a card cannot be printed.
    assert.equal(quizWanted('quiz me on trigonometry and give me the pdf')?.kind, 'document')
  })

  it('reads "write a quiz on X" with no file word as a document too', () => {
    assert.equal(quizWanted('write a quiz on the Tudors')?.kind, 'document')
  })

  it('leaves an ordinary message alone', () => {
    for (const message of [
      'what is the water cycle?',
      'summarise this page',
      'how do you write a good quiz question?',
      'tell me about tests in javascript'
    ]) {
      assert.equal(quizWanted(message), null, message)
    }
  })

  it('knows when the subject is something already on screen', () => {
    const got = quizWanted('quiz me on this')
    assert.equal(got?.pointsBack, true)
    assert.equal(got?.about, '')
  })

  it('takes the number of questions from the message', () => {
    assert.equal(countIn('quiz me with 5 questions on algebra'), 5)
    assert.equal(countIn('give me a quiz of 12 on algebra'), 12)
    assert.equal(countIn('quiz me on algebra with ten questions'), 10)
    assert.equal(countIn('quiz me on algebra'), USUALLY)
  })

  it('keeps the number inside what a quiz can be', () => {
    assert.equal(countIn('quiz me with 99 questions'), MOST)
    assert.equal(countIn('quiz me with 1 question'), FEWEST)
  })

  it('takes the difficulty from the message', () => {
    assert.equal(difficultyIn('quiz me on hard integrals'), 'hard')
    assert.equal(difficultyIn('an easy quiz please'), 'easy')
    assert.equal(difficultyIn('quiz me on integrals'), 'ordinary')
  })

  it('does not leave the difficulty or the count inside the subject', () => {
    assert.equal(subjectOf('quiz me on the Roman empire with 5 hard questions'), 'the Roman empire')
  })
})

// ---------------------------------------------------------------- the questions

const fine = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  asks: 'Which planet is closest to the Sun?',
  options: ['Mercury', 'Venus', 'Earth', 'Mars'],
  answer: 0,
  because: 'Mercury orbits nearest to the Sun, at about 58 million kilometres.',
  topic: 'Planets',
  ...over
})

describe('checking one question', () => {
  it('accepts a sound one', () => {
    const got = checkQuestion(fine(), 'q1')
    assert.ok(!isQuizRefusal(got))
  })

  it('refuses the same option twice', () => {
    const got = checkQuestion(fine({ options: ['Mercury', 'mercury', 'Earth', 'Mars'] }), 'q1')
    assert.ok(isQuizRefusal(got))
    assert.match((got as { failed: string }).failed, /duplicate/)
  })

  it('refuses an answer that is not one of the options', () => {
    const got = checkQuestion(fine({ answer: 7 }), 'q1')
    assert.ok(isQuizRefusal(got))
  })

  it('refuses a question with no explanation', () => {
    assert.ok(isQuizRefusal(checkQuestion(fine({ because: '' }), 'q1')))
  })

  it('refuses "all of the above", which cannot be checked for one right answer', () => {
    assert.ok(isQuizRefusal(checkQuestion(fine({ options: ['Mercury', 'Venus', 'Earth', 'all of the above'] }), 'q1')))
  })

  it('refuses fewer than two options', () => {
    assert.ok(isQuizRefusal(checkQuestion(fine({ options: ['Mercury'] }), 'q1')))
  })

  it('takes an answer given as the text of an option', () => {
    const got = checkQuestion(fine({ answer: 'Venus' }), 'q1')
    assert.equal((got as { answer: number }).answer, 1)
  })

  it('takes an answer given as a letter', () => {
    assert.equal((checkQuestion(fine({ answer: 'C' }), 'q1') as { answer: number }).answer, 2)
  })

  it('takes an answer counted from one when zero would be out of range', () => {
    assert.equal((checkQuestion(fine({ options: ['a1', 'b2'], answer: '2' }), 'q1') as { answer: number }).answer, 1)
  })

  it('refuses an answer text that matches two options', () => {
    // Two identical options are refused anyway, but an unresolvable answer must never be guessed.
    const got = checkQuestion(fine({ options: ['Mercury', 'Venus'], answer: 'Pluto' }), 'q1')
    assert.ok(isQuizRefusal(got))
  })
})

describe('what Orion is asked for', () => {
  it('says exactly one option must be right, and that it is checked', () => {
    const asked = quizPrompt({ about: 'the water cycle', count: 8, difficulty: 'ordinary' })
    assert.match(asked, /Exactly one option is right/)
    assert.match(asked, /thrown away/)
    assert.match(asked, /8 multiple-choice/)
  })

  it('holds the questions to a given text when there is one', () => {
    const asked = quizPrompt({ about: 'this page', count: 4, difficulty: 'easy', source: 'Rain falls.' })
    assert.match(asked, /must come from this text/)
    assert.match(asked, /Rain falls\./)
  })
})

describe('reading a whole quiz', () => {
  const context = { about: 'space', difficulty: 'ordinary' as const, from: 'space', count: 4, id: 'z1', now: 1000 }

  it('keeps the sound questions and drops the rest', () => {
    const reply = JSON.stringify({
      title: 'Space',
      questions: [fine(), fine({ asks: 'Which planet has rings?', options: ['Saturn', 'Jupiter only', 'Venus', 'Mars'], answer: 0 }), fine({ asks: 'Which star is nearest to us?', options: ['The Sun', 'Sirius', 'Vega', 'Rigel'], answer: 0 }), fine({ asks: 'A broken one here?', options: ['one', 'two', 'three', 'four'], because: '' }), fine({ asks: 'Another broken one?', options: ['a', 'a', 'b', 'c'] })]
    })
    const got = readQuiz(reply, context)
    assert.ok(!isQuizRefusal(got))
    const { quiz, dropped } = got as { quiz: Quiz; dropped: unknown[] }
    assert.equal(quiz.questions.length, 3)
    assert.equal(dropped.length, 2)
    assert.equal(quiz.dropped, 2)
  })

  it('drops the same question asked twice', () => {
    const reply = JSON.stringify({ questions: [fine(), fine(), fine({ asks: 'Which planet has rings?', options: ['Saturn', 'Mercury', 'Venus', 'Mars'], answer: 0 }), fine({ asks: 'Which star is nearest to us?', options: ['The Sun', 'Sirius', 'Vega', 'Rigel'], answer: 0 })] })
    const got = readQuiz(reply, { ...context, count: 4 })
    const quiz = (got as { quiz: Quiz }).quiz
    assert.equal(quiz.questions.length, 3)
    assert.equal(quiz.dropped, 1)
  })

  it('does not call two different short answers the same fact', () => {
    // Two words in common is the floor: without it "the Sun" and "the Moon" would be one fact.
    const reply = JSON.stringify({
      questions: [
        fine({ asks: 'Which body gives us daylight?', options: ['The Sun', 'a', 'b', 'c'], answer: 0 }),
        fine({ asks: 'Which body causes the tides?', options: ['The Moon', 'x', 'y', 'z'], answer: 0 }),
        fine({ asks: 'Which planet is closest to the Sun?', options: ['Mercury', 'p', 'q', 'r'], answer: 0 })
      ]
    })
    const got = readQuiz(reply, { ...context, count: 3 })
    assert.equal((got as { quiz: Quiz }).quiz.questions.length, 3)
  })

  it('counts the same question asked twice as the same question, not as a repeated fact', () => {
    // Both checks drop something; the message in the log should be the right one.
    const reply = JSON.stringify({
      questions: [
        fine(),
        fine(),
        fine({ asks: 'Which planet has rings?', options: ['Saturn', 'a', 'b', 'c'], answer: 0 }),
        fine({ asks: 'Which star is nearest to us?', options: ['The Sun', 'x', 'y', 'z'], answer: 0 })
      ]
    })
    const got = readQuiz(reply, { ...context, count: 4 }) as { dropped: { why: string }[] }
    assert.equal(got.dropped.length, 1)
    assert.match(got.dropped[0].why, /same question twice/)
  })

  it('refuses the whole quiz when too few questions hold up', () => {
    const reply = JSON.stringify({ questions: [fine({ because: '' }), fine({ asks: 'x' })] })
    const got = readQuiz(reply, context)
    assert.ok(isQuizRefusal(got))
    assert.match((got as { problem: string }).problem, /too few/)
  })

  it('never shows more questions than were asked for', () => {
    // Each one has to be about a different fact, because asking one twice is refused.
    const many = Array.from({ length: 9 }, (_one, at) =>
      fine({
        asks: `Question number ${at} about space?`,
        options: [`answer ${at}`, `wrong ${at} one`, `wrong ${at} two`, `wrong ${at} three`],
        answer: 0
      })
    )
    const got = readQuiz(JSON.stringify({ questions: many }), { ...context, count: 4 })
    assert.equal((got as { quiz: Quiz }).quiz.questions.length, 4)
  })

  it('drops a second question about the same fact in different words', () => {
    // What a real run produced: runoff asked twice, worded differently, so comparing the question text let both
    // through.
    const reply = JSON.stringify({
      questions: [
        fine(),
        fine({ asks: 'What is runoff?', options: ['Water moving over the land', 'Rain', 'Snow', 'Fog'], answer: 0 }),
        fine({ asks: 'Which describes surface runoff?', options: ['Water flowing over the land', 'Rain', 'Snow', 'Fog'], answer: 0 }),
        fine({ asks: 'Which planet has rings?', options: ['Saturn', 'Mercury', 'Venus', 'Mars'], answer: 0 })
      ]
    })
    const got = readQuiz(reply, { ...context, count: 4 })
    const quiz = (got as { quiz: Quiz }).quiz
    assert.equal(quiz.questions.length, 3)
    assert.equal(quiz.dropped, 1)
  })

  it('refuses a reply that is not a quiz', () => {
    assert.ok(isQuizRefusal(readQuiz('I would rather not.', context)))
    assert.ok(isQuizRefusal(readQuiz('{"questions": []}', context)))
  })

  it('finds the JSON when words came with it', () => {
    const got = readQuiz(`Here you go!\n${JSON.stringify({ questions: [fine(), fine({ asks: 'Which planet has rings?', options: ['Saturn', 'a', 'b', 'c'], answer: 0 }), fine({ asks: 'How hot is the Sun at its surface?', options: ['5,500°C', '100°C', '1 million°C', '50°C'], answer: 0 })] })}\nGood luck.`, { ...context, count: 3 })
    assert.ok(!isQuizRefusal(got))
  })
})

// ---------------------------------------------------------------- marking

const quizOf = (questions: number): Quiz => ({
  id: 'z1',
  title: 'Space',
  about: 'space',
  difficulty: 'ordinary',
  from: 'space',
  madeAt: 0,
  questions: Array.from({ length: questions }, (_one, at) => ({
    id: `q${at + 1}`,
    asks: `Question ${at + 1}?`,
    options: ['right', 'wrong', 'also wrong', 'wrong too'],
    answer: 0,
    because: 'because it is.',
    topic: at % 2 === 0 ? 'Planets' : 'Stars'
  }))
})

const answered = (picks: readonly (number | null)[], each = 2000): QuizAnswer[] =>
  picks.map((picked, at) => ({ questionId: `q${at + 1}`, picked, tookMs: each }))

describe('marking an attempt', () => {
  it('counts the marks and the percentage from what was answered', () => {
    const got = mark(quizOf(4), answered([0, 1, 0, 0]))
    assert.equal(got.right, 3)
    assert.equal(got.wrong, 1)
    assert.equal(got.outOf, 4)
    assert.equal(got.percent, 75)
  })

  it('rounds the percentage down rather than up', () => {
    // 7 of 8 is 87.5: showing 88 would flatter the attempt.
    const got = mark(quizOf(8), answered([0, 0, 0, 0, 0, 0, 0, 1]))
    assert.equal(got.percent, 87)
  })

  it('counts a question passed over as wrong, not as missing', () => {
    const got = mark(quizOf(4), answered([0, null, 0, null]))
    assert.equal(got.right, 2)
    assert.equal(got.skipped, 2)
    assert.equal(got.percent, 50)
    assert.match(got.says, /passed over, which counts as wrong/)
  })

  it('adds up the time from the answers', () => {
    const got = mark(quizOf(3), answered([0, 0, 0], 1500))
    assert.equal(got.tookMs, 4500)
    assert.equal(got.perQuestionMs, 1500)
  })

  it('has no average when nothing was answered', () => {
    const got = mark(quizOf(2), answered([null, null], 0))
    assert.equal(got.perQuestionMs, null)
    assert.equal(got.percent, 0)
  })

  it('breaks the result down by topic, weakest first', () => {
    const got = mark(quizOf(4), answered([0, 1, 0, 1]))
    assert.deepEqual(
      got.byTopic.map((one) => [one.topic, one.right, one.outOf, one.percent]),
      [['Stars', 0, 2, 0], ['Planets', 2, 2, 100]]
    )
  })

  it('lists what was missed, with what was picked and what was right', () => {
    const got = mark(quizOf(2), answered([1, null]))
    assert.equal(got.missed.length, 2)
    assert.equal(got.missed[0].pickedText, 'wrong')
    assert.equal(got.missed[0].answerText, 'right')
    assert.equal(got.missed[1].pickedText, null)
  })

  it('does not praise a poor attempt', () => {
    const got = mark(quizOf(10), answered([0, 1, 1, 1, 1, 1, 1, 1, 1, 1]))
    assert.doesNotMatch(got.says, /great|well done|nice|good job/i)
    assert.match(got.says, /1 of 10 right/)
  })

  it('says so plainly when everything was right', () => {
    assert.match(mark(quizOf(3), answered([0, 0, 0])).says, /All 3 right\./)
  })

  it('counts an answer that was never recorded as skipped', () => {
    const got = mark(quizOf(3), [{ questionId: 'q1', picked: 0, tookMs: 100 }])
    assert.equal(got.right, 1)
    assert.equal(got.skipped, 2)
  })
})

describe('trying the missed ones again', () => {
  it('makes a quiz of exactly what was missed', () => {
    const quiz = quizOf(4)
    const got = retryOf(quiz, mark(quiz, answered([0, 1, 0, 1])), 'z2', 500)
    assert.equal(got?.questions.length, 2)
    assert.deepEqual(got?.questions.map((one) => one.id), ['q2', 'q4'])
    assert.equal(got?.id, 'z2')
    assert.match(String(got?.title), /missed/)
  })

  it('offers nothing when nothing was missed', () => {
    const quiz = quizOf(2)
    assert.equal(retryOf(quiz, mark(quiz, answered([0, 0])), 'z2', 500), null)
  })
})

describe('saying how long it took', () => {
  it('reads as somebody would say it', () => {
    assert.equal(howLong(300), 'under a second')
    assert.equal(howLong(4000), '4 seconds')
    assert.equal(howLong(1000), '1 second')
    assert.equal(howLong(120_000), '2 minutes')
    assert.equal(howLong(95_000), '1 min 35 sec')
  })
})
