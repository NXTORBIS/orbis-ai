import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  confirmPassword,
  isCommonPassword,
  judgePassword,
  PASSWORD_MAX,
  PASSWORD_MIN
} from './passwordStrength.ts'

// ---------------------------------------------------------------- what is refused

test('nothing typed yet is not an error', () => {
  const said = judgePassword('')
  assert.equal(said.ok, false)
  assert.equal(said.problem, '', 'an empty field is not yet a mistake')
})

test('too short is refused, and says how much more is wanted', () => {
  const said = judgePassword('short')
  assert.equal(said.ok, false)
  assert.match(said.problem, new RegExp(`${PASSWORD_MIN - 'short'.length} more character`))
})

test('exactly the minimum is accepted', () => {
  assert.equal(judgePassword('x'.repeat(PASSWORD_MIN)).ok, false, 'but not when it is one character repeated')
  assert.equal(judgePassword('trombone fjord').ok, true)
})

test('the passwords everybody chooses are refused, digits and all', () => {
  for (const tried of ['password', 'Password123', 'PASSWORD!!', 'qwertyuiop', 'letmein2024', 'iloveyou123', 'orbis1234']) {
    assert.equal(judgePassword(tried).ok, false, `${tried} should be refused`)
  }
  assert.equal(isCommonPassword('Password1'), true)
  assert.equal(isCommonPassword('quiet harbour lamp'), false)
})

test('one character held down is refused', () => {
  assert.equal(judgePassword('aaaaaaaaaaaaaaaa').ok, false)
  assert.match(judgePassword('aaaaaaaaaaaaaaaa').problem, /same character/)
})

test('a short pattern repeated is refused', () => {
  for (const tried of ['abababababababab', 'xyzxyzxyzxyzxyz', 'ababababababab']) {
    assert.equal(judgePassword(tried).ok, false, `${tried} should be refused`)
  }
  // But a phrase that merely happens to repeat a word is not a pattern.
  assert.equal(judgePassword('harbour lamp harbour').ok, true)
})

test('a walk across the keyboard is refused', () => {
  assert.equal(judgePassword('asdfghjkl;zxcv').ok, false)
  assert.equal(judgePassword('1234567890123').ok, false)
})

test('a password that is only the name is refused', () => {
  assert.equal(judgePassword('nishanthnishanth', 'Nishanth').ok, false)
  assert.match(judgePassword('nishanthnishanth', 'Nishanth').problem, /just your name/)
  // A short name is not enough to refuse on -- a person called "Al" would otherwise lose every password containing
  // "al" -- so this one is refused for being a repeated pattern instead, which it is.
  const al = judgePassword('alalalalalalalal', 'Al')
  assert.equal(al.ok, false)
  assert.match(al.problem, /short pattern repeated/)
  assert.equal(judgePassword('al fresco harbour lamp', 'Al').ok, true, 'and a real phrase containing the name is fine')
})

test('spaces alone are not a password', () => {
  assert.equal(judgePassword('              ').ok, false)
})

test('something absurdly long is refused rather than hashed', () => {
  assert.equal(judgePassword('a'.repeat(PASSWORD_MAX + 1)).ok, false)
})

// ---------------------------------------------------------------- what is accepted, and how it is described

test('composition is not demanded: a passphrase with no symbols is accepted', () => {
  const said = judgePassword('the seven red bicycles')
  assert.equal(said.ok, true)
  assert.equal(said.problem, '')
  assert.ok(said.score >= 3, 'and it is not called weak for lacking a capital letter')
})

test('length is what raises the score', () => {
  const short = judgePassword('quiet harbour')
  const longer = judgePassword('quiet harbour lamp')
  const longest = judgePassword('quiet harbour lamp beneath the bridge')
  assert.ok(longer.score >= short.score)
  assert.ok(longest.score > short.score)
  assert.equal(longest.strength, 'strong')
})

test('long but drawn from few characters does not score as well as long and varied', () => {
  // Not a clean repeated pattern, so it is accepted -- but it draws on four characters, and the score says so.
  const dull = judgePassword('abcabcabcabcabcabx')
  const varied = judgePassword('lantern gravel window')
  assert.ok(dull.ok, 'still acceptable')
  assert.ok(varied.score > dull.score, 'but not as good')
})

test('a strong password is told so by saying nothing', () => {
  assert.equal(judgePassword('quiet harbour lamp beneath the bridge').advice, '')
  assert.ok(judgePassword('trombone fjord').advice.length > 0, 'a merely acceptable one gets a nudge')
})

test('the score stays inside the meter', () => {
  for (const tried of ['trombone fjord', 'the seven red bicycles', 'x'.repeat(200), 'a b c d e f g h i j k l m n']) {
    const said = judgePassword(tried)
    assert.ok(said.score >= 0 && said.score <= 4, `${tried} scored ${said.score}`)
  }
})

// ---------------------------------------------------------------- confirming

test('confirmation', () => {
  assert.deepEqual(confirmPassword('quiet harbour lamp', ''), { ok: false, problem: '' })
  assert.deepEqual(confirmPassword('quiet harbour lamp', 'quiet harbour lam'), {
    ok: false,
    problem: 'Those do not match.'
  })
  assert.deepEqual(confirmPassword('quiet harbour lamp', 'quiet harbour lamp'), { ok: true, problem: '' })
})

test('confirmation compares exactly, including spaces and case', () => {
  assert.equal(confirmPassword('quiet harbour ', 'quiet harbour').ok, false)
  assert.equal(confirmPassword('Quiet Harbour Lamp', 'quiet harbour lamp').ok, false)
})
