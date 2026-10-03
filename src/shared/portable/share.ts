import { looksSecret } from '../clipboardHistory.ts'
import type { ChatMessage, Conversation } from '../types.ts'
import type { Workspace } from '../workspaces.ts'

/**
 * Taking one conversation, or one project, out of Orbis.
 *
 * A whole profile could be exported and imported, and a single thing could not. So the ordinary requests -- "send
 * somebody this conversation", "set up the same project on my other machine" -- had no answer but copying text out of
 * the window by hand, which loses the structure and keeps none of the settings.
 *
 * Two rules, and the first is the one that decides the shape of everything here:
 *
 * **Nothing secret leaves.** Not by filtering a list of fields somebody has to remember to add to, but by building the
 * export out of named fields: anything not listed is not in it. Every piece of text is checked again on the way out,
 * and anything that looks like a key, a token or a card number is replaced, because a conversation is exactly where
 * somebody once pasted one.
 *
 * **An import is read, never run.** A project arriving from elsewhere is a description, and everything in it is
 * checked the way a file off a disk is checked. It brings instructions and preferences because those are words; it
 * never brings references to things on the machine it came from, because those ids mean nothing here and a project
 * listing items that do not exist is worse than one listing none.
 */

export const SHARE_FORMAT = 1

const LF = String.fromCharCode(10)

/** Anything that looks like a secret, replaced. A conversation is exactly where somebody once pasted one. */
function scrub(text: string): string {
  return text
    .split(LF)
    .map((line) => (looksSecret(line) ? '[something that looked like a key or a token was removed when this was exported]' : line))
    .join(LF)
}

// ---------------------------------------------------------------- a conversation

const WHO = (message: ChatMessage): string => (message.role === 'user' ? 'You' : 'Orbis')

/**
 * One conversation as something a person can read, and another program can too.
 *
 * Markdown rather than JSON because the thing people do with an exported conversation is read it or send it to
 * somebody, and a file nobody can open without a tool is a file nobody opens. What it holds is the words, who said
 * them, when, and the sources an answer cited -- not the internal ids, not the reasoning, not the attachments'
 * contents, none of which the person asking for "this conversation" means.
 */
export function conversationToMarkdown(conversation: Conversation, now: number): string {
  const lines: string[] = [`# ${conversation.title || 'Conversation'}`, '', `_Exported from Orbis on ${new Date(now).toDateString()}._`, '']

  for (const message of conversation.messages) {
    const when = new Date(message.createdAt).toLocaleString()
    lines.push(`## ${WHO(message)} — ${when}`, '')
    lines.push(scrub(message.content.trim() || '_(nothing)_'), '')

    const files = (message.attachments ?? []).map((one) => one.name)
    if (files.length) lines.push(`_Attached: ${files.join(', ')}. The files themselves are not in this export._`, '')

    if (message.research?.sources.length) {
      lines.push('_Sources:_', '')
      for (const source of message.research.sources) lines.push(`${source.n}. [${source.title}](${source.url})`)
      lines.push('')
    }
  }
  return lines.join(LF)
}

// ---------------------------------------------------------------- a project

export interface SharedProject {
  format: typeof SHARE_FORMAT
  kind: 'project'
  name: string
  goal: string
  instructions: string
  outputFormat: string
  /** The model it answers with, by id. Kept only if the machine it arrives on has that model. */
  model: string
  exportedAt: number
}

/**
 * A project as something that can be set up again elsewhere.
 *
 * What travels is how the project works: its goal, how Orion should work in it, how answers should come out, and
 * which model answers. What does not travel is what it refers to -- the notes, tasks, research and conversations --
 * because those are references to things on the machine it came from, and a project arriving with a list of items
 * that do not exist here is worse than one arriving with none. That is stated on import rather than left to be
 * discovered.
 */
export function projectToShare(workspace: Workspace, now: number): SharedProject | null {
  const project = workspace.project
  if (!project) return null
  return {
    format: SHARE_FORMAT,
    kind: 'project',
    name: workspace.name.slice(0, 120),
    goal: scrub(project.goal),
    instructions: scrub(project.instructions),
    outputFormat: scrub(project.outputFormat),
    model: project.model,
    exportedAt: now
  }
}

export interface ImportedProject {
  project: SharedProject
  /** What was left behind, and why. Said, because an import that quietly drops things is an import nobody trusts. */
  notes: string[]
}

/**
 * A shared project read back, or why it is not one.
 *
 * Everything is checked the way a file off a disk is checked: this arrived from somewhere else, and that it came from
 * Orbis is a claim it makes about itself. A model named in it is kept only if this machine has it, because a project
 * pointing at a model that is not here would fail on its first message rather than at the moment it is set up.
 */
export function readSharedProject(raw: unknown, modelExists: (id: string) => boolean): ImportedProject | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'That file is not a project Orbis exported.' }
  const o = raw as Record<string, unknown>
  if (o.kind !== 'project') return { error: 'That file is not a project.' }
  if (typeof o.format !== 'number' || o.format > SHARE_FORMAT) return { error: 'That project was exported by a newer version of Orbis than this one.' }
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 120) : ''
  if (!name) return { error: 'That project has no name.' }

  const notes: string[] = []
  const text = (value: unknown, limit: number): string => (typeof value === 'string' ? scrub(value).replace(/[ \t]+/g, ' ').trim().slice(0, limit) : '')

  let model = typeof o.model === 'string' ? o.model.trim().slice(0, 120) : ''
  if (model && !modelExists(model)) {
    notes.push(`It was set to answer with a model this copy of Orbis does not have (${model}), so it will use whatever you are using.`)
    model = ''
  }
  // Said every time there was anything to say it about, because somebody importing a project expects their notes.
  notes.push('Projects carry how they work, not what they refer to: notes, tasks, research and chats stay where they are.')

  return {
    project: {
      format: SHARE_FORMAT,
      kind: 'project',
      name,
      goal: text(o.goal, 500),
      instructions: text(o.instructions, 2000),
      outputFormat: text(o.outputFormat, 400),
      model,
      exportedAt: typeof o.exportedAt === 'number' ? o.exportedAt : 0
    },
    notes
  }
}

/** A name for the file, from the thing being exported. Safe on every filesystem Orbis runs on. */
export function shareFilename(title: string, extension: string): string {
  const base = title
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return `${base || 'Orbis export'}.${extension}`
}
