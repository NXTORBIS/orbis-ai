import type { Module } from '../../types.ts'

/**
 * Module 8 — Real-World Python Development.
 *
 * Nothing new about the language. Everything about the difference between code that runs and code somebody else
 * can work on — including you, in six months, having forgotten all of it.
 */
export const MODULE_8: Module = {
  id: 'm8',
  title: 'Real-World Python Development',
  summary: 'Writing code that can be read, found wrong, changed and trusted: style, debugging, tests, structure and refactoring.',
  concepts: ['readable-code', 'comments', 'debugging', 'testing', 'project-structure', 'reading-unfamiliar', 'refactoring', 'layers'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'm8l1',
      title: 'Code people can read',
      intro: 'Naming, spacing and the conventions every Python programmer already expects.',
      objectives: ['Follow PEP 8 naming', 'Spot unreadable code and say why', 'Explain why consistency matters more than preference'],
      concepts: ['readable-code'],
      requires: ['function-design'],
      minutes: 12,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'Code is read far more often than it is written. PEP 8 is Python\'s style guide, and its value is not that its choices are the best possible ones — it is that everybody made the same ones.' },
        {
          kind: 'table',
          headers: ['Thing', 'Style', 'Example'],
          rows: [
            ['Variables and functions', 'lower case with underscores', 'total_price, send_email'],
            ['Constants', 'upper case with underscores', 'VAT_RATE, MAX_RETRIES'],
            ['Classes', 'capitalised words', 'BankAccount, UserProfile'],
            ['Internal things', 'leading underscore', '_cache, _validate'],
            ['Indentation', 'four spaces, never tabs', '']
          ]
        },
        { kind: 'code', language: 'python', code: '# Hard to read\ndef calc(x,y,z):\n    a=x*y\n    if a>z:return a-z\n    else:return 0\n\n# Clear\ndef excess_cost(unit_price, quantity, budget):\n    total = unit_price * quantity\n    if total > budget:\n        return total - budget\n    return 0', caption: 'Same behaviour. The second can be checked against what it is supposed to do.' },
        { kind: 'heading', text: 'What actually helps' },
        {
          kind: 'list',
          items: [
            'Names that say what the thing is, not what type it is',
            'Spaces round operators and after commas',
            'One statement per line',
            'A blank line between functions, and between the sections of a long one',
            'Lines short enough to read without scrolling sideways',
            'Return early instead of nesting four levels deep'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Tools do this for you. black reformats a file to one agreed style, and ruff or flake8 point out problems before you run anything. Use them and stop having the argument.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'i, j, x and y are fine for loop counters and coordinates, where the meaning is obvious and the scope is three lines. They are not fine for anything that lives longer than that.'
        },
        { kind: 'check', questionId: 'm8l1q1' }
      ],
      questions: [
        {
          id: 'm8l1q1',
          kind: 'choice',
          concept: 'readable-code',
          prompt: 'Which follows Python conventions?',
          difficulty: 'beginner',
          options: ['def CalcTotal(ItemList):', 'def calc_total(item_list):', 'def calcTotal(itemList):', 'def CALC_TOTAL(item_list):'],
          answer: 1,
          explanation: 'Lower case with underscores for functions and variables. Capitalised words are for classes, and all-caps for constants.',
          hints: ['What case do Python functions use?']
        },
        {
          id: 'm8l1q2',
          kind: 'choice',
          concept: 'readable-code',
          prompt: 'Why does following a shared style guide matter more than which style is best?',
          difficulty: 'intermediate',
          options: [
            'It makes code run faster',
            'Consistency is what lets anybody read anybody else\'s code without re-learning how it is laid out',
            'Python will not run badly styled code',
            'It saves disk space'
          ],
          answer: 1,
          explanation: 'The value is in everybody having made the same choices. Any consistent style beats a better style used by half the project.',
          hints: ['What is the cost of two styles in one codebase?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'm8l2',
      title: 'Comments and docstrings',
      intro: 'Write why, not what — and the comment that is worse than none.',
      objectives: ['Tell a useful comment from a noisy one', 'Write a docstring', 'Explain why comments go stale'],
      concepts: ['comments'],
      requires: ['readable-code'],
      minutes: 10,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# Add 1 to count\ncount += 1\n\n# Loop through the items\nfor item in items:', caption: 'These say what the code already says. They are noise.' },
        { kind: 'code', language: 'python', code: '# The API rejects more than 50 at a time, so send in batches.\nfor batch in chunks(items, 50):\n    send(batch)\n\n# Deliberately not cached: prices change during the day and a stale\n# one is worse than a slow page.\nprice = fetch_price(item)', caption: 'These say why, which the code cannot.' },
        { kind: 'text', text: 'The rule is short: the code says what, the comment says why. If a comment is needed to explain what, the usual fix is a better name or a smaller function.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'A comment that is out of date is worse than no comment, because it will be believed. When you change code, change the comment above it in the same edit — this is the one thing nothing can check for you.'
        },
        { kind: 'heading', text: 'Docstrings' },
        { kind: 'code', language: 'python', code: 'def average(scores):\n    """Return the mean of a list of numbers.\n\n    Raises ZeroDivisionError on an empty list — deliberately, because\n    silently returning 0 has hidden real bugs here before.\n    """\n    return sum(scores) / len(scores)\n\nprint(average.__doc__)\nhelp(average)', caption: 'A docstring is the first thing in the body, and tools can read it.' },
        { kind: 'text', text: 'A docstring describes what a function is for, what it expects and what it hands back — including how it fails. A comment explains a decision inside it. They are different jobs.' },
        { kind: 'heading', text: 'Worth commenting' },
        {
          kind: 'list',
          items: [
            'A decision somebody would otherwise undo — especially a workaround',
            'A formula or rule that came from somewhere else',
            'Why something is not done the obvious way',
            'Anything that looks wrong and is correct'
          ]
        },
        { kind: 'check', questionId: 'm8l2q1' }
      ],
      questions: [
        {
          id: 'm8l2q1',
          kind: 'choice',
          concept: 'comments',
          prompt: 'Which is the most useful comment?',
          difficulty: 'intermediate',
          options: [
            '# increment i',
            '# loop over the list',
            '# Sorted before saving because the report reader assumes order',
            '# this is a function'
          ],
          answer: 2,
          explanation: 'Only the third says something the code cannot: a reason. The others describe what is already visible.',
          hints: ['Which one tells you something you could not read off the code?']
        },
        {
          id: 'm8l2q2',
          kind: 'choice',
          concept: 'comments',
          prompt: 'Why is an out-of-date comment worse than no comment?',
          difficulty: 'intermediate',
          options: [
            'It takes up space',
            'It will be believed, so it sends the next reader in the wrong direction',
            'Python tries to run it',
            'It slows the program'
          ],
          answer: 1,
          explanation: 'A wrong comment is trusted. The next person reads it, forms the wrong model, and changes the wrong thing.',
          hints: ['What does a reader do with a comment they find?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'm8l3',
      title: 'Debugging',
      intro: 'Finding out why, properly — a method rather than changing things until it stops complaining.',
      objectives: ['Read a traceback', 'Narrow a bug down systematically', 'Use print and a debugger deliberately'],
      concepts: ['debugging'],
      requires: ['errors', 'exceptions'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'Debugging is not guesswork, although it looks like it when done badly. It is narrowing down where reality stops matching what you believe.' },
        { kind: 'heading', text: 'Read the traceback from the bottom' },
        { kind: 'code', language: 'python', code: 'Traceback (most recent call last):\n  File "main.py", line 12, in <module>\n    report(scores)\n  File "main.py", line 7, in report\n    print(average(values))\n  File "main.py", line 3, in average\n    return sum(scores) / len(scores)\nZeroDivisionError: division by zero', caption: 'The last line is what went wrong. The line above it is where.' },
        { kind: 'text', text: 'Read upwards and you get the chain: main called report, which called average, which divided by zero — because it was handed an empty list. The traceback has already told you nearly everything.' },
        { kind: 'heading', text: 'The method' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Reproduce it reliably. A bug you cannot trigger on purpose cannot be fixed, only hidden from.',
            'Find the smallest input that still shows it.',
            'Say out loud what you expect at a particular line.',
            'Check what is actually there. One of the two is wrong.',
            'Fix the cause, not the symptom.',
            'Check the fix against the case that failed — and the cases that worked.'
          ]
        },
        { kind: 'heading', text: 'print, used properly' },
        { kind: 'code', language: 'python', code: 'def average(scores):\n    print(f"DEBUG average got: {scores!r} ({type(scores)})")\n    return sum(scores) / len(scores)', caption: '!r shows quotes and structure, so "" and " " and None are distinguishable.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Print the value and its type. Half of all Python bugs are a value being a string when you expected a number, or None when you expected a list, and the type is what tells you.'
        },
        { kind: 'heading', text: 'A debugger' },
        { kind: 'code', language: 'python', code: 'def average(scores):\n    breakpoint()        # the program stops here and gives you a prompt\n    return sum(scores) / len(scores)\n\n# At the prompt:  scores   type(scores)   n (next)   c (carry on)   q (quit)', caption: 'breakpoint() is built in since Python 3.7 — nothing to install.' },
        { kind: 'text', text: 'Print statements are fine and everybody uses them. A debugger is better when you do not yet know which variable is wrong, because you can look at all of them without deciding in advance.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'If a fix works and you cannot say why, you have not fixed it. You have moved it somewhere you are not looking, and it will come back at a worse moment.'
        },
        { kind: 'check', questionId: 'm8l3q1' },
        { kind: 'check', questionId: 'm8l3q2' }
      ],
      questions: [
        {
          id: 'm8l3q1',
          kind: 'choice',
          concept: 'debugging',
          prompt: 'Where in a traceback is the actual error described?',
          difficulty: 'beginner',
          options: ['The first line', 'The last line', 'The middle', 'It is not in the traceback'],
          answer: 1,
          explanation: 'The last line names the error and the message. The line just above it says where, and reading upwards gives the chain of calls that got there.',
          hints: ['Which end has the error name on it?']
        },
        {
          id: 'm8l3q2',
          kind: 'choice',
          concept: 'debugging',
          prompt: 'What is the first step when you have a bug?',
          difficulty: 'intermediate',
          options: [
            'Change something and see if it goes away',
            'Make it happen reliably, on purpose',
            'Rewrite the function',
            'Add a try/except around it'
          ],
          answer: 1,
          explanation: 'Reproduce it first. Without that you cannot tell a fix from a coincidence, and the try/except option hides it rather than fixing it.',
          hints: ['How would you know whether a change actually helped?']
        },
        {
          id: 'm8l3q3',
          kind: 'choice',
          concept: 'debugging',
          prompt: 'Why print the type of a value as well as the value?',
          difficulty: 'intermediate',
          options: [
            'It looks more thorough',
            'A great many bugs are a value being a string or None when you expected something else, and only the type shows that',
            'print needs it',
            'Types are always wrong'
          ],
          answer: 1,
          explanation: 'Printing 5 does not tell you whether it is 5 or "5". The type does, and that distinction is behind an enormous share of beginner bugs.',
          hints: ['Does the printed output of 5 and "5" look different?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'm8l4',
      title: 'Testing',
      intro: 'Code that checks your code, so a fix cannot quietly break something else.',
      objectives: ['Write tests with assert and with pytest', 'Choose what to test', 'Explain what tests actually buy you'],
      concepts: ['testing'],
      requires: ['functions', 'exceptions'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'You already test. Running the program and looking at the output is a test — it is just one you have to do by hand, every time, for ever. Writing it down means the machine does it.' },
        { kind: 'code', language: 'python', code: 'def add(a, b):\n    return a + b\n\nassert add(2, 3) == 5\nassert add(-1, 1) == 0\nassert add(0, 0) == 0\nprint("All passed")', caption: 'assert raises AssertionError when what follows is false. Nothing to install.' },
        { kind: 'heading', text: 'pytest' },
        { kind: 'code', language: 'python', code: '# test_maths.py\nfrom maths import add, average\n\ndef test_add_positive():\n    assert add(2, 3) == 5\n\ndef test_add_negative():\n    assert add(-1, -1) == -2\n\ndef test_average():\n    assert average([2, 4, 6]) == 4\n\n# At the terminal:  pytest', caption: 'pytest finds every test_ function and reports which failed and why.' },
        { kind: 'heading', text: 'Testing failure' },
        { kind: 'code', language: 'python', code: 'import pytest\n\ndef test_empty_list_raises():\n    with pytest.raises(ZeroDivisionError):\n        average([])', caption: 'Asserting that something fails, and fails in the right way, is as important as asserting success.' },
        { kind: 'heading', text: 'What to test' },
        {
          kind: 'list',
          items: [
            'The ordinary case — it works at all',
            'The edges — empty, zero, one item, the maximum, negative',
            'What should fail — and that it fails loudly',
            'Every bug you have ever fixed, so it cannot come back'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That last one is the cheapest habit in programming. Found a bug, fixed it, write a test for exactly that case. It can now never return silently.'
        },
        { kind: 'heading', text: 'Why it is worth it' },
        { kind: 'text', text: 'Not because it finds bugs today — reading the code finds those. Because six weeks from now you change one function and find out in two seconds whether you broke the other forty. Without tests the only way to know is to use the whole program by hand, which means nobody checks properly.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'This is where Module 5\'s advice pays off. A function that takes values and returns a value is testable in one line. A function that reads input and prints is not, which is exactly why calculation belongs in the middle and talking at the edges.'
        },
        { kind: 'check', questionId: 'm8l4q1' },
        { kind: 'check', questionId: 'm8l4q2' }
      ],
      questions: [
        {
          id: 'm8l4q1',
          kind: 'choice',
          concept: 'testing',
          prompt: 'What is the main thing tests buy you?',
          difficulty: 'intermediate',
          options: [
            'Code that runs faster',
            'Confidence that changing one thing has not broken another, checked in seconds instead of by hand',
            'Proof the code has no bugs',
            'Shorter code'
          ],
          answer: 1,
          explanation: 'They protect against breaking what already worked. No test suite proves there are no bugs — it proves the cases you wrote down still behave.',
          hints: ['What is hard about changing a large program?']
        },
        {
          id: 'm8l4q2',
          kind: 'choice',
          concept: 'testing',
          prompt: 'Why is a function that prints harder to test than one that returns?',
          difficulty: 'advanced',
          options: [
            'Printing is slow',
            'A returned value can be compared in one line; printed output has to be captured or read by a person',
            'print cannot be called from a test',
            'It is not harder'
          ],
          answer: 1,
          explanation: 'assert f(2) == 5 is the whole test. Checking printed output means capturing the stream, which is more work and less precise.',
          hints: ['How would you write an assert about something that was printed?']
        },
        {
          id: 'm8l4q3',
          kind: 'short',
          concept: 'testing',
          prompt: 'What should you always do after fixing a bug?',
          difficulty: 'intermediate',
          answer: 'write a test for that exact case',
          accepts: ['add a test', 'write a regression test', 'test the case that failed'],
          explanation: 'Write a test for the case that failed. It is the cheapest habit there is, and it means that particular bug can never come back unnoticed.',
          hints: ['How do you stop the same bug returning?']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'm8l5',
      title: 'Laying out a project',
      intro: 'When one file stops being enough, and where things go instead.',
      objectives: ['Lay out a small project', 'Separate logic from input and output', 'Keep secrets out of the code'],
      concepts: ['project-structure', 'layers'],
      requires: ['modules', 'function-design'],
      minutes: 13,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'One file is right for a hundred lines. Past that, finding anything becomes the slow part.' },
        { kind: 'example', title: 'A small project', text: 'tasks/\n    main.py            what runs — arguments, menus, printing\n    tasks/\n        __init__.py\n        model.py       what a task is\n        store.py       saving and loading\n        report.py      working things out\n    tests/\n        test_model.py\n        test_store.py\n    requirements.txt\n    README.md\n    .gitignore' },
        { kind: 'heading', text: 'Three layers' },
        {
          kind: 'table',
          headers: ['Layer', 'Does', 'Knows about'],
          rows: [
            ['Interface', 'talks to the person — input, print, menus', 'the logic layer'],
            ['Logic', 'the actual rules and calculations', 'nothing but data'],
            ['Storage', 'files, databases, the network', 'nothing but data']
          ]
        },
        { kind: 'text', text: 'The useful rule is the direction: the interface may call the logic, the logic must not call the interface. A logic function that prints can only ever be used from a terminal — and cannot be tested in one line.' },
        { kind: 'code', language: 'python', code: '# Bad — logic that insists on a terminal\ndef total_due(tasks):\n    total = sum(t.cost for t in tasks)\n    print(f"Total: £{total:.2f}")\n\n# Good\ndef total_due(tasks):\n    return sum(t.cost for t in tasks)\n\n# in main.py\nprint(f"Total: £{total_due(tasks):.2f}")', caption: 'The second works from a terminal, a web page, a scheduled job and a test.' },
        { kind: 'heading', text: 'Secrets' },
        { kind: 'code', language: 'python', code: 'API_KEY = "sk-live-abc123"   # never do this\n\n# Instead:\nimport os\nAPI_KEY = os.environ.get("API_KEY")\nif not API_KEY:\n    raise RuntimeError("API_KEY is not set")', caption: 'Read from the environment, and fail clearly when it is missing.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'A key written into a file goes into version control and stays in its history even after you delete the line. Keys have been found and used within minutes of being pushed. Keep them out of the code, and put the file that holds them in .gitignore.'
        },
        { kind: 'heading', text: 'README' },
        { kind: 'text', text: 'What it is, how to install it, how to run it, how to run the tests. Four sections, ten minutes, and it is what makes a project usable by anybody — including you, next year.' },
        { kind: 'check', questionId: 'm8l5q1' },
        { kind: 'check', questionId: 'm8l5q2' }
      ],
      questions: [
        {
          id: 'm8l5q1',
          kind: 'choice',
          concept: 'layers',
          prompt: 'Why must the logic layer not call print?',
          difficulty: 'advanced',
          options: [
            'print is slow',
            'It ties the logic to a terminal, so it cannot be reused elsewhere or tested in one line',
            'print is not allowed in modules',
            'It would cause an error'
          ],
          answer: 1,
          explanation: 'Logic that prints only works where there is a terminal. Returning the value means it works from a web page, a scheduled job and a test as well.',
          hints: ['Where could that function be used, in each version?']
        },
        {
          id: 'm8l5q2',
          kind: 'choice',
          concept: 'project-structure',
          prompt: 'Why is writing an API key into a source file a serious problem?',
          difficulty: 'advanced',
          options: [
            'It makes the file longer',
            'It goes into version control and stays in the history even after the line is deleted',
            'Python cannot read long strings',
            'It is only a style issue'
          ],
          answer: 1,
          explanation: 'Committing it is the damage, and deleting the line afterwards does not undo it. Read secrets from the environment and keep the file holding them out of the repository.',
          hints: ['What happens to the file once it is committed?']
        }
      ]
    },

    // ------------------------------------------------------------------ 6
    {
      id: 'm8l6',
      title: 'Reading code you did not write',
      intro: 'A method for understanding an unfamiliar codebase without reading all of it.',
      objectives: ['Find where a program starts', 'Follow one path through unfamiliar code', 'Resist reading everything'],
      concepts: ['reading-unfamiliar'],
      requires: ['reading-code', 'project-structure'],
      minutes: 12,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'Most programming work is on code somebody else wrote. The instinct is to read it all; that fails on anything larger than a few hundred lines, and it is not how experienced people do it.' },
        { kind: 'heading', text: 'The order' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'The README — what is this for, how is it run',
            'The directory names — the shape of it, before any code',
            'The entry point — main.py, or whatever has the __name__ guard',
            'One path. Pick a single thing the program does and follow it all the way through.',
            'The tests — they show what the author believed mattered, with examples',
            'Only then, the parts you actually need'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Following one path end to end teaches you more than skimming everything. The shape you learn from one journey is the shape the rest of it shares.'
        },
        { kind: 'heading', text: 'Tools' },
        {
          kind: 'list',
          items: [
            'Search for a function name to find every place it is called',
            'Search for a string you saw on screen to find the code that produced it',
            'Run it and add a print where you are unsure',
            'Change something harmless deliberately and see what breaks — that tells you what depends on it',
            'git log on a file to see how it got this way'
          ]
        },
        { kind: 'heading', text: 'Reading an error you have never seen' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'The last line of the traceback — what, exactly',
            'The deepest line of yours in the stack — their library usually did what it was asked',
            'What you passed in, and its type',
            'Only then search the message, with your own paths and names removed'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Do not change code you do not understand because a rewrite looks tidier. The ugly branch is usually there because of a bug somebody had and you have not had yet. Find out why before removing it.'
        },
        { kind: 'check', questionId: 'm8l6q1' }
      ],
      questions: [
        {
          id: 'm8l6q1',
          kind: 'choice',
          concept: 'reading-unfamiliar',
          prompt: 'What is the best way into an unfamiliar codebase?',
          difficulty: 'intermediate',
          options: [
            'Read every file from top to bottom',
            'Find the entry point and follow one thing the program does all the way through',
            'Start with the longest file',
            'Rewrite the parts you do not understand'
          ],
          answer: 1,
          explanation: 'One path end to end. It gives you the shape of the whole thing, which reading everything shallowly does not.',
          hints: ['Which approach scales to a large project?']
        },
        {
          id: 'm8l6q2',
          kind: 'choice',
          concept: 'reading-unfamiliar',
          prompt: 'Why are the tests a good place to look early?',
          difficulty: 'advanced',
          options: [
            'They are shorter',
            'They show what the author thought mattered, with working examples of how things are called',
            'They never change',
            'They contain the main logic'
          ],
          answer: 1,
          explanation: 'A test is an executable example plus a statement of intent. It is often the clearest documentation a project has.',
          hints: ['What does a test tell you about how a function is meant to be used?']
        }
      ]
    },

    // ------------------------------------------------------------------ 7
    {
      id: 'm8l7',
      title: 'Refactoring',
      intro: 'Improving code without changing what it does — and the one condition that makes it safe.',
      objectives: ['Name the common refactorings', 'Refactor safely', 'Say when not to'],
      concepts: ['refactoring'],
      requires: ['testing', 'readable-code'],
      minutes: 12,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'Refactoring is changing the shape of code while its behaviour stays identical. If the behaviour changes, it is not refactoring — it is a rewrite, and it needs testing as new work.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Refactoring without tests is guessing. The whole safety of it rests on being able to show the behaviour did not change, and only a test can show that. If there are no tests, write one for the current behaviour first — even an ugly one.'
        },
        { kind: 'heading', text: 'The common ones' },
        {
          kind: 'list',
          items: [
            'Extract a function — a block with a comment above it is usually a function with a name',
            'Rename — the cheapest improvement available',
            'Replace a magic number with a named constant',
            'Return early instead of nesting',
            'Collapse duplication — but only once it has appeared twice and you can see the shape',
            'Replace a chain of ifs with a dictionary lookup'
          ]
        },
        { kind: 'code', language: 'python', code: '# Before\ndef process(order):\n    if order["status"] == "new":\n        if order["total"] > 0:\n            if order["items"]:\n                send(order)\n                return True\n    return False\n\n# After — the conditions read as the rules they are\ndef process(order):\n    if order["status"] != "new":\n        return False\n    if order["total"] <= 0:\n        return False\n    if not order["items"]:\n        return False\n    send(order)\n    return True', caption: 'Same behaviour. Four levels of nesting become a list of reasons to refuse.' },
        { kind: 'code', language: 'python', code: '# Before\nif total > 100:\n    discount = total * 0.1\n\n# After\nFREE_DELIVERY_THRESHOLD = 100\nBULK_DISCOUNT = 0.1\n\nif total > FREE_DELIVERY_THRESHOLD:\n    discount = total * BULK_DISCOUNT', caption: 'The numbers now say what they are, and there is one place to change them.' },
        { kind: 'heading', text: 'When not to' },
        {
          kind: 'list',
          items: [
            'In the same commit as a behaviour change — nobody can review both at once',
            'Code about to be deleted',
            'Code nobody runs any more',
            'Because you prefer a different style, with no other reason'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Small steps, tests after each. Ten five-minute refactorings with a green test suite between them is safe; one two-hour rearrangement is how a working program stops working with no clear point to go back to.'
        },
        { kind: 'check', questionId: 'm8l7q1' }
      ],
      questions: [
        {
          id: 'm8l7q1',
          kind: 'choice',
          concept: 'refactoring',
          prompt: 'What makes refactoring safe?',
          difficulty: 'intermediate',
          options: [
            'Doing it slowly',
            'Tests that show the behaviour has not changed',
            'Keeping a copy of the old file',
            'Doing it all at once'
          ],
          answer: 1,
          explanation: 'Tests are the whole safety net. Without them you cannot tell a successful refactoring from a broken one.',
          hints: ['How would you know the behaviour is unchanged?']
        },
        {
          id: 'm8l7q2',
          kind: 'choice',
          concept: 'refactoring',
          prompt: 'Why should refactoring not be mixed into a commit that also changes behaviour?',
          difficulty: 'advanced',
          options: [
            'It makes the commit larger',
            'Nobody can tell which changes were meant to alter behaviour and which were not, so a review cannot catch a mistake',
            'Git does not allow it',
            'It is slower'
          ],
          answer: 1,
          explanation: 'Mixed together, a real change hides among a hundred cosmetic ones. Separate commits mean each can actually be checked.',
          hints: ['Think about whoever has to review it.']
        }
      ]
    },

    // ------------------------------------------------------------------ 8
    {
      id: 'm8l8',
      title: 'Development challenge',
      intro: 'Judgement questions rather than syntax: what is wrong with this, and why.',
      objectives: ['Apply the whole module to code that runs and should not be left as it is'],
      concepts: ['readable-code', 'comments', 'debugging', 'testing', 'project-structure', 'refactoring', 'layers'],
      requires: ['refactoring', 'testing', 'layers'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'check', questionId: 'm8c1' },
        { kind: 'check', questionId: 'm8c2' },
        { kind: 'check', questionId: 'm8c3' },
        { kind: 'check', questionId: 'm8c4' },
        { kind: 'check', questionId: 'm8c5' }
      ],
      questions: [
        {
          id: 'm8c1',
          kind: 'choice',
          concept: 'debugging',
          prompt: 'A ZeroDivisionError appears in average(). What is the actual cause most likely to be?',
          difficulty: 'intermediate',
          options: [
            'A bug in sum()',
            'average() was handed an empty list, so the problem is in whoever called it',
            'The numbers are too large',
            'A missing import'
          ],
          answer: 1,
          explanation: 'The division is where it surfaced; the empty list is the cause. Reading the traceback upwards is how you find who passed it.',
          hints: ['What has to be true of scores for len() to be zero?']
        },
        {
          id: 'm8c2',
          kind: 'multi',
          concept: 'readable-code',
          prompt: 'Which make code genuinely easier to work with? (Choose all that apply.)',
          difficulty: 'intermediate',
          options: [
            'Names that say what the thing is',
            'Comments restating what each line does',
            'Returning early instead of nesting four deep',
            'Named constants instead of bare numbers'
          ],
          answer: [0, 2, 3],
          explanation: 'All except the restating comments, which are noise and go stale. The other three all reduce what a reader has to hold in their head.',
          hints: ['One of these adds work and no information.']
        },
        {
          id: 'm8c3',
          kind: 'choice',
          concept: 'testing',
          prompt: 'Which set of tests for  average(scores)  is best?',
          difficulty: 'advanced',
          options: [
            'One test with three numbers',
            'Ordinary numbers, a single item, and an empty list that should raise',
            'Ten tests with different ordinary numbers',
            'No tests — it is one line'
          ],
          answer: 1,
          explanation: 'The ordinary case plus the edges, including the one that should fail. Ten variations of the same ordinary case test the same thing ten times.',
          hints: ['Where do bugs actually live?']
        },
        {
          id: 'm8c4',
          kind: 'choice',
          concept: 'layers',
          prompt: 'Which function is in the wrong layer?',
          difficulty: 'advanced',
          options: [
            'def total(items): return sum(i.price for i in items)',
            'def show_total(items): print(f"£{total(items):.2f}")',
            'def total_and_print(items): t = sum(...); print(t); return t',
            'def load(path): return json.load(open(path))'
          ],
          answer: 2,
          explanation: 'The third mixes calculation with output. The second is fine — it is an interface function whose job is printing, and it calls the logic rather than containing it.',
          hints: ['Which one does two jobs from two different layers?']
        },
        {
          id: 'm8c5',
          kind: 'short',
          concept: 'refactoring',
          prompt: 'You want to refactor a function and there are no tests. What do you do first?',
          difficulty: 'advanced',
          answer: 'write a test for the current behaviour first',
          accepts: ['add tests before refactoring', 'write a test that captures what it does now', 'test the existing behaviour'],
          explanation: 'Capture the current behaviour in a test, even an ugly one. Without it there is no way to show the refactoring changed nothing.',
          hints: ['What makes a refactoring safe?']
        }
      ]
    }
  ]
}
