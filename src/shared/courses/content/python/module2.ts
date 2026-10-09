import type { Module } from '../../types.ts'

/**
 * Module 2 — Python Fundamentals.
 *
 * Variables, types, operators, input and strings. The module where the commonest beginner misunderstanding is
 * planted or avoided: that `=` is assignment and not equality, and that `input()` always hands back text.
 */
export const MODULE_2: Module = {
  id: 'm2',
  title: 'Python Fundamentals',
  summary: 'Storing values, the kinds of value there are, doing arithmetic, taking input, and working with text.',
  concepts: ['variables', 'types', 'numbers', 'strings', 'operators', 'input', 'conversion', 'f-strings', 'booleans'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'm2l1',
      title: 'Variables',
      intro: 'Giving a value a name so you can use it later — and what the equals sign actually means.',
      objectives: ['Create and reassign variables', 'Explain what = does', 'Name variables the way Python code is normally named'],
      concepts: ['variables'],
      requires: ['print'],
      minutes: 11,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'A variable is a name that refers to a value. You make one by writing the name, an equals sign, and the value.' },
        { kind: 'code', language: 'python', code: 'name = "Sam"\nage = 19\nprint(name)\nprint(age)', caption: 'Two variables, then printing what they refer to.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'In Python, = does not mean "is equal to". It means "put this value into this name". Asking whether two things are equal is ==, which arrives in Module 3. Mixing these two up is the single most common beginner mistake.'
        },
        { kind: 'heading', text: 'They can change' },
        { kind: 'text', text: 'That is what "variable" means. Assigning again replaces what the name refers to; the old value is simply gone.' },
        { kind: 'code', language: 'python', code: 'score = 10\nprint(score)   # 10\nscore = 25\nprint(score)   # 25\nscore = score + 5\nprint(score)   # 30', caption: 'The last line reads the current value, adds 5, and puts the result back in the same name.' },
        { kind: 'text', text: 'Read `score = score + 5` right-hand side first. Work out `score + 5` using the value score has now, then store the answer back in score. As a mathematical statement it would be nonsense; as an instruction it is perfectly clear.' },
        { kind: 'heading', text: 'Naming' },
        {
          kind: 'list',
          items: [
            'Letters, numbers and underscores only — and it cannot start with a number',
            'Case matters: score and Score are two different variables',
            'Python style is lower case with underscores: total_price, user_name, days_left',
            'No spaces, and no Python keywords (you cannot call a variable if or for)'
          ]
        },
        { kind: 'text', text: 'Names are for people. `x` costs you nothing today and costs you ten minutes in a fortnight; `days_until_deadline` costs eight extra keystrokes once.' },
        { kind: 'check', questionId: 'm2l1q1' },
        { kind: 'check', questionId: 'm2l1q2' }
      ],
      questions: [
        {
          id: 'm2l1q1',
          kind: 'choice',
          concept: 'variables',
          prompt: 'What does this print?\n\ncount = 3\ncount = count + 4\nprint(count)',
          difficulty: 'beginner',
          options: ['3', '4', '7', 'An error, because count is used before it is finished'],
          answer: 2,
          explanation: '7. The right-hand side is worked out first using the value count has at that moment (3), giving 7, and that is stored back in count.',
          hints: ['Work out the right-hand side first, then store it.']
        },
        {
          id: 'm2l1q2',
          kind: 'choice',
          concept: 'variables',
          prompt: 'Which of these is not a valid variable name?',
          difficulty: 'beginner',
          options: ['total_price', 'item2', '2nd_item', 'userName'],
          answer: 2,
          explanation: '2nd_item — a name cannot start with a number. The others are all valid, though userName is unusual in Python, where total_price style is normal.',
          hints: ['One of them starts with something a name may not start with.']
        },
        {
          id: 'm2l1q3',
          kind: 'true-false',
          concept: 'variables',
          prompt: 'In Python, = checks whether two values are equal.',
          difficulty: 'beginner',
          answer: false,
          explanation: 'False. = stores a value in a name. == is the one that asks whether two values are equal.',
          hints: ['One of them stores, the other asks.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'm2l2',
      title: 'Kinds of value',
      intro: 'Text, whole numbers, decimals and true/false — and why the kind of a value changes what you can do with it.',
      objectives: ['Name the four basic types', 'Use type() to find out what something is', 'Predict when mixing types will fail'],
      concepts: ['types'],
      requires: ['variables'],
      minutes: 10,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Every value in Python has a type, and the type decides what you are allowed to do with it. You can divide numbers; you cannot divide a word.' },
        {
          kind: 'table',
          headers: ['Type', 'What it is', 'Examples'],
          rows: [
            ['str', 'Text, called a string', '"hello"  "19"  ""  "a"'],
            ['int', 'A whole number', '0  19  -4  1000000'],
            ['float', 'A number with a decimal point', '3.14  -0.5  2.0'],
            ['bool', 'True or false', 'True  False']
          ]
        },
        { kind: 'text', text: 'Note `"19"` in the first row. With quotes it is text that happens to look like a number. Without them it is a number. They behave very differently, and this catches everybody once.' },
        { kind: 'code', language: 'python', code: 'print(19 + 1)      # 20   — numbers are added\nprint("19" + "1")  # 191  — text is joined end to end', caption: 'Same symbols, different types, entirely different result.' },
        { kind: 'heading', text: 'Asking what something is' },
        { kind: 'code', language: 'python', code: 'print(type("hello"))  # <class \'str\'>\nprint(type(19))       # <class \'int\'>\nprint(type(3.14))     # <class \'float\'>\nprint(type(True))     # <class \'bool\'>' },
        { kind: 'heading', text: 'When mixing fails' },
        { kind: 'code', language: 'python', code: 'age = 19\nprint("I am " + age)\n# TypeError: can only concatenate str (not "int") to str', caption: 'Python will not guess what you meant here.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Two fixes, both coming up: print("I am", age) — commas, so print handles it — or an f-string, which is the one you will use for the rest of your life.'
        },
        { kind: 'text', text: 'True and False are capitalised, always. `true` is not a Python value and will be treated as a name that does not exist.' },
        { kind: 'check', questionId: 'm2l2q1' },
        { kind: 'check', questionId: 'm2l2q2' }
      ],
      questions: [
        {
          id: 'm2l2q1',
          kind: 'choice',
          concept: 'types',
          prompt: 'What does print("5" + "3") produce?',
          difficulty: 'beginner',
          options: ['8', '53', '"53"', 'An error'],
          answer: 1,
          explanation: '53. Both are strings, and + on strings joins them end to end. Nothing is added up, because nothing here is a number.',
          hints: ['Look at the quotes. What type are these two values?']
        },
        {
          id: 'm2l2q2',
          kind: 'choice',
          concept: 'types',
          prompt: 'What is the type of the value 7.0?',
          difficulty: 'beginner',
          options: ['int, because it is a whole number', 'float, because it is written with a decimal point', 'str', 'bool'],
          answer: 1,
          explanation: 'float. The decimal point is what decides it, not whether the value happens to be whole. 7 is an int; 7.0 is a float.',
          hints: ['What decides int versus float — the value, or how it is written?']
        },
        {
          id: 'm2l2q3',
          kind: 'short',
          concept: 'types',
          prompt: 'Why does  "I am " + 19  fail?',
          difficulty: 'intermediate',
          answer: 'you cannot add a number to a string',
          accepts: ['different types', 'string and int cannot be joined', 'typeerror because one is text and one is a number', 'mixing str and int'],
          explanation: '+ on two strings joins them and + on two numbers adds them, but Python refuses to guess what you meant by mixing the two. That is a TypeError.',
          hints: ['What are the two types involved, and what should + do with one of each?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'm2l3',
      title: 'Arithmetic',
      intro: 'The seven operators, and the two that surprise people.',
      objectives: ['Use all seven arithmetic operators', 'Explain the difference between / and //', 'Use % to test divisibility'],
      concepts: ['numbers', 'operators'],
      requires: ['types'],
      minutes: 12,
      difficulty: 'beginner',
      required: true,
      blocks: [
        {
          kind: 'table',
          headers: ['Operator', 'Does', 'Example', 'Result'],
          rows: [
            ['+', 'add', '7 + 2', '9'],
            ['-', 'subtract', '7 - 2', '5'],
            ['*', 'multiply', '7 * 2', '14'],
            ['/', 'divide', '7 / 2', '3.5'],
            ['//', 'divide and throw away the remainder', '7 // 2', '3'],
            ['%', 'the remainder only', '7 % 2', '1'],
            ['**', 'to the power of', '7 ** 2', '49']
          ]
        },
        { kind: 'heading', text: '/ always gives a float' },
        { kind: 'code', language: 'python', code: 'print(10 / 2)   # 5.0   — not 5\nprint(10 // 2)  # 5     — a whole number\nprint(7 // 2)   # 3     — the .5 is discarded, not rounded', caption: '// cuts the decimal part off; it does not round.' },
        { kind: 'text', text: 'That last line matters. `7 // 2` is 3 and `-7 // 2` is -4, because it always goes down, never towards zero. Worth knowing before it surprises you.' },
        { kind: 'heading', text: '% is more useful than it looks' },
        { kind: 'text', text: 'The remainder answers a question you will ask constantly: does this divide evenly?' },
        { kind: 'code', language: 'python', code: 'print(10 % 2)  # 0  — so 10 is even\nprint(7 % 2)   # 1  — so 7 is odd\nprint(17 % 5)  # 2\n\n# 62 seconds is 1 minute and 2 seconds:\nprint(62 // 60, "min", 62 % 60, "sec")', caption: '// and % together split a quantity into units.' },
        { kind: 'heading', text: 'Order of operations' },
        { kind: 'text', text: 'The usual rules: powers first, then multiply and divide, then add and subtract. Brackets beat all of it.' },
        { kind: 'code', language: 'python', code: 'print(2 + 3 * 4)     # 14\nprint((2 + 3) * 4)   # 20\nprint(2 ** 3 * 2)    # 16' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Use brackets even where they are unnecessary, if they make the intention obvious. Nobody has ever regretted a clear bracket.'
        },
        { kind: 'heading', text: 'Shorthand' },
        { kind: 'code', language: 'python', code: 'total = 10\ntotal += 5   # same as total = total + 5\ntotal -= 3\ntotal *= 2\nprint(total)  # 24' },
        { kind: 'check', questionId: 'm2l3q1' },
        { kind: 'check', questionId: 'm2l3q2' }
      ],
      questions: [
        {
          id: 'm2l3q1',
          kind: 'number',
          concept: 'numbers',
          prompt: 'What is  17 % 5 ?',
          difficulty: 'beginner',
          answer: 2,
          explanation: '2. Five goes into 17 three times, making 15, and 2 is left over.',
          hints: ['How much is left over after taking out as many 5s as possible?']
        },
        {
          id: 'm2l3q2',
          kind: 'choice',
          concept: 'numbers',
          prompt: 'What does  9 / 2  give?',
          difficulty: 'beginner',
          options: ['4', '4.5', '5', '4.0'],
          answer: 1,
          explanation: '4.5. A single / always produces a float, decimal part included. If you wanted 4, that is 9 // 2.',
          hints: ['Which operator keeps the decimal part?']
        },
        {
          id: 'm2l3q3',
          kind: 'choice',
          concept: 'operators',
          prompt: 'What does  2 + 3 * 4 ** 2  give?',
          difficulty: 'intermediate',
          options: ['50', '100', '400', '26'],
          answer: 0,
          explanation: '50. Power first: 4 ** 2 is 16. Then multiply: 3 * 16 is 48. Then add: 2 + 48 is 50.',
          hints: ['Powers, then multiply, then add.']
        },
        {
          id: 'm2l3q4',
          kind: 'short',
          concept: 'numbers',
          prompt: 'How would you test whether a number stored in n is even?',
          difficulty: 'intermediate',
          answer: 'n % 2 == 0',
          accepts: ['n%2==0', 'check n % 2 is 0', 'n mod 2 equals 0'],
          explanation: 'n % 2 == 0. If dividing by two leaves no remainder, it is even. This is one of the most-used tricks in programming.',
          hints: ['What is left over when an even number is divided by two?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'm2l4',
      title: 'Taking input',
      intro: 'Asking the person running the program a question — and the one thing about input() that catches everybody.',
      objectives: ['Use input() to get a value', 'Explain why input() always gives a string', 'Convert input into a number'],
      concepts: ['input', 'conversion'],
      requires: ['variables', 'types'],
      minutes: 12,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'name = input("What is your name? ")\nprint("Hello,", name)', caption: 'The program stops, waits, and whatever is typed goes into name.' },
        { kind: 'text', text: 'The text in the brackets is the prompt. Put a space at the end of it — otherwise what the person types sits flush against your question mark.' },
        { kind: 'heading', text: 'input() always gives you text' },
        { kind: 'text', text: 'Always. Even when the person types 42. That is not a number, it is the two characters 4 and 2.' },
        { kind: 'code', language: 'python', code: 'age = input("Your age? ")   # person types 42\nprint(age + 1)\n# TypeError: can only concatenate str (not "int") to str', caption: 'The classic first real bug.' },
        { kind: 'heading', text: 'Converting' },
        { kind: 'code', language: 'python', code: 'age = int(input("Your age? "))\nprint("Next year you will be", age + 1)\n\nprice = float(input("Price? "))\nprint("With VAT:", price * 1.2)', caption: 'int() for whole numbers, float() for decimals.' },
        { kind: 'text', text: 'Read `int(input(...))` from the inside out: input gets the text, int turns that text into a number, and the number is stored.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'If the person types "hello" into an int(), the program crashes with a ValueError. That is correct behaviour for now — you cannot sensibly make a number out of "hello". Module 6 shows how to handle it gracefully instead of crashing.'
        },
        { kind: 'heading', text: 'Converting the other way' },
        { kind: 'code', language: 'python', code: 'count = 7\nprint("You have " + str(count) + " messages")', caption: 'str() turns a number into text so it can be joined to a string.' },
        { kind: 'check', questionId: 'm2l4q1' },
        { kind: 'check', questionId: 'm2l4q2' }
      ],
      questions: [
        {
          id: 'm2l4q1',
          kind: 'choice',
          concept: 'input',
          prompt: 'Somebody types 5 at this program. What happens?\n\nn = input("Number: ")\nprint(n * 2)',
          difficulty: 'intermediate',
          options: ['It prints 10', 'It prints 55', 'It crashes', 'It prints 5'],
          answer: 1,
          explanation: '55. n is the string "5", and multiplying a string by 2 repeats it. To get 10 you need int(input(...)).',
          hints: ['What type is n? What does * do to a string?']
        },
        {
          id: 'm2l4q2',
          kind: 'short',
          concept: 'conversion',
          prompt: 'Write a line that asks for a number and stores it as a whole number in a variable called n.',
          difficulty: 'intermediate',
          answer: 'n = int(input("Number: "))',
          accepts: ['n = int(input())', "n = int(input('Number: '))", 'n=int(input("enter a number"))'],
          explanation: 'n = int(input("Number: ")) — input collects the text, int turns it into a whole number.',
          hints: ['Two functions, one inside the other.']
        },
        {
          id: 'm2l4q3',
          kind: 'choice',
          concept: 'conversion',
          prompt: 'What happens with  int(input())  when the person types  hello ?',
          difficulty: 'intermediate',
          options: [
            'It stores 0',
            'It stores "hello"',
            'The program crashes with a ValueError',
            'int() ignores it and waits for another go'
          ],
          answer: 2,
          explanation: 'A ValueError. There is no sensible number to make from "hello", so Python says so and stops. Handling that properly is what try/except in Module 6 is for.',
          hints: ['What number would "hello" even be?']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'm2l5',
      title: 'Strings',
      intro: 'Text in more detail: joining, repeating, measuring, picking it apart, and the methods you will use daily.',
      objectives: ['Join and repeat strings', 'Index and slice a string', 'Use the common string methods'],
      concepts: ['strings'],
      requires: ['types'],
      minutes: 14,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'first = "Ada"\nlast = "Lovelace"\nprint(first + " " + last)   # Ada Lovelace\nprint("-" * 20)              # --------------------\nprint(len(first))            # 3', caption: '+ joins, * repeats, len() counts the characters.' },
        { kind: 'heading', text: 'Getting at one character' },
        { kind: 'text', text: 'Positions start at 0. This is not Python being awkward — nearly every language counts from zero, and it stops being odd within a week.' },
        { kind: 'code', language: 'python', code: 'word = "Python"\n#       012345\nprint(word[0])   # P\nprint(word[3])   # h\nprint(word[-1])  # n   — last one\nprint(word[-2])  # o   — second from the end', caption: 'Negative positions count back from the end.' },
        { kind: 'heading', text: 'Slices' },
        { kind: 'text', text: 'A slice takes a range: `word[start:stop]`. The start is included and the stop is not.' },
        { kind: 'code', language: 'python', code: 'word = "Python"\nprint(word[0:3])   # Pyt   — 0, 1, 2\nprint(word[2:])    # thon  — from 2 to the end\nprint(word[:4])    # Pyth  — from the start to 3\nprint(word[-3:])   # hon   — the last three' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Stop-not-included looks strange and is actually convenient: word[0:3] has exactly 3 characters, and word[:n] always gives you n of them. Once you notice that, you stop having to count.'
        },
        { kind: 'heading', text: 'Methods' },
        { kind: 'code', language: 'python', code: 'greeting = "  Hello, World!  "\nprint(greeting.strip())         # "Hello, World!"\nprint(greeting.strip().lower()) # "hello, world!"\nprint(greeting.upper())\nprint("Hello".replace("l", "L"))      # HeLLo\nprint("a,b,c".split(","))             # [\'a\', \'b\', \'c\']\nprint("Hello".startswith("He"))       # True\nprint("World" in greeting)            # True', caption: 'A method is called with a dot after the value it works on.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Strings cannot be changed. greeting.upper() hands back a new string and leaves greeting exactly as it was. If you want to keep the result you have to assign it: greeting = greeting.upper().'
        },
        { kind: 'text', text: '`.strip()` and `.lower()` together are the two you will reach for whenever you compare something a person typed. "  Yes " and "yes" are different strings until you tidy them.' },
        { kind: 'check', questionId: 'm2l5q1' },
        { kind: 'check', questionId: 'm2l5q2' }
      ],
      questions: [
        {
          id: 'm2l5q1',
          kind: 'choice',
          concept: 'strings',
          prompt: 'What does "programming"[0:4] give?',
          difficulty: 'beginner',
          options: ['prog', 'progr', 'rogr', 'rog'],
          answer: 0,
          explanation: 'prog — positions 0, 1, 2 and 3. The stop position is not included, so you get exactly four characters.',
          hints: ['Start included, stop not included.']
        },
        {
          id: 'm2l5q2',
          kind: 'choice',
          concept: 'strings',
          prompt: 'What does this print?\n\nword = "hello"\nword.upper()\nprint(word)',
          difficulty: 'intermediate',
          options: ['HELLO', 'hello', 'Hello', 'An error'],
          answer: 1,
          explanation: 'hello. .upper() returns a new string and nothing was done with it. word itself never changed — strings cannot be changed in place.',
          hints: ['Was the result of .upper() stored anywhere?']
        },
        {
          id: 'm2l5q3',
          kind: 'short',
          concept: 'strings',
          prompt: 'How do you get the last character of a string stored in s?',
          difficulty: 'intermediate',
          answer: 's[-1]',
          accepts: ['s[len(s)-1]', 's[ -1 ]'],
          explanation: 's[-1]. Negative positions count back from the end, so -1 is the last character however long the string is.',
          hints: ['Negative numbers count from which end?']
        },
        {
          id: 'm2l5q4',
          kind: 'multi',
          concept: 'strings',
          prompt: 'Which of these are true about strings in Python? (Choose all that apply.)',
          difficulty: 'intermediate',
          options: [
            'Positions start at 0',
            'A method like .lower() changes the string it is called on',
            'len() tells you how many characters there are',
            '"abc" * 3 gives "abcabcabc"'
          ],
          answer: [0, 2, 3],
          explanation: 'All true except the second. Methods hand back a new string; the original is untouched unless you assign over it.',
          hints: ['One of these claims a string can be changed in place.']
        }
      ]
    },

    // ------------------------------------------------------------------ 6
    {
      id: 'm2l6',
      title: 'f-strings',
      intro: 'Putting values inside text properly. Once you have this you will never go back to joining with +.',
      objectives: ['Write f-strings with values and expressions inside', 'Format a number to a fixed number of decimal places'],
      concepts: ['f-strings'],
      requires: ['strings', 'variables'],
      minutes: 10,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Put an f immediately before the opening quote, and anything in curly brackets inside is worked out and dropped into the text.' },
        { kind: 'code', language: 'python', code: 'name = "Sam"\nage = 19\nprint(f"{name} is {age} years old")   # Sam is 19 years old', caption: 'No +, no str(), no counting commas.' },
        { kind: 'text', text: 'Compare it with the alternatives, which is the whole argument:' },
        { kind: 'code', language: 'python', code: 'print("Hello " + name + ", you are " + str(age))   # fiddly, and breaks without str()\nprint("Hello", name + ",", "you are", age)         # awkward punctuation\nprint(f"Hello {name}, you are {age}")              # this one' },
        { kind: 'heading', text: 'Expressions work too' },
        { kind: 'code', language: 'python', code: 'price = 9.99\nqty = 3\nprint(f"Total: {price * qty}")           # Total: 29.97\nprint(f"Next year: {age + 1}")\nprint(f"Shouting: {name.upper()}")' },
        { kind: 'heading', text: 'Tidying numbers' },
        { kind: 'text', text: 'A colon after the value introduces a format. `:.2f` means a decimal number to two places — exactly what money needs.' },
        { kind: 'code', language: 'python', code: 'total = 10 / 3\nprint(f"{total}")        # 3.3333333333333335\nprint(f"{total:.2f}")    # 3.33\nprint(f"{total:.0f}")    # 3\nprint(f"{1234567:,}")    # 1,234,567', caption: 'The formatting changes how it is shown, not the value itself.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Use f-strings from here on. They are shorter, they read in the order the output appears, and they never fail because you forgot a str().'
        },
        { kind: 'check', questionId: 'm2l6q1' }
      ],
      questions: [
        {
          id: 'm2l6q1',
          kind: 'short',
          concept: 'f-strings',
          prompt: 'Using variables name and score, write a line that prints:  Sam scored 42',
          difficulty: 'beginner',
          answer: 'print(f"{name} scored {score}")',
          accepts: ["print(f'{name} scored {score}')"],
          explanation: 'print(f"{name} scored {score}") — the f before the quote is what makes the curly brackets do anything.',
          hints: ['Do not forget the f before the opening quote.']
        },
        {
          id: 'm2l6q2',
          kind: 'choice',
          concept: 'f-strings',
          prompt: 'What does  print(f"{7/2:.1f}")  produce?',
          difficulty: 'intermediate',
          options: ['3.5', '3.50', '4', '7/2'],
          answer: 0,
          explanation: '3.5. The expression is worked out to 3.5, and :.1f shows it to one decimal place.',
          hints: ['Work out the sum first, then apply the format.']
        },
        {
          id: 'm2l6q3',
          kind: 'choice',
          concept: 'f-strings',
          prompt: 'What does  print("{name} is here")  produce, with name set to "Sam"?',
          difficulty: 'intermediate',
          options: ['Sam is here', '{name} is here', 'An error', 'name is here'],
          answer: 1,
          explanation: '{name} is here — literally. Without the f before the quote it is just an ordinary string, and the curly brackets are ordinary characters.',
          hints: ['Look very carefully at what is missing before the quote.']
        }
      ]
    },

    // ------------------------------------------------------------------ 7
    {
      id: 'm2l7',
      title: 'True and False',
      intro: 'The type with only two values, and the comparisons that produce it.',
      objectives: ['Use the comparison operators', 'Explain the difference between = and ==', 'Combine conditions with and, or and not'],
      concepts: ['booleans'],
      requires: ['types', 'operators'],
      minutes: 11,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'A bool is either True or False, capitalised. You will rarely type one — you will produce them by comparing things, and that is what every decision a program makes is built on.' },
        {
          kind: 'table',
          headers: ['Operator', 'Asks', 'Example', 'Result'],
          rows: [
            ['==', 'are these equal?', '5 == 5', 'True'],
            ['!=', 'are these different?', '5 != 3', 'True'],
            ['>', 'greater than', '5 > 3', 'True'],
            ['<', 'less than', '5 < 3', 'False'],
            ['>=', 'greater than or equal to', '5 >= 5', 'True'],
            ['<=', 'less than or equal to', '3 <= 5', 'True']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'One equals sign stores. Two equals signs ask. age = 18 makes age eighteen; age == 18 asks whether it is. Getting this wrong is the most common error in anybody\'s first month.'
        },
        { kind: 'heading', text: 'Comparing text' },
        { kind: 'code', language: 'python', code: 'print("cat" == "cat")    # True\nprint("Cat" == "cat")    # False — case matters\nprint("apple" < "banana")  # True — alphabetical order', caption: 'Which is why .lower() matters before comparing what somebody typed.' },
        { kind: 'heading', text: 'Combining' },
        {
          kind: 'list',
          items: [
            'and — true only when both sides are true',
            'or — true when at least one side is true',
            'not — flips it'
          ]
        },
        { kind: 'code', language: 'python', code: 'age = 20\nhas_ticket = True\n\nprint(age >= 18 and has_ticket)   # True\nprint(age < 18 or has_ticket)     # True\nprint(not has_ticket)             # False', caption: 'These read very close to English, which is deliberate.' },
        { kind: 'text', text: 'And a trick Python has that most languages do not: you can chain comparisons the way mathematics does.' },
        { kind: 'code', language: 'python', code: 'score = 75\nprint(50 <= score <= 100)   # True — reads exactly as it looks' },
        { kind: 'check', questionId: 'm2l7q1' },
        { kind: 'check', questionId: 'm2l7q2' }
      ],
      questions: [
        {
          id: 'm2l7q1',
          kind: 'choice',
          concept: 'booleans',
          prompt: 'What is the value of  10 != 10 ?',
          difficulty: 'beginner',
          options: ['True', 'False', '0', 'An error'],
          answer: 1,
          explanation: 'False. != asks "are these different", and they are not.',
          hints: ['!= means "not equal to".']
        },
        {
          id: 'm2l7q2',
          kind: 'choice',
          concept: 'booleans',
          prompt: 'With  age = 15  and  has_permission = True, what is  age >= 18 and has_permission ?',
          difficulty: 'intermediate',
          options: ['True', 'False', 'An error', 'It depends on the order'],
          answer: 1,
          explanation: 'False. and needs both sides true. The first is false, so the whole thing is false regardless of the second.',
          hints: ['Work out each side, then apply and.']
        },
        {
          id: 'm2l7q3',
          kind: 'true-false',
          concept: 'booleans',
          prompt: '"Yes" == "yes" is True in Python.',
          difficulty: 'beginner',
          answer: false,
          explanation: 'False — case matters in string comparison. This is why you call .lower() on anything a person typed before comparing it.',
          hints: ['Look at the first letter of each.']
        },
        {
          id: 'm2l7q4',
          kind: 'choice',
          concept: 'booleans',
          prompt: 'What does  not (5 > 3)  give?',
          difficulty: 'intermediate',
          options: ['True', 'False', '5', 'An error'],
          answer: 1,
          explanation: 'False. 5 > 3 is True, and not flips it.',
          hints: ['Work out the brackets first, then flip.']
        }
      ]
    },

    // ------------------------------------------------------------------ 8
    {
      id: 'm2l8',
      title: 'Fundamentals challenge',
      intro: 'Everything from this module, mixed together with no signposts.',
      objectives: ['Combine variables, types, arithmetic, input, strings and comparisons'],
      concepts: ['variables', 'types', 'numbers', 'strings', 'input', 'conversion', 'f-strings', 'booleans'],
      requires: ['booleans', 'f-strings', 'input'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'These need two or three ideas at once, which is what real problems are like.' },
        { kind: 'check', questionId: 'm2c1' },
        { kind: 'check', questionId: 'm2c2' },
        { kind: 'check', questionId: 'm2c3' },
        { kind: 'check', questionId: 'm2c4' },
        { kind: 'check', questionId: 'm2c5' },
        { kind: 'check', questionId: 'm2c6' }
      ],
      questions: [
        {
          id: 'm2c1',
          kind: 'choice',
          concept: 'types',
          prompt: 'What does this print?\n\nx = "10"\ny = 5\nprint(int(x) + y)',
          difficulty: 'intermediate',
          options: ['105', '15', 'An error', '10 5'],
          answer: 1,
          explanation: '15. int(x) turns the string "10" into the number 10, and then it is ordinary addition.',
          hints: ['What does int() do to "10"?']
        },
        {
          id: 'm2c2',
          kind: 'number',
          concept: 'numbers',
          prompt: 'What is  (10 + 5) % 4 ?',
          difficulty: 'intermediate',
          answer: 3,
          explanation: '3. Brackets first gives 15, and 15 % 4 is 3 (four goes in three times, leaving 3).',
          hints: ['Brackets first, then the remainder.']
        },
        {
          id: 'm2c3',
          kind: 'short',
          concept: 'f-strings',
          prompt: 'Variables  item  and  price  hold "Tea" and 2.5. Write a line that prints:  Tea costs £2.50',
          difficulty: 'advanced',
          answer: 'print(f"{item} costs £{price:.2f}")',
          accepts: ["print(f'{item} costs £{price:.2f}')", 'print(f"{item} costs £{price:.2f}")'],
          explanation: 'print(f"{item} costs £{price:.2f}") — the :.2f is what turns 2.5 into 2.50, which is what money always needs.',
          hints: ['You need a format on the price to get the trailing zero.']
        },
        {
          id: 'm2c4',
          kind: 'choice',
          concept: 'strings',
          prompt: 'What does this print?\n\ns = "  Hello  "\nprint(len(s.strip()))',
          difficulty: 'advanced',
          options: ['9', '5', '7', '10'],
          answer: 1,
          explanation: '5. .strip() removes the spaces at both ends, leaving "Hello", and len() of that is 5.',
          hints: ['Strip first, then count what is left.']
        },
        {
          id: 'm2c5',
          kind: 'choice',
          concept: 'input',
          prompt: 'This program should double a number. Why does it not?\n\nn = input("Number: ")\nprint(n * 2)',
          difficulty: 'intermediate',
          options: [
            'print cannot multiply',
            'input() gives text, and multiplying text repeats it instead of doubling',
            '* is the wrong operator for doubling',
            'n needs to be printed before it is used'
          ],
          answer: 1,
          explanation: 'input() always returns a string. "5" * 2 is "55". Wrapping it as int(input(...)) fixes it.',
          hints: ['What type does input() always hand back?']
        },
        {
          id: 'm2c6',
          kind: 'choice',
          concept: 'booleans',
          prompt: 'With  n = 12, what is  n % 2 == 0 and n > 10 ?',
          difficulty: 'advanced',
          options: ['True', 'False', 'An error', '12'],
          answer: 0,
          explanation: 'True. 12 % 2 is 0, so the first side is true; 12 > 10 is also true; and needs both, and has both.',
          hints: ['Work out each side separately first.']
        }
      ]
    }
  ]
}
