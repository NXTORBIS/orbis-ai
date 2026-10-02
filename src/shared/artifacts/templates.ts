import type { ColumnType } from '../compute/data.ts'

/**
 * Starting points: a table with its columns already chosen, a document with its headings already written.
 *
 * A template is structure and nothing else. No row in a table template is data and no sentence in a document template
 * is a claim: a table starts with its columns and no rows, and a document says "(fill in)" where the person's own
 * words go. That is the difference between a starting point and a sample -- a sample left in by mistake is a false
 * record, and a blank cannot be.
 *
 * Nothing here needs a model, a connection or a key. It is the part of creating something that works on a plane.
 */

export interface TemplateColumn {
  name: string
  type: ColumnType
  /** For a quantity column: what it is measured in. */
  unit?: string
}

interface TemplateBase {
  id: string
  name: string
  /** One line on what it is for, shown next to the name. */
  describe: string
  group: 'Money' | 'Work' | 'Study' | 'Home' | 'Writing'
}

export type Template = (TemplateBase & { kind: 'table'; columns: TemplateColumn[] }) | (TemplateBase & { kind: 'document'; markdown: string })

const table = (id: string, group: TemplateBase['group'], name: string, describe: string, columns: TemplateColumn[]): Template => ({ id, group, name, describe, kind: 'table', columns })
const document = (id: string, group: TemplateBase['group'], name: string, describe: string, markdown: string): Template => ({ id, group, name, describe, kind: 'document', markdown })

const c = (name: string, type: ColumnType = 'text', unit?: string): TemplateColumn => (unit ? { name, type, unit } : { name, type })

