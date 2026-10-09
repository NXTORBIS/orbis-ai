import type { Module } from '../../types.ts'

/**
 * Module 5 — Functions and Program Design.
 *
 * The module that separates someone who can write code from someone who can build something. The single most
 * important distinction in it is return versus print, and it gets a lesson of its own because almost everybody
 * conflates them once and then cannot work out why their code does nothing.
 */
export const MODULE_5: Module = {
  id: 'm5',
  title: 'Functions and Program Design',
  summary: 'Writing your own functions, handing values in and out, where names live, and how to shape a program out of them.',
  concepts: ['functions', 'parameters', 'return', 'default-args', 'scope', 'function-design', 'lambda', 'recursion'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'm5l1',
      title: 'Writing a function',
      intro: 'Giving a piece of work a name so it can be done again without being written again.',
      objectives: ['Define and call a function', 'Explain why defining one runs nothing', 'Say what problem functions solve'],
      concepts: ['functions'],
      requires: ['conditions', 'for-loops'],
      minutes: 12,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'def greet():\n    print("Hello!")\n    print("Welcome.")\n\ngreet()\ngreet()', caption: 'Defined once, called twice. Four lines of output.' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'def says a function is being defined',
            'The name follows the same rules as a variable name',
            'Round brackets — empty here, because this one needs nothing handed to it',
            'A colon, then an indented block: the body'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Defining a function runs nothing. def only records what the name means. Nothing happens until you call it with greet(), and a function you defined but never called is the quietest bug there is — no error, no output.'
        },
        { kind: 'heading', text: 'Why bother' },
        { kind: 'text', text: 'Three reasons, in order of how much they matter as a program grows:' },
        {
          kind: 'list',
          items: [
            'The same work is not written twice, so a fix happens in one place',
            'A name explains what a block does, so the code that calls it reads like a description',
            'A small piece can be understood and checked on its own'
          ]
        },
        { kind: 'example', title: 'Before and after', text: 'Before — the same five lines of validation pasted three times, and a bug in it fixed twice and forgotten once.\n\nAfter — is_valid(entry), called three times. One place to fix, and the calling code says what it means.' },
        { kind: 'heading', text: 'Order matters' },
        { kind: 'code', language: 'python', code: 'greet()      # NameError — not defined yet\n\ndef greet():\n    print("Hi")', caption: 'The interpreter works top to bottom, as Module 1 said. Define before you call.' },
        { kind: 'check', questionId: 'm5l1q1' },
        { kind: 'check', questionId: 'm5l1q2' }
      ],
      questions: [
        {
          id: 'm5l1q1',
          kind: 'choice',
          concept: 'functions',
          prompt: 'What does this print?\n\ndef hello():\n    print("hi")',
          difficulty: 'beginner',
          options: ['hi', 'Nothing', 'An error', 'hello'],
          answer: 1,
          explanation: 'Nothing. The function is defined but never called. def records what the name means; only hello() makes it happen.',
          hints: ['Is the function ever called?']
        },
        {
          id: 'm5l1q2',
          kind: 'choice',
          concept: 'functions',
          prompt: 'What is the main reason to put repeated code in a function?',
          difficulty: 'beginner',
          options: [
            'It makes the program run faster',
            'A change or a fix then happens in one place instead of several',
            'Python requires it past a certain length',
            'It uses less memory'
          ],
          answer: 1,
          explanation: 'One place to change. Duplicated code is duplicated bugs, and the copy you forget is the one that breaks.',
          hints: ['What goes wrong when the same lines exist in five places?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'm5l2',
      title: 'Parameters',
      intro: 'Handing values in, so one function can do its job on anything.',
      objectives: ['Write a function with parameters', 'Call it positionally and by name', 'Explain the difference between a parameter and an argument'],
      concepts: ['parameters'],
      requires: ['functions'],
      minutes: 12,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'def greet(name):\n    print(f"Hello, {name}!")\n\ngreet("Sam")\ngreet("Bea")', caption: 'name is a parameter. "Sam" is an argument.' },
        { kind: 'text', text: 'The parameter is the name in the definition; the argument is the value you pass when calling. Inside the body the parameter behaves like an ordinary variable that already has a value.' },
        { kind: 'heading', text: 'Several' },
        { kind: 'code', language: 'python', code: 'def introduce(name, age, city):\n    print(f"{name} is {age} and lives in {city}")\n\nintroduce("Sam", 19, "Leeds")\nintroduce(city="York", name="Bea", age=22)   # by name, any order', caption: 'Positional arguments go in order; named ones do not have to.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Positional arguments go in the order the parameters were written. introduce(19, "Sam", "Leeds") does not fail — it prints "19 is Sam and lives in Leeds". A perfectly running, perfectly wrong program.'
        },
        { kind: 'text', text: 'Which is the argument for naming them when there are more than two or three, or when the values are all the same type and nothing on the call line tells you which is which.' },
        { kind: 'heading', text: 'The wrong number' },
        { kind: 'code', language: 'python', code: 'def greet(name):\n    print(name)\n\ngreet()\n# TypeError: greet() missing 1 required positional argument: \'name\'', caption: 'Python counts, and says exactly what is missing.' },
        { kind: 'heading', text: 'A real one' },
        { kind: 'code', language: 'python', code: 'def area(width, height):\n    print(f"Area: {width * height}")\n\narea(3, 4)      # Area: 12\narea(10, 2.5)   # Area: 25.0', caption: 'One function, any rectangle. That is the whole point of a parameter.' },
        { kind: 'check', questionId: 'm5l2q1' },
        { kind: 'check', questionId: 'm5l2q2' }
      ],
      questions: [
        {
          id: 'm5l2q1',
          kind: 'choice',
          concept: 'parameters',
          prompt: 'What does this print?\n\ndef show(a, b):\n    print(a, b)\n\nshow(b=1, a=2)',
          difficulty: 'intermediate',
          options: ['1 2', '2 1', 'An error', '2 2'],
          answer: 1,
          explanation: '2 1. Named arguments are matched by name, not by position, so a is 2 and b is 1 whatever order they are written in.',
          hints: ['Which value went into which name?']
        },
        {
          id: 'm5l2q2',
          kind: 'choice',
          concept: 'parameters',
          prompt: 'Why is  area(10, 3)  risky when the definition is  def area(height, width) ?',
          difficulty: 'intermediate',
          options: [
            'It will crash',
            'Nothing on the call line says which number is which, so a swap runs fine and gives the wrong meaning',
            'Numbers cannot be passed positionally',
            'It needs brackets round the arguments'
          ],
          answer: 1,
          explanation: 'Nothing tells you which is which. For a rectangle the area happens to be the same either way, but with a function where it matters the swap runs happily and is wrong. area(height=10, width=3) cannot be misread.',
          hints: ['Would Python notice the swap?']
        },
        {
          id: 'm5l2q3',
          kind: 'short',
          concept: 'parameters',
          prompt: 'What is the difference between a parameter and an argument?',
          difficulty: 'intermediate',
          answer: 'a parameter is the name in the definition, an argument is the value passed in',
          accepts: ['parameter is in the definition, argument is the value', 'the name versus the value'],
          explanation: 'A parameter is the name in the definition. An argument is the actual value handed over at the call.',
          hints: ['One lives in the def line, the other at the call.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'm5l3',
      title: 'return',
      intro: 'Handing an answer back — and why that is not the same as printing it. The most important lesson in the module.',
      objectives: ['Write a function that returns a value', 'Explain the difference between return and print', 'Use a returned value in a calculation'],
      concepts: ['return'],
      requires: ['parameters'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'def add(a, b):\n    return a + b\n\nresult = add(3, 4)\nprint(result)        # 7\nprint(add(1, 2) * 10)  # 30 — the value can be used in a sum', caption: 'return hands a value back to whoever called the function.' },
        { kind: 'heading', text: 'The difference, stated plainly' },
        {
          kind: 'table',
          headers: ['', 'print', 'return'],
          rows: [
            ['Who it is for', 'A person reading the screen', 'The rest of the program'],
            ['Can you store it?', 'No', 'Yes'],
            ['Can you calculate with it?', 'No', 'Yes'],
            ['Ends the function?', 'No', 'Yes, immediately']
          ]
        },
        { kind: 'code', language: 'python', code: 'def add_printing(a, b):\n    print(a + b)\n\ndef add_returning(a, b):\n    return a + b\n\nx = add_printing(3, 4)   # shows 7, and x is None\ny = add_returning(3, 4)  # shows nothing, and y is 7\n\nprint(x)   # None\nprint(y)   # 7', caption: 'Both appear to work until you try to use the answer.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'A function with no return gives back None. That is why "my function works but the variable is empty" is such a common confusion: the printing happened, and nothing was handed back.'
        },
        { kind: 'heading', text: 'return ends it' },
        { kind: 'code', language: 'python', code: 'def check(n):\n    if n < 0:\n        return "negative"\n    if n == 0:\n        return "zero"\n    return "positive"\n\nprint(check(-5))   # negative', caption: 'Nothing after the first matching return runs, so no else is needed.' },
        { kind: 'text', text: 'That shape — return early for the special cases, then the ordinary case at the bottom — is extremely common and usually reads better than a nested if/elif chain.' },
        { kind: 'heading', text: 'Returning more than one thing' },
        { kind: 'code', language: 'python', code: 'def stats(numbers):\n    return min(numbers), max(numbers), sum(numbers) / len(numbers)\n\nlowest, highest, average = stats([4, 8, 15])\nprint(f"{lowest} to {highest}, average {average:.1f}")', caption: 'It is really one tuple, unpacked at the call — which is why Module 4 covered unpacking.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'As a rule: let functions return, and let the code that called them decide whether to print. A function that prints can only ever be used for printing; a function that returns can be used for anything, printing included.'
        },
        { kind: 'check', questionId: 'm5l3q1' },
        { kind: 'check', questionId: 'm5l3q2' },
        { kind: 'check', questionId: 'm5l3q3' }
      ],
      questions: [
        {
          id: 'm5l3q1',
          kind: 'choice',
          concept: 'return',
          prompt: 'What does this print?\n\ndef double(n):\n    print(n * 2)\n\nx = double(5)\nprint(x)',
          difficulty: 'intermediate',
          options: ['10 then 10', '10 then None', 'None then 10', '10'],
          answer: 1,
          explanation: '10, then None. The function prints 10 but returns nothing, so x is None. Changing print to return makes x be 10 — and then nothing prints until you print it.',
          hints: ['What does a function without a return hand back?']
        },
        {
          id: 'm5l3q2',
          kind: 'choice',
          concept: 'return',
          prompt: 'What does this return for n = 5?\n\ndef f(n):\n    if n > 0:\n        return "positive"\n    return "not positive"\n    return "never"',
          difficulty: 'intermediate',
          options: ['positive', 'not positive', 'never', 'All three'],
          answer: 0,
          explanation: 'positive. A return ends the function immediately, so nothing below the one that runs is ever reached — the last line is dead code.',
          hints: ['What does return do to the rest of the function?']
        },
        {
          id: 'm5l3q3',
          kind: 'short',
          concept: 'return',
          prompt: 'In one sentence: why should a function usually return rather than print?',
          difficulty: 'advanced',
          answer: 'a returned value can be used by the rest of the program, a printed one cannot',
          accepts: ['so the value can be reused', 'printing only shows it, returning gives it back', 'you can store or calculate with a returned value'],
          explanation: 'A returned value can be stored, calculated with, passed on or printed. A printed one has already been spent — and the caller gets None.',
          hints: ['Which of the two leaves you with something to use?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'm5l4',
      title: 'Default values',
      intro: 'Parameters that need not be given — and the default that catches everybody.',
      objectives: ['Give a parameter a default', 'Explain why defaults go last', 'Avoid the mutable default trap'],
      concepts: ['default-args'],
      requires: ['parameters'],
      minutes: 11,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'def greet(name, greeting="Hello"):\n    print(f"{greeting}, {name}!")\n\ngreet("Sam")                      # Hello, Sam!\ngreet("Bea", "Good morning")      # Good morning, Bea!\ngreet("Cal", greeting="Oi")       # Oi, Cal!', caption: 'A default makes a parameter optional.' },
        { kind: 'text', text: 'This is how one function serves the common case cheaply and the unusual case fully. Most calls say nothing about greeting; the one that cares, says so.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Parameters with defaults must come after those without. def f(a="x", b) is a SyntaxError — Python would have no way to work out what a single positional argument meant.'
        },
        { kind: 'code', language: 'python', code: 'def area(width, height=None):\n    if height is None:\n        height = width      # a square\n    return width * height\n\nprint(area(4))      # 16\nprint(area(4, 3))   # 12', caption: 'None as a default is the usual way to say "work it out if not told".' },
        { kind: 'heading', text: 'The trap' },
        { kind: 'code', language: 'python', code: 'def add_item(item, basket=[]):   # do not do this\n    basket.append(item)\n    return basket\n\nprint(add_item("tea"))    # [\'tea\']\nprint(add_item("milk"))   # [\'tea\', \'milk\']  — the same list again!', caption: 'The default list is created once, when the function is defined, and then shared by every call.' },
        { kind: 'code', language: 'python', code: 'def add_item(item, basket=None):\n    if basket is None:\n        basket = []\n    basket.append(item)\n    return basket', caption: 'The fix: default to None and make a fresh list inside.' },
        { kind: 'text', text: 'This bites everybody once. The rule is simple — never use a list, dictionary or set as a default value. Use None and create it in the body.' },
        { kind: 'check', questionId: 'm5l4q1' }
      ],
      questions: [
        {
          id: 'm5l4q1',
          kind: 'choice',
          concept: 'default-args',
          prompt: 'Why is  def f(x, items=[])  a problem?',
          difficulty: 'advanced',
          options: [
            'Lists cannot be parameters',
            'The list is made once at definition and shared between every call, so it keeps what earlier calls put in it',
            'It is slower',
            'It needs to be a tuple'
          ],
          answer: 1,
          explanation: 'The default is created once, when the def runs, and every call that does not supply one gets that same list. Default to None and create a fresh list inside.',
          hints: ['How many times is that empty list actually created?']
        },
        {
          id: 'm5l4q2',
          kind: 'choice',
          concept: 'default-args',
          prompt: 'Which definition is valid?',
          difficulty: 'intermediate',
          options: ['def f(a=1, b):', 'def f(a, b=1):', 'def f(a=1, b, c=2):', 'All of them'],
          answer: 1,
          explanation: 'Only def f(a, b=1). Parameters with defaults have to come last, otherwise a single positional argument would be ambiguous.',
          hints: ['Where must the defaults sit?']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'm5l5',
      title: 'Where names live',
      intro: 'Scope: why a variable made inside a function disappears, and why that is a good thing.',
      objectives: ['Explain local and global scope', 'Predict a NameError from scope', 'Say why changing globals inside a function is avoided'],
      concepts: ['scope'],
      requires: ['functions'],
      minutes: 12,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'def calculate():\n    total = 100\n    print(total)\n\ncalculate()\nprint(total)\n# NameError: name \'total\' is not defined', caption: 'total exists only while the function is running.' },
        { kind: 'text', text: 'A name created inside a function is local to that call. When the call ends it is gone. That is deliberate and it is what makes functions safe to use: a function cannot accidentally stamp on a variable somewhere else in your program.' },
        { kind: 'heading', text: 'Reading out is allowed' },
        { kind: 'code', language: 'python', code: 'tax_rate = 0.2         # global\n\ndef with_tax(price):\n    return price * (1 + tax_rate)   # reading is fine\n\nprint(with_tax(100))   # 120.0' },
        { kind: 'heading', text: 'Writing is not — and quietly so' },
        { kind: 'code', language: 'python', code: 'count = 0\n\ndef increase():\n    count = count + 1    # UnboundLocalError\n\nincrease()', caption: 'Assigning to count makes it local, so reading it on the right-hand side has nothing to read.' },
        { kind: 'text', text: 'Python decides a name is local the moment the function assigns to it anywhere — so `count` on the right is the local one, which has no value yet. `global count` would allow it, and you should almost never do that.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Instead of reaching out to a global, hand the value in and return the new one: def increase(count): return count + 1. Now the function can be read on its own, tested on its own, and cannot surprise anything else.'
        },
        { kind: 'heading', text: 'Same name, different places' },
        { kind: 'code', language: 'python', code: 'name = "global Sam"\n\ndef show():\n    name = "local Bea"\n    print(name)   # local Bea\n\nshow()\nprint(name)       # global Sam — untouched', caption: 'Two entirely separate variables that happen to share a name.' },
        { kind: 'check', questionId: 'm5l5q1' },
        { kind: 'check', questionId: 'm5l5q2' }
      ],
      questions: [
        {
          id: 'm5l5q1',
          kind: 'choice',
          concept: 'scope',
          prompt: 'What happens here?\n\ndef f():\n    x = 10\n\nf()\nprint(x)',
          difficulty: 'intermediate',
          options: ['It prints 10', 'It prints None', 'A NameError — x only existed inside f', 'It prints 0'],
          answer: 2,
          explanation: 'A NameError. x was local to the call and disappeared when the call finished. To get it out, return it.',
          hints: ['How long does a variable made inside a function last?']
        },
        {
          id: 'm5l5q2',
          kind: 'choice',
          concept: 'scope',
          prompt: 'Why is passing a value in and returning the result better than changing a global?',
          difficulty: 'advanced',
          options: [
            'It is faster',
            'The function can be read, tested and reused on its own, and cannot surprise the rest of the program',
            'Globals are not allowed in Python',
            'It uses less memory'
          ],
          answer: 1,
          explanation: 'Everything a function depends on comes in through its parameters and everything it produces goes out through its return. That makes it understandable alone, which is exactly what makes a large program manageable.',
          hints: ['What goes wrong when any function can change any variable?']
        },
        {
          id: 'm5l5q3',
          kind: 'true-false',
          concept: 'scope',
          prompt: 'A function can read a global variable without declaring anything.',
          difficulty: 'intermediate',
          answer: true,
          explanation: 'True — reading is allowed. Assigning to it is what makes the name local and causes the trouble.',
          hints: ['Reading and writing behave differently here.']
        }
      ]
    },

    // ------------------------------------------------------------------ 6
    {
      id: 'm5l6',
      title: 'Designing with functions',
      intro: 'How to split a program up: one job each, a good name, and a main() at the bottom.',
      objectives: ['Split a task into well-named functions', 'Judge whether a function does too much', 'Structure a program around main()'],
      concepts: ['function-design'],
      requires: ['return', 'scope'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'Functions are a tool for thinking, not just for avoiding repetition. The decomposition from Module 1 becomes real here: each step of the plan becomes a function.' },
        { kind: 'heading', text: 'One job each' },
        { kind: 'example', title: 'Too much', text: 'def process():\n    reads the file, cleans the data, works out averages, prints a report\n\nFour jobs in one name. It cannot be tested in parts, it cannot be reused in parts, and when the averages are wrong you read all forty lines to find out why.' },
        { kind: 'code', language: 'python', code: 'def read_scores(path): ...\ndef clean(rows): ...\ndef average(scores): ...\ndef report(summary): ...\n\ndef main():\n    rows = read_scores("scores.txt")\n    scores = clean(rows)\n    print(report(average(scores)))\n\nmain()', caption: 'Each name says one thing, and main() reads like the plan.' },
        { kind: 'heading', text: 'Names' },
        {
          kind: 'list',
          items: [
            'A verb for something that does: read_scores, send_email, validate',
            'is_ or has_ for something that answers yes or no: is_valid, has_access',
            'get_ or a noun for something that fetches: get_user, average',
            'Never do_stuff, process, handle, or anything you cannot picture'
          ]
        },
        { kind: 'heading', text: 'Four signs a function is doing too much' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'You cannot name it without using "and"',
            'It is longer than roughly one screen',
            'It takes six or seven parameters',
            'Explaining it takes several sentences'
          ]
        },
        { kind: 'heading', text: 'Keep the printing at the edges' },
        { kind: 'code', language: 'python', code: '# Harder to use and impossible to test:\ndef average_and_print(scores):\n    print(f"Average: {sum(scores) / len(scores):.1f}")\n\n# Reusable, and checkable with one comparison:\ndef average(scores):\n    return sum(scores) / len(scores)\n\nprint(f"Average: {average(scores):.1f}")', caption: 'Calculation in the middle, input and output at the edges.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That split — pure calculation inside, talking to the screen and the disk at the outside — is the single habit that most improves a program. It is also what makes Module 8\'s testing possible at all.'
        },
        { kind: 'heading', text: 'Saying what a function does' },
        { kind: 'code', language: 'python', code: 'def average(scores):\n    """Return the mean of a list of numbers.\n\n    Raises ZeroDivisionError on an empty list.\n    """\n    return sum(scores) / len(scores)', caption: 'A docstring — triple-quoted text as the first thing in the body.' },
        { kind: 'check', questionId: 'm5l6q1' },
        { kind: 'check', questionId: 'm5l6q2' }
      ],
      questions: [
        {
          id: 'm5l6q1',
          kind: 'choice',
          concept: 'function-design',
          prompt: 'Which is the clearest sign a function should be split up?',
          difficulty: 'intermediate',
          options: [
            'It has more than three lines',
            'You cannot name it without using the word "and"',
            'It returns a value',
            'It takes a parameter'
          ],
          answer: 1,
          explanation: 'Needing "and" in the name means it has more than one job. It is the quickest test there is, and it is nearly always right.',
          hints: ['Think about what the name is telling you.']
        },
        {
          id: 'm5l6q2',
          kind: 'choice',
          concept: 'function-design',
          prompt: 'Why keep calculation separate from printing?',
          difficulty: 'advanced',
          options: [
            'It runs faster',
            'The calculation can then be reused and checked, while a function that prints can only ever print',
            'Python requires it',
            'Printing is slow'
          ],
          answer: 1,
          explanation: 'A function that returns a number can be used anywhere and checked with one comparison. One that prints it has spent the value and can only be verified by reading the screen.',
          hints: ['Which version can be tested?']
        },
        {
          id: 'm5l6q3',
          kind: 'short',
          concept: 'function-design',
          prompt: 'Give a better name than  process()  for a function that works out the total of a basket.',
          difficulty: 'intermediate',
          answer: 'basket_total',
          accepts: ['total_price', 'calculate_total', 'get_total', 'basket_total()', 'total'],
          explanation: 'Anything that says what comes back: basket_total, calculate_total, total_price. The reader should not have to open it.',
          hints: ['Name it after what it hands back.']
        }
      ]
    },

    // ------------------------------------------------------------------ 7
    {
      id: 'm5l7',
      title: 'lambda',
      intro: 'A function small enough to write where it is used. Useful in exactly one situation.',
      objectives: ['Read a lambda', 'Use one as a sort key', 'Say when a named function is better'],
      concepts: ['lambda'],
      requires: ['functions'],
      minutes: 9,
      difficulty: 'advanced',
      required: false,
      blocks: [
        { kind: 'text', text: 'A lambda is a one-expression function with no name. It exists because sometimes passing a whole def somewhere is more ceremony than the job deserves.' },
        { kind: 'code', language: 'python', code: 'def double(n):\n    return n * 2\n\ndouble = lambda n: n * 2    # the same thing, and not how it should be used', caption: 'If you are giving it a name, write a def.' },
        { kind: 'heading', text: 'Where it genuinely belongs' },
        { kind: 'code', language: 'python', code: 'people = [{"name": "Ali", "age": 30}, {"name": "Bea", "age": 25}]\n\npeople.sort(key=lambda p: p["age"])\nprint([p["name"] for p in people])      # [\'Bea\', \'Ali\']\n\nwords = ["ccc", "a", "bb"]\nprint(sorted(words, key=lambda w: len(w)))', caption: 'Sorting by something other than the value itself. This is the main use.' },
        { kind: 'text', text: 'That is the `key=lambda pair: pair[1]` from Module 4, now explained: a tiny function handed to sorted, saying what to compare.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Use a lambda only for a short expression passed straight to something else. Anything with a condition, a loop or more than one idea in it should be a named def — the name is free documentation.'
        },
        { kind: 'check', questionId: 'm5l7q1' }
      ],
      questions: [
        {
          id: 'm5l7q1',
          kind: 'choice',
          concept: 'lambda',
          prompt: 'What does  sorted([(1, "b"), (2, "a")], key=lambda t: t[1])  give?',
          difficulty: 'advanced',
          options: ['[(1, "b"), (2, "a")]', '[(2, "a"), (1, "b")]', '["a", "b"]', 'An error'],
          answer: 1,
          explanation: '[(2, "a"), (1, "b")]. The key says to compare the second part of each tuple, so "a" sorts before "b".',
          hints: ['What is at position 1 of each tuple?']
        },
        {
          id: 'm5l7q2',
          kind: 'choice',
          concept: 'lambda',
          prompt: 'When should you use a def instead of a lambda?',
          difficulty: 'intermediate',
          options: [
            'Always',
            'Whenever the logic is more than a single short expression, or you want to give it a name',
            'Only for functions with parameters',
            'Only inside other functions'
          ],
          answer: 1,
          explanation: 'A lambda is for a single short expression passed straight somewhere. Anything longer, or anything worth naming, should be a def.',
          hints: ['What is a lambda actually limited to?']
        }
      ]
    },

    // ------------------------------------------------------------------ 8
    {
      id: 'm5l8',
      title: 'Recursion',
      intro: 'A function that calls itself. Strange at first, and the right answer for a particular shape of problem.',
      objectives: ['Write a recursive function with a base case', 'Explain what happens without a base case', 'Say when recursion suits a problem'],
      concepts: ['recursion'],
      requires: ['return'],
      minutes: 13,
      difficulty: 'advanced',
      required: false,
      blocks: [
        { kind: 'code', language: 'python', code: 'def countdown(n):\n    if n <= 0:          # the base case\n        print("Go!")\n        return\n    print(n)\n    countdown(n - 1)    # calls itself with a smaller problem\n\ncountdown(3)   # 3 2 1 Go!', caption: 'Every recursive function needs a case that does not recurse.' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'A base case — the smallest problem, answered directly',
            'A recursive case — calls itself on something smaller',
            'Each call must genuinely get closer to the base case'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Miss the base case and you get RecursionError: maximum recursion depth exceeded. Python stops you at around a thousand nested calls, which is its version of the infinite loop warning.'
        },
        { kind: 'heading', text: 'Factorial' },
        { kind: 'code', language: 'python', code: 'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nprint(factorial(5))   # 120', caption: '5 * 4 * 3 * 2 * 1, each layer waiting for the one below.' },
        { kind: 'example', title: 'What actually happens', text: 'factorial(5) = 5 * factorial(4)\n             = 5 * (4 * factorial(3))\n             = 5 * (4 * (3 * factorial(2)))\n             = 5 * (4 * (3 * (2 * factorial(1))))\n             = 5 * (4 * (3 * (2 * 1)))\n             = 120\n\nThe calls stack up on the way down and the answers come back up.' },
        { kind: 'heading', text: 'Where it earns its place' },
        { kind: 'text', text: 'Problems that contain smaller copies of themselves: a folder containing folders, a reply with replies, a menu with submenus, a nested dictionary of unknown depth. A loop can do all of it, but the loop has to manage its own stack of where-was-I, and the recursive version simply says what the structure is.' },
        { kind: 'code', language: 'python', code: 'def total(data):\n    """Add up every number in a list that may contain lists."""\n    sum_so_far = 0\n    for item in data:\n        if isinstance(item, list):\n            sum_so_far += total(item)     # a smaller copy of the same problem\n        else:\n            sum_so_far += item\n    return sum_so_far\n\nprint(total([1, [2, 3], [4, [5, 6]]]))   # 21', caption: 'This works at any depth, and nothing in it mentions how deep the nesting goes.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'For plain counting and totalling, a loop is clearer and faster — recursion is not a better way to add up a list. Reach for it when the data itself nests.'
        },
        { kind: 'check', questionId: 'm5l8q1' }
      ],
      questions: [
        {
          id: 'm5l8q1',
          kind: 'choice',
          concept: 'recursion',
          prompt: 'What does every recursive function need to avoid running for ever?',
          difficulty: 'intermediate',
          options: [
            'A loop',
            'A base case that returns without calling itself',
            'A global variable',
            'A default argument'
          ],
          answer: 1,
          explanation: 'A base case. Without one the calls never stop, and Python eventually gives up with a RecursionError.',
          hints: ['Something has to stop the chain.']
        },
        {
          id: 'm5l8q2',
          kind: 'number',
          concept: 'recursion',
          prompt: 'What does factorial(4) return?\n\ndef factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)',
          difficulty: 'advanced',
          answer: 24,
          explanation: '24 — 4 * 3 * 2 * 1.',
          hints: ['Multiply 4 by factorial(3), and so on down.']
        },
        {
          id: 'm5l8q3',
          kind: 'choice',
          concept: 'recursion',
          prompt: 'Which problem genuinely suits recursion?',
          difficulty: 'advanced',
          options: [
            'Adding up a flat list of numbers',
            'Printing 1 to 100',
            'Totalling the numbers in a list that may contain lists, to any depth',
            'Counting the vowels in a word'
          ],
          answer: 2,
          explanation: 'The nested list. The data contains smaller copies of itself, which is exactly the shape recursion describes. The other three are plain loops.',
          hints: ['Which problem contains a smaller version of itself?']
        }
      ]
    },

    // ------------------------------------------------------------------ 9
    {
      id: 'm5l9',
      title: 'Functions challenge',
      intro: 'Everything from the module, with the return/print distinction tested properly.',
      objectives: ['Write and reason about functions without prompting'],
      concepts: ['functions', 'parameters', 'return', 'default-args', 'scope', 'function-design'],
      requires: ['function-design', 'scope', 'return'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'check', questionId: 'm5c1' },
        { kind: 'check', questionId: 'm5c2' },
        { kind: 'check', questionId: 'm5c3' },
        { kind: 'check', questionId: 'm5c4' },
        { kind: 'check', questionId: 'm5c5' },
        { kind: 'check', questionId: 'm5c6' }
      ],
      questions: [
        {
          id: 'm5c1',
          kind: 'choice',
          concept: 'return',
          prompt: 'What does this print?\n\ndef f(a, b=2):\n    return a * b\n\nprint(f(3), f(3, 3))',
          difficulty: 'intermediate',
          options: ['6 9', '6 6', '9 9', 'An error'],
          answer: 0,
          explanation: '6 9. The first call uses the default b of 2, the second supplies 3.',
          hints: ['What is b in each call?']
        },
        {
          id: 'm5c2',
          kind: 'choice',
          concept: 'scope',
          prompt: 'What does this print?\n\nx = 5\ndef f():\n    x = 10\nf()\nprint(x)',
          difficulty: 'intermediate',
          options: ['5', '10', 'None', 'A NameError'],
          answer: 0,
          explanation: '5. Assigning inside the function made a separate local x. The global one was never touched.',
          hints: ['Does assigning inside a function change the outer variable?']
        },
        {
          id: 'm5c3',
          kind: 'short',
          concept: 'functions',
          prompt: 'Write a function  is_even(n)  that returns True when n is even.',
          difficulty: 'intermediate',
          answer: 'def is_even(n):\n    return n % 2 == 0',
          accepts: ['def is_even(n): return n % 2 == 0', 'return n%2==0'],
          explanation: 'def is_even(n): return n % 2 == 0. The comparison already produces True or False, so no if is needed.',
          hints: ['The comparison is already a True/False value — just return it.']
        },
        {
          id: 'm5c4',
          kind: 'choice',
          concept: 'return',
          prompt: 'Why does total come out as None?\n\ndef add(a, b):\n    print(a + b)\n\ntotal = add(2, 3)',
          difficulty: 'intermediate',
          options: [
            'print is broken',
            'The function prints but never returns, so it hands back None',
            'total is the wrong name',
            'add needs three arguments'
          ],
          answer: 1,
          explanation: 'It printed the answer and returned nothing. A function with no return hands back None. Change print to return.',
          hints: ['What does the function give back to its caller?']
        },
        {
          id: 'm5c5',
          kind: 'multi',
          concept: 'function-design',
          prompt: 'Which of these suggest a function should be split? (Choose all that apply.)',
          difficulty: 'advanced',
          options: [
            'Its name needs the word "and"',
            'It returns a tuple',
            'It is two screens long',
            'It takes seven parameters'
          ],
          answer: [0, 2, 3],
          explanation: 'The name needing "and", the length, and the parameter count all point at more than one job. Returning a tuple is perfectly normal.',
          hints: ['One of these is ordinary and fine.']
        },
        {
          id: 'm5c6',
          kind: 'choice',
          concept: 'default-args',
          prompt: 'What does the second call print?\n\ndef add(x, into=[]):\n    into.append(x)\n    return into\n\nprint(add(1))\nprint(add(2))',
          difficulty: 'advanced',
          options: ['[2]', '[1, 2]', '[1]', 'An error'],
          answer: 1,
          explanation: '[1, 2]. The default list was created once and is shared by every call, so the 1 from the first call is still in it. This is why you default to None.',
          hints: ['How many lists exist here in total?']
        }
      ]
    }
  ]
}
