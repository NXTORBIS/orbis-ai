import type { Module } from '../../types.ts'

/**
 * Module 4 — Collections and Data.
 *
 * Lists, tuples, sets and dictionaries, then nesting them. The lesson that matters most here is the last one:
 * choosing the right structure is usually what makes a problem easy, and choosing the wrong one is usually what
 * makes it hard.
 */
export const MODULE_4: Module = {
  id: 'm4',
  title: 'Collections and Data',
  summary: 'Holding many values at once: lists, tuples, sets and dictionaries, how to go through them, and which to pick.',
  concepts: [
    'lists', 'list-methods', 'tuples', 'sets', 'dicts', 'dict-methods',
    'nested-data', 'iterating-data', 'comprehensions', 'data-wrangling', 'choosing-structures'
  ],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'm4l1',
      title: 'Lists',
      intro: 'Many values in one name, in order, and changeable.',
      objectives: ['Create and index a list', 'Change an item', 'Slice a list'],
      concepts: ['lists'],
      requires: ['variables', 'for-loops'],
      minutes: 12,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'shopping = ["tea", "milk", "bread"]\nprint(shopping)        # [\'tea\', \'milk\', \'bread\']\nprint(shopping[0])     # tea\nprint(shopping[-1])    # bread\nprint(len(shopping))   # 3', caption: 'Square brackets, items separated by commas. Positions start at 0, as with strings.' },
        { kind: 'text', text: 'A list keeps its order, allows duplicates, and may hold anything — including a mixture, though in practice a list usually holds one kind of thing.' },
        { kind: 'code', language: 'python', code: 'empty = []\nnumbers = [4, 8, 15, 16]\nmixed = ["Sam", 19, True, 1.75]\nrepeated = ["yes", "yes", "no"]' },
        { kind: 'heading', text: 'Lists can be changed' },
        { kind: 'text', text: 'This is the big difference from strings. You can assign straight into a position.' },
        { kind: 'code', language: 'python', code: 'shopping = ["tea", "milk", "bread"]\nshopping[1] = "oat milk"\nprint(shopping)   # [\'tea\', \'oat milk\', \'bread\']', caption: 'Try the same thing on a string and you get a TypeError.' },
        { kind: 'heading', text: 'Slices work the same way' },
        { kind: 'code', language: 'python', code: 'numbers = [10, 20, 30, 40, 50]\nprint(numbers[1:3])   # [20, 30]\nprint(numbers[:2])    # [10, 20]\nprint(numbers[-2:])   # [40, 50]', caption: 'A slice of a list gives you a new list.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Asking for a position that does not exist is an IndexError. numbers[5] on a five-item list fails — the last position is 4. Checking against len() before indexing is a habit worth having.'
        },
        { kind: 'heading', text: 'Going through one' },
        { kind: 'code', language: 'python', code: 'for item in shopping:\n    print(f"- {item}")\n\n# When you need the position too:\nfor i, item in enumerate(shopping):\n    print(f"{i + 1}. {item}")', caption: 'enumerate hands you the position and the item together.' },
        { kind: 'check', questionId: 'm4l1q1' },
        { kind: 'check', questionId: 'm4l1q2' }
      ],
      questions: [
        {
          id: 'm4l1q1',
          kind: 'choice',
          concept: 'lists',
          prompt: 'What does  [10, 20, 30, 40][1:3]  give?',
          difficulty: 'beginner',
          options: ['[10, 20]', '[20, 30]', '[20, 30, 40]', '[30, 40]'],
          answer: 1,
          explanation: '[20, 30] — positions 1 and 2. The stop is not included, same as with strings.',
          hints: ['Start included, stop not included.']
        },
        {
          id: 'm4l1q2',
          kind: 'choice',
          concept: 'lists',
          prompt: 'What happens with  nums = [1, 2, 3]  and then  nums[3] = 4 ?',
          difficulty: 'intermediate',
          options: [
            'The list becomes [1, 2, 3, 4]',
            'An IndexError — position 3 does not exist in a three-item list',
            'Nothing happens',
            'The last item is replaced'
          ],
          answer: 1,
          explanation: 'An IndexError. Assigning to a position only works where there already is one; the valid positions here are 0, 1 and 2. To grow a list you use .append().',
          hints: ['What are the valid positions in a list of three?']
        },
        {
          id: 'm4l1q3',
          kind: 'true-false',
          concept: 'lists',
          prompt: 'Unlike a string, a list can be changed after it is made.',
          difficulty: 'beginner',
          answer: true,
          explanation: 'True. You can assign into a position, add items and remove them. Strings cannot be changed in place at all.',
          hints: ['Which one did Module 2 say hands back a new value instead of changing?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'm4l2',
      title: 'Working with lists',
      intro: 'Adding, removing, sorting, searching — and the method that silently destroys your original.',
      objectives: ['Use the common list methods', 'Explain the difference between sort() and sorted()', 'Remove an item safely'],
      concepts: ['list-methods'],
      requires: ['lists'],
      minutes: 14,
      difficulty: 'beginner',
      required: true,
      blocks: [
        { kind: 'heading', text: 'Adding' },
        { kind: 'code', language: 'python', code: 'jobs = []\njobs.append("wash up")          # one item on the end\njobs.insert(0, "urgent")        # at a position\njobs.extend(["email", "tidy"])  # several at once\nprint(jobs)', caption: 'append takes one item; extend takes a list of them.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'jobs.append(["a", "b"]) adds the list itself as a single item, giving a list with a list inside. If you meant to add two items, that is extend.'
        },
        { kind: 'heading', text: 'Removing' },
        { kind: 'code', language: 'python', code: 'jobs.remove("tidy")   # by value — ValueError if it is not there\nlast = jobs.pop()     # takes the last one off and hands it back\nfirst = jobs.pop(0)   # by position\njobs.clear()          # empty it' },
        { kind: 'heading', text: 'Searching' },
        { kind: 'code', language: 'python', code: 'names = ["Ali", "Bea", "Cal", "Bea"]\nprint("Bea" in names)        # True\nprint(names.index("Bea"))    # 1 — the first one\nprint(names.count("Bea"))    # 2', caption: '`in` is the one you will use most, and it reads like English.' },
        { kind: 'heading', text: 'Sorting — and the trap' },
        { kind: 'code', language: 'python', code: 'numbers = [4, 1, 3]\n\nnumbers.sort()              # changes numbers, returns None\nprint(numbers)              # [1, 3, 4]\n\nordered = sorted([4, 1, 3]) # leaves the original alone, hands back a new list\nprint(ordered)              # [1, 3, 4]', caption: 'Two ways to sort, and they do quite different things.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'numbers = numbers.sort() sets numbers to None, because sort() changes the list in place and returns nothing. Your list is gone. Use sorted() when you want a result to assign, and sort() on its own line when you want to rearrange in place.'
        },
        { kind: 'code', language: 'python', code: 'print(sorted(["pear", "apple"]))              # alphabetical\nprint(sorted([3, 1, 2], reverse=True))        # [3, 2, 1]\nprint(sorted(["bb", "a", "ccc"], key=len))    # by length' },
        { kind: 'heading', text: 'Numbers in one word' },
        { kind: 'code', language: 'python', code: 'scores = [70, 85, 62, 91]\nprint(sum(scores))\nprint(max(scores), min(scores))\nprint(sum(scores) / len(scores))   # the average', caption: 'The four loop patterns from Module 3, built in.' },
        { kind: 'check', questionId: 'm4l2q1' },
        { kind: 'check', questionId: 'm4l2q2' }
      ],
      questions: [
        {
          id: 'm4l2q1',
          kind: 'choice',
          concept: 'list-methods',
          prompt: 'What does this print?\n\nnums = [3, 1, 2]\nnums = nums.sort()\nprint(nums)',
          difficulty: 'advanced',
          options: ['[1, 2, 3]', '[3, 1, 2]', 'None', 'An error'],
          answer: 2,
          explanation: 'None. sort() rearranges the list in place and returns nothing, so assigning its result overwrites the list with None. Use sorted() if you want to assign.',
          hints: ['What does sort() hand back?']
        },
        {
          id: 'm4l2q2',
          kind: 'choice',
          concept: 'list-methods',
          prompt: 'What is  len(x)  after this?\n\nx = [1, 2]\nx.append([3, 4])',
          difficulty: 'intermediate',
          options: ['2', '3', '4', 'An error'],
          answer: 1,
          explanation: '3. append adds its argument as one item, so x is [1, 2, [3, 4]]. extend would have given four items.',
          hints: ['Does append add one thing or several?']
        },
        {
          id: 'm4l2q3',
          kind: 'short',
          concept: 'list-methods',
          prompt: 'How would you get the average of a list of numbers called scores?',
          difficulty: 'intermediate',
          answer: 'sum(scores) / len(scores)',
          accepts: ['sum(scores)/len(scores)', 'total divided by count'],
          explanation: 'sum(scores) / len(scores). Worth a guard in real code: an empty list makes len() zero and dividing by zero crashes.',
          hints: ['Two built-in functions, divided.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'm4l3',
      title: 'Tuples and sets',
      intro: 'A list that cannot change, and a collection with no duplicates.',
      objectives: ['Say when a tuple is the right choice', 'Use a set to remove duplicates', 'Explain what a set gives up'],
      concepts: ['tuples', 'sets'],
      requires: ['lists'],
      minutes: 12,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'heading', text: 'Tuples — fixed' },
        { kind: 'code', language: 'python', code: 'point = (3, 7)\nprint(point[0])    # 3\n\npoint[0] = 5\n# TypeError: tuple object does not support item assignment', caption: 'Round brackets, and no changing it afterwards.' },
        { kind: 'text', text: 'Use a tuple when the group is a single thing whose parts should not move: coordinates, a red-green-blue colour, a row from a file, a pair of return values. "This is a point" rather than "these are some numbers I might add to".' },
        { kind: 'code', language: 'python', code: 'x, y = (3, 7)        # unpacking — very common\nprint(x, y)\n\nname, age = "Sam", 19  # the brackets are optional', caption: 'Unpacking is the main reason tuples turn up everywhere.' },
        { kind: 'heading', text: 'Sets — no duplicates, no order' },
        { kind: 'code', language: 'python', code: 'tags = {"python", "code", "python"}\nprint(tags)          # {\'python\', \'code\'} — the repeat is gone\nprint(len(tags))     # 2\n\nnumbers = [1, 2, 2, 3, 3, 3]\nprint(set(numbers))        # {1, 2, 3}\nprint(list(set(numbers)))  # back to a list, duplicates removed', caption: 'Curly brackets. Removing duplicates is the commonest use by far.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'A set has no order, so there is no set[0] and the order you see when printing it is not something to rely on. That is the price of its two advantages: no duplicates, and very fast membership checks.'
        },
        { kind: 'code', language: 'python', code: 'a = {1, 2, 3}\nb = {3, 4, 5}\nprint(a & b)   # {3}          in both\nprint(a | b)   # {1,2,3,4,5}  in either\nprint(a - b)   # {1, 2}       in a only', caption: 'Comparing two groups, which is otherwise a nested loop.' },
        { kind: 'text', text: 'And `x in some_set` stays fast however large the set is, while `x in some_list` has to look through item by item. For a membership test over a lot of data, that difference is enormous.' },
        {
          kind: 'callout',
          tone: 'note',
          text: '{} on its own is an empty dictionary, not an empty set. An empty set is set(). A small wart in the language, and worth knowing before it confuses you.'
        },
        { kind: 'check', questionId: 'm4l3q1' },
        { kind: 'check', questionId: 'm4l3q2' }
      ],
      questions: [
        {
          id: 'm4l3q1',
          kind: 'number',
          concept: 'sets',
          prompt: 'What is  len({1, 2, 2, 3, 3, 3}) ?',
          difficulty: 'beginner',
          answer: 3,
          explanation: '3. A set keeps only one of each value, so the repeats vanish.',
          hints: ['Count the distinct values.']
        },
        {
          id: 'm4l3q2',
          kind: 'choice',
          concept: 'tuples',
          prompt: 'Which is the best use for a tuple rather than a list?',
          difficulty: 'intermediate',
          options: [
            'A shopping list you will add to',
            'An (x, y) coordinate',
            'A list of scores that will be sorted',
            'Items read one at a time from a file'
          ],
          answer: 1,
          explanation: 'The coordinate. It is one thing made of fixed parts, and x and y are not items that get appended or removed. The other three all change.',
          hints: ['Which one should never gain or lose a member?']
        },
        {
          id: 'm4l3q3',
          kind: 'choice',
          concept: 'sets',
          prompt: 'What does a set give up in exchange for having no duplicates?',
          difficulty: 'intermediate',
          options: [
            'The ability to hold strings',
            'Order, and therefore indexing by position',
            'The ability to be looped over',
            'Nothing'
          ],
          answer: 1,
          explanation: 'Order. There is no set[0], and the printing order is not something to depend on. You can still loop over it.',
          hints: ['Can you ask a set for its first item?']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'm4l4',
      title: 'Dictionaries',
      intro: 'Looking something up by name instead of by position. The most useful structure in Python.',
      objectives: ['Create and read a dictionary', 'Add and change entries', 'Handle a missing key without crashing'],
      concepts: ['dicts'],
      requires: ['lists'],
      minutes: 14,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'A list answers "what is in position 3". A dictionary answers "what is the price of tea" — and that is the question real problems usually ask.' },
        { kind: 'code', language: 'python', code: 'person = {\n    "name": "Sam",\n    "age": 19,\n    "city": "Leeds"\n}\n\nprint(person["name"])   # Sam\nprint(person["age"])    # 19', caption: 'Curly brackets, and key: value pairs.' },
        { kind: 'text', text: 'Keys are usually strings and must be unique. Values can be anything, including lists and other dictionaries.' },
        { kind: 'heading', text: 'Adding and changing' },
        { kind: 'code', language: 'python', code: 'person["email"] = "sam@example.com"   # new key — just assign\nperson["age"] = 20                   # existing key — replaced\ndel person["city"]                   # removed\nprint(len(person))', caption: 'Unlike a list, assigning to a key that does not exist creates it.' },
        { kind: 'heading', text: 'A missing key' },
        { kind: 'code', language: 'python', code: 'print(person["phone"])\n# KeyError: \'phone\'\n\nprint(person.get("phone"))            # None — no crash\nprint(person.get("phone", "unknown")) # unknown — your own fallback\n\nif "phone" in person:\n    print(person["phone"])', caption: 'Square brackets crash on a missing key; .get() does not.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Use square brackets when the key must be there and its absence is a real problem — crashing loudly beats carrying on with nonsense. Use .get() with a fallback when the key is genuinely optional.'
        },
        { kind: 'heading', text: 'Counting things — the pattern you will reuse for ever' },
        { kind: 'code', language: 'python', code: 'words = ["tea", "milk", "tea", "tea"]\ncounts = {}\n\nfor word in words:\n    counts[word] = counts.get(word, 0) + 1\n\nprint(counts)   # {\'tea\': 3, \'milk\': 1}', caption: 'get(word, 0) gives zero the first time a word appears, so nothing special is needed for the first one.' },
        { kind: 'text', text: 'That is six lines doing what is genuinely hard with lists alone. Counting, grouping and tallying are where dictionaries earn their place.' },
        { kind: 'check', questionId: 'm4l4q1' },
        { kind: 'check', questionId: 'm4l4q2' }
      ],
      questions: [
        {
          id: 'm4l4q1',
          kind: 'choice',
          concept: 'dicts',
          prompt: 'What happens with  d = {"a": 1}  and then  print(d["b"]) ?',
          difficulty: 'intermediate',
          options: ['It prints None', 'It prints 0', 'A KeyError', 'It creates the key'],
          answer: 2,
          explanation: 'A KeyError. Square brackets insist the key exists. d.get("b") would hand back None instead.',
          hints: ['Reading with brackets versus reading with .get() — which is forgiving?']
        },
        {
          id: 'm4l4q2',
          kind: 'choice',
          concept: 'dicts',
          prompt: 'Why is  counts[word] = counts.get(word, 0) + 1  better than  counts[word] = counts[word] + 1 ?',
          difficulty: 'advanced',
          options: [
            'It is shorter',
            'It works the first time a word appears, when there is no entry yet',
            'It is faster',
            'There is no difference'
          ],
          answer: 1,
          explanation: 'The first time a word is seen there is no entry, so the bracket version raises a KeyError. .get(word, 0) supplies the zero that makes the first time work like every other time.',
          hints: ['What is in counts for a word you have not seen yet?']
        },
        {
          id: 'm4l4q3',
          kind: 'short',
          concept: 'dicts',
          prompt: 'How do you read a key from a dictionary d with "none" if the key is missing?',
          difficulty: 'intermediate',
          answer: 'd.get(key, "none")',
          accepts: ['d.get("key", "none")', 'using .get with a default'],
          explanation: 'd.get(key, "none"). The second argument is the fallback, used when the key is not there.',
          hints: ['One method takes a second argument for exactly this.']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'm4l5',
      title: 'Going through a dictionary',
      intro: 'Keys, values, both at once — and sorting the result.',
      objectives: ['Loop over keys, values and items', 'Sort a dictionary by its values'],
      concepts: ['dict-methods', 'iterating-data'],
      requires: ['dicts', 'for-loops'],
      minutes: 11,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'prices = {"tea": 2.50, "milk": 1.20, "bread": 1.80}\n\nfor item in prices:                      # keys, by default\n    print(item)\n\nfor price in prices.values():\n    print(price)\n\nfor item, price in prices.items():       # both — the useful one\n    print(f"{item}: £{price:.2f}")', caption: '.items() hands you a key and a value each pass.' },
        { kind: 'text', text: 'Looping a dictionary gives you its keys, not its values. Remembering that saves one puzzled afternoon.' },
        { kind: 'heading', text: 'Totals and extremes' },
        { kind: 'code', language: 'python', code: 'print(sum(prices.values()))          # 5.5\nprint(len(prices))                   # 3\nprint(max(prices, key=prices.get))   # tea — the key with the biggest value', caption: 'max over a dictionary compares keys unless you tell it to use the values.' },
        { kind: 'heading', text: 'Sorting' },
        { kind: 'code', language: 'python', code: 'for item, price in sorted(prices.items()):\n    print(item, price)                      # alphabetical by key\n\nfor item, price in sorted(prices.items(), key=lambda pair: pair[1], reverse=True):\n    print(f"{item}: £{price:.2f}")          # dearest first', caption: 'key= says what to sort on; pair[1] is the value half of each pair.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'lambda is a one-line unnamed function, covered properly in Module 5. Here it only means "for each pair, sort on its second part".'
        },
        { kind: 'heading', text: 'The top three of a tally' },
        { kind: 'code', language: 'python', code: 'counts = {"tea": 7, "milk": 2, "bread": 5, "jam": 9}\nranked = sorted(counts.items(), key=lambda pair: pair[1], reverse=True)\n\nfor item, n in ranked[:3]:\n    print(f"{item}: {n}")', caption: 'Count into a dictionary, sort by value, slice the top few. This answers an enormous number of real questions.' },
        { kind: 'check', questionId: 'm4l5q1' }
      ],
      questions: [
        {
          id: 'm4l5q1',
          kind: 'choice',
          concept: 'dict-methods',
          prompt: 'What does  for x in prices:  give you on each pass?',
          difficulty: 'intermediate',
          options: ['The values', 'The keys', 'A key-and-value pair', 'Nothing — a dictionary cannot be looped over'],
          answer: 1,
          explanation: 'The keys. For values use .values(), and for both at once use .items().',
          hints: ['Which half does a plain loop hand you?']
        },
        {
          id: 'm4l5q2',
          kind: 'short',
          concept: 'dict-methods',
          prompt: 'How do you add up all the values in a dictionary called prices?',
          difficulty: 'intermediate',
          answer: 'sum(prices.values())',
          accepts: ['sum(prices.values())', 'sum of prices.values()'],
          explanation: 'sum(prices.values()). sum(prices) on its own would try to add the keys, which with string keys is a TypeError.',
          hints: ['sum needs to be handed the value half.']
        },
        {
          id: 'm4l5q3',
          kind: 'choice',
          concept: 'iterating-data',
          prompt: 'What does  key=lambda pair: pair[1]  do inside sorted(d.items(), ...) ?',
          difficulty: 'advanced',
          options: [
            'Sorts by key',
            'Sorts by value, because pair[1] is the value half of each pair',
            'Reverses the order',
            'Removes duplicates'
          ],
          answer: 1,
          explanation: 'It sorts by value. Each item is a (key, value) pair, so pair[1] is the value, and that is what sorted compares.',
          hints: ['What is at position 1 of a (key, value) pair?']
        }
      ]
    },

    // ------------------------------------------------------------------ 6
    {
      id: 'm4l6',
      title: 'Structures inside structures',
      intro: 'A list of dictionaries — the shape nearly all real data arrives in.',
      objectives: ['Read a value from a nested structure', 'Loop over a list of dictionaries', 'Filter and total nested data'],
      concepts: ['nested-data'],
      requires: ['dicts', 'lists'],
      minutes: 14,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'Any value can hold another collection, and the combination that matters most is a list of dictionaries: several records, each with named fields. Spreadsheets, database rows, and nearly every reply from a web service look like this.' },
        { kind: 'code', language: 'python', code: 'students = [\n    {"name": "Ali", "score": 72, "year": 2},\n    {"name": "Bea", "score": 91, "year": 1},\n    {"name": "Cal", "score": 65, "year": 2}\n]\n\nprint(students[0]["name"])    # Ali\nprint(len(students))          # 3', caption: 'Read it left to right: item 0 of the list, then its "name" field.' },
        { kind: 'heading', text: 'Going through it' },
        { kind: 'code', language: 'python', code: 'for student in students:\n    print(f"{student[\'name\']}: {student[\'score\']}")\n\n# Average\ntotal = sum(s["score"] for s in students)\nprint(f"Average: {total / len(students):.1f}")\n\n# Just the second years\nfor s in students:\n    if s["year"] == 2:\n        print(s["name"])', caption: 'The four loop patterns again, now over records.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Inside an f-string use single quotes for the key when the string itself uses double quotes: f"{student[\'name\']}". Matching the outer quotes ends the string early and gives a SyntaxError.'
        },
        { kind: 'heading', text: 'Deeper' },
        { kind: 'code', language: 'python', code: 'school = {\n    "name": "Oakfield",\n    "classes": {\n        "maths": {"teacher": "Ms Dey", "students": ["Ali", "Bea"]},\n        "art":   {"teacher": "Mr Opp", "students": ["Cal"]}\n    }\n}\n\nprint(school["classes"]["maths"]["teacher"])     # Ms Dey\nprint(len(school["classes"]["maths"]["students"]))  # 2\n\nfor subject, detail in school["classes"].items():\n    print(f"{subject}: {detail[\'teacher\']}, {len(detail[\'students\'])} students")' },
        { kind: 'text', text: 'Read a chain of brackets one step at a time and say what each step gives you. `school["classes"]` is a dictionary; `["maths"]` of that is a dictionary; `["teacher"]` of that is a string. Nothing is mysterious if you do not try to read it all at once.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Deep chains break loudly on a single missing key. .get() at each level, or a check before you go deeper, is what keeps a program working on imperfect data — which all real data is.'
        },
        { kind: 'check', questionId: 'm4l6q1' },
        { kind: 'check', questionId: 'm4l6q2' }
      ],
      questions: [
        {
          id: 'm4l6q1',
          kind: 'choice',
          concept: 'nested-data',
          prompt: 'With  data = [{"a": [1, 2]}, {"a": [3]}], what is  data[0]["a"][1] ?',
          difficulty: 'advanced',
          options: ['1', '2', '3', 'An error'],
          answer: 1,
          explanation: '2. Item 0 of the list is the first dictionary; its "a" is [1, 2]; position 1 of that is 2.',
          hints: ['Take one bracket at a time and say what you have after each.']
        },
        {
          id: 'm4l6q2',
          kind: 'short',
          concept: 'nested-data',
          prompt: 'Given a list of dictionaries called items, each with a "price" key, how would you total the prices?',
          difficulty: 'advanced',
          answer: 'sum(i["price"] for i in items)',
          accepts: ['loop and add i["price"]', 'sum of item["price"] for each item', 'total += i["price"] in a loop'],
          explanation: 'sum(i["price"] for i in items), or the long form: total = 0 and total += i["price"] inside a loop. Both are the accumulator pattern.',
          hints: ['You need the price out of each record, then added up.']
        },
        {
          id: 'm4l6q3',
          kind: 'choice',
          concept: 'nested-data',
          prompt: 'Why does  f"{s["name"]}"  cause a SyntaxError?',
          difficulty: 'advanced',
          options: [
            'Keys are not allowed in f-strings',
            'The inner double quote ends the string early — use single quotes inside',
            'f-strings cannot contain brackets',
            'It needs a str() around it'
          ],
          answer: 1,
          explanation: 'The double quote before name closes the string. Use f"{s[\'name\']}" so the inner quotes are a different kind from the outer ones.',
          hints: ['Count the double quotes and see where Python thinks the string ends.']
        }
      ]
    },

    // ------------------------------------------------------------------ 7
    {
      id: 'm4l7',
      title: 'Comprehensions',
      intro: 'Building a list from another in one line — and knowing when not to.',
      objectives: ['Write a list comprehension with and without a condition', 'Rewrite a loop as a comprehension', 'Say when a plain loop is better'],
      concepts: ['comprehensions'],
      requires: ['lists', 'for-loops'],
      minutes: 12,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: '"Make a new list by doing something to each item of this one" is such a common shape that Python has a compact form for it.' },
        { kind: 'code', language: 'python', code: '# The long way\nsquares = []\nfor n in range(1, 6):\n    squares.append(n ** 2)\n\n# The same thing\nsquares = [n ** 2 for n in range(1, 6)]\nprint(squares)   # [1, 4, 9, 16, 25]', caption: 'Read it as: this expression, for each of these.' },
        { kind: 'heading', text: 'With a condition' },
        { kind: 'code', language: 'python', code: 'numbers = [4, 7, 10, 13, 16]\n\nevens = [n for n in numbers if n % 2 == 0]\nprint(evens)   # [4, 10, 16]\n\nnames = ["ali", "bea", "cal"]\nprint([n.upper() for n in names])\n\nstudents = [{"name": "Ali", "score": 72}, {"name": "Bea", "score": 45}]\nprint([s["name"] for s in students if s["score"] >= 50])   # [\'Ali\']', caption: 'The if goes at the end and filters what gets in.' },
        { kind: 'heading', text: 'Dictionaries and sets too' },
        { kind: 'code', language: 'python', code: 'words = ["tea", "coffee"]\nprint({w: len(w) for w in words})       # {\'tea\': 3, \'coffee\': 6}\nprint({len(w) for w in words})          # {3, 6} — a set' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'They are for simple transformations. Once a comprehension needs two conditions, a nested loop and a calculation, it becomes unreadable — and a plain loop is then the better code, not the worse. Short is not the same as clear.'
        },
        { kind: 'example', title: 'Too far', text: 'result = [f(x) for sub in data for x in sub if x > 0 and g(x) != "no"]\n\nValid, and nobody wants to be the person who has to change it next month. Write it as a loop.' },
        { kind: 'check', questionId: 'm4l7q1' }
      ],
      questions: [
        {
          id: 'm4l7q1',
          kind: 'choice',
          concept: 'comprehensions',
          prompt: 'What does  [n * 2 for n in [1, 2, 3] if n != 2]  give?',
          difficulty: 'intermediate',
          options: ['[2, 4, 6]', '[2, 6]', '[1, 3]', '[4]'],
          answer: 1,
          explanation: '[2, 6]. The if filters 2 out first, leaving 1 and 3, and each of those is doubled.',
          hints: ['Filter first, then apply the expression.']
        },
        {
          id: 'm4l7q2',
          kind: 'short',
          concept: 'comprehensions',
          prompt: 'Write a comprehension giving the lengths of each word in a list called words.',
          difficulty: 'intermediate',
          answer: '[len(w) for w in words]',
          accepts: ['[len(word) for word in words]'],
          explanation: '[len(w) for w in words] — the expression is len(w) and it is applied to each word in turn.',
          hints: ['Expression first, then for.']
        },
        {
          id: 'm4l7q3',
          kind: 'choice',
          concept: 'comprehensions',
          prompt: 'When is a plain for loop the better choice over a comprehension?',
          difficulty: 'intermediate',
          options: [
            'Never — comprehensions are always better',
            'When the logic is complicated enough that one line stops being readable',
            'When the list is long',
            'When the items are strings'
          ],
          answer: 1,
          explanation: 'When readability suffers. A comprehension is for a simple transform; anything with several conditions and nested loops belongs in a loop where it can be read line by line.',
          hints: ['What are comprehensions actually good at?']
        }
      ]
    },

    // ------------------------------------------------------------------ 8
    {
      id: 'm4l8',
      title: 'Choosing the right structure',
      intro: 'The decision that makes a problem easy or hard, made before you write anything.',
      objectives: ['Choose between list, tuple, set and dictionary for a given problem', 'Explain why the wrong structure makes code complicated'],
      concepts: ['choosing-structures', 'data-wrangling'],
      requires: ['dicts', 'sets', 'tuples', 'lists'],
      minutes: 13,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'Beginners pick a list for everything and then write complicated code to work around it. Choosing properly is usually what makes the rest of the program short.' },
        {
          kind: 'table',
          headers: ['Use', 'When', 'Because'],
          rows: [
            ['list', 'Order matters, items repeat, it will change', 'Indexing, appending, sorting'],
            ['tuple', 'A fixed group that is one thing', 'Cannot be changed by accident; can be a dictionary key'],
            ['set', 'You only care whether something is in it', 'No duplicates, and fast membership'],
            ['dict', 'You look things up by name', 'Direct access by key instead of searching']
          ]
        },
        { kind: 'heading', text: 'The same problem, two ways' },
        { kind: 'example', title: 'Find the price of "tea"', text: 'As a list of pairs:\n    for item, price in pairs:\n        if item == "tea":\n            found = price\n            break\n\nAs a dictionary:\n    found = prices["tea"]\n\nSame data. One line against five, and the dictionary version cannot get the loop wrong.' },
        { kind: 'heading', text: 'Four questions to ask first' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Will I look things up by name? → dictionary',
            'Do I only need "is it in there?" → set',
            'Does order matter, and will it change? → list',
            'Is it a fixed group that belongs together? → tuple'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Combinations are normal and usually right. A list of dictionaries for records. A dictionary of lists for grouping. A dictionary whose values are sets for "who has which tags".'
        },
        { kind: 'code', language: 'python', code: '# Grouping: a dictionary of lists\nby_year = {}\nfor s in students:\n    by_year.setdefault(s["year"], []).append(s["name"])\nprint(by_year)   # {2: [\'Ali\', \'Cal\'], 1: [\'Bea\']}', caption: 'setdefault makes the empty list the first time a year appears.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'If you find yourself writing a loop inside a loop to match things up, that is almost always the sign of a missing dictionary. A lookup you keep doing by searching should be a lookup you do by key.'
        },
        { kind: 'check', questionId: 'm4l8q1' },
        { kind: 'check', questionId: 'm4l8q2' }
      ],
      questions: [
        {
          id: 'm4l8q1',
          kind: 'choice',
          concept: 'choosing-structures',
          prompt: 'You need to store each country and its capital, and look up capitals by country. Which structure?',
          difficulty: 'intermediate',
          options: ['A list of country names', 'A set of pairs', 'A dictionary with countries as keys', 'Two lists kept in step'],
          answer: 2,
          explanation: 'A dictionary. "Look up X by Y" is exactly what it is for. Two parallel lists work until one gets out of step, which it will.',
          hints: ['The question is literally a lookup by name.']
        },
        {
          id: 'm4l8q2',
          kind: 'choice',
          concept: 'choosing-structures',
          prompt: 'You have a million user ids and only ever need to ask "have I seen this one?". Which structure?',
          difficulty: 'advanced',
          options: ['A list, with  id in ids', 'A set, with  id in ids', 'A dictionary with None values', 'A tuple'],
          answer: 1,
          explanation: 'A set. The check stays fast however large it gets, while a list has to look through item by item — on a million items that is the difference between instant and painful.',
          hints: ['Which one is built for membership checks?']
        },
        {
          id: 'm4l8q3',
          kind: 'short',
          concept: 'choosing-structures',
          prompt: 'If you keep writing a loop inside a loop to match items from two collections, what is usually missing?',
          difficulty: 'advanced',
          answer: 'a dictionary for looking things up by key',
          accepts: ['a dictionary', 'a dict lookup', 'a lookup table', 'keying one of them by id'],
          explanation: 'A dictionary. Build one from the collection being searched, and the inner loop turns into a single lookup.',
          hints: ['What turns a search into a direct access?']
        }
      ]
    },

    // ------------------------------------------------------------------ 9
    {
      id: 'm4l9',
      title: 'Collections challenge',
      intro: 'Real data shapes, and the choices that go with them.',
      objectives: ['Work with every structure in the module without being told which to use'],
      concepts: ['lists', 'list-methods', 'sets', 'dicts', 'nested-data', 'comprehensions', 'choosing-structures'],
      requires: ['choosing-structures', 'nested-data', 'comprehensions'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'check', questionId: 'm4c1' },
        { kind: 'check', questionId: 'm4c2' },
        { kind: 'check', questionId: 'm4c3' },
        { kind: 'check', questionId: 'm4c4' },
        { kind: 'check', questionId: 'm4c5' },
        { kind: 'check', questionId: 'm4c6' }
      ],
      questions: [
        {
          id: 'm4c1',
          kind: 'choice',
          concept: 'dicts',
          prompt: 'What does this print?\n\nd = {}\nfor c in "aabc":\n    d[c] = d.get(c, 0) + 1\nprint(d)',
          difficulty: 'intermediate',
          options: ["{'a': 1, 'b': 1, 'c': 1}", "{'a': 2, 'b': 1, 'c': 1}", "{'a': 4}", 'A KeyError'],
          answer: 1,
          explanation: "{'a': 2, 'b': 1, 'c': 1}. The counting pattern — a appears twice, b and c once each.",
          hints: ['Count the letters in "aabc".']
        },
        {
          id: 'm4c2',
          kind: 'choice',
          concept: 'lists',
          prompt: 'What is the value of x?\n\nnums = [5, 3, 8, 1]\nx = sorted(nums)[-1]',
          difficulty: 'intermediate',
          options: ['1', '5', '8', '[1, 3, 5, 8]'],
          answer: 2,
          explanation: '8. sorted gives [1, 3, 5, 8] and [-1] takes the last — which is the largest. max(nums) is the clearer way to say it.',
          hints: ['Sort it, then take the last item.']
        },
        {
          id: 'm4c3',
          kind: 'number',
          concept: 'sets',
          prompt: 'What is  len(set("mississippi")) ?',
          difficulty: 'advanced',
          answer: 4,
          explanation: '4 — m, i, s and p. A set of a string gives its distinct characters.',
          hints: ['Count the different letters, not the letters.']
        },
        {
          id: 'm4c4',
          kind: 'short',
          concept: 'comprehensions',
          prompt: 'Write a comprehension giving the names of every record in people whose "age" is 18 or more.',
          difficulty: 'advanced',
          answer: '[p["name"] for p in people if p["age"] >= 18]',
          accepts: ["[p['name'] for p in people if p['age'] >= 18]", '[person["name"] for person in people if person["age"] >= 18]'],
          explanation: '[p["name"] for p in people if p["age"] >= 18] — the expression picks the name, the if decides who gets in.',
          hints: ['Expression, for, then if.']
        },
        {
          id: 'm4c5',
          kind: 'choice',
          concept: 'choosing-structures',
          prompt: 'You need to keep a to-do list in the order it was written, allow repeats, and let items be ticked off and added. Which structure?',
          difficulty: 'intermediate',
          options: ['A set', 'A tuple', 'A list', 'A dictionary keyed by position'],
          answer: 2,
          explanation: 'A list. Order matters, duplicates are allowed, and it changes — which is the list description exactly. A set would lose the order and silently drop repeated jobs.',
          hints: ['Order, duplicates and changing — which structure has all three?']
        },
        {
          id: 'm4c6',
          kind: 'choice',
          concept: 'nested-data',
          prompt: 'What does this print?\n\ndata = {"a": [1, 2], "b": [3]}\nprint(sum(len(v) for v in data.values()))',
          difficulty: 'advanced',
          options: ['2', '3', '6', '5'],
          answer: 1,
          explanation: '3. The values are [1, 2] and [3], whose lengths are 2 and 1, adding to 3. It counts items, not their values.',
          hints: ['len of each value, then added.']
        }
      ]
    }
  ]
}
