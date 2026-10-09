import { DatabaseSync } from 'node:sqlite'

/**
 * The SQL laboratory.
 *
 * ## It is a real database, not a parser
 *
 * Every query runs through SQLite — the same engine Orbis already uses for memory, recall and the galaxy. So a join
 * behaves like a join, a GROUP BY behaves like a GROUP BY, an error message is SQLite's own, and the query plan shown
 * is the plan SQLite actually chose. A hand-written interpreter over a subset would get all four of those wrong, and
 * the fourth one is the whole point of a SQL laboratory.
 *
 * ## It lives in memory and nowhere else
 *
 * Each open laboratory gets its own `:memory:` database. Nothing is written to disk, nothing survives closing the
 * app, and no laboratory can see another's tables. A practice database that could touch the real ones would be a
 * serious mistake, and keeping them in memory is how that is prevented rather than promised.
 *
 * ## Typed SQL is checked before it reaches SQLite
 *
 * `:memory:` is not on its own enough. `ATTACH DATABASE` would let a query open a file, read it and write it, which
 * would turn a teaching tool into a way to reach the user's own data. So every statement is read first and the ones
 * that can leave memory are refused by name, with a reason. The guard is a list of what is forbidden rather than a
 * list of what is allowed, because a list of what is allowed would quietly block two thirds of SQL and make the
 * laboratory useless for learning it.
 *
 * ## The practice data says that it is practice data
 *
 * The datasets below are made up. They are shaped like real data — a shop with customers and orders, a library with
 * loans — because learning a join needs something to join, but nothing here is a measurement of anything and every
 * dataset carries a line saying so. Orbis never presents invented numbers as real, and a sample database is exactly
 * where that rule is easiest to break by accident.
 */

/** How long one query may run before it is stopped. */
const QUERY_MILLISECONDS = 5_000

/** The most rows one result may carry back. Beyond this the laboratory says it truncated rather than returning it all. */
const ROW_CEILING = 2_000

/** The most rows a laboratory's whole database may hold, so a runaway INSERT cannot exhaust memory. */
const TOTAL_ROW_CEILING = 200_000

export interface SqlProblem {
  error: string
  says: string
  fix: string
}

const refuse = (error: string, says: string, fix: string): SqlProblem => ({ error, says, fix })

/**
 * Statements that could reach outside the in-memory database.
 *
 * Each is matched as a whole word at the start of a statement or as a function call, and each carries the reason it
 * is refused — because "that is not allowed" teaches nothing, and somebody learning SQL who types ATTACH deserves to
 * know why a practice database will not do it.
 */
