import type { Module } from '../../types.ts'

/**
 * Module 9 — Working Independently.
 *
 * The module the course exists for. Everything before it taught Python; this one is about finishing something
 * nobody has given you the steps to. No new syntax appears anywhere in it.
 */
export const MODULE_9: Module = {
  id: 'm9',
  title: 'Working Independently',
  summary: 'Turning a vague request into a finished program: requirements, design, building in small steps, and getting unstuck.',
  concepts: ['requirements', 'design-first', 'choosing-structures', 'incremental', 'independent', 'debugging', 'testing'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'm9l1',
      title: 'Working out what is actually wanted',
      intro: 'Most failed programs are correct answers to the wrong question.',
      objectives: ['Turn a vague request into specific requirements', 'Identify what was left unsaid', 'Write down what is out of scope'],
      concepts: ['requirements'],
      requires: ['decomposition'],
      minutes: 13,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'quote', text: 'Can you make something to keep track of my expenses?' },
        { kind: 'text', text: 'Nothing about that is enough to build from, and it feels like it is. The commonest way a project goes wrong is not bad code — it is building the wrong thing well.' },
        { kind: 'heading', text: 'The questions that have to be answered' },
        {
          kind: 'list',
          items: [
            'What goes in — what fields does one expense have?',
            'What comes out — a total, a monthly report, a chart, an export?',
            'Who uses it, and how — a terminal, a file, a web page?',
            'How much data — twenty entries or twenty thousand?',
            'What must never happen — losing data, double-counting, showing it to anybody else?',
            'What is explicitly not wanted — this is the one people forget to ask'
          ]
        },
        { kind: 'example', title: 'The same request, answered', text: 'Expenses have: date, amount, category, note.\nIt runs in a terminal, one person, a few hundred a year.\nIt shows a total per month and a total per category.\nIt saves to a JSON file in the user\'s own folder.\nIt must never lose an entry that was confirmed.\n\nNot in scope: multiple users, currencies, receipts, bank imports, charts.' },
        { kind: 'text', text: 'That is buildable. It took five minutes and it is the difference between finishing and drifting.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Write down what is out of scope, explicitly. It is what lets you say "not yet" without feeling you failed, and it is the only defence against a project that grows faster than you build it.'
        },
        { kind: 'heading', text: 'When you cannot ask' },
        { kind: 'text', text: 'Write down your assumptions, build the smallest honest version, and show it. A thing people can look at produces better corrections in ten minutes than an hour of questions in the abstract.' },
        { kind: 'check', questionId: 'm9l1q1' }
      ],
      questions: [
        {
          id: 'm9l1q1',
          kind: 'choice',
          concept: 'requirements',
          prompt: 'What is the commonest reason a project fails?',
          difficulty: 'intermediate',
          options: [
            'The code has bugs',
            'The wrong thing was built, carefully',
            'The language was wrong',
            'It was too slow'
          ],
          answer: 1,
          explanation: 'Building the wrong thing. Bugs get fixed; a program that solves a problem nobody had gets abandoned.',
          hints: ['Which failure cannot be fixed by better code?']
        },
        {
          id: 'm9l1q2',
          kind: 'choice',
          concept: 'requirements',
          prompt: 'Why write down what is out of scope?',
          difficulty: 'advanced',
          options: [
            'To look thorough',
            'It is what lets you finish, instead of the project growing faster than you build it',
            'It is required by convention',
            'It makes the README longer'
          ],
          answer: 1,
          explanation: 'An unbounded project never finishes. Deciding in advance what you are not doing is what makes the rest achievable.',
          hints: ['What happens when every new idea is in scope?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'm9l2',
      title: 'Designing before typing',
      intro: 'Deciding the data, the pieces and the order, while changing your mind is still free.',
      objectives: ['Design the data before the code', 'Sketch the functions needed', 'Decide the order to build in'],
      concepts: ['design-first', 'choosing-structures'],
      requires: ['requirements', 'choosing-structures'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'The data first' },
        { kind: 'text', text: 'Decide the shape of the data before any logic. Get it right and the functions are short; get it wrong and every single one of them fights it.' },
        { kind: 'code', language: 'python', code: '# One expense\n{"date": "2026-03-14", "amount": 12.50, "category": "food", "note": "lunch"}\n\n# All of them: a list, because order and duplicates both matter\n[{...}, {...}, {...}]\n\n# Monthly totals: a dictionary, because it is a lookup by name\n{"2026-03": 240.10, "2026-04": 198.75}', caption: 'Three decisions, each following the rules from Module 4.' },
        { kind: 'text', text: 'Note why the date is a string in that shape: written as YYYY-MM-DD it sorts correctly as text, and "2026-03" is the first seven characters. Choosing the format well removed a whole piece of work.' },
        { kind: 'heading', text: 'Then the pieces' },
        { kind: 'code', language: 'python', code: 'def load(path): ...                 # list of expenses, or [] if there is no file\ndef save(expenses, path): ...       # write them\n\ndef add(expenses, date, amount, category, note): ...   # validated\ndef monthly_totals(expenses): ...  # {"2026-03": 240.10, ...}\ndef category_totals(expenses): ...\n\ndef main(): ...                    # menu, printing, asking', caption: 'Names and what each hands back. No bodies yet.' },
        { kind: 'text', text: 'Three layers are visible already: load and save are storage, the three middle ones are logic, main is the interface. That came out of naming the pieces, not out of planning it separately.' },
        { kind: 'heading', text: 'Then the order' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'The thinnest end-to-end path: add one expense in code, print the total',
            'Saving and loading, so it survives being run twice',
            'Asking the person for the values',
            'Monthly and category totals',
            'Validation on everything typed',
            'Anything nice, if there is time'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Always build the thin end-to-end path first. A program that does one small thing completely is proof the shape works. Three finished pieces that have never been joined up are proof of nothing, and joining them is where the surprises live.'
        },
        { kind: 'check', questionId: 'm9l2q1' }
      ],
      questions: [
        {
          id: 'm9l2q1',
          kind: 'choice',
          concept: 'design-first',
          prompt: 'What should be decided first?',
          difficulty: 'intermediate',
          options: [
            'Which functions to write',
            'The shape of the data',
            'What the menu looks like',
            'Which libraries to install'
          ],
          answer: 1,
          explanation: 'The data. The right shape makes the functions short; the wrong one makes every function work around it.',
          hints: ['What does everything else have to work with?']
        },
        {
          id: 'm9l2q2',
          kind: 'choice',
          concept: 'design-first',
          prompt: 'Why build a thin end-to-end path before completing any one part?',
          difficulty: 'advanced',
          options: [
            'It is quicker to type',
            'It proves the whole shape works; separate finished pieces that have never been joined prove nothing',
            'It needs fewer functions',
            'So you can stop early'
          ],
          answer: 1,
          explanation: 'Joining things up is where the surprises are. Doing it first and small means you find them while the code is tiny.',
          hints: ['Where do the unpleasant surprises usually appear?']
        },
        {
          id: 'm9l2q3',
          kind: 'short',
          concept: 'choosing-structures',
          prompt: 'Why store a date as "2026-03-14" rather than "14/03/2026"?',
          difficulty: 'advanced',
          answer: 'it sorts correctly as text and the month is the first seven characters',
          accepts: ['it sorts correctly', 'sorting works alphabetically', 'you can slice the month off the front'],
          explanation: 'Written biggest unit first, text sorting and date sorting agree, and the month is a slice. Choosing the format well deleted a piece of work.',
          hints: ['Try sorting both formats as plain strings.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'm9l3',
      title: 'Building in small steps',
      intro: 'Always having something that runs — and why that matters more than it sounds.',
      objectives: ['Work in small verified steps', 'Keep the program runnable throughout', 'Commit at sensible points'],
      concepts: ['incremental'],
      requires: ['design-first', 'testing'],
      minutes: 13,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'The way projects die is three hundred lines written before anything is run, and then forty errors at once with no way to tell which caused which.' },
        { kind: 'heading', text: 'The loop' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Pick the smallest useful next thing',
            'Write it',
            'Run it',
            'Check it did what you expected',
            'Commit',
            'Repeat'
          ]
        },
        { kind: 'text', text: 'Small means small. "Load the file and return a list" is a step. "Build the storage layer" is five.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Never have more than one unverified change at a time. One change and one error means you know where it is. Five changes and one error means bisecting your own afternoon.'
        },
        { kind: 'heading', text: 'Stubs keep it running' },
        { kind: 'code', language: 'python', code: 'def monthly_totals(expenses):\n    """Not written yet — returns an empty report so main() still runs."""\n    return {}\n\ndef category_totals(expenses):\n    return {}', caption: 'The program runs end to end from the first hour, with pieces that honestly do nothing yet.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'A stub must be obviously empty, never plausibly wrong. Returning {} is honest. Returning made-up numbers so the screen looks finished is how a demo gets shipped and nobody notices the report was never written.'
        },
        { kind: 'heading', text: 'Commit messages' },
        { kind: 'code', language: 'python', code: '# Says nothing:\n#   "fixes"   "wip"   "stuff"\n\n# Says what and why:\n#   "Load expenses from JSON, returning [] when the file is absent"\n#   "Reject negative amounts — a typo was being saved as income"', caption: 'A commit history is a record of reasons, and in six months it is the only one left.' },
        { kind: 'heading', text: 'When you are stuck mid-step' },
        { kind: 'text', text: 'Go back to the last thing that worked and take a smaller step. Fighting forward from a broken state is how an hour becomes a day; it is nearly always faster to retreat ten minutes.' },
        { kind: 'check', questionId: 'm9l3q1' }
      ],
      questions: [
        {
          id: 'm9l3q1',
          kind: 'choice',
          concept: 'incremental',
          prompt: 'Why keep to one unverified change at a time?',
          difficulty: 'intermediate',
          options: [
            'It is faster to type',
            'When something breaks you know exactly what caused it',
            'Python requires it',
            'It uses less memory'
          ],
          answer: 1,
          explanation: 'One change, one suspect. Five changes and a failure means working out which of the five, which costs far more than the time saved.',
          hints: ['What happens when five things changed and one broke?']
        },
        {
          id: 'm9l3q2',
          kind: 'choice',
          concept: 'incremental',
          prompt: 'Why must a stub return something obviously empty rather than plausible-looking data?',
          difficulty: 'advanced',
          options: [
            'Empty values are faster',
            'Plausible fake output hides the fact that the feature was never written',
            'It would crash otherwise',
            'There is no difference'
          ],
          answer: 1,
          explanation: 'A screen that looks finished stops anybody checking. An empty report is honest and stays visible until it is actually built.',
          hints: ['Who would notice the difference, and when?']
        },
        {
          id: 'm9l3q3',
          kind: 'short',
          concept: 'incremental',
          prompt: 'You have been stuck on one step for an hour. What is usually the fastest move?',
          difficulty: 'advanced',
          answer: 'go back to the last working state and take a smaller step',
          accepts: ['revert and try smaller', 'return to what worked', 'start again from the last commit'],
          explanation: 'Retreat to the last thing that worked and take a smaller step. Fighting forward from a broken state is how an hour becomes a day.',
          hints: ['What do you still have that definitely works?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'm9l4',
      title: 'Getting unstuck',
      intro: 'A method for being stuck, so it is a process rather than a mood.',
      objectives: ['Work through being stuck in order', 'Ask a question somebody can answer', 'Use AI help without stopping learning'],
      concepts: ['independent', 'debugging'],
      requires: ['debugging'],
      minutes: 13,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'Everybody gets stuck constantly, including people who have done this for twenty years. The difference is that they have a procedure instead of a feeling.' },
        { kind: 'heading', text: 'In order' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Read the error. All of it, slowly. It very often says exactly what is wrong.',
            'Say out loud what you expect to happen, then check what actually does.',
            'Make it smaller. Can you reproduce it in five lines?',
            'Explain the problem to someone — or to nobody. Finishing the sentence is frequently the fix.',
            'Search the error message, with your own names and paths taken out.',
            'Read the documentation for the function involved.',
            'Leave it. A walk genuinely works, often enough that it is a technique and not a joke.',
            'Ask, properly.'
          ]
        },
        { kind: 'heading', text: 'Asking properly' },
        { kind: 'example', title: 'A question nobody can answer', text: '"My code does not work. Help?"' },
        { kind: 'example', title: 'A question that gets answered in minutes', text: 'What I am trying to do: total the amounts from a JSON file.\nWhat I expected: 42.50\nWhat happened: TypeError: unsupported operand type(s) for +: int and str\nThe smallest code that shows it: [six lines]\nWhat I have already tried: printed the values — one of them is "12.50" with quotes, and I do not understand why.' },
        { kind: 'text', text: 'Writing that out is itself one of the best debugging techniques there is, because it forces step 2 and step 3. A noticeable share of these questions get answered by the person writing them.' },
        { kind: 'heading', text: 'AI help' },
        {
          kind: 'list',
          items: [
            'Good: explaining an error, reviewing something you wrote, suggesting approaches, writing boilerplate you understand',
            'Risky: handing you code you cannot read. It may be subtly wrong, and you will not be able to tell',
            'The test: can you explain every line? If not, ask for the explanation rather than the code'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Code you did not understand when you accepted it is code you cannot debug at two in the morning when it breaks. The time saved today is borrowed at a poor rate.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Use it as a tutor rather than a vending machine: "why is this a TypeError?" rather than "write this for me". The first makes you faster permanently; the second makes you faster once.'
        },
        { kind: 'check', questionId: 'm9l4q1' }
      ],
      questions: [
        {
          id: 'm9l4q1',
          kind: 'choice',
          concept: 'independent',
          prompt: 'Why does writing out a good question often solve the problem?',
          difficulty: 'intermediate',
          options: [
            'Somebody answers quickly',
            'It forces you to state what you expected and reduce it to the smallest case — which is debugging',
            'It makes you take a break',
            'It does not'
          ],
          answer: 1,
          explanation: 'A good question requires the two hardest debugging steps: saying precisely what you expected, and cutting it down to the minimum. Doing them is often the whole fix.',
          hints: ['What do you have to work out before you can write the question?']
        },
        {
          id: 'm9l4q2',
          kind: 'choice',
          concept: 'independent',
          prompt: 'What is the test for whether AI-suggested code is safe to use?',
          difficulty: 'advanced',
          options: [
            'It runs without errors',
            'You can explain what every line does',
            'It is short',
            'It came with a comment'
          ],
          answer: 1,
          explanation: 'Running is not the same as correct, and code you cannot read is code you cannot debug. If you cannot explain a line, ask for the explanation instead of keeping the line.',
          hints: ['What will you need to do when it breaks later?']
        },
        {
          id: 'm9l4q3',
          kind: 'choice',
          concept: 'debugging',
          prompt: 'What is the first step when stuck?',
          difficulty: 'beginner',
          options: ['Search the internet', 'Read the whole error message carefully', 'Rewrite the function', 'Ask someone'],
          answer: 1,
          explanation: 'Read the error, all of it. It very often names the problem and the line, and skipping it is the commonest waste of an afternoon.',
          hints: ['What is already on your screen?']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'm9l5',
      title: 'Finishing',
      intro: 'The difference between "it works on my machine" and done.',
      objectives: ['Judge when something is finished', 'Handle the awkward cases', 'Write the minimum documentation'],
      concepts: ['independent'],
      requires: ['incremental', 'validation'],
      minutes: 12,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'The last ten per cent is the awkward cases, and it is where most hobby projects stop. Working on your own data in the order you expected is not finished.' },
        { kind: 'heading', text: 'The checklist' },
        {
          kind: 'list',
          items: [
            'Empty everything — no file, no entries, an empty answer at every prompt',
            'Wrong types — letters where a number was asked for',
            'Extremes — zero, negative, enormous, one character, a thousand items',
            'Awkward text — spaces at the ends, quotes, accents, emoji, a very long string',
            'Interruption — closed halfway through a save',
            'Run it twice — does the second run see what the first one did?',
            'Run it somewhere else — a different folder, a clean environment'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Try pressing Enter at every prompt with nothing typed. It takes a minute and it finds a bug in nearly every first version.'
        },
        { kind: 'heading', text: 'Errors a person can act on' },
        { kind: 'code', language: 'python', code: '# Useless\nprint("Error")\n\n# Useful\nprint("Could not read expenses.json — it exists but is not valid JSON.")\nprint("Nothing has been changed. Fix or move the file and run this again.")', caption: 'Say what happened, what it means for their data, and what to do.' },
        { kind: 'text', text: 'That second message does three things: names the problem, states that nothing was destroyed, and gives the next action. Any error message missing the middle one leaves somebody frightened for their data.' },
        { kind: 'heading', text: 'The minimum documentation' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'What it is, in one sentence',
            'How to install it — including the Python version',
            'How to run it, with a real example',
            'Where it keeps its data',
            'What it deliberately does not do'
          ]
        },
        { kind: 'heading', text: 'Done' },
        { kind: 'text', text: 'Finished means: it does what the requirements said, it survives the checklist above, somebody else can install and run it from the README alone, its errors say what to do, and it has tests for the parts that would be expensive to get wrong. Not perfect — finished.' },
        { kind: 'check', questionId: 'm9l5q1' }
      ],
      questions: [
        {
          id: 'm9l5q1',
          kind: 'choice',
          concept: 'independent',
          prompt: 'What does a good error message include that "Error" does not?',
          difficulty: 'intermediate',
          options: [
            'The line number',
            'What happened, what it means for the person\'s data, and what to do next',
            'A longer word',
            'The name of the function'
          ],
          answer: 1,
          explanation: 'All three. Without the middle one — whether anything was lost — somebody is left frightened about their data and no wiser.',
          hints: ['What does somebody need to know to act?']
        },
        {
          id: 'm9l5q2',
          kind: 'choice',
          concept: 'independent',
          prompt: 'Which test finds a bug in nearly every first version?',
          difficulty: 'intermediate',
          options: [
            'A very large number',
            'Pressing Enter with nothing typed at every prompt',
            'Running it twice',
            'Reading the code again'
          ],
          answer: 1,
          explanation: 'Empty input. It takes a minute and almost always finds something, because nobody tests it while building.',
          hints: ['What do you never type while testing your own program?']
        },
        {
          id: 'm9l5q3',
          kind: 'multi',
          concept: 'independent',
          prompt: 'Which are needed before calling something finished? (Choose all that apply.)',
          difficulty: 'advanced',
          options: [
            'It survives empty and wrong input',
            'Somebody else can install and run it from the README alone',
            'Every possible feature is implemented',
            'Its errors say what to do next'
          ],
          answer: [0, 1, 3],
          explanation: 'All except "every possible feature" — that is the definition of never finishing, and it is why scope gets written down in lesson one of this module.',
          hints: ['One of these describes a project that never ships.']
        }
      ]
    },

    // ------------------------------------------------------------------ 6
    {
      id: 'm9l6',
      title: 'Three problems, no instructions',
      intro: 'Problems with nothing telling you which part of the course to use. That is the point.',
      objectives: ['Approach an unfamiliar problem with the whole course available'],
      concepts: ['independent', 'requirements', 'design-first', 'choosing-structures'],
      requires: ['independent'],
      minutes: 20,
      difficulty: 'expert',
      required: true,
      blocks: [
        { kind: 'text', text: 'Design each of these before writing anything: the data shape, the functions, and the order to build them in. Then build them.' },
        { kind: 'example', title: '1. Word frequency', text: 'Read a text file and report the ten most common words.\n\nDecide: what counts as a word? Is "The" the same word as "the"? What about "don\'t", or a full stop stuck to the end? Do you exclude "the", "and", "of" — and if so, who decides the list?\n\nThose questions are the problem. The code is short once they are answered.' },
        { kind: 'example', title: '2. Split the bill', text: 'Several people, several items, some shared and some not, a service charge, and rounding so the pennies add up exactly.\n\nThe trap: rounding each share to two places and then totalling gives a number that is not the bill. Somebody has to absorb the odd penny, and you have to decide who and say so.' },
        { kind: 'example', title: '3. Tidy a folder', text: 'Sort files into subfolders by their type.\n\nThe real work is every awkward case: a file with no extension, two files with the same name landing in the same place, a file currently open, a file you do not have permission to move, and the folder you created last time you ran it.\n\nAnd one rule above all of them — never overwrite anything without being told to.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The third one moves real files. Write it to print what it would do before it does anything, and run it that way first. "It worked except it overwrote forty photographs" is a real outcome of not doing this.'
        },
        { kind: 'text', text: 'Orion can be asked for a hint on any of them. Ask for the question you have not thought of rather than the code — that is the part that transfers to the next problem.' },
        { kind: 'check', questionId: 'm9l6q1' },
        { kind: 'check', questionId: 'm9l6q2' },
        { kind: 'check', questionId: 'm9l6q3' }
      ],
      questions: [
        {
          id: 'm9l6q1',
          kind: 'choice',
          concept: 'choosing-structures',
          prompt: 'For the word frequency problem, what structure holds the counts?',
          difficulty: 'intermediate',
          options: ['A list of words', 'A dictionary of word to count', 'A set of words', 'A tuple'],
          answer: 1,
          explanation: 'A dictionary — a lookup from word to how many times it appeared. Then sort its items by value and take the first ten.',
          hints: ['You need a count attached to each word.']
        },
        {
          id: 'm9l6q2',
          kind: 'choice',
          concept: 'requirements',
          prompt: 'In the bill-splitting problem, why does rounding each share separately go wrong?',
          difficulty: 'advanced',
          options: [
            'Floats are inaccurate',
            'The rounded shares do not add back up to the bill, so somebody must absorb the odd penny and you have to decide who',
            'Division does not work on money',
            'It does not go wrong'
          ],
          answer: 1,
          explanation: 'Three ways of £10 is £3.33 each, totalling £9.99. The missing penny has to go somewhere, deliberately and visibly.',
          hints: ['Add the rounded shares back up.']
        },
        {
          id: 'm9l6q3',
          kind: 'choice',
          concept: 'independent',
          prompt: 'What should the folder-tidying program do before it is ever allowed to move a file?',
          difficulty: 'advanced',
          options: [
            'Back up the whole disk',
            'Print exactly what it would do, and be run that way first',
            'Ask for a password',
            'Nothing — just move them'
          ],
          answer: 1,
          explanation: 'A dry run. Anything that changes files should be able to describe its plan without doing it, because the cost of a mistake is somebody\'s photographs.',
          hints: ['How would you check it before trusting it with real files?']
        }
      ]
    }
  ]
}
