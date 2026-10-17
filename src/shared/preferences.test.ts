import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { preferenceQuestion, standingPreference } from './preferences.ts'

const yes = (msg: string, text: string, kind?: string): void => {
  const got = standingPreference(msg)
  assert.ok(got, `expected a preference in: ${msg}`)
  assert.equal(got.text, text, msg)
  if (kind) assert.equal(got.kind, kind)
}
const no = (msg: string): void => assert.equal(standingPreference(msg), null, `should not offer for: ${msg}`)

test('standing style preferences are noticed', () => {
  yes('Always answer in short bullet points', 'Always answer in short bullet points', 'style')
  yes('please always answer in short bullet points.', 'Always answer in short bullet points')
  yes('Never use emojis', 'Never use emojis')
  yes('From now on, reply in British English', 'Reply in British English')
  yes('Reply in French from now on', 'Reply in French')
  yes('Going forward keep explanations under five lines', 'Keep explanations under five lines')
  yes('I want you to always cite your sources', 'Always cite your sources')
  yes('Stop using exclamation marks', 'Stop using exclamation marks')
  yes('Thanks! Always show code in TypeScript.', 'Always show code in TypeScript')
})

test('more realistic standing instructions', () => {
  yes('From now on, do not use emojis', 'Do not use emojis')
  yes('Always keep answers under 200 words', 'Always keep answers under 200 words')
  yes('you should never start an answer with "Certainly"', 'Never start an answer with "Certainly"')
  yes('Make sure you always cite the source', 'Always cite the source')
  yes('By default, answer in metric units', 'Answer in metric units')
  yes('Use British spelling from now on', 'Use British spelling')
  yes('Never add a summary at the end', 'Never add a summary at the end')
})

test('a message with chat around the preference still finds it', () => {
  yes('Thanks, that worked. From now on reply in short bullet points. I will test it later.', 'Reply in short bullet points')
  yes('Great. Call me Ana. What is next?', 'Prefers to be called Ana')
})

test('names and tools', () => {
  yes('Call me Sam', 'Prefers to be called Sam', 'name')
  yes('you can call me Dr Rao', 'Prefers to be called Dr Rao')
  yes('I use TypeScript and pnpm', 'I use TypeScript and pnpm', 'tools')
  yes('I prefer metric units', 'I prefer metric units')
  yes('I mostly write in Rust', 'I mostly write in Rust')
})

test('one-offs, questions and hypotheticals are not standing', () => {
  no('answer in French this time')
  no('Please answer in French for now')
  no('Just answer in bullets today')
  no('Can you always answer in bullets?')
  no('Should I always use emojis?')
  no('Do you never use emojis?')
  no('How do I always answer in bullets')
  no('If I ask for code, always use TypeScript')
  no('For example, always use bullets')
  no('Never mind, I figured it out')
  no('Call me later')
  no('call me back when you can')
  no('Call me if you find anything')
  no('Always late, that is me')
  no('in this chat always reply in French')
  no('Answer in bullet points')
  no('I use it to build a website')
  no('I use this for my homework')
  no('I prefer option B')
  no('I use Python for this project')
  no('Summarise this article and always keep it short?')
})

test('secrets are never offered, and junk is ignored', () => {
  no('Always use my password hunter2 when logging in')
  no('I use the api key sk-abcdefghijklmnop1234567890 for everything')
  no('')
  no('hi')
  no('x'.repeat(700))
})

test('the chip question reads naturally', () => {
  assert.equal(preferenceQuestion({ text: 'Always answer in short bullet points', kind: 'style' }), 'Remember: always answer in short bullet points?')
  assert.equal(preferenceQuestion({ text: 'I use TypeScript and pnpm', kind: 'tools' }), 'Remember: I use TypeScript and pnpm?')
  assert.ok(preferenceQuestion({ text: 'Always ' + 'x'.repeat(200), kind: 'style' }).length < 110)
  // A name reads badly as a sentence read back ("Remember: prefers to be called Sam?"), so it carries its own wording.
  assert.equal(preferenceQuestion(standingPreference('Call me Sam')!), 'Remember to call you Sam?')
})