export const TEMPLATES: readonly Template[] = Object.freeze([
  table('budget', 'Money', 'Monthly budget', 'What was spent, on what, and who paid.', [c('Date', 'date'), c('Category', 'category'), c('Description'), c('Amount', 'number'), c('Paid by', 'category')]),
  table('invoice', 'Money', 'Invoice lines', 'The lines of an invoice, ready for a total.', [c('Item'), c('Quantity', 'integer'), c('Unit price', 'number'), c('Tax percent', 'number')]),
  table('subscriptions', 'Money', 'Subscriptions', 'What renews, when, and for how much.', [c('Service'), c('Cost', 'number'), c('Every', 'category'), c('Renews on', 'date'), c('Notes')]),
  table('timesheet', 'Work', 'Timesheet', 'Hours against projects, by day.', [c('Date', 'date'), c('Project', 'category'), c('Task'), c('Hours', 'number')]),
  table('project-plan', 'Work', 'Project plan', 'Tasks with an owner, dates and a status.', [c('Task'), c('Owner', 'category'), c('Start', 'date'), c('Due', 'date'), c('Status', 'category'), c('Notes')]),
  table('inventory', 'Work', 'Inventory', 'What is in stock and when to reorder.', [c('Item'), c('Code'), c('Quantity', 'integer'), c('Reorder at', 'integer'), c('Location', 'category')]),
  table('contacts', 'Work', 'Contacts', 'People, where they work, and how to reach them.', [c('Name'), c('Organisation'), c('Email'), c('Phone'), c('Notes')]),
  table('risks', 'Work', 'Risk register', 'What could go wrong, how likely, and who is watching it.', [c('Risk'), c('Likelihood', 'category'), c('Impact', 'category'), c('Owner', 'category'), c('What reduces it')]),
  table('study-log', 'Study', 'Study log', 'What was studied, for how long.', [c('Date', 'date'), c('Subject', 'category'), c('Topic'), c('Minutes', 'integer'), c('Notes')]),
  table('gradebook', 'Study', 'Gradebook', 'Scores by student and assignment.', [c('Student'), c('Assignment', 'category'), c('Score', 'number'), c('Out of', 'number')]),
  table('readings', 'Study', 'Lab readings', 'Measurements over a set of trials.', [c('Trial', 'integer'), c('Time', 'quantity', 's'), c('Value', 'number'), c('Notes')]),
  table('meals', 'Home', 'Meal plan', 'What is for each meal, and what to buy for it.', [c('Day', 'category'), c('Meal', 'category'), c('Dish'), c('To buy')]),
  table('habit', 'Home', 'Habit tracker', 'One line a day, done or not.', [c('Date', 'date'), c('Habit', 'category'), c('Done', 'boolean'), c('Notes')]),

  document(
    'report',
    'Writing',
    'Report',
    'Summary, background, findings, recommendations.',
    `# (Title of the report)

## Summary

(fill in: the three things a reader must take away, in three sentences)

## Background

(fill in: what this is about and why it was looked at)

## Findings

1. (fill in)
2. (fill in)
3. (fill in)

## Recommendations

- (fill in: what should be done, and by whom)

## Next steps

| What | Who | By when |
| --- | --- | --- |
| (fill in) | (fill in) | (fill in) |
`
  ),
  document(
    'meeting-notes',
    'Work',
    'Meeting notes',
    'Who was there, what was decided, who does what.',
    `# Meeting: (subject)

**Date:** (fill in)

**There:** (fill in)

## Agenda

1. (fill in)
2. (fill in)

## Decisions

- (fill in)

## Actions

| Action | Owner | Due |
| --- | --- | --- |
| (fill in) | (fill in) | (fill in) |

## Next meeting

(fill in)
`
  ),
  document(
    'proposal',
    'Work',
    'Project proposal',
    'The problem, what is proposed, what it needs, and how success is judged.',
    `# Proposal: (name)

## The problem

(fill in: what is wrong today, and for whom)

## What is proposed

(fill in)

## What it needs

- **People:** (fill in)
- **Time:** (fill in)
- **Money:** (fill in)

## Risks

- (fill in)

## How we will know it worked

(fill in: something that can be checked, with a date)
`
  ),
  document(
    'readme',
    'Work',
    'README',
    'What a project is, how to run it, how to change it.',
    `# (Project name)

(fill in: one sentence on what this is)

## Getting started

1. (fill in)
2. (fill in)

## How it is organised

- \`(folder)\` — (fill in)

## Running the tests

(fill in)

## Licence

(fill in)
`
  ),
  document(
    'letter',
    'Writing',
    'Letter',
    'A formal letter, laid out.',
    `(Your name)

(Your address)

(Date)

(Their name)

(Their address)

Dear (name),

(fill in: why you are writing, in one sentence)

(fill in: the detail)

(fill in: what you would like to happen next)

Yours sincerely,

(Your name)
`
  ),
  document(
    'essay',
    'Study',
    'Essay outline',
    'A claim, three points with their evidence, and a conclusion.',
    `# (Title)

## The claim

(fill in: the one thing this essay argues)

## First point

(fill in: the point)

> (fill in: the evidence, with where it is from)

## Second point

(fill in)

> (fill in)

## Third point

(fill in)

> (fill in)

## The strongest objection, and the answer to it

(fill in)

## Conclusion

(fill in)
`
  ),
  document(
    'lesson-plan',
    'Study',
    'Lesson plan',
    'What will be learned, how the time is spent, and how it is checked.',
    `# Lesson: (topic)

**For:** (fill in: who, and what they already know)

**Length:** (fill in)

## By the end, they can

- (fill in)
- (fill in)

## How the time is spent

| Minutes | Activity | What is needed |
| --- | --- | --- |
| (fill in) | (fill in) | (fill in) |

## How it is checked

(fill in)

## Homework

(fill in)
`
  ),
  document(
    'cv',
    'Writing',
    'CV',
    'Experience, education and skills on a page.',
    `# (Your name)

(fill in: email) · (fill in: phone) · (fill in: city)

## Profile

(fill in: two sentences on what you do and what you are looking for)

## Experience

### (Role), (Organisation)

(fill in: dates)

- (fill in: something you did, and what came of it)

## Education

### (Qualification), (Institution)

(fill in: dates)

## Skills

- (fill in)
`
  )
])

export const templateById = (id: string): Template | null => TEMPLATES.find((one) => one.id === id) ?? null

/** The catalogue as the screen needs it: what each one is, without its contents. */
export function listTemplates(): { id: string; kind: 'table' | 'document'; name: string; describe: string; group: string; columns: number }[] {
  return TEMPLATES.map((one) => ({ id: one.id, kind: one.kind, name: one.name, describe: one.describe, group: one.group, columns: one.kind === 'table' ? one.columns.length : 0 }))
}