const FORBIDDEN: readonly { pattern: RegExp; says: string; fix: string }[] = Object.freeze([
  {
    pattern: /\battach\s+(database\b|['"])/i,
    says: 'ATTACH would open another database file.',
    fix: 'This laboratory is kept in memory on purpose, so it cannot reach any file. Everything you need is in the tables already here.'
  },
  {
    pattern: /\bdetach\s+database\b/i,
    says: 'DETACH only makes sense after ATTACH, which is not allowed here.',
    fix: 'There is only ever one database in this laboratory.'
  },
  {
    pattern: /\bload_extension\s*\(/i,
    says: 'load_extension would load code from a file.',
    fix: 'The laboratory runs no code from outside it.'
  },
  {
    pattern: /\bvacuum\s+into\b/i,
    says: 'VACUUM INTO would write the database to a file.',
    fix: 'Use the export button if you want the data out — that goes through Orbis rather than straight to disk.'
  },
  {
    pattern: /\bpragma\s+\w*(journal|wal|temp_store|mmap|cache_spill|database_list|synchronous)/i,
    says: 'That PRAGMA is about files and storage, which this laboratory does not have.',
    fix: 'PRAGMA table_info and PRAGMA index_list work, and are the useful ones for looking at a schema.'
  },
  {
    pattern: /\bwritefile\s*\(|\breadfile\s*\(/i,
    says: 'Those read and write files.',
    fix: 'They are not available here.'
  }
])

/** Reads the typed SQL and refuses it if it could leave memory. */
export function checkSql(sql: string): SqlProblem | null {
  const text = String(sql)
  if (text.trim().length === 0) return refuse('empty', 'Nothing was typed.', 'Write a query, such as SELECT * FROM customers.')
  if (text.length > 20_000) {
    return refuse('too long', 'That is a very long query.', 'Keep it under 20,000 characters.')
  }
  /*
   * Comments and string literals are blanked before matching, so a column called `attachment` or a row containing the
   * word ATTACH does not trip the guard — and, more importantly, so a forbidden word hidden inside a comment cannot
   * be used to slip past it either way.
   */
  const stripped = text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
  for (const one of FORBIDDEN) {
    if (one.pattern.test(stripped)) return refuse('not allowed here', one.says, one.fix)
  }
  return null
}

export interface Column {
  name: string
  /** What the table says it is. Empty for a computed column, which SQLite does not type. */
  declared: string
}

export interface ResultTable {
  columns: readonly Column[]
  rows: readonly (readonly (string | number | boolean | null)[])[]
  /** Rows there were, when more than came back. */
  of: number
  truncated: boolean
}

export interface PlanStep {
  detail: string
  /** True when SQLite said it is scanning a whole table, which is the thing worth noticing. */
  scanning: boolean
  /** True when it used an index. */
  usingIndex: boolean
}

export interface QueryResult {
  sql: string
  /** A SELECT-shaped result, or null for a statement that changed something instead. */
  table: ResultTable | null
  /** Rows added, changed or removed. Null when the statement was a query. */
  changed: number | null
  /** How long SQLite took, in milliseconds. Measured, and stated to one decimal because that is all it is worth. */
  took: number
  plan: readonly PlanStep[]
  /** What the plan means, in words. */
  planSays: string
  /** SQLite's own message, when the query failed. */
  problem: SqlProblem | null
  /** Statements run, when several were given at once. */
  statements: number
}

export interface TableFacts {
  name: string
  columns: readonly { name: string; type: string; notNull: boolean; primaryKey: boolean }[]
  rows: number
  indexes: readonly { name: string; columns: readonly string[]; unique: boolean }[]
  /** What this table points at, as the database declares it. Empty when it declares none. */
  references: readonly { toTable: string; from: string; to: string }[]
}

export interface Schema {
  tables: readonly TableFacts[]
  /** Which dataset is loaded, and the line saying it is made up. */
  dataset: string
  about: string
}

// ---------------------------------------------------------------- the practice datasets

interface Dataset {
  id: string
  name: string
  about: string
  /** Why somebody would pick this one — which joins and which aggregates it is good for. */
  teaches: readonly string[]
  sql: string
}

/*
 * Every dataset is written as plain SQL rather than built from a table of objects, so what the laboratory contains is
 * readable here and so the schema shown in the inspector is exactly the schema that was created.
 */
export const DATASETS: readonly Dataset[] = Object.freeze([
  {
    id: 'shop',
    name: 'A small shop',
    about: 'Made-up practice data. None of these customers or orders is real.',
    teaches: ['Joins across three tables', 'GROUP BY with SUM and COUNT', 'Finding customers with no orders'],
    sql: `
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        city TEXT NOT NULL,
        joined TEXT NOT NULL
      );
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        placed TEXT NOT NULL
      );
      CREATE TABLE order_lines (
        order_id INTEGER NOT NULL REFERENCES orders(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL,
        PRIMARY KEY (order_id, product_id)
      );
      INSERT INTO customers (id, name, city, joined) VALUES
        (1, 'Ada Nkemelu', 'Leeds', '2023-01-14'),
        (2, 'Bo Laurent', 'Bristol', '2023-02-02'),
        (3, 'Chen Wei', 'Leeds', '2023-02-19'),
        (4, 'Dara Okafor', 'Glasgow', '2023-03-30'),
        (5, 'Esme Ruiz', 'Bristol', '2023-05-11'),
        (6, 'Fen Adeyemi', 'Cardiff', '2023-06-01'),
        (7, 'Gil Mbeki', 'Leeds', '2023-07-23'),
        (8, 'Hana Sato', 'Glasgow', '2023-09-08');
      INSERT INTO products (id, name, category, price) VALUES
        (1, 'Notebook', 'Stationery', 3.50),
        (2, 'Fountain pen', 'Stationery', 24.00),
        (3, 'Desk lamp', 'Furniture', 42.00),
        (4, 'Chair', 'Furniture', 165.00),
        (5, 'Headphones', 'Electronics', 89.99),
        (6, 'Keyboard', 'Electronics', 54.50),
        (7, 'Mug', 'Kitchen', 8.00),
        (8, 'Kettle', 'Kitchen', 37.25);
      INSERT INTO orders (id, customer_id, placed) VALUES
        (1, 1, '2023-03-01'), (2, 1, '2023-04-17'), (3, 2, '2023-03-05'),
        (4, 3, '2023-05-20'), (5, 3, '2023-06-02'), (6, 3, '2023-08-14'),
        (7, 5, '2023-07-01'), (8, 7, '2023-09-19'), (9, 7, '2023-10-02'),
        (10, 8, '2023-10-30');
      INSERT INTO order_lines (order_id, product_id, quantity) VALUES
        (1, 1, 4), (1, 7, 2), (2, 5, 1), (3, 2, 1), (3, 1, 10),
        (4, 4, 2), (4, 3, 1), (5, 6, 1), (6, 8, 1), (6, 7, 6),
        (7, 3, 3), (8, 5, 2), (8, 6, 2), (9, 1, 1), (10, 4, 1);
      CREATE INDEX orders_by_customer ON orders(customer_id);
    `
  },
  {
    id: 'library',
    name: 'A library',
    about: 'Made-up practice data. These books exist; these borrowers and loans do not.',
    teaches: ['Dates and overdue calculations', 'LEFT JOIN to find what is not borrowed', 'Counting per group with HAVING'],
    sql: `
      CREATE TABLE books (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        year INTEGER NOT NULL,
        copies INTEGER NOT NULL
      );
      CREATE TABLE borrowers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL
      );
      CREATE TABLE loans (
        id INTEGER PRIMARY KEY,
        book_id INTEGER NOT NULL REFERENCES books(id),
        borrower_id INTEGER NOT NULL REFERENCES borrowers(id),
        taken TEXT NOT NULL,
        due TEXT NOT NULL,
        returned TEXT
      );
      INSERT INTO books (id, title, author, year, copies) VALUES
        (1, 'Things Fall Apart', 'Chinua Achebe', 1958, 3),
        (2, 'The Left Hand of Darkness', 'Ursula K. Le Guin', 1969, 2),
        (3, 'Beloved', 'Toni Morrison', 1987, 4),
        (4, 'Invisible Cities', 'Italo Calvino', 1972, 1),
        (5, 'The Remains of the Day', 'Kazuo Ishiguro', 1989, 2),
        (6, 'Season of Migration to the North', 'Tayeb Salih', 1966, 1),
        (7, 'Wide Sargasso Sea', 'Jean Rhys', 1966, 2);
      INSERT INTO borrowers (id, name, kind) VALUES
        (1, 'Ines Varela', 'member'),
        (2, 'Jon Pethick', 'member'),
        (3, 'Kemi Alabi', 'staff'),
        (4, 'Liu Yang', 'member'),
        (5, 'Mira Holt', 'staff');
      INSERT INTO loans (id, book_id, borrower_id, taken, due, returned) VALUES
        (1, 1, 1, '2024-01-05', '2024-02-05', '2024-01-28'),
        (2, 3, 1, '2024-02-10', '2024-03-10', NULL),
        (3, 2, 2, '2024-01-20', '2024-02-20', '2024-03-04'),
        (4, 3, 3, '2024-03-01', '2024-04-01', NULL),
        (5, 5, 4, '2024-02-14', '2024-03-14', '2024-03-12'),
        (6, 1, 4, '2024-03-20', '2024-04-20', NULL),
        (7, 7, 2, '2024-04-02', '2024-05-02', NULL),
        (8, 3, 5, '2024-01-11', '2024-02-11', '2024-02-09');
      CREATE INDEX loans_by_book ON loans(book_id);
    `
  },
  {
    id: 'weather',
    name: 'Weather readings',
    about: 'Made-up practice data. These are not real measurements from anywhere.',
    teaches: ['Window functions', 'Grouping by month', 'Averages and running totals'],
    sql: `
      CREATE TABLE stations (
        id TEXT PRIMARY KEY,
        place TEXT NOT NULL,
        height_m INTEGER NOT NULL
      );
      CREATE TABLE readings (
        station_id TEXT NOT NULL REFERENCES stations(id),
        day TEXT NOT NULL,
        temperature_c REAL NOT NULL,
        rain_mm REAL NOT NULL,
        PRIMARY KEY (station_id, day)
      );
      INSERT INTO stations (id, place, height_m) VALUES
        ('HIL', 'Hilltop', 410), ('VAL', 'Valley floor', 35), ('CST', 'Coast', 8);
    `
  },
  {
    id: 'empty',
    name: 'Nothing — I will make my own',
    about: 'An empty database. Write CREATE TABLE and put your own data in.',
    teaches: ['CREATE TABLE and types', 'Primary keys and constraints', 'Watching a constraint refuse bad data'],
    sql: ''
  }
])

const DATASET_BY_ID = new Map(DATASETS.map((one) => [one.id, one]))

/**
 * Fills the weather dataset.
 *
 * Generated rather than typed out because three hundred readings is the point — a window function over eight rows
 * teaches nothing. The values follow a seasonal curve plus a fixed wobble, and they are *not* random: the same
 * laboratory always holds the same numbers, so a query somebody writes today gives the same answer tomorrow, and the
 * dataset's own description says they are made up.
 */
function weatherRows(): string {
  const parts: string[] = []
  const stations: readonly [string, number][] = [
    ['HIL', -3.5],
    ['VAL', 0],
    ['CST', 1.5]
  ]
  for (const [id, offset] of stations) {
    for (let day = 0; day < 120; day += 1) {
      const date = new Date(Date.UTC(2024, 0, 1 + day))
      const season = 9 + 8 * Math.sin((2 * Math.PI * (day - 20)) / 365)
      // A deterministic wobble, so two stations do not read identically and nothing depends on a random source.
      const wobble = 2.5 * Math.sin(day * 1.7 + offset * 3)
      const temperature = Math.round((season + offset + wobble) * 10) / 10
      const rain = Math.max(0, Math.round((3 + 4 * Math.sin(day * 0.9 + offset)) * 10) / 10)
      parts.push(`('${id}', '${date.toISOString().slice(0, 10)}', ${temperature}, ${rain})`)
    }
  }
  return `INSERT INTO readings (station_id, day, temperature_c, rain_mm) VALUES ${parts.join(', ')};`
}

// ---------------------------------------------------------------- the laboratory

interface Open {
  db: DatabaseSync
  dataset: string
}

/**
 * Holds one in-memory database per open laboratory.
 *
 * Closed databases are let go when the instance closes, and `closeAll` runs at quit — not because the memory would
 * otherwise leak past the process, but because a `DatabaseSync` holds a native handle and dropping it on the floor is
 * the kind of thing that works until it does not.
 */
export class SqlLab {
  private readonly open = new Map<string, Open>()

  /** Sets a laboratory up with a dataset, replacing whatever it held. */
  load(instanceId: string, datasetId: string): Schema | SqlProblem {
    const dataset = DATASET_BY_ID.get(datasetId)
    if (dataset === undefined) {
      return refuse(
        'no such dataset',
        `There is no practice database called "${datasetId}".`,
        `Pick one of: ${DATASETS.map((one) => one.name).join(', ')}.`
      )
    }
    this.close(instanceId)
    let db: DatabaseSync
    try {
      db = new DatabaseSync(':memory:')
      db.exec('PRAGMA foreign_keys = ON;')
      if (dataset.sql.trim().length > 0) db.exec(dataset.sql)
      if (dataset.id === 'weather') db.exec(weatherRows())
    } catch (error) {
      return refuse(
        'could not set up',
        `The practice database would not load: ${error instanceof Error ? error.message : String(error)}`,
        'This is a fault in Orbis rather than in anything you did.'
      )
    }
    this.open.set(instanceId, { db, dataset: dataset.id })
    return this.schemaOf(instanceId) as Schema
  }

  /** What a laboratory holds. */
  schemaOf(instanceId: string): Schema | SqlProblem {
    const held = this.open.get(instanceId)
    if (held === undefined) return refuse('not open', 'This laboratory has no database yet.', 'Pick a practice database to start with.')
    const dataset = DATASET_BY_ID.get(held.dataset)
    const names = held.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as { name: string }[]

    const tables: TableFacts[] = []
    for (const { name } of names) {
      const columns = (held.db.prepare(`PRAGMA table_info(${quoteName(name)})`).all() as {
        name: string
        type: string
        notnull: number
        pk: number
      }[]).map((one) => ({ name: one.name, type: one.type || 'any', notNull: one.notnull === 1, primaryKey: one.pk > 0 }))
      const rows = Number((held.db.prepare(`SELECT COUNT(*) AS n FROM ${quoteName(name)}`).get() as { n: number }).n)
      const indexes = (held.db.prepare(`PRAGMA index_list(${quoteName(name)})`).all() as {
        name: string
        unique: number
      }[]).map((one) => ({
        name: one.name,
        unique: one.unique === 1,
        columns: (held.db.prepare(`PRAGMA index_info(${quoteName(one.name)})`).all() as { name: string }[]).map(
          (two) => two.name
        )
      }))
      /*
       * The relationships the database itself declares.
       *
       * `PRAGMA foreign_key_list` is SQLite's own answer, not a guess from column names. A picture of a schema drawn
       * from names that merely look alike would join tables that are not joined, which is worse than drawing nothing.
       */
      const references = (held.db.prepare(`PRAGMA foreign_key_list(${quoteName(name)})`).all() as {
        table: string
        from: string
        to: string | null
      }[]).map((one) => ({ toTable: one.table, from: one.from, to: one.to ?? 'rowid' }))
      tables.push({
        name,
        columns: Object.freeze(columns),
        rows,
        indexes: Object.freeze(indexes),
        references: Object.freeze(references)
      })
    }
    return {
      tables: Object.freeze(tables),
      dataset: dataset?.name ?? held.dataset,
      about: dataset?.about ?? ''
    }
  }

  /**
   * Runs SQL.
   *
   * Several statements separated by semicolons are allowed, because learning SQL involves typing a CREATE and an
   * INSERT together. The last statement's result is what comes back, and the count says how many ran — otherwise a
   * three-statement paste would silently show only part of what happened.
   */
  run(instanceId: string, sql: string): QueryResult {
    const empty: QueryResult = {
      sql,
      table: null,
      changed: null,
      took: 0,
      plan: Object.freeze([]),
      planSays: '',
      problem: null,
      statements: 0
    }
    const held = this.open.get(instanceId)
    if (held === undefined) {
      return { ...empty, problem: refuse('not open', 'There is no database open.', 'Pick a practice database first.') }
    }
    const refused = checkSql(sql)
    if (refused !== null) return { ...empty, problem: refused }

    const statements = splitStatements(sql)
    if (statements.length === 0) {
      return { ...empty, problem: refuse('empty', 'Nothing to run.', 'Write a query.') }
    }
    if (statements.length > 50) {
      return {
        ...empty,
        problem: refuse('too many', `${statements.length} statements at once is more than this will run.`, 'Run them in smaller groups.')
      }
    }

    const started = performance.now()
    let table: ResultTable | null = null
    let changed: number | null = null
    let ran = 0

    try {
      for (const statement of statements) {
        if (performance.now() - started > QUERY_MILLISECONDS) {
          return {
            ...empty,
            took: performance.now() - started,
            statements: ran,
            problem: refuse(
              'took too long',
              `It was still running after ${(QUERY_MILLISECONDS / 1000).toFixed(0)} seconds, so it was stopped.`,
              'A missing join condition is the usual cause — it makes every row match every other row.'
            )
          }
        }
        const prepared = held.db.prepare(statement)
        ran += 1
        /*
         * `all()` works for a SELECT and throws for a statement that returns nothing, so the shape of the statement
         * decides which is used. Asking SQLite rather than guessing from the first word means a CTE that ends in a
         * SELECT, or an INSERT ... RETURNING, is handled correctly.
         */
        if (returnsRows(statement)) {
          const rows = prepared.all() as Record<string, unknown>[]
          const names = rows.length > 0 ? Object.keys(rows[0]) : columnNamesOf(held.db, statement)
          const declared = declaredTypes(held.db, statement, names)
          const kept = rows.slice(0, ROW_CEILING)
          table = {
            columns: Object.freeze(names.map((name) => ({ name, declared: declared[name] ?? '' }))),
            rows: Object.freeze(kept.map((row) => Object.freeze(names.map((name) => asCell(row[name]))))),
            of: rows.length,
            truncated: rows.length > kept.length
          }
          changed = null
        } else {
          const made = prepared.run()
          changed = Number(made.changes)
          table = null
        }
      }

      const total = totalRows(held.db)
      if (total > TOTAL_ROW_CEILING) {
        return {
          sql,
          table,
          changed,
          took: performance.now() - started,
          plan: Object.freeze([]),
          planSays: '',
          statements: ran,
          problem: refuse(
            'too much data',
            `The database now holds ${total.toLocaleString()} rows, which is past what this laboratory keeps.`,
            'Delete some rows, or load a fresh practice database.'
          )
        }
      }
    } catch (error) {
      /*
       * SQLite's own message, not a rewritten one. "no such column: custmer_id" is more useful than anything this
       * could say instead, and a learner needs to get used to reading it.
       */
      const message = error instanceof Error ? error.message : String(error)
      return {
        ...empty,
        took: performance.now() - started,
        statements: ran,
        problem: refuse('sql error', message, adviseOn(message))
      }
    }

    const took = performance.now() - started
    const plan = statements.length === 1 && returnsRows(statements[0]) ? planFor(held.db, statements[0]) : []
    return {
      sql,
      table,
      changed,
      took,
      plan: Object.freeze(plan),
      planSays: describePlan(plan),
      problem: null,
      statements: ran
    }
  }

  /** Closes one laboratory's database. */
  close(instanceId: string): void {
    const held = this.open.get(instanceId)
    if (held === undefined) return
    try {
      held.db.close()
    } catch {
      // A database that will not close is being discarded anyway; there is nothing useful to do about it.
    }
    this.open.delete(instanceId)
  }

  closeAll(): void {
    for (const id of [...this.open.keys()]) this.close(id)
  }

  get openCount(): number {
    return this.open.size
  }
}

// ---------------------------------------------------------------- the bits that read SQLite

const quoteName = (name: string): string => `"${name.replace(/"/g, '""')}"`

/** Splits on semicolons that are not inside a string or a comment. */
export function splitStatements(sql: string): readonly string[] {
  const out: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let inLineComment = false
  let inBlockComment = false
  const text = String(sql)
  for (let i = 0; i < text.length; i += 1) {
    const here = text[i]
    const next = text[i + 1]
    if (inLineComment) {
      if (here === '\n') inLineComment = false
      current += here
      continue
    }
    if (inBlockComment) {
      if (here === '*' && next === '/') {
        inBlockComment = false
        current += '*/'
        i += 1
        continue
      }
      current += here
      continue
    }
    if (!inSingle && !inDouble) {
      if (here === '-' && next === '-') {
        inLineComment = true
        current += '--'
        i += 1
        continue
      }
      if (here === '/' && next === '*') {
        inBlockComment = true
        current += '/*'
        i += 1
        continue
      }
    }
    if (here === "'" && !inDouble) inSingle = !inSingle
    else if (here === '"' && !inSingle) inDouble = !inDouble
    if (here === ';' && !inSingle && !inDouble) {
      if (current.trim().length > 0) out.push(current.trim())
      current = ''
      continue
    }
    current += here
  }
  if (current.trim().length > 0) out.push(current.trim())
  return Object.freeze(out)
}

/** Whether a statement gives rows back. */
function returnsRows(statement: string): boolean {
  const first = statement.replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)*\s*/, '').trimStart()
  if (/^\s*(select|values|explain|pragma)\b/i.test(first)) return true
  // A CTE gives rows when it ends in a SELECT, and an INSERT ... RETURNING does too.
  if (/^\s*with\b/i.test(first)) return !/\b(insert|update|delete)\b(?![\s\S]*\breturning\b)/i.test(first) || /\breturning\b/i.test(first)
  return /\breturning\b/i.test(first)
}

/** Column names for a query that returned nothing, so an empty result still has a header. */
function columnNamesOf(db: DatabaseSync, statement: string): readonly string[] {
  try {
    const prepared = db.prepare(statement)
    const got = prepared.columns() as { name?: string; column?: string | null }[]
    return got.map((one, i) => one.name ?? one.column ?? `column ${i + 1}`)
  } catch {
    return Object.freeze([])
  }
}

/** The declared type of each column, where it comes from a table rather than being computed. */
function declaredTypes(db: DatabaseSync, statement: string, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const got = db.prepare(statement).columns() as { name?: string; type?: string | null }[]
    for (let i = 0; i < got.length; i += 1) {
      const name = got[i].name ?? names[i]
      if (name !== undefined && got[i].type) out[name] = String(got[i].type)
    }
  } catch {
    // Column metadata is a nicety. Its absence loses the type labels and nothing else.
  }
  return out
}

const asCell = (value: unknown): string | number | boolean | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  if (value instanceof Uint8Array) return `${value.length} bytes`
  return String(value)
}

function totalRows(db: DatabaseSync): number {
  try {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[]
    let total = 0
    for (const { name } of tables) {
      total += Number((db.prepare(`SELECT COUNT(*) AS n FROM ${quoteName(name)}`).get() as { n: number }).n)
    }
    return total
  } catch {
    return 0
  }
}

/** SQLite's own query plan. */
function planFor(db: DatabaseSync, statement: string): readonly PlanStep[] {
  try {
    const rows = db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all() as { detail: string }[]
    return Object.freeze(
      rows.map((one) => ({
        detail: one.detail,
        scanning: /\bSCAN\b/.test(one.detail) && !/USING\s+(COVERING\s+)?INDEX/.test(one.detail),
        usingIndex: /USING\s+(COVERING\s+)?INDEX|SEARCH/.test(one.detail)
      }))
    )
  } catch {
    // EXPLAIN fails on some statements. A missing plan is honest; an invented one would not be.
    return Object.freeze([])
  }
}

/** What the plan means, said plainly. */
function describePlan(plan: readonly PlanStep[]): string {
  if (plan.length === 0) return ''
  const scans = plan.filter((one) => one.scanning).length
  const indexed = plan.filter((one) => one.usingIndex).length
  if (scans === 0 && indexed > 0) {
    return `SQLite used an index for every step, so it went straight to the rows it needed rather than reading the tables through.`
  }
  if (scans > 0 && indexed === 0) {
    return `SQLite read ${scans === 1 ? 'a whole table' : `${scans} whole tables`} because there was no index it could use. On a small practice database that is instant; on a large one it is the difference between fast and unusable.`
  }
  if (scans > 0) {
    return `SQLite used an index for ${indexed} ${indexed === 1 ? 'step' : 'steps'} and read ${scans === 1 ? 'a whole table' : `${scans} whole tables`} for the rest.`
  }
  return 'SQLite worked through the query in the steps above.'
}

/** A pointer towards the usual cause of a message, where there is one worth giving. */
function adviseOn(message: string): string {
  if (/no such column/i.test(message)) return 'Check the spelling against the tables on the left, and that the column belongs to a table the query names.'
  if (/no such table/i.test(message)) return 'The tables in this database are listed on the left.'
  if (/syntax error/i.test(message)) return 'SQLite points at where it stopped understanding, which is usually just after the real mistake.'
  if (/FOREIGN KEY constraint failed/i.test(message)) return 'A row refers to something that does not exist. Put the row it depends on in first.'
  if (/UNIQUE constraint failed/i.test(message)) return 'That key is already used. Primary keys and unique indexes only allow one of each.'
  if (/NOT NULL constraint failed/i.test(message)) return 'That column must be given a value.'
  if (/datatype mismatch/i.test(message)) return 'A value does not fit the column it is going into.'
  if (/ambiguous column name/i.test(message)) return 'Two joined tables both have that column, so say which one you mean, as in orders.id.'
  return 'Read the message above — it is SQLite’s own, and it is usually precise about what it could not do.'
}

export { DATASET_BY_ID }
