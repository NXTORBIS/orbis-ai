import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { conversationToMarkdown, projectToShare, readSharedProject, shareFilename, SHARE_FORMAT } from './share.ts'
import { newWorkspace } from '../workspaces.ts'
import type { ChatMessage, Conversation } from '../types.ts'

/**
 * A whole profile could be exported and a single thing could not, so "send somebody this conversation" and "set up
 * this project on my other machine" had no answer but copying text out of the window by hand.
 */

const NOW = new Date('2026-10-03T12:00:00').getTime()

const say = (role: ChatMessage['role'], content: string, patch: Partial<ChatMessage> = {}): ChatMessage => ({ id: `m-${content.length}`, role, content, createdAt: NOW, ...patch })

const chat = (messages: ChatMessage[]): Conversation => ({ id: 'c1', title: 'Batteries', model: 'm', messages, createdAt: NOW, updatedAt: NOW })

test('a conversation comes out as something a person can read', () => {
  const said = conversationToMarkdown(chat([say('user', 'How long do batteries last?'), say('assistant', 'About five years.')]), NOW)
  assert.ok(said.startsWith('# Batteries'))
  assert.ok(said.includes('## You'))
  assert.ok(said.includes('## Orbis'))
  assert.ok(said.includes('About five years.'))
})

test('anything that looks like a key is taken out, because a chat is where somebody pasted one', () => {
  const said = conversationToMarkdown(chat([say('user', `here is my key${String.fromCharCode(10)}sk_live_abcdefghij1234567890`)]), NOW)
  assert.ok(!said.includes('sk_live_abcdefghij1234567890'), said)
  assert.ok(said.includes('was removed when this was exported'), said)
})

test('sources an answer cited travel with it', () => {
  const said = conversationToMarkdown(
    chat([
      say('assistant', 'Five years [1].', {
        research: { id: 'r', question: 'q', queries: [], recency: 'any', retrievedAt: NOW, sources: [{ n: 1, title: 'A study', url: 'https://example.org/s', domain: 'example.org', snippet: '', excerpt: '', query: '', read: true }] }
      })
    ]),
    NOW
  )
  assert.ok(said.includes('[A study](https://example.org/s)'), said)
})

test('attachments are named, and their contents are not in the file', () => {
  const said = conversationToMarkdown(chat([say('user', 'look at this', { attachments: [{ name: 'secret.csv', content: 'a,b,c', type: 'text' }] })]), NOW)
  assert.ok(said.includes('secret.csv'))
  assert.ok(!said.includes('a,b,c'), 'the file itself is not an export of the conversation')
})

test('what Orbis was told to be is not part of a conversation somebody asked for', () => {
  // A conversation holds only what was said: the instructions Orbis runs under are not one of its messages, so there
  // is nothing here to leak. This states that, so a future message role cannot quietly change it.
  const said = conversationToMarkdown(chat([say('user', 'hi'), say('assistant', 'hello')]), NOW)
  assert.ok(!said.includes('system'), said)
})

// ---------------------------------------------------------------- projects

const project = newWorkspace({ id: 'w1', name: 'Physics' })
project.project = { goal: 'study for the exam', instructions: 'Use SI units.', outputFormat: 'Show the working.', model: 'openai/gpt-oss-120b', items: [{ ref: 'note:1', addedAt: NOW }] }

test('a project carries how it works', () => {
  const shared = projectToShare(project, NOW)!
  assert.equal(shared.name, 'Physics')
  assert.equal(shared.instructions, 'Use SI units.')
  assert.equal(shared.outputFormat, 'Show the working.')
  assert.equal(shared.model, 'openai/gpt-oss-120b')
})

test('a project does not carry what it refers to, because those ids mean nothing elsewhere', () => {
  const shared = projectToShare(project, NOW)!
  assert.ok(!JSON.stringify(shared).includes('note:1'), JSON.stringify(shared))
})

test('a workspace that is not a project exports nothing rather than an empty project', () => {
  assert.equal(projectToShare(newWorkspace({ id: 'w2', name: 'Tabs' }), NOW), null)
})

test('a project read back says what it left behind, rather than letting it be discovered later', () => {
  const read = readSharedProject(projectToShare(project, NOW), () => true)
  assert.ok(!('error' in read))
  assert.ok((read as { notes: string[] }).notes.some((n) => n.includes('stay where they are')), JSON.stringify(read))
})

test('a model this copy of Orbis does not have is dropped, and said, rather than failing on the first message', () => {
  const read = readSharedProject(projectToShare(project, NOW), () => false) as { project: { model: string }; notes: string[] }
  assert.equal(read.project.model, '')
  assert.ok(read.notes.some((n) => n.includes('does not have')), JSON.stringify(read.notes))
})

test('a file that is not a project is refused, with a reason', () => {
  assert.ok('error' in readSharedProject({ kind: 'something-else' }, () => true))
  assert.ok('error' in readSharedProject('rubbish', () => true))
  assert.ok('error' in readSharedProject({ kind: 'project', format: SHARE_FORMAT }, () => true), 'no name')
})

test('a project from a newer Orbis is refused rather than half-read', () => {
  const refused = readSharedProject({ kind: 'project', format: SHARE_FORMAT + 1, name: 'Future' }, () => true)
  assert.ok('error' in refused)
  assert.ok((refused as { error: string }).error.includes('newer version'))
})

test('an imported project is checked for secrets too, because it came from somewhere else', () => {
  const read = readSharedProject({ kind: 'project', format: SHARE_FORMAT, name: 'X', instructions: 'use sk_live_abcdefghij1234567890' }, () => true) as { project: { instructions: string } }
  assert.ok(!read.project.instructions.includes('sk_live_abcdefghij1234567890'))
})

test('a filename is made from the title and is safe everywhere', () => {
  assert.equal(shareFilename('My chat: part 2/3', 'md'), 'My chat part 23.md')
  assert.equal(shareFilename('***', 'json'), 'Orbis export.json')
})
