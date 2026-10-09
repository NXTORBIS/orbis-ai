import type { Module } from '../../types.ts'

/**
 * Module 1 — Programming Foundations.
 *
 * Nothing in this module is Python-specific except `print()`. That is deliberate: somebody who learns syntax
 * before they learn what a program *is* spends the rest of the course memorising rather than reasoning, and the
 * first time they meet a problem the tutorial did not cover they stop.
 */
export const MODULE_1: Module = {
  id: 'm1',
  title: 'Programming Foundations',
  summary: 'What a program is, how a computer runs one, and how to think the way programming needs you to think.',
  concepts: ['programming', 'execution', 'print', 'reading-code', 'errors', 'algorithms'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'm1l1',
      title: 'What is programming?',
      intro: 'Before any code, the idea underneath all of it: a program is a set of instructions precise enough that a machine with no judgement can follow them.',
      objectives: ['Say what a program is', 'Explain why computers need such exact instructions', 'Turn an everyday task into steps a machine could follow'],
      concepts: ['programming'],
      requires: [],
      minutes: 9,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Programming is writing instructions for a computer. That is the whole of it. What makes it hard is not the writing — it is the precision.' },
        { kind: 'text', text: 'You can tell a person "make me a cup of tea" and they will fill in a hundred details you never mentioned: which kettle, how much water, where the cups are, what to do if there is no milk. A computer fills in nothing. It does exactly what you wrote, in exactly the order you wrote it, and if you left a step out it does not notice — it simply does the wrong thing, confidently.' },
        { kind: 'heading', text: 'A program is a sequence' },
        { kind: 'text', text: 'Instructions run one after another, top to bottom, unless you say otherwise. Order is not decoration. "Put the teabag in, then pour the water" and "pour the water, then put the teabag in" are different programs with different results.' },
        {
          kind: 'example',
          title: 'Making tea, as a program',
          text: '1. Fill the kettle with water\n2. Switch the kettle on\n3. Wait until it boils\n4. Put a teabag in a cup\n5. Pour the water into the cup\n6. Wait three minutes\n7. Take the teabag out\n8. Add milk if wanted'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Notice step 3. A person would never need telling to wait. A computer would pour cold water, because nothing told it not to.'
        },
        { kind: 'heading', text: 'Why we need a language' },
        { kind: 'text', text: 'English is far too vague for this. "Add milk if wanted" — wanted by whom, how much, what if there is none? So we use a programming language: a small, strict vocabulary where every word means exactly one thing. Python is one of those languages, and it is the one this course uses.' },
        { kind: 'text', text: 'The strictness is the point. A language where "a bit" is a valid amount is a language where the computer has to guess, and a computer that guesses is a computer you cannot rely on.' },
        { kind: 'check', questionId: 'm1l1q1' },
        { kind: 'check', questionId: 'm1l1q2' }
      ],
      questions: [
        {
          id: 'm1l1q1',
          kind: 'choice',
          concept: 'programming',
          prompt: 'Why do computers need instructions to be so much more precise than people do?',
          difficulty: 'beginner',
          options: [
            'Because computers are slower than people at understanding language',
            'Because a computer has no judgement and fills in nothing you leave out',
            'Because programming languages are harder than English',
            'Because computers can only do one thing at a time'
          ],
          answer: 1,
          explanation: 'A computer has no sense of what you probably meant. It does exactly what you wrote. Anything you leave unsaid is simply not done — and it will not stop to ask.',
          hints: ['Think about what a person does automatically that a machine does not.']
        },
        {
          id: 'm1l1q2',
          kind: 'choice',
          concept: 'programming',
          prompt: 'A recipe says: "Pour the water. Boil the kettle. Add the teabag." What is wrong with it as a program?',
          difficulty: 'beginner',
          options: [
            'Nothing — all the steps are there',
            'The steps are in the wrong order, so it would pour cold water',
            'It is missing the milk',
            'A program cannot have more than two steps'
          ],
          answer: 1,
          explanation: 'All the right steps, in the wrong order. Order is part of the instruction, not a detail — a program with the right steps in the wrong sequence is simply a wrong program.',
          hints: ['Read the steps strictly in order, doing exactly what each one says.']
        },
        {
          id: 'm1l1q3',
          kind: 'short',
          concept: 'algorithms',
          prompt: 'In one sentence: what is a program?',
          difficulty: 'beginner',
          answer: 'a sequence of precise instructions a computer follows',
          accepts: ['instructions for a computer', 'a set of instructions', 'steps a computer follows', 'list of instructions'],
          explanation: 'A program is a sequence of instructions, precise enough that a machine with no judgement can follow them in order.',
          hints: ['Two words matter: instructions, and order.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'm1l2',
      title: 'How a computer runs your code',
      intro: 'What actually happens between you writing a line and something appearing on screen.',
      objectives: ['Describe what source code is', 'Explain what the interpreter does', 'Use the input → processing → output shape to describe a program'],
      concepts: ['execution'],
      requires: ['programming'],
      minutes: 9,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'What you write is called source code. It is a text file. On its own it does nothing at all — it is a document, like a letter. Something has to read it and act on it.' },
        { kind: 'heading', text: 'The interpreter' },
        { kind: 'text', text: 'For Python, that something is the Python interpreter: a program already on the machine whose entire job is to read your file one line at a time and carry out what each line says.' },
        { kind: 'text', text: 'This is worth holding on to, because it explains a lot of behaviour later. The interpreter works through your file top to bottom. It does not read ahead. It does not know what is coming on line 40 while it is doing line 3.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'This is why a program can run perfectly for ten lines and then fail. The first ten lines were fine. The interpreter only found out about line eleven when it got there.'
        },
        { kind: 'heading', text: 'Where things are kept' },
        { kind: 'text', text: 'While your program runs, the values it is working with sit in memory — fast, and emptied the moment the program stops. The processor does the actual work: the arithmetic, the comparisons, the decisions. You will almost never think about either directly, but it is why a program forgets everything when it ends, unless you deliberately save it to a file.' },
        { kind: 'heading', text: 'The shape of almost every program' },
        { kind: 'text', text: 'Nearly everything you write will have the same three parts: get something in, do something with it, put something out.' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Input — something comes in: typed by a person, read from a file, fetched from the internet',
            'Processing — the program does something with it: calculates, decides, sorts, filters',
            'Output — something comes out: printed, saved, sent'
          ]
        },
        {
          kind: 'example',
          title: 'A calculator, in that shape',
          text: 'Input: two numbers typed by the user.\nProcessing: add them together.\nOutput: show the total.'
        },
        { kind: 'check', questionId: 'm1l2q1' }
      ],
      questions: [
        {
          id: 'm1l2q1',
          kind: 'choice',
          concept: 'execution',
          prompt: 'A program prints three lines correctly and then stops with an error. What does that tell you?',
          difficulty: 'beginner',
          options: [
            'The whole file was wrong from the start',
            'The first three lines were fine; the interpreter reached a bad line and stopped there',
            'Python checks the whole file before running anything',
            'The error must be on the first line'
          ],
          answer: 1,
          explanation: 'The interpreter works top to bottom. Everything above the failure already ran. That is why the output you got before the error tells you roughly where to look.',
          hints: ['Did the three lines print before or after the interpreter reached the problem?']
        },
        {
          id: 'm1l2q2',
          kind: 'short',
          concept: 'execution',
          prompt: 'Why does a program forget everything when it finishes, unless you do something about it?',
          difficulty: 'beginner',
          answer: 'because values live in memory which is cleared when the program ends',
          accepts: ['memory is cleared', 'values are in memory', 'memory empties', 'not saved to disk', 'not saved to a file'],
          explanation: 'Values live in memory while the program runs, and memory is handed back when it stops. Keeping anything means writing it to a file — which is exactly what Module 6 is about.',
          hints: ['Where were the values while the program was running?']
        },
        {
          id: 'm1l2q3',
          kind: 'multi',
          concept: 'execution',
          prompt: 'Which of these are true of the Python interpreter? (Choose all that apply.)',
          difficulty: 'intermediate',
          options: [
            'It reads your source code and carries out each line',
            'It runs the lines in the order they appear, unless told otherwise',
            'It reads the whole file and fixes mistakes for you',
            'It is a program that is already on the machine'
          ],
          answer: [0, 1, 3],
          explanation: 'It reads and carries out your code in order, and it is a program in its own right. It never fixes anything — it reports the problem and stops.',
          hints: ['Three of these are true. The false one claims the interpreter is helpful in a way no interpreter is.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'm1l3',
      title: 'What Python is, and what it is for',
      intro: 'Why this language, where it is genuinely good, and where it is the wrong tool — said honestly.',
      objectives: ['Say what Python is used for in practice', 'Name a situation where Python is the wrong choice'],
      concepts: ['execution'],
      requires: ['execution'],
      minutes: 7,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Python was designed to be readable. That sounds like a small thing and it is the reason for almost everything else about it: code that reads close to English is code more people can write, and code more people can read six months later.' },
        { kind: 'heading', text: 'Where it is genuinely used' },
        {
          kind: 'list',
          items: [
            'Automation — the scripts that rename a thousand files or check a site every morning',
            'Data analysis — reading messy data, cleaning it, getting an answer out of it',
            'Artificial intelligence and machine learning — very nearly the whole field is Python at the top',
            'Web backends — the part of a website you never see',
            'Science and research — simulations, modelling, processing results',
            'Teaching — because of that readability'
          ]
        },
        { kind: 'heading', text: 'Where it is the wrong tool' },
        { kind: 'text', text: 'An honest course says this part. Python is comparatively slow: the interpreter is doing a lot of work for you at the moment you run each line. For most programs that is irrelevant — the slow part is the network, or the disk, or the person. But for a game engine, an operating system, or code that must respond within a fixed number of microseconds, Python is the wrong choice and nobody serious pretends otherwise.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'In practice the heavy numerical libraries get around this by doing the real work in C underneath, with Python as the layer you steer it from. That is a very common pattern, and it is why "Python is slow" and "Python is used for enormous computations" are both true at once.'
        },
        { kind: 'check', questionId: 'm1l3q1' }
      ],
      questions: [
        {
          id: 'm1l3q1',
          kind: 'choice',
          concept: 'execution',
          prompt: 'Which of these is the least suitable job for Python?',
          difficulty: 'beginner',
          options: [
            'A script that tidies up a folder of files every night',
            'Analysing a spreadsheet of sales figures',
            'The core of a game engine that must draw a frame every 16 milliseconds',
            'A program that fetches data from a website and saves it'
          ],
          answer: 2,
          explanation: 'The game engine. Everything else spends most of its time waiting on disks, networks or people, where Python being slower makes no practical difference. A hard timing budget is the case where it does.',
          hints: ['Which one has a deadline measured in milliseconds?']
        },
        {
          id: 'm1l3q2',
          kind: 'true-false',
          concept: 'execution',
          prompt: 'Because Python is slower than C, it is never used for large numerical work.',
          difficulty: 'intermediate',
          answer: false,
          explanation: 'False, and it is a common misunderstanding. Libraries like NumPy do the heavy work in C and give you Python to steer it with — so you get Python to write in and compiled speed where it counts.',
          hints: ['Think about what the numerical libraries are actually written in.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'm1l4',
      title: 'Your first Python program',
      intro: 'One function, and the first thing every programmer writes.',
      objectives: ['Write a program that prints something', 'Explain what the quotes and the brackets are each doing', 'Print several things on one line'],
      concepts: ['print', 'strings'],
      requires: ['execution'],
      minutes: 11,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Here is a complete Python program. Not a fragment — this is the whole thing.' },
        { kind: 'code', language: 'python', code: 'print("Hello, world!")', caption: 'Running this puts Hello, world! on the screen.' },
        { kind: 'heading', text: 'Taking it apart' },
        {
          kind: 'list',
          items: [
            'print is the name of something Python already knows how to do: show a value to whoever is running the program',
            'The round brackets () mean "do it", and whatever goes inside them is what you are doing it to',
            'The double quotes "" mark the start and end of a piece of text. Text in quotes is called a string'
          ]
        },
        { kind: 'text', text: 'The quotes are not part of the message. They are the fence that tells Python where the text begins and ends. Print the line above and you see Hello, world! with no quotes — they did their job and disappeared.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Leave off a closing quote or bracket and Python stops before running anything at all, with a SyntaxError. It is not being awkward — it genuinely cannot tell where your text was supposed to end.'
        },
        { kind: 'heading', text: 'More than one line' },
        { kind: 'code', language: 'python', code: 'print("Good morning.")\nprint("The kettle is on.")\nprint("Tea in three minutes.")', caption: 'Three statements, run in order, three lines of output.' },
        { kind: 'heading', text: 'Several things at once' },
        { kind: 'text', text: 'Give print more than one thing, separated by commas, and it puts them all on one line with a space between each.' },
        { kind: 'code', language: 'python', code: 'print("Tea is ready in", 3, "minutes")', caption: 'Prints: Tea is ready in 3 minutes' },
        { kind: 'text', text: 'Notice that 3 has no quotes. It is a number, not text, and print is perfectly happy with either. The space between each piece is added by print itself — you do not have to put it there.' },
        { kind: 'heading', text: "Single quotes work too" },
        { kind: 'code', language: 'python', code: "print('This works exactly the same')\nprint(\"She said 'hello' and left\")", caption: 'Either kind of quote. Using one lets you put the other inside.' },
        { kind: 'check', questionId: 'm1l4q1' },
        { kind: 'check', questionId: 'm1l4q2' }
      ],
      questions: [
        {
          id: 'm1l4q1',
          kind: 'choice',
          concept: 'print',
          prompt: 'What exactly does print("Hello") put on the screen?',
          difficulty: 'beginner',
          options: ['"Hello"', 'Hello', 'print("Hello")', 'Hello with the quotes shown only sometimes'],
          answer: 1,
          explanation: 'Just Hello. The quotes tell Python where the text starts and ends; they are not part of the text itself.',
          hints: ['Are the quotes part of the message, or are they marking the message?']
        },
        {
          id: 'm1l4q2',
          kind: 'short',
          concept: 'print',
          prompt: 'Write a line of Python that prints:  I am learning Python',
          difficulty: 'beginner',
          answer: 'print("I am learning Python")',
          accepts: ["print('I am learning Python')", 'print "I am learning Python"'],
          explanation: 'print("I am learning Python") — the name, the brackets, and the text fenced in quotes.',
          hints: ['Name, then brackets, then the text in quotes.']
        },
        {
          id: 'm1l4q3',
          kind: 'choice',
          concept: 'print',
          prompt: 'What does print("Score:", 10, "points") print?',
          difficulty: 'intermediate',
          options: ['Score:10points', 'Score: 10 points', '"Score:", 10, "points"', 'Score:, 10, points'],
          answer: 1,
          explanation: 'print puts a single space between each thing it is given, so you get: Score: 10 points. You did not have to add those spaces yourself.',
          hints: ['What does print do between each item separated by a comma?']
        },
        {
          id: 'm1l4q4',
          kind: 'choice',
          concept: 'errors',
          prompt: 'What happens if you run:  print("Hello)',
          difficulty: 'intermediate',
          options: [
            'It prints Hello',
            'It prints "Hello',
            'Nothing runs — Python reports a SyntaxError',
            'It prints an empty line'
          ],
          answer: 2,
          explanation: 'Nothing runs at all. The string was never closed, so Python cannot tell where it ends, and it refuses the whole file before executing a single line.',
          hints: ['Count the quotes.']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'm1l5',
      title: 'Reading code',
      intro: 'Working out what a program does by reading it — the skill you will use far more than writing.',
      objectives: ['Predict the output of a short program without running it', 'Explain why indentation is part of the meaning in Python'],
      concepts: ['reading-code'],
      requires: ['print'],
      minutes: 10,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Most of the time you spend around code is spent reading it — your own from last month, somebody else\'s, an example you found. Being able to look at a few lines and say what they will do, before running them, is the single most useful habit to build early.' },
        { kind: 'heading', text: 'Read it like the interpreter does' },
        { kind: 'text', text: 'Top to bottom, one line at a time, doing exactly what it says and nothing it does not. Say each line out loud if it helps. The temptation is to skim and assume; the whole skill is not assuming.' },
        { kind: 'code', language: 'python', code: 'print("One")\nprint("Two")\nprint("Three")', caption: 'What does this print, and in what order?' },
        { kind: 'text', text: 'One, then Two, then Three, on three separate lines. Obvious here — but the habit of actually walking through it is what saves you later when it is forty lines and not obvious at all.' },
        { kind: 'heading', text: 'Indentation means something' },
        { kind: 'text', text: 'In most languages, the spaces at the start of a line are decoration. In Python they are part of the grammar. Indenting a line says "this belongs inside the thing above it".' },
        { kind: 'code', language: 'python', code: 'print("This runs")\n    print("This is an error")', caption: 'The second line is indented for no reason, and Python rejects it.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'That gives you an IndentationError. Python is not being fussy — an indent is how you say something is inside something else, so an indent with nothing to be inside of is genuinely meaningless.'
        },
        { kind: 'text', text: 'You will use indentation properly from Module 3, when there is finally something to be inside. For now the rule is simply: start lines at the left-hand edge unless you have a reason not to.' },
        { kind: 'heading', text: 'Comments' },
        { kind: 'text', text: 'Anything after a # on a line is ignored completely. It is there for people.' },
        { kind: 'code', language: 'python', code: '# Greet whoever is running this\nprint("Hello!")  # this bit is ignored too', caption: 'The interpreter skips everything from the # to the end of the line.' },
        { kind: 'check', questionId: 'm1l5q1' }
      ],
      questions: [
        {
          id: 'm1l5q1',
          kind: 'choice',
          concept: 'reading-code',
          prompt: 'What does this print?\n\nprint("A")\n# print("B")\nprint("C")',
          difficulty: 'beginner',
          options: ['A, B and C', 'A and C', 'Only A', 'A, then an error'],
          answer: 1,
          explanation: 'A and C. The middle line starts with #, so the interpreter skips it entirely — it is a comment, not an instruction.',
          hints: ['What does Python do with a line that starts with #?']
        },
        {
          id: 'm1l5q2',
          kind: 'choice',
          concept: 'reading-code',
          prompt: 'Why does Python refuse this?\n\nprint("One")\n    print("Two")',
          difficulty: 'intermediate',
          options: [
            'The second line has a spelling mistake',
            'An indent says "this is inside something", and there is nothing for it to be inside',
            'You cannot have two print statements in a row',
            'The quotes are the wrong kind'
          ],
          answer: 1,
          explanation: 'In Python an indent means the line belongs inside the structure above it. There is no structure above it here, so the indent means nothing and Python says so with an IndentationError.',
          hints: ['What does an indented line mean in Python?']
        },
        {
          id: 'm1l5q3',
          kind: 'order',
          concept: 'reading-code',
          prompt: 'Put these in the order the output would appear:\n\nprint("Boil")\nprint("Pour")\nprint("Drink")',
          difficulty: 'beginner',
          options: ['Boil', 'Pour', 'Drink'],
          answer: [0, 1, 2],
          explanation: 'Exactly the order they are written in. The interpreter goes top to bottom, with nothing here telling it to do otherwise.',
          hints: ['There is nothing clever going on — which direction does the interpreter read?']
        }
      ]
    },

    // ------------------------------------------------------------------ 6
    {
      id: 'm1l6',
      title: 'When things go wrong',
      intro: 'Three kinds of error, how each announces itself, and why the third is the one to fear.',
      objectives: ['Tell syntax, runtime and logic errors apart', 'Read a Python error message and find the useful part'],
      concepts: ['errors'],
      requires: ['execution', 'print'],
      minutes: 11,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Your programs will be wrong constantly. Everybody\'s are. What separates people who find programming bearable from people who do not is knowing which kind of wrong they are looking at.' },
        { kind: 'heading', text: '1. Syntax errors — it is not valid Python' },
        { kind: 'text', text: 'You wrote something that is not a sentence in the language. A missing bracket, a missing quote, a colon where there should not be one. Python notices before running anything.' },
        { kind: 'code', language: 'python', code: 'print("Hello"\n# SyntaxError: the bracket was never closed', caption: 'Nothing runs at all. Not one line.' },
        { kind: 'callout', tone: 'tip', text: 'These are the friendliest errors you will get. The program has not done anything yet, so nothing is half-done, and the message points at roughly the right line.' },
        { kind: 'heading', text: '2. Runtime errors — valid Python, impossible to do' },
        { kind: 'text', text: 'The code is proper Python, so it starts running, and then hits something it cannot carry out.' },
        { kind: 'code', language: 'python', code: 'print("Starting")\nprint(10 / 0)\nprint("Never reached")\n\n# Starting\n# ZeroDivisionError: division by zero', caption: 'The first line ran. The second could not. The third never happened.' },
        { kind: 'text', text: 'Note what that output tells you: "Starting" appeared, so everything up to there was fine. The output you got before the crash is evidence, and it is usually the fastest way to find where to look.' },
        { kind: 'heading', text: '3. Logic errors — it runs perfectly and gives the wrong answer' },
        { kind: 'text', text: 'No error message. No crash. The program does exactly what you told it, and what you told it was wrong.' },
        { kind: 'code', language: 'python', code: '# Meant to print the average of 10 and 20\nprint(10 + 20 / 2)   # prints 20.0\nprint((10 + 20) / 2)  # prints 15.0 — what was actually wanted', caption: 'Both lines run. Only one is right.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'This is the kind to be wary of. The other two stop you. This one lets you carry on and ship something that quietly gives wrong answers — which is why checking the output against what you expected matters as much as getting it to run.'
        },
        { kind: 'heading', text: 'Reading the message' },
        { kind: 'text', text: 'Python error messages look dense. Two parts matter: the last line, which names what went wrong, and the line number just above it, which says where. Read those two first and the rest usually becomes unnecessary.' },
        { kind: 'check', questionId: 'm1l6q1' },
        { kind: 'check', questionId: 'm1l6q2' }
      ],
      questions: [
        {
          id: 'm1l6q1',
          kind: 'choice',
          concept: 'errors',
          prompt: 'A program runs to the end with no error, but the total it prints is twice what it should be. What kind of error is this?',
          difficulty: 'beginner',
          options: ['A syntax error', 'A runtime error', 'A logic error', 'Not an error, since it ran'],
          answer: 2,
          explanation: 'A logic error. The code is valid and it ran happily — it simply does the wrong thing. These are the ones no error message will ever find for you.',
          hints: ['Did Python complain? Was the answer right?']
        },
        {
          id: 'm1l6q2',
          kind: 'choice',
          concept: 'errors',
          prompt: 'A program prints two lines, then stops with an error. What does that tell you about where the problem is?',
          difficulty: 'intermediate',
          options: [
            'The problem is on the first line',
            'The problem is after whatever produced the second line of output',
            'The whole program is invalid',
            'Nothing — the output is unrelated to the error'
          ],
          answer: 1,
          explanation: 'Everything that produced output already ran successfully. The problem is after that point. The output before a crash is the cheapest debugging evidence you get.',
          hints: ['If two lines printed, did the code that printed them work?']
        },
        {
          id: 'm1l6q3',
          kind: 'multi',
          concept: 'errors',
          prompt: 'Which of these would be found before the program runs at all? (Choose all that apply.)',
          difficulty: 'intermediate',
          options: [
            'A missing closing bracket',
            'Dividing by a number that turns out to be zero',
            'An unclosed string quote',
            'Adding instead of subtracting'
          ],
          answer: [0, 2],
          explanation: 'Missing brackets and unclosed quotes are syntax errors — Python checks the shape of your code before running it. Dividing by zero only shows up when it happens, and using the wrong operator never shows up at all.',
          hints: ['Which of these make the code not valid Python, as opposed to merely wrong?']
        }
      ]
    },

    // ------------------------------------------------------------------ 7
    {
      id: 'm1l7',
      title: 'Thinking like a programmer',
      intro: 'The habit underneath everything else: taking something too big to solve and breaking it into pieces that are not.',
      objectives: ['Break a problem into steps', 'Write pseudocode before writing Python', 'Identify the inputs, processing and outputs of a problem'],
      concepts: ['algorithms', 'decomposition'],
      requires: ['programming'],
      minutes: 13,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Beginners get stuck because they try to go from a problem straight to Python. Experienced programmers almost never do that. They work out the steps first, in plain language, where mistakes are free.' },
        { kind: 'heading', text: 'Decomposition' },
        { kind: 'text', text: '"Build a program that marks a quiz" is too big to start typing. Break it up:' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Get the answers somebody gave',
            'Get the correct answers',
            'Compare them one at a time, counting the matches',
            'Turn the count into a percentage',
            'Decide whether that is a pass',
            'Show the result'
          ]
        },
        { kind: 'text', text: 'Every one of those is small enough to write. None of them is frightening. That is the whole technique — and it does not stop being the technique when the problems get bigger.' },
        { kind: 'heading', text: 'Pseudocode' },
        { kind: 'text', text: 'Pseudocode is the steps written in a way that is structured like code but is not any particular language. It costs nothing to change.' },
        {
          kind: 'example',
          title: 'Marking a quiz, in pseudocode',
          text: 'set score to 0\nfor each question:\n    if the given answer matches the correct answer:\n        add 1 to score\nset percentage to score / number of questions * 100\nif percentage is at least 80:\n    say "passed"\notherwise:\n    say "not yet"'
        },
        { kind: 'text', text: 'None of that is Python. All of it is the program. Getting this right on paper is most of the work; translating it afterwards is comparatively mechanical.' },
        { kind: 'heading', text: 'Inputs, processing, outputs' },
        { kind: 'text', text: 'Before writing anything, answer three questions. What does this need to be given? What does it have to work out? What should come out of it?' },
        {
          kind: 'table',
          headers: ['Problem', 'Input', 'Processing', 'Output'],
          rows: [
            ['Mark a quiz', 'Given answers, correct answers', 'Compare, count, convert to a percentage', 'Score and pass/fail'],
            ['Convert currency', 'Amount, exchange rate', 'Multiply', 'Converted amount'],
            ['Find the longest word', 'A sentence', 'Split into words, compare lengths', 'The longest word']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'When you are stuck on a problem, you are usually stuck on one of those three. Nine times out of ten it is that you have not decided precisely what the output should be.'
        },
        { kind: 'check', questionId: 'm1l7q1' }
      ],
      questions: [
        {
          id: 'm1l7q1',
          kind: 'choice',
          concept: 'decomposition',
          prompt: 'You have to write a program that finds the most common word in a paragraph. What is the sensible first move?',
          difficulty: 'beginner',
          options: [
            'Start typing Python and see what happens',
            'Break it into steps in plain language: split into words, count each one, find the biggest count',
            'Search for someone else\'s finished program',
            'Decide which Python features you will use'
          ],
          answer: 1,
          explanation: 'Steps first, in language, where changing your mind is free. Which Python features you need becomes obvious once the steps exist — and is almost impossible to decide before.',
          hints: ['What do experienced programmers do before they open the editor?']
        },
        {
          id: 'm1l7q2',
          kind: 'short',
          concept: 'algorithms',
          prompt: 'For "convert a temperature from Celsius to Fahrenheit", what is the input?',
          difficulty: 'beginner',
          answer: 'the temperature in celsius',
          accepts: ['celsius', 'a celsius temperature', 'temperature in c', 'the celsius value'],
          explanation: 'The Celsius temperature. The processing is the formula, and the output is the Fahrenheit value.',
          hints: ['What does the program have to be given before it can do anything?']
        },
        {
          id: 'm1l7q3',
          kind: 'choice',
          concept: 'decomposition',
          prompt: 'Why write pseudocode rather than going straight to Python?',
          difficulty: 'intermediate',
          options: [
            'Because Python is too difficult to write directly',
            'Because changing your mind in plain language is free, and changing it in code is not',
            'Because pseudocode runs faster',
            'Because it is required before Python will run'
          ],
          answer: 1,
          explanation: 'It separates deciding what to do from working out how to say it. Getting the plan wrong on paper costs a line; getting it wrong after two hundred lines of Python costs the afternoon.',
          hints: ['Which is cheaper to rewrite?']
        }
      ]
    },

    // ------------------------------------------------------------------ 8
    {
      id: 'm1l8',
      title: 'Foundations challenge',
      intro: 'No new material. Several problems that need what this module covered, put together.',
      objectives: ['Apply everything from this module without being told which part to use'],
      concepts: ['programming', 'execution', 'print', 'reading-code', 'errors', 'algorithms'],
      requires: ['algorithms', 'errors', 'reading-code'],
      minutes: 14,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'Work through these without looking back unless you are genuinely stuck. Being stuck and then finding the answer is how it sticks; being told immediately is not.' },
        { kind: 'callout', tone: 'note', text: 'Orion is available on every lesson. Ask for a hint rather than the answer — the hint is what does you good.' },
        { kind: 'check', questionId: 'm1c1' },
        { kind: 'check', questionId: 'm1c2' },
        { kind: 'check', questionId: 'm1c3' },
        { kind: 'check', questionId: 'm1c4' },
        { kind: 'check', questionId: 'm1c5' }
      ],
      questions: [
        {
          id: 'm1c1',
          kind: 'choice',
          concept: 'reading-code',
          prompt: 'What is the complete output?\n\nprint("Start")\n# print("Middle")\nprint("End", "of", "program")',
          difficulty: 'intermediate',
          options: ['Start / Middle / End of program', 'Start / End of program', 'Start / End,of,program', 'Start / Endofprogram'],
          answer: 1,
          explanation: 'Two lines: "Start", then "End of program". The middle line is a comment and is skipped, and print puts single spaces between the three items it was given.',
          hints: ['Deal with the comment first, then with what the commas do.']
        },
        {
          id: 'm1c2',
          kind: 'choice',
          concept: 'errors',
          prompt: 'Which of these is a logic error?',
          difficulty: 'intermediate',
          options: [
            'print("Hello"  — a missing bracket',
            'print(5 / 0)  — dividing by zero',
            'Writing a program meant to find the largest number that always returns the first one',
            'print(Hello)  — a name that does not exist'
          ],
          answer: 2,
          explanation: 'Only the third runs happily and gives the wrong answer. The first is a syntax error, the second and fourth are runtime errors — all three stop you, which is why they are the easy ones.',
          hints: ['Which one would Python never complain about?']
        },
        {
          id: 'm1c3',
          kind: 'short',
          concept: 'print',
          prompt: 'Write one line of Python that prints:  Total: 42 items',
          difficulty: 'intermediate',
          answer: 'print("Total:", 42, "items")',
          accepts: ['print("Total: 42 items")', "print('Total:', 42, 'items')", "print('Total: 42 items')"],
          explanation: 'Either print("Total: 42 items") as one string, or print("Total:", 42, "items") letting print add the spaces. Both are correct.',
          hints: ['You can do this with one string, or with three things and commas.']
        },
        {
          id: 'm1c4',
          kind: 'multi',
          concept: 'algorithms',
          prompt: 'A program takes a shopping list and prints the total cost. Which of these are part of the processing, rather than input or output? (Choose all that apply.)',
          difficulty: 'intermediate',
          options: [
            'Reading the list of items and prices',
            'Adding each price to a running total',
            'Applying a discount if the total is over £50',
            'Showing the final amount on screen'
          ],
          answer: [1, 2],
          explanation: 'Adding up and applying the discount are the processing. Reading the list is input, showing the amount is output. Being able to sort a problem into those three is most of being able to start it.',
          hints: ['Which of these turn what came in into what goes out?']
        },
        {
          id: 'm1c5',
          kind: 'short',
          concept: 'decomposition',
          prompt: 'In pseudocode, write the steps to find the largest of three numbers. (Plain language is fine — no Python needed.)',
          difficulty: 'advanced',
          answer: 'compare the first two, keep the larger, compare that with the third, keep the larger, show it',
          accepts: ['compare them and keep the biggest', 'set largest to first then compare each', 'take the first as largest, compare with each other one'],
          explanation: 'A standard shape: hold a "largest so far", compare it with each remaining number, replace it when you find something bigger, and show it at the end. That same pattern works for three numbers or three million.',
          hints: ['Hold on to a "biggest so far" and compare the others against it.']
        }
      ]
    }
  ]
}
