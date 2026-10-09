import type { Module } from '../../types.ts'

/**
 * Module 6 — Files, Errors, Modules and Libraries.
 *
 * The module where programs stop forgetting everything and stop falling over on bad input. The honesty rule that
 * runs through it: catch the error you can actually do something about, and let the rest be loud.
 */
export const MODULE_6: Module = {
  id: 'm6',
  title: 'Files, Errors, Modules and Libraries',
  summary: 'Keeping data between runs, surviving bad input, and using code other people wrote.',
  concepts: [
    'persistence', 'reading-files', 'writing-files', 'text-processing',
    'exceptions', 'validation', 'robustness', 'modules', 'stdlib', 'json', 'packages'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'm6l1',
      title: 'Why files',
      intro: 'Everything a program holds disappears when it ends. Files are how that stops being true.',
      objectives: ['Explain why memory does not persist', 'Name the common ways a program stores data'],
      concepts: ['persistence'],
      requires: ['execution'],
      minutes: 7,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'text', text: 'Module 2 built up a list of tasks and Module 4 counted words. Run any of it again and it starts from nothing. That is because values live in memory, and memory is handed back the moment the program stops.' },
        { kind: 'text', text: 'A file lives on the disk. Writing to one is what makes a program useful more than once.' },
        {
          kind: 'table',
          headers: ['Format', 'Good for', 'Not good for'],
          rows: [
            ['Plain text (.txt)', 'Logs, notes, one item per line', 'Anything with structure'],
            ['CSV (.csv)', 'Rows and columns, opens in a spreadsheet', 'Nesting'],
            ['JSON (.json)', 'Lists and dictionaries, nested freely', 'Being read by a person at a glance'],
            ['A database', 'Lots of data, searching, several programs at once', 'A small script']
          ]
        },
        { kind: 'text', text: 'This module covers text and JSON, which between them handle most of what a small program needs. Databases are a subject of their own.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'A file path says where the file is. "notes.txt" means "beside wherever the program was run from", which is not always where the program file is — a surprise worth meeting now rather than later.'
        },
        { kind: 'check', questionId: 'm6l1q1' }
      ],
      questions: [
        {
          id: 'm6l1q1',
          kind: 'choice',
          concept: 'persistence',
          prompt: 'Why does a program forget its data when it ends?',
          difficulty: 'beginner',
          options: [
            'Python deletes it deliberately',
            'Values live in memory, which is handed back when the program stops',
            'Data has a time limit',
            'Only functions can keep data'
          ],
          answer: 1,
          explanation: 'Memory is temporary by design. Keeping anything means writing it somewhere permanent — a file, or a database.',
          hints: ['Where were the values while the program was running?']
        },
        {
          id: 'm6l1q2',
          kind: 'choice',
          concept: 'persistence',
          prompt: 'Which format best suits a dictionary with lists inside it?',
          difficulty: 'intermediate',
          options: ['Plain text', 'CSV', 'JSON', 'None of them can hold that'],
          answer: 2,
          explanation: 'JSON. It handles nesting directly. CSV is flat rows and columns, and plain text has no structure at all.',
          hints: ['Which one handles nesting?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'm6l2',
      title: 'Reading a file',
      intro: 'Opening one safely, and three ways to get what is in it.',
      objectives: ['Read a file with with open()', 'Loop over its lines', 'Explain why with is used rather than a plain open'],
      concepts: ['reading-files'],
      requires: ['persistence', 'strings'],
      minutes: 13,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'with open("notes.txt") as f:\n    content = f.read()\n\nprint(content)', caption: 'Everything in the file as one string.' },
        { kind: 'heading', text: 'Why with' },
        { kind: 'text', text: 'An open file holds a resource the operating system has to hand back. `with` closes it for you when the block ends — including when something inside the block goes wrong.' },
        { kind: 'code', language: 'python', code: 'f = open("notes.txt")   # do not do this\ncontent = f.read()\nf.close()               # skipped entirely if read() raises', caption: 'The old way. One error between those lines and the file stays open.' },
        { kind: 'heading', text: 'Three ways' },
        { kind: 'code', language: 'python', code: 'with open("notes.txt") as f:\n    whole = f.read()          # one string\n\nwith open("notes.txt") as f:\n    lines = f.readlines()     # a list, each with its newline still on\n\nwith open("notes.txt") as f:\n    for line in f:            # one at a time — use this for a big file\n        print(line.strip())', caption: 'The third never holds more than one line in memory at once.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Lines read from a file keep their newline character on the end. "tea\\n" is not equal to "tea". Call .strip() on every line you read — forgetting it is the commonest file bug there is.'
        },
        { kind: 'heading', text: 'When the file is not there' },
        { kind: 'code', language: 'python', code: 'with open("missing.txt") as f:\n    print(f.read())\n# FileNotFoundError: [Errno 2] No such file or directory: \'missing.txt\'', caption: 'Correct behaviour. The next lesson is how to respond to it.' },
        { kind: 'heading', text: 'Text into data' },
        { kind: 'code', language: 'python', code: 'with open("scores.txt") as f:\n    scores = [int(line.strip()) for line in f if line.strip()]\n\nprint(f"{len(scores)} scores, average {sum(scores) / len(scores):.1f}")', caption: 'The if drops blank lines — a file nearly always ends with one.' },
        { kind: 'check', questionId: 'm6l2q1' },
        { kind: 'check', questionId: 'm6l2q2' }
      ],
      questions: [
        {
          id: 'm6l2q1',
          kind: 'choice',
          concept: 'reading-files',
          prompt: 'Why use  with open(...)  rather than open() and close()?',
          difficulty: 'intermediate',
          options: [
            'It is shorter',
            'It closes the file even when something inside the block goes wrong',
            'It reads faster',
            'close() does not exist'
          ],
          answer: 1,
          explanation: 'with guarantees the file is closed, error or not. With a manual close, any error in between skips it and leaves the file open.',
          hints: ['What happens to close() if the line above it raises?']
        },
        {
          id: 'm6l2q2',
          kind: 'choice',
          concept: 'reading-files',
          prompt: 'A file contains the line  tea. Why does  line == "tea"  come out False?',
          difficulty: 'intermediate',
          options: [
            'Comparison does not work on file data',
            'The line still has its newline character on the end',
            'The file was opened in the wrong mode',
            'It needs int()'
          ],
          answer: 1,
          explanation: 'The line is "tea\\n". .strip() removes the newline and any surrounding spaces, and then the comparison works.',
          hints: ['What marks the end of a line in a file?']
        },
        {
          id: 'm6l2q3',
          kind: 'choice',
          concept: 'reading-files',
          prompt: 'Which way of reading suits a file too big to fit in memory?',
          difficulty: 'advanced',
          options: ['f.read()', 'f.readlines()', 'for line in f:', 'All of them are the same'],
          answer: 2,
          explanation: 'Looping over the file. It holds one line at a time, while read() and readlines() both bring the whole thing in at once.',
          hints: ['Which one does not load everything?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'm6l3',
      title: 'Writing a file',
      intro: 'Saving data — and the mode that silently deletes everything that was there.',
      objectives: ['Write and append to a file', 'Explain the difference between "w" and "a"', 'Write several lines'],
      concepts: ['writing-files'],
      requires: ['reading-files'],
      minutes: 11,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'with open("notes.txt", "w") as f:\n    f.write("First line\\n")\n    f.write("Second line\\n")', caption: 'The second argument is the mode. "w" is write.' },
        {
          kind: 'table',
          headers: ['Mode', 'Does', 'If the file exists'],
          rows: [
            ['"r"', 'read (the default)', 'reads it'],
            ['"w"', 'write', 'empties it first — everything in it is gone'],
            ['"a"', 'append', 'adds to the end'],
            ['"x"', 'create', 'fails rather than touch it']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Opening a file with "w" empties it immediately, before you write a single byte. Open the wrong filename with "w" and that file is gone, with no warning and no undo. Check the name twice; use "a" when you mean to add.'
        },
        { kind: 'heading', text: 'Appending' },
        { kind: 'code', language: 'python', code: 'with open("log.txt", "a") as f:\n    f.write("Program started\\n")', caption: 'Run it ten times and you get ten lines, not one.' },
        { kind: 'heading', text: 'Newlines are yours to add' },
        { kind: 'text', text: 'Unlike print, write adds nothing. Two writes with no \\n between them end up on the same line.' },
        { kind: 'code', language: 'python', code: 'tasks = ["wash up", "email Bea", "tidy"]\n\nwith open("tasks.txt", "w") as f:\n    for task in tasks:\n        f.write(task + "\\n")\n\n# Or in one go:\nwith open("tasks.txt", "w") as f:\n    f.write("\\n".join(tasks))', caption: 'join puts the separator between items — so no trailing newline with that version.' },
        { kind: 'heading', text: 'The round trip' },
        { kind: 'code', language: 'python', code: 'def save(tasks, path="tasks.txt"):\n    with open(path, "w") as f:\n        f.write("\\n".join(tasks))\n\ndef load(path="tasks.txt"):\n    with open(path) as f:\n        return [line.strip() for line in f if line.strip()]\n\nsave(["one", "two"])\nprint(load())   # [\'one\', \'two\']', caption: 'Two functions and the program remembers things between runs.' },
        { kind: 'check', questionId: 'm6l3q1' }
      ],
      questions: [
        {
          id: 'm6l3q1',
          kind: 'choice',
          concept: 'writing-files',
          prompt: 'A file has 100 lines. You open it with "w" and write one line. What is in it?',
          difficulty: 'intermediate',
          options: ['101 lines', 'The one new line only — the other 100 are gone', 'The 100 original lines', 'An error'],
          answer: 1,
          explanation: 'Just the new line. "w" empties the file on opening. "a" is the mode that adds without destroying.',
          hints: ['What does "w" do before writing anything?']
        },
        {
          id: 'm6l3q2',
          kind: 'choice',
          concept: 'writing-files',
          prompt: 'Why does  f.write("a")  then  f.write("b")  put them on one line?',
          difficulty: 'intermediate',
          options: [
            'write is broken',
            'write adds nothing of its own — you supply the newline',
            'The file needs mode "a"',
            'They should be on one line'
          ],
          answer: 1,
          explanation: 'write writes exactly what you give it. print adds a newline for you; write does not.',
          hints: ['Compare it with print.']
        },
        {
          id: 'm6l3q3',
          kind: 'short',
          concept: 'writing-files',
          prompt: 'Which mode adds to the end of a file without destroying what is there?',
          difficulty: 'beginner',
          answer: 'a',
          accepts: ['"a"', 'append', 'append mode'],
          explanation: '"a" for append. It writes at the end and leaves the existing content alone.',
          hints: ['One letter.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'm6l4',
      title: 'try and except',
      intro: 'Dealing with an error instead of crashing — and the version of this that hides your bugs.',
      objectives: ['Write try/except for a named error', 'Explain why bare except is bad', 'Use else and finally'],
      concepts: ['exceptions'],
      requires: ['conversion', 'reading-files'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'try:\n    age = int(input("Age: "))\n    print(f"Next year: {age + 1}")\nexcept ValueError:\n    print("That was not a number.")', caption: 'Typing "hello" now gets a sentence instead of a crash.' },
        { kind: 'text', text: 'Python runs the try block. If an error of the named kind happens, it jumps straight to the except block. If nothing goes wrong, the except block is skipped entirely.' },
        { kind: 'heading', text: 'Name the error' },
        { kind: 'code', language: 'python', code: 'try:\n    with open("data.txt") as f:\n        numbers = [int(line) for line in f]\nexcept FileNotFoundError:\n    print("No data file yet — starting fresh.")\n    numbers = []\nexcept ValueError:\n    print("The file has something in it that is not a number.")\n    numbers = []', caption: 'Two different problems, two different responses.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'except: on its own, or except Exception:, catches everything — including your own typos. A NameError from a misspelled variable gets swallowed and reported as "that was not a number". You then spend an hour debugging the wrong thing. Always name what you expect.'
        },
        { kind: 'heading', text: 'The common ones' },
        {
          kind: 'table',
          headers: ['Error', 'When'],
          rows: [
            ['ValueError', 'Right type, impossible value — int("hello")'],
            ['TypeError', 'Wrong type — "a" + 1'],
            ['FileNotFoundError', 'The file is not there'],
            ['KeyError', 'That key is not in the dictionary'],
            ['IndexError', 'That position is past the end'],
            ['ZeroDivisionError', 'Divided by zero'],
            ['PermissionError', 'Not allowed to read or write it']
          ]
        },
        { kind: 'heading', text: 'else and finally' },
        { kind: 'code', language: 'python', code: 'try:\n    value = int(input("Number: "))\nexcept ValueError:\n    print("Not a number")\nelse:\n    print(f"Thanks — {value} squared is {value ** 2}")\nfinally:\n    print("Done either way")', caption: 'else runs when nothing went wrong; finally runs whatever happened.' },
        { kind: 'text', text: 'Keep the try block as small as the risky part. Wrapping twenty lines in one try means you no longer know which of them failed.' },
        { kind: 'heading', text: 'Raising your own' },
        { kind: 'code', language: 'python', code: 'def set_age(age):\n    if age < 0:\n        raise ValueError("Age cannot be negative")\n    return age', caption: 'Refusing nonsense loudly beats storing it quietly.' },
        { kind: 'check', questionId: 'm6l4q1' },
        { kind: 'check', questionId: 'm6l4q2' }
      ],
      questions: [
        {
          id: 'm6l4q1',
          kind: 'choice',
          concept: 'exceptions',
          prompt: 'Why is  except Exception:  usually a mistake?',
          difficulty: 'advanced',
          options: [
            'It is slower',
            'It catches your own bugs too and reports them as the expected problem',
            'It is not valid Python',
            'It only catches one error'
          ],
          answer: 1,
          explanation: 'It swallows everything, typos included. A misspelled variable name gets reported as "not a number", and you debug the wrong line for an hour.',
          hints: ['What else might go wrong inside that block?']
        },
        {
          id: 'm6l4q2',
          kind: 'choice',
          concept: 'exceptions',
          prompt: 'Which error does  int("twelve")  raise?',
          difficulty: 'intermediate',
          options: ['TypeError', 'ValueError', 'SyntaxError', 'NameError'],
          answer: 1,
          explanation: 'ValueError. The type is right — int() does take a string — but that particular value cannot be made into a number.',
          hints: ['Is the problem the type of the argument, or its value?']
        },
        {
          id: 'm6l4q3',
          kind: 'choice',
          concept: 'exceptions',
          prompt: 'When does a finally block run?',
          difficulty: 'intermediate',
          options: [
            'Only when there was no error',
            'Only when there was an error',
            'Every time, error or not',
            'Only if you call it'
          ],
          answer: 2,
          explanation: 'Always. It is for tidying up that must happen whatever the outcome.',
          hints: ['The name is a strong hint.']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'm6l5',
      title: 'Not trusting input',
      intro: 'Validation: asking again until the answer makes sense, and the difference between a mistake and an attack.',
      objectives: ['Write a loop that insists on valid input', 'Check a range as well as a type', 'Say why validation is not only about crashes'],
      concepts: ['validation', 'robustness'],
      requires: ['exceptions', 'while-loops'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'Anything from outside your program — a person, a file, the internet — may be wrong, empty, the wrong type, or deliberately hostile. Deciding what is acceptable before using it is validation, and it is most of what separates a script from a program.' },
        { kind: 'heading', text: 'Keep asking' },
        { kind: 'code', language: 'python', code: 'def ask_number(prompt):\n    while True:\n        try:\n            return int(input(prompt))\n        except ValueError:\n            print("Please type a whole number.")\n\nage = ask_number("Age: ")', caption: 'return is what ends the loop — once there is a good answer, there is nothing left to do.' },
        { kind: 'heading', text: 'Type is not enough' },
        { kind: 'code', language: 'python', code: 'def ask_age():\n    while True:\n        try:\n            age = int(input("Age: "))\n        except ValueError:\n            print("Please type a number.")\n            continue\n        if age < 0 or age > 130:\n            print("That is not a plausible age.")\n            continue\n        return age', caption: '-5 is a perfectly good integer and a terrible age.' },
        { kind: 'text', text: 'Two separate questions, and both have to be asked: is it the right kind of thing, and is it a sensible value of that kind?' },
        { kind: 'heading', text: 'Text' },
        { kind: 'code', language: 'python', code: 'def ask_name():\n    while True:\n        name = input("Name: ").strip()\n        if not name:\n            print("A name is needed.")\n            continue\n        if len(name) > 100:\n            print("That is too long.")\n            continue\n        return name', caption: 'Strip first, then check it is not empty. "   " looks like an answer and is not one.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'A length limit is not fussiness. Unbounded input is how a program gets handed a hundred megabytes in a field meant for a name, and it is cheaper to refuse than to recover.'
        },
        { kind: 'heading', text: 'Validate at the edge, once' },
        { kind: 'text', text: 'Check things as they come in, then let the rest of the program trust them. Validating in twenty places means twenty chances to get it slightly differently wrong, and no single place that says what the rule is.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Never put text from outside into something that will be executed — a shell command, a database query, a filename built by joining strings. That is how programs get taken over, and no amount of being careful inside makes up for it. Always use the form of the call that takes the value as a separate argument.'
        },
        { kind: 'check', questionId: 'm6l5q1' },
        { kind: 'check', questionId: 'm6l5q2' }
      ],
      questions: [
        {
          id: 'm6l5q1',
          kind: 'choice',
          concept: 'validation',
          prompt: 'Why is  int()  succeeding not enough to accept an age?',
          difficulty: 'intermediate',
          options: [
            'int() is unreliable',
            'A valid number can still be an impossible age, like -5 or 900',
            'Ages must be strings',
            'It is enough'
          ],
          answer: 1,
          explanation: 'Type and range are separate checks. -5 is a perfectly good integer and not a possible age.',
          hints: ['Is -5 a valid integer? Is it a valid age?']
        },
        {
          id: 'm6l5q2',
          kind: 'choice',
          concept: 'robustness',
          prompt: 'Where should input be validated?',
          difficulty: 'advanced',
          options: [
            'Everywhere it is used',
            'Once, as it comes in, so the rest of the program can trust it',
            'Nowhere — handle the errors later',
            'Only in functions that print'
          ],
          answer: 1,
          explanation: 'At the edge, once. One place that says what the rule is, and no chance of twenty slightly different versions of it.',
          hints: ['What goes wrong if the same check exists in twenty places?']
        },
        {
          id: 'm6l5q3',
          kind: 'true-false',
          concept: 'robustness',
          prompt: 'It is safe to build a shell command by joining text that somebody typed into it.',
          difficulty: 'advanced',
          answer: false,
          explanation: 'False, and it is one of the oldest ways programs get taken over. Pass the value as a separate argument to the call rather than building a command string.',
          hints: ['What if what they typed contains a command of its own?']
        }
      ]
    },

    // ------------------------------------------------------------------ 6
    {
      id: 'm6l6',
      title: 'Modules',
      intro: 'Splitting a program across files, and using code that already exists.',
      objectives: ['Import a module three ways', 'Write and import your own module', 'Explain the __name__ guard'],
      concepts: ['modules'],
      requires: ['functions'],
      minutes: 12,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'import math\nprint(math.sqrt(16))        # 4.0\n\nfrom math import sqrt\nprint(sqrt(16))\n\nfrom math import sqrt as root\nprint(root(16))', caption: 'Three forms. The first keeps the module name visible, which is usually clearest.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Never use from module import *. Every name in it lands in your file at once, you cannot tell what came from where, and two modules with a shared name silently overwrite each other.'
        },
        { kind: 'heading', text: 'Your own' },
        { kind: 'code', language: 'python', code: '# helpers.py\ndef is_even(n):\n    return n % 2 == 0\n\nVAT = 0.2\n\n# main.py\nimport helpers\nprint(helpers.is_even(4))\nprint(helpers.VAT)', caption: 'Any .py file beside yours is a module you can import by its filename.' },
        { kind: 'heading', text: 'The __name__ guard' },
        { kind: 'code', language: 'python', code: '# helpers.py\ndef is_even(n):\n    return n % 2 == 0\n\nif __name__ == "__main__":\n    print(is_even(4))   # only when helpers.py is run directly', caption: 'Importing a module runs every line in it. The guard stops the test code going off.' },
        { kind: 'text', text: '`__name__` is "__main__" when the file is the one being run, and the module\'s own name when it is being imported. So that block is "what to do when somebody runs me on purpose" — and it is why nearly every Python program ends with `if __name__ == "__main__": main()`.' },
        { kind: 'check', questionId: 'm6l6q1' }
      ],
      questions: [
        {
          id: 'm6l6q1',
          kind: 'choice',
          concept: 'modules',
          prompt: 'What does  if __name__ == "__main__":  do?',
          difficulty: 'advanced',
          options: [
            'Checks the file is named main.py',
            'Runs the block only when the file is run directly, not when it is imported',
            'Declares the main function',
            'Nothing — it is a convention'
          ],
          answer: 1,
          explanation: 'It separates "run me" from "import me". Importing a module runs its lines, so without the guard a module\'s own test code would fire every time anything imported it.',
          hints: ['What happens to the lines in a module when it is imported?']
        },
        {
          id: 'm6l6q2',
          kind: 'choice',
          concept: 'modules',
          prompt: 'Why avoid  from math import * ?',
          difficulty: 'intermediate',
          options: [
            'It is slower',
            'You cannot tell where a name came from, and two modules can silently overwrite each other',
            'It only imports some of the module',
            'It is not valid Python'
          ],
          answer: 1,
          explanation: 'Every name arrives at once with nothing saying where it came from, and a clash is silent. import math, or name exactly what you want.',
          hints: ['What happens if two modules both define sqrt?']
        }
      ]
    },

    // ------------------------------------------------------------------ 7
    {
      id: 'm6l7',
      title: 'What comes with Python',
      intro: 'The standard library: a surprising amount of your work is already written.',
      objectives: ['Use several standard library modules', 'Know where to look before writing something yourself'],
      concepts: ['stdlib'],
      requires: ['modules'],
      minutes: 12,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'Python installs with a large collection of modules. Before writing anything non-trivial, the right instinct is to check whether it is already there — it very often is, and the version in the library has had far more people find its bugs than yours will.' },
        { kind: 'code', language: 'python', code: 'import math\nprint(math.sqrt(16), math.pi, math.ceil(4.2), math.floor(4.8))\n\nimport random\nprint(random.randint(1, 6))\nprint(random.choice(["tea", "coffee"]))\n\nimport datetime\nnow = datetime.datetime.now()\nprint(now.strftime("%d %B %Y"))\n\nimport os\nprint(os.path.exists("notes.txt"))', caption: 'Four of the most useful, in one go.' },
        { kind: 'heading', text: 'Paths, properly' },
        { kind: 'code', language: 'python', code: 'from pathlib import Path\n\np = Path("data") / "notes.txt"    # correct separator on any system\nprint(p.exists())\nif p.exists():\n    print(p.read_text())', caption: 'pathlib avoids every problem that comes from joining path strings by hand.' },
        { kind: 'heading', text: 'Counting, in one line' },
        { kind: 'code', language: 'python', code: 'from collections import Counter\n\nwords = ["tea", "milk", "tea", "tea"]\ncounts = Counter(words)\nprint(counts)                   # Counter({\'tea\': 3, \'milk\': 1})\nprint(counts.most_common(2))    # [(\'tea\', 3), (\'milk\', 1)]', caption: 'The counting dictionary from Module 4, already written and with a top-n built in.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Writing it out by hand first was not wasted. You now recognise what Counter is doing and when it fits — which is the difference between using a library and hoping.'
        },
        { kind: 'text', text: 'Also worth knowing by name: `csv` for spreadsheet files, `json` for structured data, `re` for pattern matching in text, `statistics` for mean and median, `argparse` for command-line options, `sqlite3` for a real database with no server to install.' },
        { kind: 'check', questionId: 'm6l7q1' }
      ],
      questions: [
        {
          id: 'm6l7q1',
          kind: 'choice',
          concept: 'stdlib',
          prompt: 'What should you do before writing a function to count how often each item appears in a list?',
          difficulty: 'intermediate',
          options: [
            'Write it — the standard library has nothing like that',
            'Check the standard library, which has Counter for exactly this',
            'Install a package',
            'Use a set'
          ],
          answer: 1,
          explanation: 'Check first. collections.Counter does it, with most_common built in, and it has been tested by far more people than your version will be.',
          hints: ['One of the modules in this lesson does precisely this.']
        },
        {
          id: 'm6l7q2',
          kind: 'choice',
          concept: 'stdlib',
          prompt: 'Why use pathlib rather than joining path strings with + ?',
          difficulty: 'advanced',
          options: [
            'It is shorter',
            'It gets the separator right on every system and handles the awkward cases for you',
            '+ does not work on strings',
            'There is no difference'
          ],
          answer: 1,
          explanation: 'Path joining by hand goes wrong on separators, duplicated slashes and relative paths. pathlib handles all of it and reads better.',
          hints: ['What differs between Windows and everything else here?']
        }
      ]
    },

    // ------------------------------------------------------------------ 8
    {
      id: 'm6l8',
      title: 'JSON',
      intro: 'Saving a dictionary or a list and getting it back exactly as it was.',
      objectives: ['Write JSON to a file and read it back', 'Explain what JSON cannot hold', 'Handle a damaged JSON file'],
      concepts: ['json'],
      requires: ['writing-files', 'nested-data', 'modules'],
      minutes: 13,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'Writing a dictionary to a text file and parsing it back is a job nobody should do by hand. JSON is a format that holds lists and dictionaries directly, and Python reads and writes it in one call each.' },
        { kind: 'code', language: 'python', code: 'import json\n\ndata = {\n    "name": "Sam",\n    "tasks": ["wash up", "email Bea"],\n    "done": 3\n}\n\nwith open("data.json", "w") as f:\n    json.dump(data, f, indent=2)\n\nwith open("data.json") as f:\n    back = json.load(f)\n\nprint(back["tasks"][0])   # wash up\nprint(back == data)       # True', caption: 'dump writes, load reads. indent=2 makes the file readable by a person.' },
        { kind: 'heading', text: 'What it can hold' },
        {
          kind: 'table',
          headers: ['Python', 'JSON'],
          rows: [
            ['dict', 'object'],
            ['list', 'array'],
            ['str', 'string'],
            ['int / float', 'number'],
            ['True / False', 'true / false'],
            ['None', 'null'],
            ['tuple', 'array — and it comes back as a list'],
            ['set, custom objects', 'not supported at all']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'A tuple goes out and comes back as a list. A set raises TypeError: Object of type set is not JSON serializable — convert it with list() first, and expect no order when you read it back.'
        },
        { kind: 'heading', text: 'When the file is damaged' },
        { kind: 'code', language: 'python', code: 'import json\n\ndef load(path):\n    try:\n        with open(path) as f:\n            return json.load(f)\n    except FileNotFoundError:\n        return {}                       # nothing saved yet — fine\n    except json.JSONDecodeError:\n        raise                           # damaged — do not quietly pretend it is empty', caption: 'Two very different situations, deliberately handled differently.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Returning {} for a damaged file is how data gets destroyed: the program carries on with nothing, saves, and overwrites the file that was merely unreadable. "Never saved" and "cannot be read" are not the same thing and must not get the same answer.'
        },
        { kind: 'check', questionId: 'm6l8q1' },
        { kind: 'check', questionId: 'm6l8q2' }
      ],
      questions: [
        {
          id: 'm6l8q1',
          kind: 'choice',
          concept: 'json',
          prompt: 'You save  {"a": (1, 2)}  as JSON and read it back. What is the value of "a"?',
          difficulty: 'advanced',
          options: ['(1, 2) — a tuple', '[1, 2] — a list', 'A string', 'An error on saving'],
          answer: 1,
          explanation: 'A list. JSON has no tuple, so it is written as an array and comes back as a list. If the distinction matters, convert it after loading.',
          hints: ['Does JSON have a tuple?']
        },
        {
          id: 'm6l8q2',
          kind: 'choice',
          concept: 'json',
          prompt: 'Why should a damaged JSON file not be treated the same as a missing one?',
          difficulty: 'advanced',
          options: [
            'They are the same',
            'A missing file means nothing was saved; a damaged one means data exists and cannot be read — carrying on empty overwrites it',
            'Damaged files cannot be opened',
            'Missing files are a worse problem'
          ],
          answer: 1,
          explanation: 'Treating unreadable as empty is how the next save destroys real data. Missing is normal; damaged is a problem that should be reported, not papered over.',
          hints: ['What happens on the next save in each case?']
        }
      ]
    },

    // ------------------------------------------------------------------ 9
    {
      id: 'm6l9',
      title: 'Installing packages',
      intro: 'pip, virtual environments, and reading a library you have never seen before.',
      objectives: ['Install a package into a virtual environment', 'Explain what a virtual environment is for', 'Record dependencies'],
      concepts: ['packages'],
      requires: ['modules'],
      minutes: 11,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'The standard library is large and the wider ecosystem is enormous. pip is the tool that installs from it.' },
        { kind: 'code', language: 'python', code: '# At a terminal, not inside Python:\n#   pip install requests\n#   pip list\n#   pip uninstall requests\n\nimport requests   # once installed, an ordinary import', caption: 'pip commands are typed at the terminal; the import is normal Python.' },
        { kind: 'heading', text: 'Virtual environments' },
        { kind: 'text', text: 'Installing everything system-wide means two projects that need different versions of the same library cannot both work. A virtual environment is a private set of packages for one project.' },
        { kind: 'code', language: 'python', code: '#   python -m venv .venv\n#   .venv\\Scripts\\activate     (Windows)\n#   source .venv/bin/activate  (Mac and Linux)\n#   pip install requests\n\n# Then, for anybody else:\n#   pip freeze > requirements.txt\n#   pip install -r requirements.txt', caption: 'Make one per project. It costs seconds and prevents a whole category of problem.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'requirements.txt is how somebody else — including you, on another machine — gets the same set of packages. A project without one is a project that works only where it was written.'
        },
        { kind: 'heading', text: 'Choosing one' },
        {
          kind: 'list',
          items: [
            'Is it maintained? Look at when it was last released',
            'Is it widely used? Many users means the obvious bugs are found',
            'What is its licence? It decides what you may do with your own work',
            'Does it need a compiler, or is it pure Python?'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Check the name character by character before installing. Packages with names one letter away from popular ones are a real and common attack, and pip install runs the package\'s own setup code on your machine.'
        },
        { kind: 'heading', text: 'Reading a library you do not know' },
        { kind: 'code', language: 'python', code: 'import requests\nprint(help(requests.get))      # its documentation\nprint(dir(requests))           # what is in it', caption: 'Both work on any module, including your own.' },
        { kind: 'text', text: 'And in order: the quickstart in its documentation, then the function you need, then — when the documentation is unclear — the source. All three are faster than guessing.' },
        { kind: 'check', questionId: 'm6l9q1' }
      ],
      questions: [
        {
          id: 'm6l9q1',
          kind: 'choice',
          concept: 'packages',
          prompt: 'What is a virtual environment for?',
          difficulty: 'intermediate',
          options: [
            'Running Python faster',
            'Giving each project its own set of packages, so projects needing different versions do not clash',
            'Hiding your code',
            'Running Python without installing it'
          ],
          answer: 1,
          explanation: 'Isolation per project. Without one, two projects needing different versions of the same library cannot both work on one machine.',
          hints: ['What happens when two projects need different versions?']
        },
        {
          id: 'm6l9q2',
          kind: 'choice',
          concept: 'packages',
          prompt: 'Why check a package name carefully before installing?',
          difficulty: 'advanced',
          options: [
            'A typo wastes time',
            'Packages named one letter from popular ones are a known attack, and installing runs their own code on your machine',
            'pip charges for failed installs',
            'Names are case sensitive'
          ],
          answer: 1,
          explanation: 'Installing runs the package\'s setup code. A near-miss name is a deliberate trap, and it is a well-documented way machines get compromised.',
          hints: ['What does pip install actually execute?']
        },
        {
          id: 'm6l9q3',
          kind: 'short',
          concept: 'packages',
          prompt: 'What file records which packages a project needs?',
          difficulty: 'beginner',
          answer: 'requirements.txt',
          accepts: ['requirements', 'requirements file', 'a requirements.txt'],
          explanation: 'requirements.txt, made with pip freeze and installed from with pip install -r.',
          hints: ['pip freeze writes it.']
        }
      ]
    },

    // ------------------------------------------------------------------ 10
    {
      id: 'm6l10',
      title: 'Files and errors challenge',
      intro: 'Reading, writing, failing safely, and the traps from this module.',
      objectives: ['Combine file handling, error handling and validation'],
      concepts: ['reading-files', 'writing-files', 'exceptions', 'validation', 'json', 'modules'],
      requires: ['json', 'validation', 'exceptions'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'check', questionId: 'm6c1' },
        { kind: 'check', questionId: 'm6c2' },
        { kind: 'check', questionId: 'm6c3' },
        { kind: 'check', questionId: 'm6c4' },
        { kind: 'check', questionId: 'm6c5' },
        { kind: 'check', questionId: 'm6c6' }
      ],
      questions: [
        {
          id: 'm6c1',
          kind: 'choice',
          concept: 'writing-files',
          prompt: 'This should add a line to a log and keeps destroying it. Why?\n\nwith open("log.txt", "w") as f:\n    f.write("event\\n")',
          difficulty: 'intermediate',
          options: [
            'write is wrong — use print',
            '"w" empties the file; "a" is the mode that adds',
            'The newline is wrong',
            'The file must be opened twice'
          ],
          answer: 1,
          explanation: '"w" empties the file on opening. For a log you want "a".',
          hints: ['Look at the mode.']
        },
        {
          id: 'm6c2',
          kind: 'choice',
          concept: 'exceptions',
          prompt: 'What does this print when the file is missing?\n\ntry:\n    with open("x.txt") as f:\n        print(f.read())\nexcept FileNotFoundError:\n    print("none")\nfinally:\n    print("end")',
          difficulty: 'intermediate',
          options: ['none', 'end', 'none then end', 'An error'],
          answer: 2,
          explanation: 'none, then end. The except handles the missing file and finally runs whatever happened.',
          hints: ['When does finally run?']
        },
        {
          id: 'm6c3',
          kind: 'choice',
          concept: 'reading-files',
          prompt: 'Why does this crash on most files?\n\nwith open("nums.txt") as f:\n    total = sum(int(line) for line in f)',
          difficulty: 'advanced',
          options: [
            'sum cannot take a generator',
            'A file usually ends with a blank line, and int("") is a ValueError',
            'int cannot read from a file',
            'The file needs mode "r"'
          ],
          answer: 1,
          explanation: 'The trailing blank line. Filter it out: int(line) for line in f if line.strip().',
          hints: ['What is the very last line of most text files?']
        },
        {
          id: 'm6c4',
          kind: 'choice',
          concept: 'json',
          prompt: 'What does json.dump raise if the data contains a set?',
          difficulty: 'advanced',
          options: ['Nothing — it becomes an array', 'A TypeError, because a set is not JSON serializable', 'A ValueError', 'It saves as null'],
          answer: 1,
          explanation: 'A TypeError. JSON has no set. Convert it with list() first, and accept that order is not preserved.',
          hints: ['Is there a set in JSON?']
        },
        {
          id: 'm6c5',
          kind: 'multi',
          concept: 'validation',
          prompt: 'Accepting a quantity between 1 and 100 from somebody typing. Which checks are needed? (Choose all that apply.)',
          difficulty: 'advanced',
          options: [
            'That int() succeeds on it',
            'That the value is at least 1',
            'That the value is at most 100',
            'That it is not an empty string after stripping'
          ],
          answer: [0, 1, 2, 3],
          explanation: 'All four. Type, both ends of the range, and the empty case — which looks like an answer and is not one.',
          hints: ['Think about what each separate thing could be wrong with.']
        },
        {
          id: 'm6c6',
          kind: 'short',
          concept: 'exceptions',
          prompt: 'Why is  except ValueError:  better than  except:  when converting input?',
          difficulty: 'advanced',
          answer: 'a bare except also catches your own bugs and reports them as the expected problem',
          accepts: ['it catches everything including typos', 'bare except hides other errors', 'it would swallow NameError too'],
          explanation: 'Naming the error means only the problem you anticipated is handled. A bare except swallows your own mistakes and reports them as bad input.',
          hints: ['What else could go wrong inside that block?']
        }
      ]
    }
  ]
}
