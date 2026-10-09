import type { Module } from '../../types.ts'

/**
 * Module 10 — the final project.
 *
 * ## Why this is a module and not a `Project`
 *
 * `Project` exists in the types, but a `Course` has no field that holds one — only `completion.requiredProjects`,
 * which names ids. Rather than invent a field, the project is a module whose lessons are its stages: each stage is
 * a brief with a checklist of what finished looks like, and its questions are the design decisions that stage
 * turns on. Progress, mastery and the certificate then all work without a single special case.
 *
 * ## It is built in the order of Module 9
 *
 * Requirements, then data, then a thin end-to-end path, then one feature at a time. Nothing is built that the
 * previous stage did not make runnable.
 */
export const MODULE_PROJECT: Module = {
  id: 'm10',
  title: 'Final Project — Personal Productivity Manager',
  summary: 'One program, built in twenty stages: tasks, notes, habits and expenses, saved to disk, with reports, validation and tests.',
  concepts: ['requirements', 'design-first', 'incremental', 'independent', 'classes', 'json', 'validation', 'testing', 'layers', 'project-structure', 'refactoring'],
  lessons: [
    // ---------------------------------------------------------------- 1
    {
      id: 'p1',
      title: 'Stage 1 — What it is, and what it is not',
      intro: 'The requirements, written down before a line of code, including everything deliberately left out.',
      objectives: ['State what the program must do', 'State what it will not do'],
      concepts: ['requirements'],
      requires: ['requirements'],
      minutes: 15,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'text', text: 'You are going to build one program over the next twenty stages: a productivity manager that keeps tasks, notes, habits and expenses, saves them, and reports on them. Here is the specification, written as Module 9 said to write one.' },
        { kind: 'heading', text: 'It must' },
        {
          kind: 'list',
          items: [
            'Add, list, complete and delete tasks, with a title, a due date, a priority and a done flag',
            'Keep short notes with titles and tags',
            'Track daily habits and how many days in a row each has been kept',
            'Record expenses with a date, an amount and a category',
            'Save everything to disk and load it again on the next run',
            'Report: what is due today, what is overdue, this month\'s spending by category, and habit streaks',
            'Run in a terminal, for one person, on a few thousand items'
          ]
        },
        { kind: 'heading', text: 'It must never' },
        {
          kind: 'list',
          items: [
            'Lose anything that was confirmed saved',
            'Overwrite a data file it could not read',
            'Crash on anything typed at a prompt'
          ]
        },
        { kind: 'heading', text: 'It will not' },
        {
          kind: 'list',
          items: [
            'Support more than one user, or any kind of sharing',
            'Have a web page, a window, or a phone app',
            'Send email, notifications or reminders',
            'Handle recurring tasks, sub-tasks, attachments or currencies',
            'Sync anywhere'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That third list is the one that lets you finish. Every item on it is a reasonable idea, and each one is also a week you have not got. Write it down and stop negotiating with yourself.'
        },
        { kind: 'text', text: 'Make a folder for the project with an empty main.py, a README.md containing the three lists above, and a .gitignore with .venv/ and data/ in it. That is stage one finished.' },
        { kind: 'check', questionId: 'p1q1' }
      ],
      questions: [
        {
          id: 'p1q1',
          kind: 'choice',
          concept: 'requirements',
          prompt: 'Why is "it will not sync anywhere" worth writing down?',
          difficulty: 'intermediate',
          options: [
            'To make the README longer',
            'A decision written down is one you need not re-argue, and it is what keeps the project finishable',
            'Syncing is impossible in Python',
            'It is not worth writing down'
          ],
          answer: 1,
          explanation: 'An unwritten exclusion gets reconsidered every week. Writing it down converts a temptation into a decision already made.',
          hints: ['What happens to an idea that was never explicitly ruled out?']
        }
      ]
    },

    // ---------------------------------------------------------------- 2
    {
      id: 'p2',
      title: 'Stage 2 — The data shape',
      intro: 'Deciding what everything looks like, before any logic has to live with it.',
      objectives: ['Design the data for all four kinds of item', 'Justify each structure choice'],
      concepts: ['design-first', 'choosing-structures'],
      requires: ['choosing-structures'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# One task\n{"id": 1, "title": "Email Bea", "due": "2026-03-20", "priority": "high", "done": False, "created": "2026-03-14"}\n\n# One note\n{"id": 1, "title": "Shopping", "body": "tea, milk", "tags": ["home"], "created": "2026-03-14"}\n\n# One habit\n{"id": 1, "name": "Read", "days": ["2026-03-12", "2026-03-13", "2026-03-14"]}\n\n# One expense\n{"id": 1, "date": "2026-03-14", "amount": 12.5, "category": "food", "note": "lunch"}', caption: 'Four records, each a dictionary with a fixed set of fields.' },
        { kind: 'code', language: 'python', code: '# Everything, as one object that can be saved in one go\n{\n    "version": 1,\n    "tasks": [],\n    "notes": [],\n    "habits": [],\n    "expenses": [],\n    "next_ids": {"tasks": 1, "notes": 1, "habits": 1, "expenses": 1}\n}', caption: 'Lists for the records, a dictionary for the whole thing.' },
        { kind: 'heading', text: 'Why each of those' },
        {
          kind: 'list',
          items: [
            'Lists, because order matters and two tasks may share a title',
            'Dates as YYYY-MM-DD strings, because they sort correctly as text and the month is a slice',
            'An id on every record, so a task can be referred to without depending on its position',
            'next_ids saved with the data, so ids are never reused after a deletion',
            'habit days as a list of dates rather than a count, because a streak has to be recalculated and a count cannot be',
            'A version number, so a later format can be recognised instead of misread'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Storing a habit as {"streak": 3} would be the single worst decision available here. A streak depends on today\'s date, so a stored one is wrong the moment a day passes — and nothing would say so. Store what happened; work out what it means.'
        },
        { kind: 'text', text: 'Write that shape into the README as the data section. Nothing to build yet.' },
        { kind: 'check', questionId: 'p2q1' },
        { kind: 'check', questionId: 'p2q2' }
      ],
      questions: [
        {
          id: 'p2q1',
          kind: 'choice',
          concept: 'design-first',
          prompt: 'Why store the days a habit was kept, rather than the streak itself?',
          difficulty: 'advanced',
          options: [
            'It takes less space',
            'A streak depends on today\'s date, so a stored one goes silently wrong as soon as a day passes',
            'Lists are faster',
            'Streaks cannot be stored in JSON'
          ],
          answer: 1,
          explanation: 'Store facts, derive conclusions. The days are what happened; the streak is a view of them that changes with the date.',
          hints: ['What happens to a stored streak overnight?']
        },
        {
          id: 'p2q2',
          kind: 'choice',
          concept: 'design-first',
          prompt: 'Why keep next_ids in the saved data?',
          difficulty: 'advanced',
          options: [
            'To know how many items there are',
            'So an id is never reused after a deletion, which would make an old reference point at a new item',
            'JSON requires it',
            'It is not needed'
          ],
          answer: 1,
          explanation: 'Working ids out from the current list reuses the numbers of deleted items. Anything that remembered id 4 would then be pointing at something else entirely.',
          hints: ['What is the highest id after you delete the last task?']
        }
      ]
    },

    // ---------------------------------------------------------------- 3
    {
      id: 'p3',
      title: 'Stage 3 — The layout',
      intro: 'Files and folders, with the three layers from Module 8 made real.',
      objectives: ['Lay the project out in files', 'Keep logic free of input and printing'],
      concepts: ['project-structure', 'layers'],
      requires: ['project-structure'],
      minutes: 14,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'example', title: 'The layout', text: 'manager/\n    main.py              the menu and all the printing\n    manager/\n        __init__.py\n        store.py         load and save the JSON\n        tasks.py         task rules\n        notes.py         note rules\n        habits.py        habit rules and streaks\n        expenses.py      expense rules and totals\n        validate.py      checking what was typed\n        dates.py         today, parsing, comparing\n    tests/\n        test_tasks.py\n        test_habits.py\n        test_expenses.py\n        test_store.py\n    data/                not in version control\n    README.md\n    requirements.txt\n    .gitignore' },
        { kind: 'heading', text: 'The rule for the whole project' },
        { kind: 'text', text: 'Nothing inside manager/ ever calls input() or print(). All of that lives in main.py. Every function in the logic files takes values and returns values.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That one rule is what makes every stage after this testable. The moment a rule function prints, it can only be checked by running the whole program and reading the screen — and then nobody checks it properly.'
        },
        { kind: 'text', text: 'Create every file, each with nothing in it but a docstring saying what it is for. Running python main.py should do nothing and not fail.' },
        { kind: 'check', questionId: 'p3q1' }
      ],
      questions: [
        {
          id: 'p3q1',
          kind: 'choice',
          concept: 'layers',
          prompt: 'Where is the only place input() and print() may appear?',
          difficulty: 'intermediate',
          options: ['Anywhere', 'main.py', 'store.py', 'validate.py'],
          answer: 1,
          explanation: 'main.py, the interface layer. Everything inside the package takes and returns values, which is what makes it testable.',
          hints: ['Which file is the interface?']
        }
      ]
    },

    // ---------------------------------------------------------------- 4
    {
      id: 'p4',
      title: 'Stage 4 — The thin path',
      intro: 'One task added in code and printed. The shortest end-to-end version that proves the shape works.',
      objectives: ['Get something running end to end', 'Verify it before adding anything'],
      concepts: ['incremental'],
      requires: ['incremental'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/tasks.py\ndef add_task(data, title, due=None, priority="normal"):\n    """Add a task and return the new task. Changes data in place."""\n    task_id = data["next_ids"]["tasks"]\n    task = {"id": task_id, "title": title, "due": due, "priority": priority, "done": False}\n    data["tasks"].append(task)\n    data["next_ids"]["tasks"] = task_id + 1\n    return task\n\n\n# main.py\nfrom manager.tasks import add_task\n\ndata = {"version": 1, "tasks": [], "notes": [], "habits": [], "expenses": [],\n        "next_ids": {"tasks": 1, "notes": 1, "habits": 1, "expenses": 1}}\n\nadd_task(data, "Email Bea", "2026-03-20", "high")\nfor t in data["tasks"]:\n    print(f"[{t[\'id\']}] {t[\'title\']} — due {t[\'due\'] or \'no date\'}")', caption: 'Nothing is saved yet, nothing is asked for yet. One thing works completely.' },
        { kind: 'text', text: 'Run it. One line of output. That is the stage finished, and it is worth more than three half-built features — the shape of the data, the import, and the layer boundary have all now actually been exercised.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Note  t["due"] or "no date". Printing "None" at somebody is a program showing its own internals. The interface layer is where that gets translated.'
        },
        { kind: 'text', text: 'Commit it: "Add a task and list it — end to end with no storage yet".' },
        { kind: 'check', questionId: 'p4q1' }
      ],
      questions: [
        {
          id: 'p4q1',
          kind: 'choice',
          concept: 'incremental',
          prompt: 'Why is one working end-to-end path worth more than three half-built features?',
          difficulty: 'intermediate',
          options: [
            'It is less code',
            'It proves the data shape, the imports and the layer boundary all actually work together',
            'It can be demonstrated',
            'It is not worth more'
          ],
          answer: 1,
          explanation: 'Joining things up is where the surprises are. One thin path has already met all of them while the code is small enough to change.',
          hints: ['What has not been tested at all in the three-half-features version?']
        }
      ]
    },

    // ---------------------------------------------------------------- 5
    {
      id: 'p5',
      title: 'Stage 5 — Saving and loading',
      intro: 'Making it survive being closed — and refusing to destroy a file it cannot read.',
      objectives: ['Write load and save', 'Treat a missing file and a damaged one differently'],
      concepts: ['json', 'persistence'],
      requires: ['json'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/store.py\nimport json\nfrom pathlib import Path\n\nPATH = Path("data") / "manager.json"\n\nEMPTY = {"version": 1, "tasks": [], "notes": [], "habits": [], "expenses": [],\n         "next_ids": {"tasks": 1, "notes": 1, "habits": 1, "expenses": 1}}\n\n\nclass DataUnreadable(Exception):\n    """The file exists and could not be understood. Never treated as empty."""\n\n\ndef load(path=PATH):\n    if not path.exists():\n        return json.loads(json.dumps(EMPTY))    # a fresh copy, never the shared one\n    try:\n        with open(path, encoding="utf-8") as f:\n            data = json.load(f)\n    except json.JSONDecodeError as exc:\n        raise DataUnreadable(f"{path} is not valid JSON: {exc}") from exc\n    if data.get("version") != 1:\n        raise DataUnreadable(f"{path} was written by a different version.")\n    return data\n\n\ndef save(data, path=PATH):\n    path.parent.mkdir(parents=True, exist_ok=True)\n    temp = path.with_suffix(".tmp")\n    with open(temp, "w", encoding="utf-8") as f:\n        json.dump(data, f, indent=2)\n    temp.replace(path)                          # atomic — the old file survives a crash', caption: 'Three deliberate decisions, each of them about not losing data.' },
        { kind: 'heading', text: 'Why write to a temporary file first' },
        { kind: 'text', text: 'Writing straight over the real file means a crash halfway through leaves a half-written file and the old data gone. Writing to a temporary file and then renaming means the real file is either the old one or the new one, never a broken mixture. The rename is a single operation the operating system cannot do halfway.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'And the other decision: DataUnreadable is raised rather than returning EMPTY. Returning empty would make the program start blank, save, and overwrite data that was merely unreadable. "Nothing saved yet" and "cannot be read" must never get the same answer.'
        },
        { kind: 'text', text: 'In main.py: load at the start, save after any change. Run it twice and check the task is still there. Write tests/test_store.py covering a missing file, a round trip, and damaged JSON raising.' },
        { kind: 'check', questionId: 'p5q1' },
        { kind: 'check', questionId: 'p5q2' }
      ],
      questions: [
        {
          id: 'p5q1',
          kind: 'choice',
          concept: 'json',
          prompt: 'Why write to a .tmp file and rename, rather than writing over the real file?',
          difficulty: 'advanced',
          options: [
            'It is faster',
            'A crash partway through leaves the old file intact, because the rename is a single operation that cannot happen halfway',
            'JSON requires it',
            'It avoids permission problems'
          ],
          answer: 1,
          explanation: 'Writing in place can leave a half-written file and no original. Temp-then-rename means the file is always one complete version or the other.',
          hints: ['What is on disk if the power goes halfway through the write?']
        },
        {
          id: 'p5q2',
          kind: 'choice',
          concept: 'json',
          prompt: 'Why does load() raise on damaged JSON rather than returning the empty structure?',
          difficulty: 'advanced',
          options: [
            'Raising is tidier',
            'Starting empty and then saving would overwrite real data that was merely unreadable',
            'json.load always raises',
            'Empty data is not valid'
          ],
          answer: 1,
          explanation: 'The next save destroys it. A file that cannot be read still contains the data, and the program must stop rather than replace it.',
          hints: ['What does the program do immediately after starting empty?']
        }
      ]
    },

    // ---------------------------------------------------------------- 6
    {
      id: 'p6',
      title: 'Stage 6 — The menu',
      intro: 'A loop that asks what to do, and never falls over on an answer.',
      objectives: ['Write the main loop', 'Dispatch with a dictionary rather than a chain of ifs'],
      concepts: ['incremental', 'validation'],
      requires: ['while-loops', 'dicts'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# main.py\ndef show_menu():\n    print("\\n1 Tasks   2 Notes   3 Habits   4 Expenses   5 Reports   q Quit")\n\n\ndef main():\n    try:\n        data = load()\n    except DataUnreadable as exc:\n        print(f"Could not start: {exc}")\n        print("Nothing has been changed. Fix or move the file and try again.")\n        return\n\n    actions = {\n        "1": tasks_menu,\n        "2": notes_menu,\n        "3": habits_menu,\n        "4": expenses_menu,\n        "5": reports_menu,\n    }\n\n    while True:\n        show_menu()\n        choice = input("> ").strip().lower()\n        if choice in ("q", "quit", ""):\n            break\n        action = actions.get(choice)\n        if action is None:\n            print("I did not understand that. Type a number, or q to quit.")\n            continue\n        action(data)\n        save(data)\n\n    print("Saved. Goodbye.")\n\n\nif __name__ == "__main__":\n    main()', caption: 'A dictionary of actions instead of five elifs — adding a sixth is one line.' },
        { kind: 'text', text: 'Three things in there are deliberate. An empty answer quits rather than erroring, because pressing Enter is what people do. An unrecognised answer says what to type instead of just "invalid". And save() happens after every action, so quitting by closing the window loses at most one action.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Stub the five menu functions to print "not built yet" and return. The program runs completely from this stage onwards, and every later stage replaces one honest stub.'
        },
        { kind: 'check', questionId: 'p6q1' }
      ],
      questions: [
        {
          id: 'p6q1',
          kind: 'choice',
          concept: 'validation',
          prompt: 'Why treat an empty answer at the menu as "quit" rather than an error?',
          difficulty: 'intermediate',
          options: [
            'It is less code',
            'Pressing Enter is what people actually do, and a program should not scold somebody for it',
            'Empty input cannot be checked',
            'It should be an error'
          ],
          answer: 1,
          explanation: 'Deciding what an empty answer means is part of the design. Leaving it to fall through to "invalid choice" is how a program feels hostile.',
          hints: ['What is the first thing anybody does at a prompt?']
        }
      ]
    },

    // ---------------------------------------------------------------- 7
    {
      id: 'p7',
      title: 'Stage 7 — Validation',
      intro: 'One module that decides what is acceptable, used everywhere.',
      objectives: ['Write validators that return values or raise', 'Keep validation out of the logic and out of the loop'],
      concepts: ['validation'],
      requires: ['validation'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/validate.py\nimport re\n\nDATE = re.compile(r"^\\d{4}-\\d{2}-\\d{2}$")\nPRIORITIES = ("low", "normal", "high")\n\n\ndef clean_title(raw):\n    title = raw.strip()\n    if not title:\n        raise ValueError("A title is needed.")\n    if len(title) > 200:\n        raise ValueError("A title cannot be longer than 200 characters.")\n    return title\n\n\ndef clean_date(raw):\n    date = raw.strip()\n    if not DATE.match(date):\n        raise ValueError("A date must look like 2026-03-20.")\n    year, month, day = (int(part) for part in date.split("-"))\n    if not (1 <= month <= 12 and 1 <= day <= 31 and 2000 <= year <= 2100):\n        raise ValueError("That is not a real date.")\n    return date\n\n\ndef clean_amount(raw):\n    try:\n        amount = round(float(raw.strip()), 2)\n    except ValueError:\n        raise ValueError("An amount must be a number, like 12.50.") from None\n    if amount <= 0:\n        raise ValueError("An amount must be more than zero.")\n    if amount > 1_000_000:\n        raise ValueError("That amount is implausible.")\n    return amount\n\n\ndef clean_priority(raw):\n    priority = raw.strip().lower() or "normal"\n    if priority not in PRIORITIES:\n        raise ValueError(f"Priority must be one of: {\', \'.join(PRIORITIES)}.")\n    return priority', caption: 'Each one returns a clean value or raises with a message a person can act on.' },
        { kind: 'text', text: 'These raise rather than loop, because asking again is the interface layer\'s job. That way the same validator serves the menu, a test, and an import from a file.' },
        { kind: 'code', language: 'python', code: '# main.py — the asking-again part\ndef ask(prompt, clean, allow_blank=False):\n    while True:\n        raw = input(prompt)\n        if allow_blank and not raw.strip():\n            return None\n        try:\n            return clean(raw)\n        except ValueError as exc:\n            print(exc)', caption: 'One function, used for every prompt in the program.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That split is worth noticing: validate.py says what is acceptable, main.py says what to do when it is not. Neither has to know about the other\'s job, and the rules exist in exactly one place.'
        },
        { kind: 'text', text: 'Write tests for every validator: the good case, the empty case, the too-long case, and the out-of-range case.' },
        { kind: 'check', questionId: 'p7q1' }
      ],
      questions: [
        {
          id: 'p7q1',
          kind: 'choice',
          concept: 'validation',
          prompt: 'Why do the validators raise rather than loop until the answer is valid?',
          difficulty: 'advanced',
          options: [
            'Loops are slow',
            'Asking again belongs to the interface, so the same validator also works for tests and for importing a file',
            'They cannot loop',
            'Raising is shorter'
          ],
          answer: 1,
          explanation: 'A validator that prompts can only be used where there is a person. One that raises serves the menu, a test and a file import equally.',
          hints: ['Where else might you need to validate the same field?']
        }
      ]
    },

    // ---------------------------------------------------------------- 8
    {
      id: 'p8',
      title: 'Stage 8 — Tasks, completely',
      intro: 'Add, list, complete, delete and edit — the first feature finished properly.',
      objectives: ['Finish one feature end to end', 'Find a record by id safely'],
      concepts: ['incremental', 'lists'],
      requires: ['list-methods'],
      minutes: 20,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/tasks.py\ndef find_task(data, task_id):\n    """Return the task with this id, or None."""\n    for task in data["tasks"]:\n        if task["id"] == task_id:\n            return task\n    return None\n\n\ndef complete_task(data, task_id, today):\n    task = find_task(data, task_id)\n    if task is None:\n        raise KeyError(f"There is no task {task_id}.")\n    if task["done"]:\n        return task                     # already done: not an error, just nothing to do\n    task["done"] = True\n    task["completed"] = today\n    return task\n\n\ndef delete_task(data, task_id):\n    task = find_task(data, task_id)\n    if task is None:\n        raise KeyError(f"There is no task {task_id}.")\n    data["tasks"].remove(task)\n    return task\n\n\ndef list_tasks(data, include_done=False):\n    tasks = [t for t in data["tasks"] if include_done or not t["done"]]\n    order = {"high": 0, "normal": 1, "low": 2}\n    return sorted(tasks, key=lambda t: (t["due"] or "9999-99-99", order[t["priority"]]))', caption: 'Note the sort key: no date sorts last, then high priority first within a date.' },
        { kind: 'text', text: 'The `"9999-99-99"` is a deliberate trick — a date string that sorts after every real one, so tasks with no due date fall to the bottom without a separate branch. Comment it, because it looks like a mistake.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Completing an already-done task returns quietly instead of raising. A missing id is a mistake worth reporting; doing something twice usually is not. Deciding which errors are real is part of the design.'
        },
        { kind: 'text', text: 'Then write tasks_menu(data) in main.py: list, add, complete, delete, and back. Use ask() for every field. Tests: adding assigns sequential ids, completing sets done, deleting removes it, and an unknown id raises.' },
        { kind: 'check', questionId: 'p8q1' },
        { kind: 'check', questionId: 'p8q2' }
      ],
      questions: [
        {
          id: 'p8q1',
          kind: 'choice',
          concept: 'lists',
          prompt: 'Why does the sort key use "9999-99-99" for a task with no due date?',
          difficulty: 'advanced',
          options: [
            'It is a real date far in the future',
            'It is a string that sorts after every real date, so undated tasks fall last without a separate branch',
            'None cannot be sorted at all',
            'It marks the task as invalid'
          ],
          answer: 1,
          explanation: 'Sorting None against strings raises a TypeError, so a stand-in is needed. A string that is alphabetically after every real date does the job in one expression.',
          hints: ['What happens if you try to sort None alongside date strings?']
        },
        {
          id: 'p8q2',
          kind: 'choice',
          concept: 'incremental',
          prompt: 'Why does completing an already-completed task not raise?',
          difficulty: 'intermediate',
          options: [
            'Raising is impossible there',
            'Doing something twice is not usually a mistake worth stopping for, unlike naming an id that does not exist',
            'It should raise',
            'done cannot be set twice'
          ],
          answer: 1,
          explanation: 'A missing id means the person meant something else. Completing a done task means the outcome they wanted is already true.',
          hints: ['Which of the two means the person was actually confused?']
        }
      ]
    },

    // ---------------------------------------------------------------- 9
    {
      id: 'p9',
      title: 'Stage 9 — Dates',
      intro: 'One module for everything to do with today, so no other file has to think about it.',
      objectives: ['Centralise date handling', 'Make today injectable so tests are not time-dependent'],
      concepts: ['stdlib', 'testing'],
      requires: ['stdlib'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/dates.py\nfrom datetime import date, timedelta\n\n\ndef today():\n    return date.today().isoformat()          # "2026-03-14"\n\n\ndef month_of(day):\n    return day[:7]                           # "2026-03"\n\n\ndef days_between(first, second):\n    return (date.fromisoformat(second) - date.fromisoformat(first)).days\n\n\ndef day_before(day):\n    return (date.fromisoformat(day) - timedelta(days=1)).isoformat()\n\n\ndef is_overdue(due, now):\n    return due is not None and due < now      # string comparison is correct for this format', caption: 'Every function takes the dates it needs; only today() asks the clock.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'This is the important part: every function that reasons about dates takes "now" as a parameter. A function that calls date.today() inside itself cannot be tested — the test would pass today and fail next Tuesday, and nobody would know why.'
        },
        { kind: 'code', language: 'python', code: '# A test that works for ever\ndef test_overdue():\n    assert is_overdue("2026-03-01", "2026-03-14") is True\n    assert is_overdue("2026-03-20", "2026-03-14") is False\n    assert is_overdue(None, "2026-03-14") is False', caption: 'No clock involved, so the result cannot change with the date.' },
        { kind: 'text', text: 'Go back to complete_task and anything else that needs the date, and pass today() in from main.py rather than calling it inside. That is the one rule of this stage.' },
        { kind: 'check', questionId: 'p9q1' }
      ],
      questions: [
        {
          id: 'p9q1',
          kind: 'choice',
          concept: 'testing',
          prompt: 'Why should a function take "now" as a parameter rather than calling date.today() itself?',
          difficulty: 'advanced',
          options: [
            'It is faster',
            'Otherwise its behaviour depends on the clock and cannot be tested reliably',
            'date.today() is unreliable',
            'There is no reason'
          ],
          answer: 1,
          explanation: 'A function that reads the clock gives a different answer tomorrow. Passing the date in makes it a pure calculation and the test valid for ever.',
          hints: ['What would happen to the test next week?']
        }
      ]
    },

    // ---------------------------------------------------------------- 10
    {
      id: 'p10',
      title: 'Stage 10 — Notes',
      intro: 'The second feature, including tags and searching.',
      objectives: ['Add notes with tags', 'Search titles, bodies and tags'],
      concepts: ['incremental', 'string-methods'],
      requires: ['string-methods'],
      minutes: 16,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/notes.py\ndef add_note(data, title, body, tags, created):\n    note_id = data["next_ids"]["notes"]\n    note = {"id": note_id, "title": title, "body": body,\n            "tags": sorted(set(tags)), "created": created}\n    data["notes"].append(note)\n    data["next_ids"]["notes"] = note_id + 1\n    return note\n\n\ndef clean_tags(raw):\n    """"home, Work ,home" -> ["home", "work"]"""\n    return sorted({part.strip().lower() for part in raw.split(",") if part.strip()})\n\n\ndef search_notes(data, query):\n    q = query.strip().lower()\n    if not q:\n        return []\n    return [n for n in data["notes"]\n            if q in n["title"].lower() or q in n["body"].lower() or any(q in t for t in n["tags"])]\n\n\ndef all_tags(data):\n    counts = {}\n    for note in data["notes"]:\n        for tag in note["tags"]:\n            counts[tag] = counts.get(tag, 0) + 1\n    return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))', caption: 'Four functions, each one of the patterns from Module 4.' },
        { kind: 'text', text: 'clean_tags does three things at once: a set removes duplicates, .lower() means "Home" and "home" are one tag, and the filter drops the empty pieces that come from a trailing comma. All three are cases a person will produce within a minute of using it.' },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The sort key  (-pair[1], pair[0])  gives most-used first and alphabetical within a tie. A tuple key sorts by its first part, then its second — which is how you say "and then by" in one expression.'
        },
        { kind: 'text', text: 'Then notes_menu: list, add, search, show one, delete. An empty search returns nothing rather than everything — guessing in either direction is worse than doing nothing.' },
        { kind: 'check', questionId: 'p10q1' }
      ],
      questions: [
        {
          id: 'p10q1',
          kind: 'choice',
          concept: 'string-methods',
          prompt: 'Why does clean_tags lower-case and de-duplicate?',
          difficulty: 'intermediate',
          options: [
            'To save space',
            'So "Home" and "home" are the same tag and a repeated one is stored once — both of which people type within a minute',
            'Tags must be lower case in JSON',
            'It is not necessary'
          ],
          answer: 1,
          explanation: 'Without it the tag list fills with near-duplicates and filtering by "home" misses half the notes. Tidying at the edge is cheaper than coping with it everywhere.',
          hints: ['What would the tag list look like after a week of real use?']
        }
      ]
    },

    // ---------------------------------------------------------------- 11
    {
      id: 'p11',
      title: 'Stage 11 — Habits and streaks',
      intro: 'The hardest calculation in the project, and the one with a real edge case.',
      objectives: ['Record a habit day idempotently', 'Work out a streak correctly', 'Handle the "not yet today" case'],
      concepts: ['incremental', 'accumulators'],
      requires: ['accumulators', 'stdlib'],
      minutes: 20,
      difficulty: 'expert',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/habits.py\nfrom .dates import day_before\n\n\ndef mark_done(habit, day):\n    """Record a day. Marking twice is the same as marking once."""\n    if day not in habit["days"]:\n        habit["days"].append(day)\n        habit["days"].sort()\n    return habit\n\n\ndef streak(habit, now):\n    """Days in a row ending today or yesterday, counting back.\n\n    Yesterday counts as the end of a live streak: a habit done every day for a\n    month is not broken at one minute past midnight, only at the end of today.\n    """\n    days = set(habit["days"])\n    if not days:\n        return 0\n\n    day = now if now in days else day_before(now)\n    if day not in days:\n        return 0\n\n    count = 0\n    while day in days:\n        count += 1\n        day = day_before(day)\n    return count\n\n\ndef longest_streak(habit):\n    days = sorted(set(habit["days"]))\n    best = run = 0\n    previous = None\n    for day in days:\n        run = run + 1 if previous is not None and day_before(day) == previous else 1\n        best = max(best, run)\n        previous = day\n    return best', caption: 'mark_done is idempotent; streak takes "now" so it can be tested.' },
        { kind: 'heading', text: 'The edge case this stage exists for' },
        { kind: 'text', text: 'A naive streak starts counting from today. Somebody who has kept a habit for thirty days and has not done it yet this morning would be shown a streak of zero — and the thing a habit tracker is for is precisely not discouraging that person at breakfast.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'So the rule is: a streak may end today or yesterday. It is broken when a whole day passes with nothing recorded, not the moment the date changes. Write that in a comment, because the next reader will think the yesterday branch is a bug.'
        },
        { kind: 'text', text: 'Tests, all with a fixed "now": three days in a row ending today is 3; three ending yesterday is still 3; a gap resets it; an empty list is 0; marking the same day twice does not change the count.' },
        { kind: 'check', questionId: 'p11q1' },
        { kind: 'check', questionId: 'p11q2' }
      ],
      questions: [
        {
          id: 'p11q1',
          kind: 'choice',
          concept: 'accumulators',
          prompt: 'Why may a live streak end yesterday rather than today?',
          difficulty: 'expert',
          options: [
            'Because of time zones',
            'Otherwise somebody who has not done it yet this morning is shown zero, which is both wrong and discouraging',
            'Because today is not in the list yet',
            'It should only end today'
          ],
          answer: 1,
          explanation: 'A streak breaks when a full day passes unrecorded, not at midnight. Counting from today alone punishes somebody who is simply not finished with the day.',
          hints: ['What does the program show at 8am to somebody with a 30-day streak?']
        },
        {
          id: 'p11q2',
          kind: 'choice',
          concept: 'incremental',
          prompt: 'Why does mark_done check whether the day is already recorded?',
          difficulty: 'advanced',
          options: [
            'To save space',
            'So marking twice is the same as marking once — the streak must not double-count a day',
            'Lists cannot hold duplicates',
            'It is not needed'
          ],
          answer: 1,
          explanation: 'Being able to repeat an action safely means an accidental double press cannot corrupt the count. Any operation a person might repeat should work this way.',
          hints: ['What happens to the streak if the same date appears twice?']
        }
      ]
    },

    // ---------------------------------------------------------------- 12
    {
      id: 'p12',
      title: 'Stage 12 — Expenses',
      intro: 'Money, categories, monthly totals, and getting the rounding right.',
      objectives: ['Record expenses and total them by month and category', 'Handle money without ending up a penny out'],
      concepts: ['incremental', 'dicts'],
      requires: ['dict-methods'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/expenses.py\nfrom .dates import month_of\n\n\ndef add_expense(data, day, amount, category, note=""):\n    expense_id = data["next_ids"]["expenses"]\n    expense = {"id": expense_id, "date": day, "amount": round(amount, 2),\n               "category": category.strip().lower(), "note": note.strip()}\n    data["expenses"].append(expense)\n    data["next_ids"]["expenses"] = expense_id + 1\n    return expense\n\n\ndef by_month(data):\n    totals = {}\n    for e in data["expenses"]:\n        month = month_of(e["date"])\n        totals[month] = round(totals.get(month, 0) + e["amount"], 2)\n    return dict(sorted(totals.items()))\n\n\ndef by_category(data, month=None):\n    totals = {}\n    for e in data["expenses"]:\n        if month is not None and month_of(e["date"]) != month:\n            continue\n        totals[e["category"]] = round(totals.get(e["category"], 0) + e["amount"], 2)\n    return dict(sorted(totals.items(), key=lambda pair: -pair[1]))\n\n\ndef biggest(data, month=None, count=5):\n    chosen = [e for e in data["expenses"] if month is None or month_of(e["date"]) == month]\n    return sorted(chosen, key=lambda e: -e["amount"])[:count]', caption: 'The counting-into-a-dictionary pattern, three times over.' },
        { kind: 'heading', text: 'Money and floats' },
        { kind: 'text', text: 'Add 0.1 and 0.2 in Python and you get 0.30000000000000004. That is not a Python bug — binary cannot represent those decimals exactly, and every language that uses floats behaves this way.' },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'For this project, rounding each total to two places as it is built is good enough and is what the code above does. For anything where the pennies genuinely matter — a payroll, an invoice, a ledger — store amounts as whole pence in an integer, or use decimal.Decimal. Floats and money are a bad long-term pairing.'
        },
        { kind: 'text', text: 'Then expenses_menu: add, this month, by category, the biggest few, delete. Tests: totals come out right, an empty month gives an empty dictionary rather than an error, and adding 0.1 and 0.2 gives exactly 0.3.' },
        { kind: 'check', questionId: 'p12q1' }
      ],
      questions: [
        {
          id: 'p12q1',
          kind: 'choice',
          concept: 'dicts',
          prompt: 'Why is  0.1 + 0.2 == 0.3  False in Python?',
          difficulty: 'advanced',
          options: [
            'A bug in Python',
            'Floats are binary and cannot represent those decimals exactly — every language with floats does this',
            'The numbers are too small',
            'It is True'
          ],
          answer: 1,
          explanation: 'It is how binary floating point works. Round the result, or store money as whole pence in an integer when the pennies genuinely matter.',
          hints: ['Is this specific to Python?']
        }
      ]
    },

    // ---------------------------------------------------------------- 13
    {
      id: 'p13',
      title: 'Stage 13 — Reports',
      intro: 'Pulling it together: today, overdue, this month, and the streaks.',
      objectives: ['Build a summary from every part of the data', 'Keep formatting out of the logic'],
      concepts: ['layers', 'iterating-data'],
      requires: ['layers'],
      minutes: 18,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/report.py\nfrom .dates import month_of, is_overdue\nfrom .expenses import by_category\nfrom .habits import streak\n\n\ndef summary(data, now):\n    """Everything the front page needs, as data. No formatting, no printing."""\n    open_tasks = [t for t in data["tasks"] if not t["done"]]\n    return {\n        "due_today": [t for t in open_tasks if t["due"] == now],\n        "overdue": [t for t in open_tasks if is_overdue(t["due"], now)],\n        "open_count": len(open_tasks),\n        "month": month_of(now),\n        "month_total": round(sum(e["amount"] for e in data["expenses"]\n                                 if month_of(e["date"]) == month_of(now)), 2),\n        "by_category": by_category(data, month_of(now)),\n        "streaks": {h["name"]: streak(h, now) for h in data["habits"]},\n        "note_count": len(data["notes"]),\n    }', caption: 'One function, returning a dictionary. It can be tested with one comparison.' },
        { kind: 'code', language: 'python', code: '# main.py — the formatting lives here\ndef print_summary(data, now):\n    s = summary(data, now)\n    print(f"\\n{now}")\n    print(f"{s[\'open_count\']} open tasks, {len(s[\'overdue\'])} overdue")\n    for t in s["due_today"]:\n        print(f"  today: {t[\'title\']}")\n    for t in s["overdue"]:\n        print(f"  overdue since {t[\'due\']}: {t[\'title\']}")\n    if s["month_total"]:\n        print(f"\\n{s[\'month\']} spending: £{s[\'month_total\']:.2f}")\n        for category, total in s["by_category"].items():\n            print(f"  {category}: £{total:.2f}")\n    for name, days in s["streaks"].items():\n        print(f"  {name}: {days} day streak" if days else f"  {name}: not started")', caption: 'Every £ and every :.2f is in the interface layer, where it belongs.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That division is the whole of Module 8 in one stage. summary() can be tested with a fixed date and an assert; print_summary() has no logic in it to be wrong.'
        },
        { kind: 'text', text: 'Note the last line: zero days says "not started" rather than "0 day streak". A number of zero is correct and reads as a failure; the words are the interface\'s job.' },
        { kind: 'check', questionId: 'p13q1' }
      ],
      questions: [
        {
          id: 'p13q1',
          kind: 'choice',
          concept: 'layers',
          prompt: 'Why does summary() return a dictionary instead of printing the report?',
          difficulty: 'advanced',
          options: [
            'Dictionaries are faster',
            'It can then be tested with a single comparison, and the same data could feed a file or a web page',
            'print cannot be used in a module',
            'There is no reason'
          ],
          answer: 1,
          explanation: 'Returning data separates what the numbers are from how they look. One is logic and testable; the other is formatting and has nothing to get wrong.',
          hints: ['How would you write a test for a function that prints?']
        }
      ]
    },

    // ---------------------------------------------------------------- 14
    {
      id: 'p14',
      title: 'Stage 14 — Tests',
      intro: 'A real test suite, written where it matters most rather than everywhere.',
      objectives: ['Write tests for the logic layer', 'Cover the edges and the bugs already found'],
      concepts: ['testing'],
      requires: ['testing'],
      minutes: 20,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# tests/test_habits.py\nfrom manager.habits import mark_done, streak, longest_streak\n\nNOW = "2026-03-14"\n\n\ndef habit(*days):\n    return {"id": 1, "name": "Read", "days": list(days)}\n\n\ndef test_streak_ending_today():\n    assert streak(habit("2026-03-12", "2026-03-13", "2026-03-14"), NOW) == 3\n\n\ndef test_streak_ending_yesterday_is_still_live():\n    assert streak(habit("2026-03-12", "2026-03-13"), NOW) == 2\n\n\ndef test_gap_breaks_the_streak():\n    assert streak(habit("2026-03-10", "2026-03-11", "2026-03-14"), NOW) == 1\n\n\ndef test_nothing_recorded():\n    assert streak(habit(), NOW) == 0\n\n\ndef test_marking_twice_changes_nothing():\n    h = habit()\n    mark_done(h, NOW)\n    mark_done(h, NOW)\n    assert h["days"] == [NOW]\n    assert streak(h, NOW) == 1', caption: 'A helper for building test data, then one assertion per behaviour.' },
        { kind: 'heading', text: 'What to cover' },
        {
          kind: 'table',
          headers: ['Area', 'Tests worth having'],
          rows: [
            ['store', 'missing file, round trip, damaged JSON raises, temp file cleaned up'],
            ['validate', 'good, empty, too long, out of range, wrong type for each validator'],
            ['tasks', 'ids increase, complete, delete, unknown id raises, sort order with and without dates'],
            ['habits', 'the five above'],
            ['expenses', 'monthly total, category total, empty month, 0.1 + 0.2'],
            ['report', 'summary with a fixed date, and with no data at all']
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Do not test main.py. It is prompts and printing, and testing it is laborious and catches little. The reason the logic is in a separate package is precisely so the valuable tests are easy.'
        },
        { kind: 'text', text: 'Run pytest. Every test should pass or point at a real bug — and at this stage in a real project, two or three of them will.' },
        { kind: 'check', questionId: 'p14q1' }
      ],
      questions: [
        {
          id: 'p14q1',
          kind: 'choice',
          concept: 'testing',
          prompt: 'Why not write tests for main.py?',
          difficulty: 'advanced',
          options: [
            'Tests cannot call input()',
            'It is prompting and printing — laborious to test and with little logic to get wrong, which is why the logic was put elsewhere',
            'main.py never has bugs',
            'pytest cannot find it'
          ],
          answer: 1,
          explanation: 'Effort goes where the risk is. The layer split exists so the valuable tests are the easy ones.',
          hints: ['What is actually in main.py?']
        }
      ]
    },

    // ---------------------------------------------------------------- 15
    {
      id: 'p15',
      title: 'Stage 15 — Tasks as a class',
      intro: 'Refactoring one part to use a class, and judging honestly whether it was worth it.',
      objectives: ['Refactor a dictionary-based record into a class', 'Decide whether the change improved anything'],
      concepts: ['classes', 'refactoring'],
      requires: ['class-design', 'refactoring'],
      minutes: 20,
      difficulty: 'expert',
      required: true,
      blocks: [
        { kind: 'text', text: 'Tasks have accumulated rules: a priority must be one of three values, completing sets a date, done tasks sort last. Module 7 said that is the signal for a class. So do it — for tasks only.' },
        { kind: 'code', language: 'python', code: '# manager/tasks.py\nfrom .validate import clean_title, clean_priority\n\n\nclass Task:\n    def __init__(self, task_id, title, due=None, priority="normal", done=False, completed=None):\n        self.id = task_id\n        self.title = clean_title(title)\n        self.due = due\n        self.priority = clean_priority(priority)\n        self.done = done\n        self.completed = completed\n\n    def complete(self, today):\n        if not self.done:\n            self.done = True\n            self.completed = today\n        return self\n\n    def is_overdue(self, now):\n        return not self.done and self.due is not None and self.due < now\n\n    def sort_key(self):\n        order = {"high": 0, "normal": 1, "low": 2}\n        return (self.done, self.due or "9999-99-99", order[self.priority])\n\n    def __repr__(self):\n        return f"Task({self.id}, {self.title!r}, due={self.due!r}, done={self.done})"\n\n    def to_dict(self):\n        return {"id": self.id, "title": self.title, "due": self.due,\n                "priority": self.priority, "done": self.done, "completed": self.completed}\n\n    @classmethod\n    def from_dict(cls, raw):\n        return cls(raw["id"], raw["title"], raw.get("due"), raw.get("priority", "normal"),\n                   raw.get("done", False), raw.get("completed"))', caption: 'to_dict and from_dict are the bridge to JSON, which cannot hold an object.' },
        { kind: 'heading', text: 'What was actually gained' },
        {
          kind: 'list',
          items: [
            'A Task cannot exist with an empty title or an invalid priority — validation happens on creation',
            'A typo like task.titel = "x" creates a stray attribute instead of silently replacing a field, and __repr__ makes it visible',
            'The sort rule lives on the thing being sorted',
            'Printing a list of tasks is now readable, which it was not'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'And the honest cost: two extra methods purely to get in and out of JSON, and every existing function and test touched. Worth it for tasks, which have rules. Not worth it for expenses, which are four fields and no behaviour — leave those as dictionaries and resist the urge to be consistent for its own sake.'
        },
        { kind: 'text', text: 'Run the tests. They will fail, because task["title"] is now task.title. Fix them one at a time — this is what refactoring feels like, and it is why the tests existed first.' },
        { kind: 'check', questionId: 'p15q1' },
        { kind: 'check', questionId: 'p15q2' }
      ],
      questions: [
        {
          id: 'p15q1',
          kind: 'choice',
          concept: 'classes',
          prompt: 'Why do Task.to_dict and Task.from_dict exist?',
          difficulty: 'advanced',
          options: [
            'For printing',
            'JSON cannot hold a Python object, so there has to be a conversion at the storage boundary',
            'To copy tasks',
            'To compare tasks'
          ],
          answer: 1,
          explanation: 'JSON holds dictionaries, lists, strings, numbers and booleans. Anything richer needs converting at the edge — which is a real cost of using classes with JSON storage.',
          hints: ['What types can JSON actually represent?']
        },
        {
          id: 'p15q2',
          kind: 'choice',
          concept: 'refactoring',
          prompt: 'Why leave expenses as dictionaries while making tasks a class?',
          difficulty: 'expert',
          options: [
            'Expenses are less important',
            'An expense is four fields with no rules or behaviour, so a class would add conversion code and gain nothing',
            'Classes cannot hold money',
            'They should both be classes'
          ],
          answer: 1,
          explanation: 'A class pays for itself where there are rules to enforce and behaviour to attach. Applying it to plain data for consistency is cost with no benefit.',
          hints: ['What rules does an expense have that a class would enforce?']
        }
      ]
    },

    // ---------------------------------------------------------------- 16
    {
      id: 'p16',
      title: 'Stage 16 — Search across everything',
      intro: 'One query, four kinds of thing, honest about what it does not search.',
      objectives: ['Search several collections with one query', 'Rank and label mixed results'],
      concepts: ['iterating-data', 'nested-data'],
      requires: ['nested-data'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/search.py\ndef search(data, query):\n    """Matches across tasks, notes and expenses. Habits are matched by name only."""\n    q = query.strip().lower()\n    if len(q) < 2:\n        return []                       # one letter matches nearly everything\n\n    found = []\n    for t in data["tasks"]:\n        if q in t["title"].lower():\n            found.append({"kind": "task", "id": t["id"], "text": t["title"], "extra": t["due"]})\n    for n in data["notes"]:\n        where = "title" if q in n["title"].lower() else "body" if q in n["body"].lower() else None\n        if where is None and not any(q in tag for tag in n["tags"]):\n            continue\n        found.append({"kind": "note", "id": n["id"], "text": n["title"], "extra": where or "tag"})\n    for e in data["expenses"]:\n        if q in e["category"] or q in e["note"].lower():\n            found.append({"kind": "expense", "id": e["id"], "text": f"{e[\'category\']} £{e[\'amount\']:.2f}", "extra": e["date"]})\n    for h in data["habits"]:\n        if q in h["name"].lower():\n            found.append({"kind": "habit", "id": h["id"], "text": h["name"], "extra": None})\n\n    # A title match is worth more than a body or note match.\n    rank = {"task": 0, "note": 1, "habit": 2, "expense": 3}\n    return sorted(found, key=lambda one: (rank[one["kind"]], one["text"].lower()))', caption: 'Every result has the same shape, so the interface needs one printing loop.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Giving mixed results one common shape — kind, id, text, extra — is what stops the print function having four branches. Deciding the result shape is as much a design decision as deciding the storage shape.'
        },
        { kind: 'text', text: 'The docstring says habits are matched by name only. Say that on screen too when a habit result appears. A search that silently does not look somewhere is worse than one that says it did not.' },
        { kind: 'check', questionId: 'p16q1' }
      ],
      questions: [
        {
          id: 'p16q1',
          kind: 'choice',
          concept: 'iterating-data',
          prompt: 'Why give every search result the same four fields?',
          difficulty: 'advanced',
          options: [
            'To save memory',
            'So the code that displays them needs one loop rather than a branch per kind',
            'Because dictionaries must match',
            'It is not necessary'
          ],
          answer: 1,
          explanation: 'A common shape is what lets the interface treat mixed results uniformly. The alternative is four printing branches that drift apart.',
          hints: ['Think about the code that has to display the results.']
        }
      ]
    },

    // ---------------------------------------------------------------- 17
    {
      id: 'p17',
      title: 'Stage 17 — Export',
      intro: 'Getting the data out, into something a spreadsheet can open.',
      objectives: ['Write CSV with the csv module', 'Explain why not to build CSV by hand'],
      concepts: ['stdlib', 'writing-files'],
      requires: ['stdlib', 'writing-files'],
      minutes: 14,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'code', language: 'python', code: '# manager/export.py\nimport csv\n\n\ndef expenses_to_csv(data, path):\n    """Write every expense as CSV. Returns how many rows were written."""\n    rows = sorted(data["expenses"], key=lambda e: e["date"])\n    with open(path, "w", newline="", encoding="utf-8") as f:\n        writer = csv.DictWriter(f, fieldnames=["date", "amount", "category", "note"],\n                                extrasaction="ignore")\n        writer.writeheader()\n        writer.writerows(rows)\n    return len(rows)', caption: 'newline="" is required on Windows, or every row comes out double-spaced.' },
        { kind: 'heading', text: 'Why not build it by hand' },
        { kind: 'text', text: 'Joining fields with commas looks like it works until a note contains a comma, a quote, or a newline — at which point the file silently has the wrong number of columns and a spreadsheet reads it wrongly with no error.' },
        { kind: 'code', language: 'python', code: '# A note of:  lunch, with "Bea"\n# By hand:   2026-03-14,12.5,food,lunch, with "Bea"     <- five columns, broken quotes\n# csv:       2026-03-14,12.5,food,"lunch, with ""Bea"""  <- four columns, correct', caption: 'The escaping rules are not hard, and getting them all right is not the job you were hired for.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The same reasoning as Module 6: a format that looks trivial usually has a specification, and the library has already met every awkward case you have not thought of.'
        },
        { kind: 'text', text: 'Add it to the reports menu, and print how many rows were written and where. A function that says "exported" without saying how many is one you cannot check.' },
        { kind: 'check', questionId: 'p17q1' }
      ],
      questions: [
        {
          id: 'p17q1',
          kind: 'choice',
          concept: 'writing-files',
          prompt: 'Why use the csv module rather than joining values with commas?',
          difficulty: 'intermediate',
          options: [
            'It is faster',
            'Values containing a comma, a quote or a newline need escaping, and getting it wrong breaks the file silently',
            'Commas are not allowed in Python',
            'There is no difference'
          ],
          answer: 1,
          explanation: 'CSV has escaping rules. By hand, a note with a comma produces an extra column and a spreadsheet reads it wrongly with no error at all.',
          hints: ['What happens when a note contains a comma?']
        }
      ]
    },

    // ---------------------------------------------------------------- 18
    {
      id: 'p18',
      title: 'Stage 18 — The awkward cases',
      intro: 'Working through the finishing checklist from Module 9, properly.',
      objectives: ['Test every empty, wrong and extreme input', 'Fix what it finds'],
      concepts: ['independent', 'robustness'],
      requires: ['robustness'],
      minutes: 20,
      difficulty: 'expert',
      required: true,
      blocks: [
        { kind: 'text', text: 'Go through all of these on the real program. Write down what happens before fixing anything.' },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Delete the data folder and start it. Does it start cleanly?',
            'Put the word "broken" in manager.json. Does it refuse, say so, and change nothing?',
            'Press Enter at every single prompt, one at a time',
            'Type letters where a number is asked for',
            'Type a 500-character title',
            'Type a title with quotes, an accent and an emoji. Save, quit, reload — is it the same?',
            'Add an expense of 0, and of -5',
            'Complete a task twice, then delete it twice',
            'Ask for a task id that does not exist',
            'Mark a habit done twice today',
            'Run the report with no data at all',
            'Export with no expenses',
            'Add 300 tasks in a loop and open the list — is it usable?',
            'Run it from a different folder',
            'Run it in a fresh virtual environment from requirements.txt alone'
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'Number 2 is the one to be ruthless about. If the program starts blank and then saves, the damaged file is gone and your own program destroyed the data. Everything else on this list is an annoyance; that one is unforgivable.'
        },
        { kind: 'heading', text: 'What this usually finds' },
        {
          kind: 'list',
          items: [
            'An empty answer somewhere that was never considered',
            'A report dividing by zero when a list is empty',
            'A deleted-then-completed task raising an unhandled KeyError at the menu',
            'An encoding problem on accented text, from a missing encoding="utf-8"',
            'A list of 300 tasks printing without pause'
          ]
        },
        { kind: 'text', text: 'Fix each, and write a test for each as you go. Those tests are the most valuable in the suite, because every one of them is a bug that actually happened.' },
        { kind: 'check', questionId: 'p18q1' }
      ],
      questions: [
        {
          id: 'p18q1',
          kind: 'choice',
          concept: 'robustness',
          prompt: 'Which item on the checklist is the most serious if it fails?',
          difficulty: 'expert',
          options: [
            'A 500-character title is accepted',
            'A damaged data file causes a blank start followed by a save, destroying the data',
            'The report looks untidy with no data',
            '300 tasks print without pause'
          ],
          answer: 1,
          explanation: 'Everything else is an annoyance. That one is the program destroying its own user\'s data, which is the one failure that cannot be apologised for.',
          hints: ['Which one loses something that cannot be got back?']
        }
      ]
    },

    // ---------------------------------------------------------------- 19
    {
      id: 'p19',
      title: 'Stage 19 — Documentation',
      intro: 'The README that makes it somebody else\'s program too.',
      objectives: ['Write a README somebody can follow with no help', 'Document the data location and the limits'],
      concepts: ['project-structure', 'comments'],
      requires: ['project-structure'],
      minutes: 14,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        { kind: 'example', title: 'What the README has to contain', text: '# Manager\n\nA terminal productivity manager: tasks, notes, habits and expenses, saved to a JSON file.\n\n## Installing\nPython 3.10 or later.\n\n    python -m venv .venv\n    .venv\\Scripts\\activate        (Windows)\n    source .venv/bin/activate     (Mac and Linux)\n    pip install -r requirements.txt\n\n## Running\n    python main.py\n\n## Where your data is\ndata/manager.json, beside the program. Back it up by copying that file.\nIt is written to a temporary file and renamed, so an interrupted save cannot corrupt it.\n\n## Tests\n    pytest\n\n## What it does not do\nOne user, one machine. No sync, no reminders, no recurring tasks, no currencies,\nno web or phone interface. Dates are stored as YYYY-MM-DD and no time of day is kept.' },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'The "where your data is" section is the one people are most grateful for and the one most often missing. Somebody will want to back it up, move it, or look at it — and if the README does not say where it is, they will go looking in the wrong place.'
        },
        { kind: 'text', text: 'Also: a docstring on every public function saying what it returns and how it fails, comments only on the decisions somebody would otherwise undo — the yesterday branch in streak(), the "9999-99-99" sort key, the temp-file rename — and requirements.txt from pip freeze.' },
        { kind: 'text', text: 'Then try it: delete your virtual environment, follow your own README from the top, and see whether it works. That is the only way to know it is right.' },
        { kind: 'check', questionId: 'p19q1' }
      ],
      questions: [
        {
          id: 'p19q1',
          kind: 'choice',
          concept: 'project-structure',
          prompt: 'Which README section is most often missing and most needed?',
          difficulty: 'intermediate',
          options: [
            'A list of the files',
            'Where the program keeps its data, and how to back it up',
            'The author\'s name',
            'The version of Python the author used'
          ],
          answer: 1,
          explanation: 'People want to back it up, move it or inspect it. Without being told where it is, they look in the wrong place and assume it was lost.',
          hints: ['What will somebody want to do with their own data?']
        }
      ]
    },

    // ---------------------------------------------------------------- 20
    {
      id: 'p20',
      title: 'Stage 20 — Done',
      intro: 'Judging your own work honestly against what finished means.',
      objectives: ['Assess the project against the requirements', 'Say what you would do differently'],
      concepts: ['independent'],
      requires: ['independent'],
      minutes: 16,
      difficulty: 'expert',
      required: true,
      blocks: [
        { kind: 'heading', text: 'Check it against stage one' },
        { kind: 'text', text: 'Go back to the three lists you wrote in stage one. Every "must" item: does it work? Every "must never": have you actually tried to make it happen? Every "will not": did you build it anyway?' },
        { kind: 'heading', text: 'Finished means' },
        {
          kind: 'list',
          items: [
            'All four kinds of item can be added, listed, changed and deleted',
            'Everything survives quitting and restarting',
            'A damaged data file is refused, not overwritten',
            'No input at any prompt can crash it',
            'Reports are right, including with no data',
            'Tests pass, and cover the storage, validation, tasks, habits and expenses',
            'Somebody else can install and run it from the README alone',
            'Errors say what happened and what to do',
            'You can explain every line in it'
          ]
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'That last one is the real test of the whole course. If there is a line you cannot explain, go and find out now — that is the line that will break at the worst moment, and understanding it is what the certificate is actually for.'
        },
        { kind: 'heading', text: 'What you would do differently' },
        { kind: 'text', text: 'Write two or three sentences, honestly. The common answers after building this are worth knowing in advance: storing money as pence from the start; making Task a class at stage 8 rather than refactoring at stage 15; writing the store tests before the store; and keeping a stricter scope than you did.' },
        { kind: 'text', text: 'None of that is failure. Noticing it is the thing that makes the next project better, and being able to say it is most of what separates a second-year programmer from a first-year one.' },
        { kind: 'check', questionId: 'p20q1' },
        { kind: 'check', questionId: 'p20q2' }
      ],
      questions: [
        {
          id: 'p20q1',
          kind: 'multi',
          concept: 'independent',
          prompt: 'Which are required before this project counts as finished? (Choose all that apply.)',
          difficulty: 'expert',
          options: [
            'No input at any prompt can crash it',
            'A damaged data file is refused rather than overwritten',
            'Every feature anybody suggested is implemented',
            'Somebody else can install and run it from the README alone'
          ],
          answer: [0, 1, 3],
          explanation: 'All except implementing every suggestion, which is the definition of never finishing — and is why stage one wrote down what the project would not do.',
          hints: ['One of these contradicts stage one.']
        },
        {
          id: 'p20q2',
          kind: 'short',
          concept: 'independent',
          prompt: 'What is the strongest single test of whether you have really learned this?',
          difficulty: 'expert',
          answer: 'being able to explain every line of your own project',
          accepts: ['you can explain every line', 'understanding all your own code', 'explaining the whole program'],
          explanation: 'Being able to explain every line. Code you cannot explain is code you cannot debug, and debugging it at the worst moment is the job.',
          hints: ['It is the last item on the finished list.']
        }
      ]
    }
  ]
}
