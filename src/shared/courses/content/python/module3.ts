import type { Module } from '../../types.ts'

/**
 * Module 3 — Control Flow and Problem Solving.
 *
 * Where programs stop being lists and start being programs. Indentation finally means something here, which is
 * why Module 1 bothered to explain it before there was anything to indent.
 */
export const MODULE_3: Module = {
  id: 'm3',
  title: 'Control Flow and Problem Solving',
  summary: 'Making decisions, repeating work, and the handful of loop patterns that nearly every program is built from.',
  concepts: [
    'conditions', 'else', 'nested-conditions', 'logic', 'for-loops', 'range',
    'while-loops', 'break-continue', 'nested-loops', 'accumulators', 'searching', 'min-max'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'm3l1',
      title: 'if',
      intro: 'Doing something only when a condition holds — and the colon and indent that say what "something" is.',
      objectives: ['Write an if statement', 'Explain what the indented block means', 'Predict whether a block runs'],
      concepts: ['conditions'],
      requires: ['booleans'],
      minutes: 12,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'age = 20\n\nif age >= 18:\n    print("You may vote.")\n\nprint("Done.")', caption: 'The indented line runs only if the condition is true. The last line always runs.' },
        { kind: 'heading', text: 'The three parts' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'if followed by something that is true or false',
            'A colon at the end of that line — forget it and you get a SyntaxError',
            'One or more indented lines underneath: the block that runs when it is true'
          ]
        },
        { kind: 'text', text: 'Four spaces is the convention. Any consistent amount works, but mixing amounts inside one block is an error, and mixing tabs with spaces is a quiet nightmare. Use four spaces and never think about it again.' },
        { kind: 'heading', text: 'Indentation is the whole of it' },
        { kind: 'code', language: 'python', code: 'temperature = 15\n\nif temperature > 25:\n    print("Hot")\n    print("Have a drink")\n\nprint("Weather checked")', caption: 'Two lines in the block, both skipped. The unindented line is outside and always runs.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Losing an indent silently changes the meaning. Un-indent "Have a drink" and it prints whatever the weather is. No error, wrong program — a logic error, exactly as Module 1 described.'
        },
        { kind: 'heading', text: 'Conditions are just values' },
        { kind: 'text', text: 'Anything that produces True or False can go after if, including a variable that already holds one.' },
        { kind: 'code', language: 'python', code: 'logged_in = True\nif logged_in:\n    print("Welcome back")\n\nname = input("Name: ")\nif name.strip().lower() == "sam":\n    print("Hello, Sam")', caption: 'Note strip and lower — the person typed this, so tidy it before comparing.' },
        { kind: 'check', questionId: 'm3l1q1' },
        { kind: 'check', questionId: 'm3l1q2' }
      ],
      questions: [
        {
          id: 'm3l1q1',
          kind: 'choice',
          concept: 'conditions',
          prompt: 'What does this print?\n\nn = 5\nif n > 10:\n    print("big")\nprint("done")',
          difficulty: 'beginner',
          options: ['big then done', 'done', 'big', 'Nothing'],
          answer: 1,
          explanation: 'Just done. The condition is false so the indented line is skipped, but print("done") is not indented — it is outside the if and always runs.',
          hints: ['Which line is inside the if, and which is not?']
        },
        {
          id: 'm3l1q2',
          kind: 'choice',
          concept: 'conditions',
          prompt: 'What is wrong with this?\n\nif score > 50\n    print("pass")',
          difficulty: 'beginner',
          options: ['The indent is wrong', 'The colon is missing after the condition', 'It should be == not >', 'Nothing is wrong'],
          answer: 1,
          explanation: 'The colon is missing. Python needs it to know the condition has finished and a block is about to start, and without it nothing runs at all.',
          hints: ['Compare it character by character with a working if.']
        },
        {
          id: 'm3l1q3',
          kind: 'short',
          concept: 'conditions',
          prompt: 'Write an if statement that prints "Even" when a variable n is even.',
          difficulty: 'intermediate',
          answer: 'if n % 2 == 0:\n    print("Even")',
          accepts: ['if n%2==0: print("Even")', 'if n % 2 == 0: print("even")'],
          explanation: 'if n % 2 == 0: with print("Even") indented underneath. The remainder test from Module 2 is doing the work.',
          hints: ['You need the % test and a colon.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'm3l2',
      title: 'else and elif',
      intro: 'Choosing between alternatives, and why order matters when the conditions overlap.',
      objectives: ['Use else for the other case', 'Chain elif for several cases', 'Explain why only one branch ever runs'],
      concepts: ['else'],
      requires: ['conditions'],
      minutes: 13,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'age = 15\n\nif age >= 18:\n    print("You may vote.")\nelse:\n    print(f"Not yet — {18 - age} years to go.")', caption: 'Exactly one of the two blocks runs. Never both, never neither.' },
        { kind: 'text', text: 'else takes no condition — it is "in every other case" — and it needs its own colon.' },
        { kind: 'heading', text: 'More than two cases' },
        { kind: 'code', language: 'python', code: 'score = 72\n\nif score >= 80:\n    grade = "A"\nelif score >= 70:\n    grade = "B"\nelif score >= 60:\n    grade = "C"\nelif score >= 50:\n    grade = "D"\nelse:\n    grade = "F"\n\nprint(f"Grade: {grade}")   # Grade: B', caption: 'elif is short for "else if". You may have as many as you need.' },
        { kind: 'heading', text: 'It stops at the first match' },
        { kind: 'text', text: 'This is the part worth really understanding. Python checks the conditions in order, runs the first true one, and skips everything after it. 72 is greater than 70, greater than 60 and greater than 50 — but only the B branch runs.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Which is why order matters. Put the score >= 50 test first and every passing mark becomes a D, because 72 matches it and nothing later is ever reached. No error, and a program that quietly marks everybody wrong.'
        },
        { kind: 'heading', text: 'Writing overlapping ranges safely' },
        { kind: 'text', text: 'Two safe habits: go from the most specific to the least, or in one direction only, highest to lowest or lowest to highest. The grade chain above does both.' },
        { kind: 'example', title: 'Why you do not need score >= 70 and score < 80', text: 'By the time the second elif is reached, the first condition has already failed — so the score is known to be under 80. Earlier branches do the upper bound for you.' },
        { kind: 'check', questionId: 'm3l2q1' },
        { kind: 'check', questionId: 'm3l2q2' }
      ],
      questions: [
        {
          id: 'm3l2q1',
          kind: 'choice',
          concept: 'else',
          prompt: 'What does this print with  n = 5 ?\n\nif n > 0:\n    print("positive")\nelif n > 3:\n    print("over three")\nelse:\n    print("other")',
          difficulty: 'intermediate',
          options: ['positive', 'positive then over three', 'over three', 'other'],
          answer: 0,
          explanation: 'Only positive. Both conditions are true, but a chain stops at the first match — the elif is never even checked.',
          hints: ['How many branches of a chain can run?']
        },
        {
          id: 'm3l2q2',
          kind: 'choice',
          concept: 'else',
          prompt: 'This grades everybody as D. Why?\n\nif score >= 50:\n    grade = "D"\nelif score >= 80:\n    grade = "A"',
          difficulty: 'intermediate',
          options: [
            'elif cannot follow if',
            'The first condition catches every passing score, so the second is never reached',
            'The grades are the wrong way round alphabetically',
            'It needs an else'
          ],
          answer: 1,
          explanation: 'A score of 90 is also >= 50, so the first branch matches and the chain stops. Overlapping ranges have to be ordered most-specific first — here, 80 before 50.',
          hints: ['Is a score of 90 also greater than 50?']
        },
        {
          id: 'm3l2q3',
          kind: 'true-false',
          concept: 'else',
          prompt: 'An else branch needs a condition after it.',
          difficulty: 'beginner',
          answer: false,
          explanation: 'False. else means "in every remaining case" — a condition there would be a SyntaxError.',
          hints: ['What would there be left to test?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'm3l3',
      title: 'Nesting and combining',
      intro: 'Conditions inside conditions — and when to flatten them with and instead.',
      objectives: ['Write a nested if', 'Rewrite a nested if using and where it is clearer', 'Use not readably'],
      concepts: ['nested-conditions', 'logic'],
      requires: ['else'],
      minutes: 12,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'age = 20\nhas_ticket = True\n\nif age >= 18:\n    if has_ticket:\n        print("Come in")\n    else:\n        print("You need a ticket")\nelse:\n    print("Too young")', caption: 'The inner if is reached only when the outer one is true.' },
        { kind: 'heading', text: 'Often and is better' },
        { kind: 'code', language: 'python', code: 'if age >= 18 and has_ticket:\n    print("Come in")\nelse:\n    print("Not allowed")', caption: 'Shorter — but it can no longer say which requirement failed.' },
        { kind: 'text', text: 'The choice is about what the program has to say. If both failures get the same message, use and. If the person deserves to know which one stopped them, nest — because a nested version has somewhere to put each message.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Past two or three levels of nesting, code becomes genuinely hard to read. Deeply nested conditions are usually a sign a function wants pulling out — which is Module 5.'
        },
        { kind: 'heading', text: 'not, used readably' },
        { kind: 'code', language: 'python', code: 'logged_in = False\n\nif not logged_in:\n    print("Please sign in")\n\n# Clear:\nif not (age >= 18 or has_ticket):\n    print("Neither requirement met")', caption: 'not flips whatever follows it; brackets make the scope obvious.' },
        { kind: 'text', text: 'Avoid piling negatives up. `if not not allowed` is valid Python and nobody can read it. If a condition takes three attempts to understand, give it a name: `can_enter = age >= 18 and has_ticket`, then `if can_enter:`.' },
        { kind: 'check', questionId: 'm3l3q1' }
      ],
      questions: [
        {
          id: 'm3l3q1',
          kind: 'choice',
          concept: 'nested-conditions',
          prompt: 'With  age = 16  and  has_ticket = True, what does this print?\n\nif age >= 18:\n    if has_ticket:\n        print("in")\n    else:\n        print("ticket needed")\nelse:\n    print("too young")',
          difficulty: 'intermediate',
          options: ['in', 'ticket needed', 'too young', 'Nothing'],
          answer: 2,
          explanation: 'too young. The outer condition fails, so the whole inner if is skipped without being looked at, and the outer else runs.',
          hints: ['Check the outer condition first. Is the inner one even reached?']
        },
        {
          id: 'm3l3q2',
          kind: 'choice',
          concept: 'logic',
          prompt: 'When is nesting better than combining with and?',
          difficulty: 'intermediate',
          options: [
            'Always — nesting is clearer',
            'When each failure needs its own message',
            'Never — and is always better',
            'When there are more than two conditions'
          ],
          answer: 1,
          explanation: 'When the failures need different responses. A single and can only tell you that something failed, not which thing.',
          hints: ['What can a nested version say that a combined one cannot?']
        },
        {
          id: 'm3l3q3',
          kind: 'short',
          concept: 'logic',
          prompt: 'Rewrite  if not (x > 10)  as a single comparison.',
          difficulty: 'intermediate',
          answer: 'if x <= 10',
          accepts: ['x <= 10', 'if x<=10:', 'x =< 10'],
          explanation: 'if x <= 10. "Not greater than ten" is the same as "ten or less", and the positive version is easier to read.',
          hints: ['What is the opposite of "greater than"? Careful about the boundary.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'm3l4',
      title: 'for loops',
      intro: 'Doing something once for each item, without writing it out.',
      objectives: ['Write a for loop over a string or a list', 'Explain what the loop variable is', 'Nest a loop inside a condition'],
      concepts: ['for-loops'],
      requires: ['conditions'],
      minutes: 12,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'A for loop takes a collection of things and runs a block once for each of them.' },
        { kind: 'code', language: 'python', code: 'for letter in "cat":\n    print(letter)\n\n# c\n# a\n# t', caption: 'The variable letter holds a different value on each pass.' },
        { kind: 'text', text: '`letter` is the loop variable. You choose the name, and Python fills it in for you each time round. There is nothing special about it — it is an ordinary variable that gets reassigned on every pass.' },
        { kind: 'code', language: 'python', code: 'shopping = ["tea", "milk", "bread"]\n\nfor item in shopping:\n    print(f"Buy: {item}")', caption: 'Lists come properly in Module 4; the loop works the same on anything you can go through.' },
        { kind: 'heading', text: 'The body can be anything' },
        { kind: 'code', language: 'python', code: 'word = "programming"\nvowels = 0\n\nfor letter in word:\n    if letter in "aeiou":\n        vowels += 1\n\nprint(f"{vowels} vowels")   # 3', caption: 'A condition inside a loop. Both levels of indentation are doing real work.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Look at the indentation. The if is inside the loop, so it is checked once per letter. vowels += 1 is inside the if, so it only happens for vowels. print is outside both, so it happens once at the end. Every one of those positions is a decision.'
        },
        { kind: 'heading', text: 'After the loop' },
        { kind: 'text', text: 'The loop variable survives, holding the last value it had. That is occasionally useful and more often a source of confusion — do not rely on it.' },
        { kind: 'check', questionId: 'm3l4q1' },
        { kind: 'check', questionId: 'm3l4q2' }
      ],
      questions: [
        {
          id: 'm3l4q1',
          kind: 'choice',
          concept: 'for-loops',
          prompt: 'How many lines does this print?\n\nfor c in "hello":\n    print(c)',
          difficulty: 'beginner',
          options: ['1', '4', '5', '6'],
          answer: 2,
          explanation: 'Five — one per character in "hello". A for loop runs its block once for each item.',
          hints: ['Count the characters.']
        },
        {
          id: 'm3l4q2',
          kind: 'choice',
          concept: 'for-loops',
          prompt: 'What does this print?\n\ntotal = 0\nfor n in [1, 2, 3]:\n    total += n\nprint(total)',
          difficulty: 'intermediate',
          options: ['1', '3', '6', '0'],
          answer: 2,
          explanation: '6. total gathers up each value in turn: 0, then 1, then 3, then 6. print is outside the loop so it happens once, at the end.',
          hints: ['Track total on each pass.']
        },
        {
          id: 'm3l4q3',
          kind: 'choice',
          concept: 'for-loops',
          prompt: 'What changes if print(total) is indented to sit inside the loop?',
          difficulty: 'intermediate',
          options: [
            'Nothing',
            'It prints the running total on every pass, so three lines instead of one',
            'It becomes an error',
            'It prints 6 three times'
          ],
          answer: 1,
          explanation: 'It prints on every pass: 1, 3, 6. Indentation decided how often it happens — which is why the indent is part of the meaning and not a style choice.',
          hints: ['How many times does an indented line run?']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'm3l5',
      title: 'range',
      intro: 'Looping a set number of times, and counting in any step you like.',
      objectives: ['Use range with one, two and three arguments', 'Loop backwards', 'Explain why range(5) stops at 4'],
      concepts: ['range'],
      requires: ['for-loops'],
      minutes: 11,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'for i in range(5):\n    print(i)\n\n# 0 1 2 3 4   — five numbers, starting at 0', caption: 'range(5) gives five values, and 5 is not one of them.' },
        { kind: 'text', text: 'Same rule as string slices: the stop value is not included. And again it is convenient rather than awkward — range(n) always gives exactly n values.' },
        {
          kind: 'table',
          headers: ['Written', 'Produces'],
          rows: [
            ['range(5)', '0 1 2 3 4'],
            ['range(1, 6)', '1 2 3 4 5'],
            ['range(0, 10, 2)', '0 2 4 6 8'],
            ['range(10, 0, -1)', '10 9 8 7 6 5 4 3 2 1'],
            ['range(0)', 'nothing at all — the loop body never runs']
          ]
        },
        { kind: 'code', language: 'python', code: '# Five times table\nfor i in range(1, 11):\n    print(f"5 x {i} = {5 * i}")\n\n# Countdown\nfor i in range(5, 0, -1):\n    print(i)\nprint("Go!")', caption: 'The third argument is the step, and it may be negative.' },
        { kind: 'heading', text: 'When you do not need the number' },
        { kind: 'code', language: 'python', code: 'for _ in range(3):\n    print("beep")', caption: 'An underscore is the usual name for "I have to name it and I am not going to use it".' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Use range when you need to count or repeat a fixed number of times. When you need the items themselves, loop over the collection directly — for item in shopping, not for i in range(len(shopping)).'
        },
        { kind: 'check', questionId: 'm3l5q1' },
        { kind: 'check', questionId: 'm3l5q2' }
      ],
      questions: [
        {
          id: 'm3l5q1',
          kind: 'choice',
          concept: 'range',
          prompt: 'What does  range(2, 8, 2)  produce?',
          difficulty: 'intermediate',
          options: ['2 4 6 8', '2 4 6', '2 3 4 5 6 7', '2 8 2'],
          answer: 1,
          explanation: '2, 4 and 6. It starts at 2, steps by 2, and stops before 8 — the stop value is never included.',
          hints: ['Step from the start and stop before the second number.']
        },
        {
          id: 'm3l5q2',
          kind: 'number',
          concept: 'range',
          prompt: 'How many times does the body run in  for i in range(3, 9) ?',
          difficulty: 'intermediate',
          answer: 6,
          explanation: 'Six — 3, 4, 5, 6, 7 and 8. The count is stop minus start.',
          hints: ['List the values, or subtract.']
        },
        {
          id: 'm3l5q3',
          kind: 'short',
          concept: 'range',
          prompt: 'Write a for loop that prints the numbers 10 down to 1.',
          difficulty: 'intermediate',
          answer: 'for i in range(10, 0, -1):\n    print(i)',
          accepts: ['for i in range(10,0,-1): print(i)', 'range(10, 0, -1)'],
          explanation: 'for i in range(10, 0, -1). Start at 10, stop before 0, step backwards by one.',
          hints: ['Three arguments, and the last one is negative.']
        }
      ]
    },

    // ------------------------------------------------------------------ 6
    {
      id: 'm3l6',
      title: 'while loops',
      intro: 'Repeating for as long as something stays true — and the one way this goes badly wrong.',
      objectives: ['Write a while loop', 'Say when while is the right choice over for', 'Explain what causes an infinite loop'],
      concepts: ['while-loops'],
      requires: ['for-loops', 'booleans'],
      minutes: 13,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'A for loop knows in advance how many passes it will make. A while loop does not — it keeps going as long as its condition is true.' },
        { kind: 'code', language: 'python', code: 'count = 1\nwhile count <= 5:\n    print(count)\n    count += 1\nprint("Finished")', caption: 'The condition is checked before every pass, including the first.' },
        { kind: 'heading', text: 'The three things a while loop needs' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Something set up before it starts (count = 1)',
            'A condition that will eventually become false (count <= 5)',
            'Something inside that moves it towards false (count += 1)'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Leave out the third and the loop never ends. Remove count += 1 above and it prints 1 for ever. The program is not broken in a way Python can see — it is doing exactly what you said, indefinitely. Ctrl+C stops it.'
        },
        { kind: 'heading', text: 'Where while genuinely wins' },
        { kind: 'text', text: 'When the number of passes depends on something you cannot know in advance — usually a person.' },
        { kind: 'code', language: 'python', code: 'answer = ""\nwhile answer != "quit":\n    answer = input("Command (or quit): ").strip().lower()\n    if answer != "quit":\n        print(f"You said: {answer}")\nprint("Goodbye")', caption: 'There is no way to write this as a for loop — nobody knows how many commands will be typed.' },
        { kind: 'code', language: 'python', code: 'total = 0\nwhile total < 100:\n    total += int(input("Add: "))\n    print(f"Total now {total}")\nprint("Reached 100")', caption: 'The loop ends when a quantity is reached, not after a set number of goes.' },
        { kind: 'heading', text: 'Choosing between them' },
        {
          kind: 'table',
          headers: ['Use', 'When'],
          rows: [
            ['for', 'You have a collection, or you know how many times'],
            ['while', 'You are waiting for something to become true']
          ]
        },
        { kind: 'check', questionId: 'm3l6q1' },
        { kind: 'check', questionId: 'm3l6q2' }
      ],
      questions: [
        {
          id: 'm3l6q1',
          kind: 'choice',
          concept: 'while-loops',
          prompt: 'What does this do?\n\nn = 5\nwhile n > 0:\n    print(n)',
          difficulty: 'intermediate',
          options: ['Prints 5 4 3 2 1', 'Prints 5 once', 'Prints 5 for ever', 'Prints nothing'],
          answer: 2,
          explanation: 'Prints 5 for ever. Nothing in the body changes n, so the condition stays true. This is an infinite loop and it is the commonest while mistake.',
          hints: ['What changes n inside the loop?']
        },
        {
          id: 'm3l6q2',
          kind: 'choice',
          concept: 'while-loops',
          prompt: 'Which task genuinely needs a while loop rather than a for loop?',
          difficulty: 'intermediate',
          options: [
            'Printing every character of a word',
            'Printing the numbers 1 to 100',
            'Asking for a password until the right one is typed',
            'Adding up the numbers in a list'
          ],
          answer: 2,
          explanation: 'The password. You cannot know how many attempts it will take, and that is exactly the case while exists for. The other three all have a known number of passes.',
          hints: ['Which one has an unknown number of repeats?']
        },
        {
          id: 'm3l6q3',
          kind: 'number',
          concept: 'while-loops',
          prompt: 'How many times does the body run?\n\nn = 10\nwhile n > 6:\n    n -= 1',
          difficulty: 'intermediate',
          answer: 4,
          explanation: 'Four. n goes 10, 9, 8, 7, and at 6 the condition fails. One pass for each decrease down to 6.',
          hints: ['Write out n after each pass and stop when the condition fails.']
        }
      ]
    },

    // ------------------------------------------------------------------ 7
    {
      id: 'm3l7',
      title: 'break and continue',
      intro: 'Leaving a loop early, and skipping the rest of one pass.',
      objectives: ['Use break to stop a loop', 'Use continue to skip a pass', 'Say when each is appropriate'],
      concepts: ['break-continue'],
      requires: ['while-loops'],
      minutes: 11,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'heading', text: 'break — stop now' },
        { kind: 'code', language: 'python', code: 'for n in range(1, 11):\n    if n == 5:\n        break\n    print(n)\n\n# 1 2 3 4  — then it leaves', caption: 'break abandons the whole loop, not just the pass.' },
        { kind: 'text', text: 'Its best use is searching: once you have found the thing, there is no reason to keep looking.' },
        { kind: 'code', language: 'python', code: 'names = ["Ali", "Bea", "Cal", "Dee"]\nlooking_for = "Cal"\n\nfor name in names:\n    if name == looking_for:\n        print("Found")\n        break\nelse:\n    print("Not there")', caption: 'A for loop may have an else: it runs only if the loop finished without breaking.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'for/else is unusual to Python and genuinely useful — it is "did we get all the way through without finding it". It trips people up precisely once, because else here means "no break", not "the condition was false".'
        },
        { kind: 'heading', text: 'continue — skip this one' },
        { kind: 'code', language: 'python', code: 'for n in range(1, 11):\n    if n % 2 != 0:\n        continue\n    print(n)\n\n# 2 4 6 8 10', caption: 'continue jumps straight to the next pass; the loop itself carries on.' },
        { kind: 'text', text: 'That example is equally well written as `if n % 2 == 0: print(n)`, which is shorter. continue earns its place when there are several reasons to skip and you want them stated and dealt with at the top.' },
        { kind: 'code', language: 'python', code: 'for line in lines:\n    if line.strip() == "":\n        continue          # blank\n    if line.startswith("#"):\n        continue          # a comment\n    process(line)', caption: 'Each reason to skip gets its own line, and the real work is not buried three indents deep.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'In a while loop, a continue that jumps over the line that changes the condition gives you an infinite loop. Increase the counter before the continue, not after.'
        },
        { kind: 'check', questionId: 'm3l7q1' }
      ],
      questions: [
        {
          id: 'm3l7q1',
          kind: 'choice',
          concept: 'break-continue',
          prompt: 'What does this print?\n\nfor n in range(5):\n    if n == 2:\n        continue\n    print(n)',
          difficulty: 'intermediate',
          options: ['0 1', '0 1 3 4', '0 1 2 3 4', '0 1 2'],
          answer: 1,
          explanation: '0, 1, 3, 4. continue skips only the pass where n is 2; the loop carries on afterwards.',
          hints: ['Does continue end the loop or just that one pass?']
        },
        {
          id: 'm3l7q2',
          kind: 'choice',
          concept: 'break-continue',
          prompt: 'Change that continue to a break. What prints?',
          difficulty: 'intermediate',
          options: ['0 1', '0 1 3 4', '0 1 2', 'Nothing'],
          answer: 0,
          explanation: '0 and 1. break leaves the loop entirely when n reaches 2, so 3 and 4 never happen.',
          hints: ['break abandons the whole loop.']
        },
        {
          id: 'm3l7q3',
          kind: 'choice',
          concept: 'break-continue',
          prompt: 'When does the else on a for loop run?',
          difficulty: 'advanced',
          options: [
            'When the collection was empty',
            'When the loop finished without hitting a break',
            'After every loop',
            'When the condition was false'
          ],
          answer: 1,
          explanation: 'When the loop ran to the end without breaking. It is the natural place for "searched everything and did not find it".',
          hints: ['It is about break, not about any condition.']
        }
      ]
    },

    // ------------------------------------------------------------------ 8
    {
      id: 'm3l8',
      title: 'Loops inside loops',
      intro: 'A loop in the body of another loop — grids, pairs and tables.',
      objectives: ['Trace a nested loop', 'Work out how many passes a nested loop makes', 'Use nesting to build a grid'],
      concepts: ['nested-loops'],
      requires: ['range', 'for-loops'],
      minutes: 12,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'for row in range(3):\n    for col in range(3):\n        print(f"({row},{col})", end=" ")\n    print()\n\n# (0,0) (0,1) (0,2)\n# (1,0) (1,1) (1,2)\n# (2,0) (2,1) (2,2)', caption: 'end=" " keeps print on the same line; the bare print() ends the row.' },
        { kind: 'text', text: 'The inner loop runs all the way through on every single pass of the outer one. Three outer passes times three inner passes is nine — which is the number to keep in mind, because it multiplies.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Nested loops multiply. 1,000 items inside 1,000 items is a million passes. Three levels of 1,000 is a billion, and that is the difference between instant and never finishing. Always ask what the two numbers are.'
        },
        { kind: 'heading', text: 'A times table' },
        { kind: 'code', language: 'python', code: 'for a in range(1, 4):\n    for b in range(1, 4):\n        print(f"{a} x {b} = {a * b}")\n    print("---")' },
        { kind: 'text', text: 'Note where `print("---")` sits: inside the outer loop, outside the inner one. So it happens once per outer pass — three times, not nine. Working out which level a line belongs on is most of the skill here.' },
        { kind: 'heading', text: 'Triangles' },
        { kind: 'code', language: 'python', code: 'for i in range(1, 6):\n    print("*" * i)\n\n# *\n# **\n# ***\n# ****\n# *****', caption: 'Sometimes string repetition does the inner loop for you.' },
        { kind: 'check', questionId: 'm3l8q1' }
      ],
      questions: [
        {
          id: 'm3l8q1',
          kind: 'number',
          concept: 'nested-loops',
          prompt: 'How many times does print run?\n\nfor i in range(4):\n    for j in range(3):\n        print(i, j)',
          difficulty: 'intermediate',
          answer: 12,
          explanation: '12. The inner loop runs three times for each of the four outer passes, and four times three is twelve.',
          hints: ['Multiply the two counts.']
        },
        {
          id: 'm3l8q2',
          kind: 'choice',
          concept: 'nested-loops',
          prompt: 'How many times does the second print run?\n\nfor i in range(3):\n    for j in range(5):\n        print("inner")\n    print("outer")',
          difficulty: 'intermediate',
          options: ['3', '5', '15', '18'],
          answer: 0,
          explanation: 'Three. It is inside the outer loop but outside the inner one, so it happens once per outer pass.',
          hints: ['Which loop is it indented inside?']
        },
        {
          id: 'm3l8q3',
          kind: 'true-false',
          concept: 'nested-loops',
          prompt: 'Nesting two loops over 1,000 items each means about two thousand passes.',
          difficulty: 'intermediate',
          answer: false,
          explanation: 'False — a million. Nested loops multiply, they do not add, and that distinction is the difference between a program that finishes and one that does not.',
          hints: ['Does the inner loop run once in total, or once per outer pass?']
        }
      ]
    },

    // ------------------------------------------------------------------ 9
    {
      id: 'm3l9',
      title: 'The four loop patterns',
      intro: 'Counting, totalling, searching and finding the extreme. Nearly every loop you write is one of these.',
      objectives: ['Write an accumulator loop', 'Write a search loop with a flag', 'Find a maximum without using max()'],
      concepts: ['accumulators', 'searching', 'min-max'],
      requires: ['for-loops', 'conditions'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'These four shapes come up constantly. Recognising which one a problem is saves you from thinking it through from scratch every time.' },
        { kind: 'heading', text: '1. Count' },
        { kind: 'code', language: 'python', code: 'word = "programming"\ncount = 0\nfor letter in word:\n    if letter == "m":\n        count += 1\nprint(count)   # 2', caption: 'Start at zero, add one when the condition holds.' },
        { kind: 'heading', text: '2. Total' },
        { kind: 'code', language: 'python', code: 'prices = [2.50, 1.20, 4.00]\ntotal = 0\nfor price in prices:\n    total += price\nprint(f"£{total:.2f}")   # £7.70', caption: 'An accumulator: one variable gathering everything up.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Start the accumulator before the loop, not inside it. Put total = 0 inside and it is reset on every pass, so you end up with the last value instead of the sum. No error, wrong answer.'
        },
        { kind: 'heading', text: '3. Search' },
        { kind: 'code', language: 'python', code: 'names = ["Ali", "Bea", "Cal"]\nfound = False\nfor name in names:\n    if name == "Bea":\n        found = True\n        break\nif found:\n    print("Yes")\nelse:\n    print("No")', caption: 'A flag records what happened; break stops once there is nothing left to learn.' },
        { kind: 'heading', text: '4. Biggest or smallest' },
        { kind: 'code', language: 'python', code: 'numbers = [4, 19, 7, 2, 11]\nlargest = numbers[0]\nfor n in numbers:\n    if n > largest:\n        largest = n\nprint(largest)   # 19', caption: 'Hold a best-so-far and replace it when something beats it.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Start from the first item, not from 0. Start from 0 and a list of all-negative numbers gives you 0 — a value that was never in the list at all. This is one of the classic quiet bugs.'
        },
        { kind: 'text', text: 'Python has `sum()`, `max()`, `min()` and `in` that do all four in one word, and you will use them. Writing them out by hand once is what lets you recognise the shape when the problem is slightly different and no built-in fits.' },
        { kind: 'check', questionId: 'm3l9q1' },
        { kind: 'check', questionId: 'm3l9q2' }
      ],
      questions: [
        {
          id: 'm3l9q1',
          kind: 'choice',
          concept: 'accumulators',
          prompt: 'Why is total = 0 placed before the loop and not inside it?',
          difficulty: 'intermediate',
          options: [
            'Style only — either works',
            'Inside, it resets on every pass, so you end up with only the last value',
            'Python does not allow assignment inside a loop',
            'It would be an error'
          ],
          answer: 1,
          explanation: 'Inside the loop it is reset every pass, wiping out the running total. There is no error — you simply get the last value instead of the sum.',
          hints: ['What happens to total at the start of each pass if the line is inside?']
        },
        {
          id: 'm3l9q2',
          kind: 'choice',
          concept: 'min-max',
          prompt: 'This finds the largest number but fails on one kind of list. Which?\n\nlargest = 0\nfor n in numbers:\n    if n > largest:\n        largest = n',
          difficulty: 'advanced',
          options: [
            'A list with one item',
            'A list where every number is negative — it returns 0, which was never in the list',
            'A list of decimals',
            'A sorted list'
          ],
          answer: 1,
          explanation: 'All-negative lists. Nothing beats 0, so you get 0 — a number that is not in the data. Starting from numbers[0] fixes it.',
          hints: ['What if nothing in the list is bigger than the starting value?']
        },
        {
          id: 'm3l9q3',
          kind: 'short',
          concept: 'accumulators',
          prompt: 'Which pattern would you use to find how many words in a list are longer than five letters?',
          difficulty: 'intermediate',
          answer: 'count',
          accepts: ['counting', 'a counter', 'count with a condition', 'the count pattern'],
          explanation: 'Count: start at zero and add one each time the condition holds. "How many" is almost always a counter.',
          hints: ['The question starts with "how many".']
        }
      ]
    },

    // ------------------------------------------------------------------ 10
    {
      id: 'm3l10',
      title: 'Control flow challenge',
      intro: 'Conditions and loops together, with the traps from this module among them.',
      objectives: ['Trace and write control flow without prompting'],
      concepts: ['conditions', 'else', 'for-loops', 'range', 'while-loops', 'break-continue', 'nested-loops', 'accumulators'],
      requires: ['accumulators', 'nested-loops', 'break-continue'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'Trace these on paper. Writing down what each variable holds on each pass is slower than guessing and is right far more often.' },
        { kind: 'check', questionId: 'm3c1' },
        { kind: 'check', questionId: 'm3c2' },
        { kind: 'check', questionId: 'm3c3' },
        { kind: 'check', questionId: 'm3c4' },
        { kind: 'check', questionId: 'm3c5' },
        { kind: 'check', questionId: 'm3c6' }
      ],
      questions: [
        {
          id: 'm3c1',
          kind: 'choice',
          concept: 'for-loops',
          prompt: 'What does this print?\n\ntotal = 0\nfor i in range(1, 5):\n    if i % 2 == 0:\n        total += i\nprint(total)',
          difficulty: 'intermediate',
          options: ['10', '6', '4', '2'],
          answer: 1,
          explanation: '6. The values are 1, 2, 3, 4; only 2 and 4 are even, and 2 + 4 is 6.',
          hints: ['Which of 1, 2, 3, 4 pass the test?']
        },
        {
          id: 'm3c2',
          kind: 'choice',
          concept: 'while-loops',
          prompt: 'What does this print?\n\nn = 1\nwhile n < 20:\n    n = n * 3\nprint(n)',
          difficulty: 'advanced',
          options: ['9', '20', '27', 'It never ends'],
          answer: 2,
          explanation: '27. n goes 3, 9, 27; at 27 the condition fails. The loop checks before each pass, so the last multiplication still happens and takes it past 20.',
          hints: ['Write out n after each pass. When does the check fail?']
        },
        {
          id: 'm3c3',
          kind: 'choice',
          concept: 'break-continue',
          prompt: 'What does this print?\n\nfor i in range(10):\n    if i > 3:\n        break\n    if i == 1:\n        continue\n    print(i)',
          difficulty: 'advanced',
          options: ['0 2 3', '0 1 2 3', '0 2 3 4', '0'],
          answer: 0,
          explanation: '0, 2, 3. 1 is skipped by the continue, and at 4 the break ends the loop before anything prints.',
          hints: ['Go through i = 0, 1, 2, 3, 4 one at a time.']
        },
        {
          id: 'm3c4',
          kind: 'choice',
          concept: 'else',
          prompt: 'Why does this always print "medium" for a score of 95?\n\nif score > 30:\n    print("medium")\nelif score > 90:\n    print("high")',
          difficulty: 'intermediate',
          options: [
            'elif cannot come after if',
            '95 is also over 30, so the first branch matches and the chain stops',
            'It needs an else',
            'The comparisons should be >='
          ],
          answer: 1,
          explanation: 'The first condition catches it and a chain stops at the first match. The high test has to come first.',
          hints: ['Is 95 greater than 30?']
        },
        {
          id: 'm3c5',
          kind: 'number',
          concept: 'nested-loops',
          prompt: 'How many stars does this print in total?\n\nfor i in range(1, 5):\n    print("*" * i)',
          difficulty: 'advanced',
          answer: 10,
          explanation: '10 — rows of 1, 2, 3 and 4 stars, which add up to ten.',
          hints: ['Add up the length of each row.']
        },
        {
          id: 'm3c6',
          kind: 'short',
          concept: 'searching',
          prompt: 'In plain language, how would you check whether a list contains any negative number, stopping as soon as you find one?',
          difficulty: 'advanced',
          answer: 'loop through, if a number is negative set a flag and break',
          accepts: ['use a flag and break', 'for each number if n < 0 then break', 'search pattern with a flag'],
          explanation: 'The search pattern: a flag set to False, loop until you find one, set the flag and break. Nothing is learned by carrying on after the first.',
          hints: ['Which of the four patterns is "is there any"?']
        }
      ]
    }
  ]
}
