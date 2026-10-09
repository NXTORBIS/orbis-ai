import type { Concept } from '../../types.ts'

/**
 * Everything the Python course teaches, and what each thing rests on.
 *
 * ## This list is the spine of the course
 *
 * Mastery is measured per concept, revision is scheduled per concept, and remediation works by walking backwards
 * along these edges. A lesson that teaches something missing from here is a lesson whose learning cannot be
 * measured — which is why `check()` reports it.
 *
 * ## The edges are what somebody genuinely cannot proceed without
 *
 * Not "appears earlier in the course" — `requires` means the learner will be stuck without it. Loops require
 * conditions because a `while` is a condition. Loops do not require strings, even though strings come first.
 * Over-wiring the graph makes remediation send people back over everything, which is the same as sending them
 * back over nothing.
 *
 * ## Weight is how much of the course rests on it
 *
 * Used to decide what revision prioritises. Variables and functions carry most of the course; lambda does not.
 */
export const PYTHON_CONCEPTS: Concept[] = [
  // ---------------------------------------------------------------- foundations
  { id: 'programming', name: 'What programming is', blurb: 'Giving a computer precise, ordered instructions.', requires: [], weight: 0.6 },
  { id: 'execution', name: 'How Python runs code', blurb: 'Source code, the interpreter, and top-to-bottom execution.', requires: ['programming'], weight: 0.6 },
  { id: 'print', name: 'print()', blurb: 'Showing something to whoever is running the program.', requires: ['execution'], weight: 0.7 },
  { id: 'reading-code', name: 'Reading code', blurb: 'Working out what a program does before running it.', requires: ['print'], weight: 0.8 },
  { id: 'errors', name: 'Kinds of error', blurb: 'Syntax, runtime and logic errors, and how each announces itself.', requires: ['execution'], weight: 0.8 },
  { id: 'algorithms', name: 'Algorithmic thinking', blurb: 'Breaking a task into steps precise enough to follow.', requires: ['programming'], weight: 0.85 },

  // ---------------------------------------------------------------- fundamentals
  { id: 'variables', name: 'Variables', blurb: 'Names that refer to values.', requires: ['execution'], weight: 1 },
  { id: 'numbers', name: 'Numbers', blurb: 'Integers, floats, and the arithmetic operators.', requires: ['variables'], weight: 0.9 },
  { id: 'strings', name: 'Strings', blurb: 'Text: writing it, joining it, indexing and slicing it.', requires: ['variables'], weight: 0.95 },
  { id: 'string-methods', name: 'String methods', blurb: 'upper, strip, replace, split, join and friends.', requires: ['strings'], weight: 0.8 },
  { id: 'f-strings', name: 'f-strings', blurb: 'Putting values inside text, and formatting numbers while you do it.', requires: ['strings', 'variables'], weight: 0.9 },
  { id: 'input', name: 'input()', blurb: 'Reading what somebody types — always as text.', requires: ['strings', 'print'], weight: 0.8 },
  { id: 'types', name: 'Types', blurb: 'int, float, str and bool, and why the kind of a value decides what you can do with it.', requires: ['numbers', 'strings'], weight: 0.9 },
  { id: 'conversion', name: 'Converting between types', blurb: 'int(), float() and str(), and why input() always needs one.', requires: ['types', 'input'], weight: 0.9 },
  { id: 'booleans', name: 'Booleans', blurb: 'True and False, and the comparisons that produce them.', requires: ['types'], weight: 0.9 },
  { id: 'operators', name: 'Operators', blurb: 'Arithmetic, comparison, assignment and logical operators.', requires: ['numbers', 'booleans'], weight: 0.85 },
  { id: 'expressions', name: 'Expressions and precedence', blurb: 'What gets worked out first, and how to be sure.', requires: ['operators'], weight: 0.8 },

  // ---------------------------------------------------------------- control flow
  { id: 'conditions', name: 'if statements', blurb: 'Running some code only when something is true.', requires: ['booleans'], weight: 1 },
  { id: 'else', name: 'if / else / elif', blurb: 'Choosing between two or more paths.', requires: ['conditions'], weight: 0.95 },
  { id: 'nested-conditions', name: 'Nested conditions', blurb: 'Decisions inside decisions, and keeping them readable.', requires: ['else'], weight: 0.6 },
  { id: 'logic', name: 'and, or, not', blurb: 'Combining conditions into one.', requires: ['booleans', 'conditions'], weight: 0.85 },
  { id: 'for-loops', name: 'for loops', blurb: 'Doing something once for each item.', requires: ['conditions'], weight: 1 },
  { id: 'range', name: 'range()', blurb: 'Counting in a for loop.', requires: ['for-loops'], weight: 0.8 },
  { id: 'while-loops', name: 'while loops', blurb: 'Repeating for as long as something stays true.', requires: ['for-loops', 'logic'], weight: 0.9 },
  { id: 'break-continue', name: 'break and continue', blurb: 'Leaving a loop early, or skipping one turn of it.', requires: ['while-loops'], weight: 0.7 },
  { id: 'nested-loops', name: 'Nested loops', blurb: 'A loop inside a loop, and what that costs.', requires: ['for-loops'], weight: 0.6 },
  { id: 'accumulators', name: 'Counters and accumulators', blurb: 'Building up a total or a count as you go.', requires: ['for-loops', 'variables'], weight: 0.9 },
  { id: 'searching', name: 'Searching', blurb: 'Looking through data for something, and knowing when it is not there.', requires: ['accumulators', 'conditions'], weight: 0.8 },
  { id: 'min-max', name: 'Smallest and largest', blurb: 'The pattern for finding an extreme without a built-in.', requires: ['accumulators'], weight: 0.75 },
  { id: 'decomposition', name: 'Breaking problems down', blurb: 'Turning one hard problem into several easy ones.', requires: ['algorithms'], weight: 0.9 },

  // ---------------------------------------------------------------- collections
  { id: 'lists', name: 'Lists', blurb: 'An ordered collection you can change.', requires: ['for-loops'], weight: 1 },
  { id: 'list-methods', name: 'List methods', blurb: 'append, insert, remove, pop, sort, reverse.', requires: ['lists'], weight: 0.9 },
  { id: 'tuples', name: 'Tuples', blurb: 'An ordered collection you cannot change, and why that is useful.', requires: ['lists'], weight: 0.6 },
  { id: 'sets', name: 'Sets', blurb: 'A collection with no duplicates and no order.', requires: ['lists'], weight: 0.6 },
  { id: 'dicts', name: 'Dictionaries', blurb: 'Looking things up by a key instead of a position.', requires: ['lists'], weight: 1 },
  { id: 'dict-methods', name: 'Dictionary methods', blurb: 'keys, values, items, get, update, pop.', requires: ['dicts'], weight: 0.85 },
  { id: 'nested-data', name: 'Nested data', blurb: 'Lists of dictionaries and dictionaries of lists.', requires: ['dicts', 'lists'], weight: 0.9 },
  { id: 'iterating-data', name: 'Working through data', blurb: 'Looping over collections, including nested ones.', requires: ['nested-data', 'for-loops'], weight: 0.9 },
  { id: 'comprehensions', name: 'List comprehensions', blurb: 'Building a list in one line — and when not to.', requires: ['lists', 'for-loops', 'conditions'], weight: 0.65 },
  { id: 'data-wrangling', name: 'Filtering, sorting, totalling', blurb: 'The three things you do to real data.', requires: ['iterating-data', 'accumulators'], weight: 0.9 },

  // ---------------------------------------------------------------- functions
  { id: 'functions', name: 'Functions', blurb: 'Naming a piece of work so it can be done again.', requires: ['variables', 'decomposition'], weight: 1 },
  { id: 'parameters', name: 'Parameters', blurb: 'Giving a function what it needs to work on.', requires: ['functions'], weight: 0.95 },
  { id: 'return', name: 'return', blurb: 'Handing an answer back — and why that is not printing it.', requires: ['parameters'], weight: 1 },
  { id: 'default-args', name: 'Default and keyword arguments', blurb: 'Arguments that can be left out, and ones named at the call.', requires: ['parameters'], weight: 0.7 },
  { id: 'scope', name: 'Scope', blurb: 'Where a name exists, and where it does not.', requires: ['functions'], weight: 0.85 },
  { id: 'function-design', name: 'Designing functions', blurb: 'One job, clear inputs, a returned answer, no surprises.', requires: ['return', 'scope'], weight: 0.9 },
  { id: 'lambda', name: 'Lambda', blurb: 'A tiny unnamed function, used where a name would not help.', requires: ['functions'], weight: 0.4 },
  { id: 'recursion', name: 'Recursion', blurb: 'A function that calls itself, and the case that stops it.', requires: ['return'], weight: 0.6 },

  // ---------------------------------------------------------------- files, errors, libraries
  { id: 'persistence', name: 'Why data has to be saved', blurb: 'Memory goes when the program does. Storage does not.', requires: ['variables'], weight: 0.7 },
  { id: 'reading-files', name: 'Reading files', blurb: 'Opening a file safely and getting what is in it.', requires: ['persistence', 'strings'], weight: 0.85 },
  { id: 'writing-files', name: 'Writing files', blurb: 'Writing and appending, and the mode that silently empties a file.', requires: ['reading-files'], weight: 0.85 },
  { id: 'text-processing', name: 'Processing text', blurb: 'Lines, stripping, splitting, and turning text into data.', requires: ['reading-files', 'string-methods'], weight: 0.8 },
  { id: 'exceptions', name: 'Exceptions', blurb: 'try, except, else, finally — dealing with what goes wrong.', requires: ['errors', 'conditions'], weight: 0.95 },
  { id: 'validation', name: 'Validating input', blurb: 'Not trusting what somebody typed.', requires: ['exceptions', 'input'], weight: 0.9 },
  { id: 'robustness', name: 'Programs that survive', blurb: 'Handling failure without hiding real bugs.', requires: ['validation'], weight: 0.75 },
  { id: 'modules', name: 'Modules', blurb: 'import, from…import, and what a namespace is for.', requires: ['functions'], weight: 0.85 },
  { id: 'stdlib', name: 'The standard library', blurb: 'math, random, datetime, pathlib, json — already installed.', requires: ['modules'], weight: 0.8 },
  { id: 'json', name: 'JSON', blurb: 'The format almost everything uses to exchange data.', requires: ['stdlib', 'nested-data'], weight: 0.9 },
  { id: 'apis', name: 'APIs', blurb: 'Asking another program for data, and what comes back.', requires: ['json'], weight: 0.6 },
  { id: 'packages', name: 'Packages and environments', blurb: 'Code other people wrote, and keeping projects apart.', requires: ['modules'], weight: 0.5 },

  // ---------------------------------------------------------------- objects
  { id: 'oop-why', name: 'Why objects', blurb: 'Keeping state and the things that act on it together.', requires: ['functions', 'dicts'], weight: 0.8 },
  { id: 'classes', name: 'Classes', blurb: 'The description something is made from.', requires: ['oop-why'], weight: 0.95 },
  { id: 'objects', name: 'Objects', blurb: 'The actual things made from a class.', requires: ['classes'], weight: 0.95 },
  { id: 'init', name: '__init__', blurb: 'Setting an object up the moment it is made.', requires: ['objects'], weight: 0.9 },
  { id: 'methods', name: 'Methods', blurb: 'Functions that belong to an object, and what self is.', requires: ['init'], weight: 0.95 },
  { id: 'class-data', name: 'Instance and class data', blurb: 'What belongs to one object and what belongs to all of them.', requires: ['methods'], weight: 0.6 },
  { id: 'encapsulation', name: 'Encapsulation', blurb: 'Keeping the inside of an object its own business.', requires: ['methods'], weight: 0.65 },
  { id: 'inheritance', name: 'Inheritance', blurb: 'A class built on another one.', requires: ['methods'], weight: 0.8 },
  { id: 'overriding', name: 'Overriding', blurb: 'A child class doing something its own way.', requires: ['inheritance'], weight: 0.75 },
  { id: 'composition', name: 'Composition', blurb: 'Building from parts instead of inheriting — usually the better answer.', requires: ['inheritance'], weight: 0.75 },
  { id: 'class-design', name: 'Designing classes', blurb: 'Turning a real situation into objects worth having.', requires: ['composition', 'encapsulation'], weight: 0.8 },

  // ---------------------------------------------------------------- being a developer
  { id: 'readable-code', name: 'Readable code', blurb: 'Names, structure and the reader who is you in a month.', requires: ['function-design'], weight: 0.85 },
  { id: 'comments', name: 'Comments and docstrings', blurb: 'Saying why, when the code already says what.', requires: ['readable-code'], weight: 0.6 },
  { id: 'debugging', name: 'Debugging', blurb: 'Reproduce, isolate, inspect, hypothesise, fix, check.', requires: ['errors', 'reading-code'], weight: 1 },
  { id: 'testing', name: 'Testing', blurb: 'Deciding what should happen, then checking that it does.', requires: ['functions', 'debugging'], weight: 0.9 },
  { id: 'project-structure', name: 'Structuring a project', blurb: 'More than one file, and what goes where.', requires: ['modules', 'readable-code'], weight: 0.75 },
  { id: 'reading-unfamiliar', name: 'Reading code you did not write', blurb: 'The skill you will use more than any other.', requires: ['reading-code', 'classes'], weight: 0.85 },
  { id: 'refactoring', name: 'Refactoring', blurb: 'Making code better without changing what it does.', requires: ['readable-code', 'testing'], weight: 0.8 },
  { id: 'layers', name: 'Separating concerns', blurb: 'Data, logic and interface, kept apart.', requires: ['project-structure', 'class-design'], weight: 0.8 },

  // ---------------------------------------------------------------- doing it alone
  { id: 'requirements', name: 'Understanding requirements', blurb: 'Goals, inputs, outputs and constraints, before any code.', requires: ['decomposition'], weight: 0.85 },
  { id: 'design-first', name: 'Designing before coding', blurb: 'Working out the shape on paper, where changes are free.', requires: ['requirements'], weight: 0.85 },
  { id: 'choosing-structures', name: 'Choosing data structures', blurb: 'List, dict or set — the decision that shapes everything after it.', requires: ['dicts', 'sets', 'design-first'], weight: 0.9 },
  { id: 'incremental', name: 'Building a bit at a time', blurb: 'Small working program, then the next feature, then the next.', requires: ['testing', 'design-first'], weight: 0.9 },
  { id: 'independent', name: 'Solving it yourself', blurb: 'Taking a problem you have never seen and finishing it.', requires: ['incremental', 'debugging', 'choosing-structures'], weight: 1 }
]
