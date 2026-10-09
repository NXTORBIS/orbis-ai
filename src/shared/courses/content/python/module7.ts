import type { Module } from '../../types.ts'

/**
 * Module 7 — Object-Oriented Python.
 *
 * Taught in the order that makes it make sense: the problem first, then classes as the answer to it. Teaching
 * `class` before showing what goes wrong without one is why so many people can write a class and cannot say when
 * they should.
 */
export const MODULE_7: Module = {
  id: 'm7',
  title: 'Object-Oriented Python',
  summary: 'Bundling data with the things that act on it: classes, objects, inheritance, and when not to use any of it.',
  concepts: ['oop-why', 'classes', 'objects', 'init', 'methods', 'class-data', 'encapsulation', 'inheritance', 'overriding', 'composition', 'class-design'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'm7l1',
      title: 'The problem classes solve',
      intro: 'What goes wrong when related data and the functions that use it are kept apart.',
      objectives: ['Describe the problem a class solves', 'Recognise when a dictionary of fields wants to become a class'],
      concepts: ['oop-why'],
      requires: ['dicts', 'function-design'],
      minutes: 10,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'text', text: 'You can build a bank account with what you already know. Here it is.' },
        { kind: 'code', language: 'python', code: 'account = {"owner": "Sam", "balance": 100}\n\ndef deposit(acc, amount):\n    acc["balance"] += amount\n\ndef withdraw(acc, amount):\n    if amount > acc["balance"]:\n        raise ValueError("Not enough money")\n    acc["balance"] -= amount\n\ndeposit(account, 50)\nwithdraw(account, 30)\nprint(account["balance"])   # 120', caption: 'This works. It is also where the trouble starts.' },
        { kind: 'heading', text: 'Three things that go wrong' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Nothing joins them up. deposit must be handed an account and nothing stops it being handed a shopping list.',
            'Nothing protects the data. account["balance"] = -5000 is allowed, and the withdraw rule you carefully wrote is simply bypassed.',
            'A typo in a key creates a new one. account["balence"] = 0 adds a field, silently, and reads of "balance" carry on unaffected.'
          ]
        },
        { kind: 'text', text: 'With twenty accounts and fifteen functions, "which functions belong to this data and what is allowed to change it" stops being obvious — and nothing in the code answers it.' },
        { kind: 'heading', text: 'What a class does' },
        { kind: 'text', text: 'A class puts the data and the operations in one place and makes the rules part of the thing rather than part of the caller\'s good intentions.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The signal to reach for a class: you have a dictionary with a fixed set of fields, and several functions that all take it as their first argument. That is a class trying to exist.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'And the opposite signal. A class with one method and no data that lasts between calls is a function wearing a costume. Not everything should be a class, and Python — unlike some languages — does not insist.'
        },
        { kind: 'check', questionId: 'm7l1q1' }
      ],
      questions: [
        {
          id: 'm7l1q1',
          kind: 'choice',
          concept: 'oop-why',
          prompt: 'What is the clearest sign that some dictionaries and functions want to be a class?',
          difficulty: 'intermediate',
          options: [
            'There are more than ten functions',
            'Several functions all take the same dictionary as their first argument',
            'The dictionary has nested data',
            'The program is longer than 100 lines'
          ],
          answer: 1,
          explanation: 'Functions that all take the same data first are methods waiting for an object. The data and the operations already belong together; a class says so.',
          hints: ['Look at the first parameter of each function.']
        },
        {
          id: 'm7l1q2',
          kind: 'choice',
          concept: 'oop-why',
          prompt: 'Why is  account["balance"] = -5000  a problem in the dictionary version?',
          difficulty: 'intermediate',
          options: [
            'Dictionaries cannot hold negative numbers',
            'It bypasses the withdraw rule entirely — nothing enforces it',
            'It would raise a KeyError',
            'It is not a problem'
          ],
          answer: 1,
          explanation: 'The rule lives in a function nobody is obliged to call. Anything with access to the dictionary can put it in any state it likes.',
          hints: ['Who is forced to use withdraw()?']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'm7l2',
      title: 'A class and its objects',
      intro: '__init__, self, and the difference between the blueprint and the thing.',
      objectives: ['Define a class with __init__', 'Create several objects from it', 'Explain what self is'],
      concepts: ['classes', 'objects', 'init'],
      requires: ['oop-why', 'functions'],
      minutes: 14,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'class Account:\n    def __init__(self, owner, balance=0):\n        self.owner = owner\n        self.balance = balance\n\nsam = Account("Sam", 100)\nbea = Account("Bea")\n\nprint(sam.owner, sam.balance)   # Sam 100\nprint(bea.owner, bea.balance)   # Bea 0', caption: 'One class, two objects, separate data in each.' },
        { kind: 'text', text: 'The class is the description. An object is one actual thing made from it. `Account` is the idea of an account; `sam` is an account.' },
        { kind: 'heading', text: '__init__' },
        { kind: 'text', text: 'It runs automatically when you create an object, and its job is to set up that object\'s data. You never call it yourself — `Account("Sam", 100)` calls it for you.' },
        { kind: 'heading', text: 'self' },
        { kind: 'text', text: '`self` is the object the method is working on. It is the first parameter of every method, Python passes it in automatically, and `self.balance` means "this particular object\'s balance".' },
        { kind: 'code', language: 'python', code: 'sam = Account("Sam", 100)\n# inside __init__, self IS sam, so self.balance = 100 sets sam.balance', caption: 'There is nothing magic about the name — but call it self, because everyone does.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Forgetting self is the standard beginner error. def deposit(amount) inside a class gives "takes 1 positional argument but 2 were given", because Python passed the object in as the first argument and your definition had nowhere to put it.'
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'And inside a method, balance on its own is not self.balance. It is a local variable, and assigning to it changes nothing about the object. No error, no effect.'
        },
        { kind: 'heading', text: 'Each object is separate' },
        { kind: 'code', language: 'python', code: 'sam.balance += 50\nprint(sam.balance)   # 150\nprint(bea.balance)   # 0 — untouched', caption: 'That separateness is the point.' },
        { kind: 'check', questionId: 'm7l2q1' },
        { kind: 'check', questionId: 'm7l2q2' }
      ],
      questions: [
        {
          id: 'm7l2q1',
          kind: 'choice',
          concept: 'init',
          prompt: 'When does __init__ run?',
          difficulty: 'beginner',
          options: [
            'When the class is defined',
            'Automatically whenever an object is created from the class',
            'Only if you call it',
            'Once, the first time the class is used'
          ],
          answer: 1,
          explanation: 'Every time an object is created. Account("Sam") calls it with "Sam" as the owner argument.',
          hints: ['Think about what happens at Account("Sam").']
        },
        {
          id: 'm7l2q2',
          kind: 'choice',
          concept: 'classes',
          prompt: 'What does self refer to inside a method?',
          difficulty: 'intermediate',
          options: ['The class itself', 'The particular object the method was called on', 'The module', 'The most recently created object'],
          answer: 1,
          explanation: 'The object it was called on. sam.deposit(10) makes self be sam, so self.balance is sam\'s balance and nobody else\'s.',
          hints: ['Which account changes when you call sam.deposit()?']
        },
        {
          id: 'm7l2q3',
          kind: 'choice',
          concept: 'classes',
          prompt: 'Why does  balance = balance + 10  inside a method not change the object?',
          difficulty: 'advanced',
          options: [
            'It does change it',
            'Without self it is an ordinary local variable, gone when the method ends',
            'Methods cannot do arithmetic',
            'It needs a return'
          ],
          answer: 1,
          explanation: 'No self means no object. It is a local variable that disappears at the end of the call, and nothing reports a problem.',
          hints: ['What is missing from the front of the name?']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'm7l3',
      title: 'Methods',
      intro: 'Giving an object things it can do — and the two methods every class should have.',
      objectives: ['Write methods that use and change the object', 'Add __str__ and __repr__', 'Say why a method is better than an outside function here'],
      concepts: ['methods'],
      requires: ['classes'],
      minutes: 14,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'class Account:\n    def __init__(self, owner, balance=0):\n        self.owner = owner\n        self.balance = balance\n\n    def deposit(self, amount):\n        if amount <= 0:\n            raise ValueError("A deposit must be positive")\n        self.balance += amount\n        return self.balance\n\n    def withdraw(self, amount):\n        if amount <= 0:\n            raise ValueError("A withdrawal must be positive")\n        if amount > self.balance:\n            raise ValueError("Not enough money")\n        self.balance -= amount\n        return self.balance\n\n    def can_afford(self, amount):\n        return amount <= self.balance\n\nsam = Account("Sam", 100)\nsam.deposit(50)\nprint(sam.can_afford(200))   # False', caption: 'The rules now live with the data, and every change goes through them.' },
        { kind: 'text', text: 'That is the gain over the dictionary version: there is no longer a way to change the balance without the rules being applied. The object cannot be put into a state the class says is impossible.' },
        { kind: 'heading', text: 'Printing an object' },
        { kind: 'code', language: 'python', code: 'print(sam)\n# <__main__.Account object at 0x000001F3...>   — useless', caption: 'Python has no idea how you want an account described.' },
        { kind: 'code', language: 'python', code: 'class Account:\n    def __init__(self, owner, balance=0):\n        self.owner = owner\n        self.balance = balance\n\n    def __str__(self):\n        return f"{self.owner}: £{self.balance:.2f}"\n\n    def __repr__(self):\n        return f"Account({self.owner!r}, {self.balance!r})"\n\nsam = Account("Sam", 100)\nprint(sam)          # Sam: £100.00\nprint([sam])        # [Account(\'Sam\', 100)]', caption: '__str__ is for people; __repr__ is what you see in a list or at a prompt.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Write __repr__ on every class you make. The hour it saves is the one where you print a list of objects while debugging and get a column of memory addresses.'
        },
        { kind: 'heading', text: 'Other methods worth knowing' },
        { kind: 'code', language: 'python', code: 'class Money:\n    def __init__(self, pence):\n        self.pence = pence\n\n    def __eq__(self, other):\n        return isinstance(other, Money) and self.pence == other.pence\n\n    def __add__(self, other):\n        return Money(self.pence + other.pence)\n\n    def __len__(self):\n        return self.pence\n\nprint(Money(50) == Money(50))        # True\nprint((Money(50) + Money(25)).pence) # 75', caption: 'Defining these makes your objects work with ==, + and len() like built-in types.' },
        { kind: 'check', questionId: 'm7l3q1' }
      ],
      questions: [
        {
          id: 'm7l3q1',
          kind: 'choice',
          concept: 'methods',
          prompt: 'What is the main advantage of withdraw() being a method rather than a separate function?',
          difficulty: 'intermediate',
          options: [
            'It is faster',
            'The rule cannot be bypassed — changing the balance goes through the object',
            'Methods can take more arguments',
            'It saves typing'
          ],
          answer: 1,
          explanation: 'The data and its rules are one thing. There is no longer a route to the balance that skips the check.',
          hints: ['Who could change the balance in the dictionary version?']
        },
        {
          id: 'm7l3q2',
          kind: 'choice',
          concept: 'methods',
          prompt: 'What is __str__ for?',
          difficulty: 'beginner',
          options: [
            'Converting strings to objects',
            'Saying how the object should look when printed for a person',
            'Comparing two objects',
            'Naming the class'
          ],
          answer: 1,
          explanation: 'It is what print() uses. Without it you get the class name and a memory address, which tells you nothing.',
          hints: ['What does print(sam) show without it?']
        },
        {
          id: 'm7l3q3',
          kind: 'short',
          concept: 'methods',
          prompt: 'Which method should you define so  print([obj])  shows something useful?',
          difficulty: 'advanced',
          answer: '__repr__',
          accepts: ['repr', '__repr__()', 'the repr method'],
          explanation: '__repr__. A list shows its items using __repr__, not __str__, which is why a list of objects looks like memory addresses even when printing one looks fine.',
          hints: ['Not the one print uses on the object itself.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'm7l4',
      title: 'Data on the class itself',
      intro: 'Attributes shared by every object, and the one that goes wrong.',
      objectives: ['Tell class attributes from instance attributes', 'Use a class attribute appropriately', 'Avoid the shared mutable attribute trap'],
      concepts: ['class-data'],
      requires: ['classes'],
      minutes: 11,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'class Account:\n    interest_rate = 0.02      # on the class — shared by all\n    count = 0\n\n    def __init__(self, owner):\n        self.owner = owner    # on the instance — one per object\n        Account.count += 1\n\na = Account("Sam")\nb = Account("Bea")\nprint(Account.count)          # 2\nprint(a.interest_rate)        # 0.02 — read through the object', caption: 'A class attribute belongs to the class; an instance attribute belongs to one object.' },
        { kind: 'text', text: 'Class attributes suit things genuinely the same for every object: a rate, a limit, a set of valid values, a counter of how many exist.' },
        { kind: 'heading', text: 'The trap' },
        { kind: 'code', language: 'python', code: 'class Basket:\n    items = []            # do not do this\n\n    def add(self, item):\n        self.items.append(item)\n\na = Basket()\nb = Basket()\na.add("tea")\nprint(b.items)        # [\'tea\'] — b has it too!', caption: 'One list, created once with the class, shared by every object.' },
        { kind: 'code', language: 'python', code: 'class Basket:\n    def __init__(self):\n        self.items = []   # a new list per object\n\n    def add(self, item):\n        self.items.append(item)', caption: 'Anything each object should own goes in __init__.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'This is the same mistake as the mutable default from Module 5, in different clothing: one list made once and shared where you meant one each. Lists, dictionaries and sets go in __init__, never on the class body.'
        },
        { kind: 'text', text: 'There is a subtler version too. `a.interest_rate = 0.05` does not change the class attribute — it creates an instance attribute on a that hides it. Other objects still see 0.02. Change it as `Account.interest_rate = 0.05` if you mean all of them.' },
        { kind: 'check', questionId: 'm7l4q1' }
      ],
      questions: [
        {
          id: 'm7l4q1',
          kind: 'choice',
          concept: 'class-data',
          prompt: 'Why does  items = []  in the class body cause two baskets to share items?',
          difficulty: 'advanced',
          options: [
            'Baskets are always shared',
            'The list is created once with the class, so every object refers to the same one',
            'append is broken on class attributes',
            'It would raise an error'
          ],
          answer: 1,
          explanation: 'One list, made once, belonging to the class. Put it in __init__ and each object gets its own.',
          hints: ['How many times is that empty list created?']
        },
        {
          id: 'm7l4q2',
          kind: 'choice',
          concept: 'class-data',
          prompt: 'What does  a.rate = 0.05  do when rate is a class attribute?',
          difficulty: 'advanced',
          options: [
            'Changes it for every object',
            'Creates an instance attribute on a that hides the class one; other objects are unchanged',
            'Raises an error',
            'Nothing'
          ],
          answer: 1,
          explanation: 'It makes a new attribute on that one object. To change it for everybody you assign to the class: Account.rate = 0.05.',
          hints: ['Where does the assignment actually put the value?']
        }
      ]
    },

    // ------------------------------------------------------------------ 5
    {
      id: 'm7l5',
      title: 'Keeping things in',
      intro: 'Encapsulation in Python: the underscore convention, and properties.',
      objectives: ['Use the underscore convention', 'Write a property with validation', 'Explain how Python differs from languages with real private fields'],
      concepts: ['encapsulation'],
      requires: ['methods'],
      minutes: 12,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'Python has no genuinely private attributes. It has a convention, and it works because people follow it.' },
        { kind: 'code', language: 'python', code: 'class Account:\n    def __init__(self, balance=0):\n        self._balance = balance   # "internal — please do not touch"\n\n    def deposit(self, amount):\n        self._balance += amount', caption: 'One leading underscore means "this is not part of how you are meant to use me".' },
        { kind: 'text', text: 'Nothing stops you writing `a._balance = -500`. The underscore is a message from the author, and ignoring it means you own whatever breaks. In practice that is enough.' },
        { kind: 'heading', text: 'Properties' },
        { kind: 'text', text: 'A property lets you keep the plain, readable `a.balance` while still running code when it is read or set — so validation can be added later without changing every caller.' },
        { kind: 'code', language: 'python', code: 'class Account:\n    def __init__(self, balance=0):\n        self._balance = balance\n\n    @property\n    def balance(self):\n        return self._balance\n\n    @balance.setter\n    def balance(self, value):\n        if value < 0:\n            raise ValueError("A balance cannot be negative")\n        self._balance = value\n\na = Account(100)\nprint(a.balance)     # 100 — looks like an ordinary attribute\na.balance = 50       # goes through the check\na.balance = -5       # ValueError', caption: 'The assignment syntax is unchanged; the rule is now unavoidable.' },
        { kind: 'heading', text: 'A read-only value' },
        { kind: 'code', language: 'python', code: 'class Rectangle:\n    def __init__(self, width, height):\n        self.width = width\n        self.height = height\n\n    @property\n    def area(self):\n        return self.width * self.height\n\nr = Rectangle(3, 4)\nprint(r.area)   # 12 — worked out each time, never stale', caption: 'A property with no setter cannot be assigned to, and can never disagree with the values it is derived from.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Do not write properties that only get and set. Start with a plain attribute; add a property the moment there is a rule or a derived value. Python makes that change invisible to callers, which is exactly why you need not do it in advance.'
        },
        { kind: 'check', questionId: 'm7l5q1' }
      ],
      questions: [
        {
          id: 'm7l5q1',
          kind: 'choice',
          concept: 'encapsulation',
          prompt: 'What does a single leading underscore mean in Python?',
          difficulty: 'intermediate',
          options: [
            'The attribute cannot be accessed from outside',
            'A convention saying "internal — not part of the intended interface", which nothing enforces',
            'The attribute is read-only',
            'It is a class attribute'
          ],
          answer: 1,
          explanation: 'A convention, not a rule. Python trusts you and documents the author\'s intention rather than preventing access.',
          hints: ['Can you still read it if you insist?']
        },
        {
          id: 'm7l5q2',
          kind: 'choice',
          concept: 'encapsulation',
          prompt: 'Why is a property better than making the caller use  set_balance() ?',
          difficulty: 'advanced',
          options: [
            'It is faster',
            'The plain  a.balance = 50  still works, so the rule can be added without changing any calling code',
            'Properties cannot fail',
            'There is no difference'
          ],
          answer: 1,
          explanation: 'The attribute syntax is kept while the behaviour changes. Nothing that already used a.balance has to be rewritten, which is why Python code starts with plain attributes.',
          hints: ['What has to change at every call site in each version?']
        },
        {
          id: 'm7l5q3',
          kind: 'choice',
          concept: 'encapsulation',
          prompt: 'Why make area a property rather than setting self.area in __init__?',
          difficulty: 'advanced',
          options: [
            'It uses less memory',
            'It is worked out when asked, so it can never disagree with the width and height',
            'Properties are required for numbers',
            'It is shorter'
          ],
          answer: 1,
          explanation: 'A stored area goes stale the moment the width changes. A derived one cannot be wrong.',
          hints: ['What happens to a stored area when the width is changed?']
        }
      ]
    },

    // ------------------------------------------------------------------ 6
    {
      id: 'm7l6',
      title: 'Inheritance',
      intro: 'A class built on another — and the test for whether that is the right relationship.',
      objectives: ['Write a subclass and call super()', 'Override a method', 'Apply the is-a test'],
      concepts: ['inheritance', 'overriding'],
      requires: ['methods'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: 'class Animal:\n    def __init__(self, name):\n        self.name = name\n\n    def speak(self):\n        return "..."\n\n    def describe(self):\n        return f"{self.name} says {self.speak()}"\n\nclass Dog(Animal):\n    def speak(self):\n        return "Woof"\n\nclass Cat(Animal):\n    def speak(self):\n        return "Meow"\n\nfor a in [Dog("Rex"), Cat("Tom"), Animal("Thing")]:\n    print(a.describe())', caption: 'describe() is written once and works for all of them.' },
        { kind: 'text', text: 'A subclass gets everything from its parent and may replace any of it. `Dog` never defines `__init__` or `describe` — it inherits both — and overriding `speak` changes what `describe` produces without `describe` knowing anything about dogs.' },
        { kind: 'heading', text: 'super()' },
        { kind: 'code', language: 'python', code: 'class Account:\n    def __init__(self, owner, balance=0):\n        self.owner = owner\n        self.balance = balance\n\nclass SavingsAccount(Account):\n    def __init__(self, owner, balance=0, rate=0.02):\n        super().__init__(owner, balance)   # let the parent do its part\n        self.rate = rate\n\n    def add_interest(self):\n        self.balance += self.balance * self.rate\n\ns = SavingsAccount("Sam", 1000)\ns.add_interest()\nprint(s.balance)   # 1020.0', caption: 'super() calls the parent version, so its setup is not copied out by hand.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Forget super().__init__() and the parent\'s attributes are never set, so the first use of self.owner is an AttributeError — in a method that is correct and looks it.'
        },
        { kind: 'heading', text: 'The is-a test' },
        { kind: 'text', text: 'Inherit only when the subclass genuinely is a kind of the parent, everywhere the parent is used. A savings account is an account. A dog is an animal.' },
        { kind: 'example', title: 'Where it fails', text: 'class Car(Engine) — a car is not a kind of engine, it has one.\nclass Basket(list) — tempting, and now a basket has sort, reverse, pop and forty other things you never meant to offer.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Deep hierarchies age badly. Two levels is usually plenty; past three, a change near the top breaks things you cannot see from where you are working.'
        },
        { kind: 'check', questionId: 'm7l6q1' },
        { kind: 'check', questionId: 'm7l6q2' }
      ],
      questions: [
        {
          id: 'm7l6q1',
          kind: 'choice',
          concept: 'inheritance',
          prompt: 'What does super().__init__() do?',
          difficulty: 'intermediate',
          options: [
            'Creates a new object',
            'Runs the parent class\'s __init__, so its setup happens too',
            'Defines the parent class',
            'Copies the parent\'s methods'
          ],
          answer: 1,
          explanation: 'It calls the parent\'s version. Without it the parent\'s attributes are never set and the first use of one is an AttributeError.',
          hints: ['What sets the attributes the parent is responsible for?']
        },
        {
          id: 'm7l6q2',
          kind: 'choice',
          concept: 'inheritance',
          prompt: 'Which is a correct use of inheritance?',
          difficulty: 'advanced',
          options: [
            'class Car(Engine) — a car has an engine',
            'class SavingsAccount(Account) — a savings account is an account',
            'class Basket(list) — a basket holds things',
            'class Printer(Document) — a printer prints documents'
          ],
          answer: 1,
          explanation: 'Only the savings account passes the is-a test. The others are has-a relationships, and modelling them with inheritance exposes a pile of behaviour you never meant to offer.',
          hints: ['Which one can you say "is a" about and have it be true?']
        },
        {
          id: 'm7l6q3',
          kind: 'choice',
          concept: 'overriding',
          prompt: 'In the Animal example, why does  describe()  work on a Dog without being rewritten?',
          difficulty: 'advanced',
          options: [
            'Dog redefines describe',
            'describe calls self.speak(), and self is a Dog, so Dog\'s version runs',
            'Python copies describe into Dog',
            'It does not work on a Dog'
          ],
          answer: 1,
          explanation: 'self.speak() is looked up on the actual object. describe is written once and behaves differently for each subclass without knowing any of them exist.',
          hints: ['Which speak() does self.speak() find?']
        }
      ]
    },

    // ------------------------------------------------------------------ 7
    {
      id: 'm7l7',
      title: 'Composition, and designing classes',
      intro: 'Holding other objects instead of inheriting from them — usually the better answer.',
      objectives: ['Build a class out of other objects', 'Choose between inheritance and composition', 'Judge whether a class is well designed'],
      concepts: ['composition', 'class-design'],
      requires: ['inheritance'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'Composition means a class holds other objects and uses them. It is less celebrated than inheritance and it is the right choice far more often.' },
        { kind: 'code', language: 'python', code: 'class Engine:\n    def start(self):\n        return "running"\n\nclass Car:\n    def __init__(self, make):\n        self.make = make\n        self.engine = Engine()      # has one, is not one\n\n    def start(self):\n        return f"{self.make}: {self.engine.start()}"\n\nprint(Car("Volvo").start())', caption: 'The Car decides exactly what it offers. Nothing leaks out that it did not choose.' },
        {
          kind: 'table',
          headers: ['', 'Inheritance', 'Composition'],
          rows: [
            ['Relationship', 'is a', 'has a'],
            ['What is exposed', 'everything the parent has', 'only what you pass on'],
            ['Changing later', 'a parent change reaches every subclass', 'contained, by construction'],
            ['Use when', 'the subclass genuinely substitutes for the parent', 'nearly every other time']
          ]
        },
        { kind: 'heading', text: 'The practical difference' },
        { kind: 'example', title: 'Basket as a subclass of list', text: 'basket.sort()  — allowed, and meaningless\nbasket.pop()   — bypasses whatever rule add() enforced\nbasket += [1]  — puts anything at all in\n\nAs composition, a Basket holds a list and offers add, remove and total. The forty methods you never wanted are not there to be misused.' },
        { kind: 'heading', text: 'Four questions for a class' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Can you say what it is for in one sentence with no "and"?',
            'Could an object of it ever be in a state the rules say is impossible? If so, something sets data directly that should not.',
            'Does every method use the object\'s own data? A method that ignores self is a function.',
            'Would a reader guess what each method does from its name alone?'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Start with functions and plain data. Reach for a class when state has to be kept between calls and there are rules about it. Reach for inheritance only when two classes already exist and one genuinely is a kind of the other.'
        },
        { kind: 'check', questionId: 'm7l7q1' }
      ],
      questions: [
        {
          id: 'm7l7q1',
          kind: 'choice',
          concept: 'composition',
          prompt: 'Why is  class Basket:  holding a list better than  class Basket(list): ?',
          difficulty: 'advanced',
          options: [
            'It is faster',
            'The basket offers only what it chooses, instead of inheriting every list method including ones that bypass its rules',
            'Lists cannot be inherited from',
            'It uses less memory'
          ],
          answer: 1,
          explanation: 'Inheriting from list exposes pop, sort, slicing and more, several of which get round whatever add() checks. Composition exposes exactly what you wrote.',
          hints: ['What else can you do to a list that a basket should not allow?']
        },
        {
          id: 'm7l7q2',
          kind: 'choice',
          concept: 'class-design',
          prompt: 'A method in your class never uses self. What does that suggest?',
          difficulty: 'advanced',
          options: [
            'It should be deleted',
            'It is really a plain function and does not belong in the class',
            'It needs more parameters',
            'Nothing — that is normal'
          ],
          answer: 1,
          explanation: 'A method that ignores the object has no reason to be a method. It is a function, and moving it out makes both the class and the function easier to understand.',
          hints: ['What makes a method a method?']
        },
        {
          id: 'm7l7q3',
          kind: 'short',
          concept: 'class-design',
          prompt: 'What relationship does inheritance model, in two words?',
          difficulty: 'intermediate',
          answer: 'is a',
          accepts: ['is-a', 'is a relationship', 'isa'],
          explanation: '"Is a". Composition models "has a", and confusing the two is the single most common design mistake with classes.',
          hints: ['Contrast it with "has a".']
        }
      ]
    },

    // ------------------------------------------------------------------ 8
    {
      id: 'm7l8',
      title: 'Objects challenge',
      intro: 'Classes, self, inheritance and the two shared-state traps.',
      objectives: ['Reason about classes without prompting'],
      concepts: ['classes', 'init', 'methods', 'class-data', 'inheritance', 'composition', 'class-design'],
      requires: ['class-design', 'composition', 'inheritance'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'check', questionId: 'm7c1' },
        { kind: 'check', questionId: 'm7c2' },
        { kind: 'check', questionId: 'm7c3' },
        { kind: 'check', questionId: 'm7c4' },
        { kind: 'check', questionId: 'm7c5' }
      ],
      questions: [
        {
          id: 'm7c1',
          kind: 'choice',
          concept: 'classes',
          prompt: 'What does this print?\n\nclass C:\n    def __init__(self, n):\n        self.n = n\n    def add(self, k):\n        self.n += k\n        return self.n\n\na = C(1)\nb = C(1)\na.add(5)\nprint(a.n, b.n)',
          difficulty: 'intermediate',
          options: ['6 6', '6 1', '1 1', '5 1'],
          answer: 1,
          explanation: '6 1. Each object has its own n, so changing a leaves b alone.',
          hints: ['How many separate values of n are there?']
        },
        {
          id: 'm7c2',
          kind: 'choice',
          concept: 'class-data',
          prompt: 'What does this print?\n\nclass C:\n    log = []\n    def add(self, x):\n        self.log.append(x)\n\na, b = C(), C()\na.add(1)\nb.add(2)\nprint(len(a.log))',
          difficulty: 'advanced',
          options: ['1', '2', '0', 'An error'],
          answer: 1,
          explanation: '2. log is on the class, so there is one list shared by both objects. Moving it into __init__ gives each its own.',
          hints: ['Where was the list created?']
        },
        {
          id: 'm7c3',
          kind: 'choice',
          concept: 'inheritance',
          prompt: 'What goes wrong here?\n\nclass B(A):\n    def __init__(self, x, y):\n        self.y = y\n\n# A.__init__ sets self.x',
          difficulty: 'advanced',
          options: [
            'Nothing',
            'self.x is never set, so using it raises an AttributeError — super().__init__(x) is missing',
            'y cannot be set in a subclass',
            'It raises a TypeError immediately'
          ],
          answer: 1,
          explanation: 'Defining __init__ in the subclass replaces the parent\'s entirely. Without super().__init__(x), x is never set and the failure appears later, somewhere that looks correct.',
          hints: ['Who was going to set x?']
        },
        {
          id: 'm7c4',
          kind: 'multi',
          concept: 'class-design',
          prompt: 'Which suggest a class is badly designed? (Choose all that apply.)',
          difficulty: 'advanced',
          options: [
            'A method that never uses self',
            'It defines __repr__',
            'Its purpose needs "and" to describe',
            'Outside code sets its attributes directly, bypassing its rules'
          ],
          answer: [0, 2, 3],
          explanation: 'All except __repr__, which is a good habit. The other three are: a function in disguise, more than one job, and rules that are not actually enforced.',
          hints: ['One of these is something you should always do.']
        },
        {
          id: 'm7c5',
          kind: 'short',
          concept: 'oop-why',
          prompt: 'In one sentence: what does a class give you that a dictionary plus functions does not?',
          difficulty: 'advanced',
          answer: 'the data and its rules are one thing, so the rules cannot be bypassed',
          accepts: ['it enforces the rules', 'data and behaviour together', 'you cannot change the data without going through the methods'],
          explanation: 'The data and the operations are bound together, so there is no route to the data that skips the rules — and a typo cannot silently invent a new field.',
          hints: ['Think about what nothing enforced in the dictionary version.']
        }
      ]
    }
  ]
}
