import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { checkSql, DATASETS, SqlLab, splitStatements } from './sql.ts'

/**
 * What the SQL laboratory is held to.
 *
 * The queries here are ones whose answers can be worked out by hand from the dataset, so a wrong join or a wrong
 * aggregate fails rather than merely looking plausible. The guard tests matter most: a practice database that could
 * be made to open a file would be a real hole, and the test for it is the one that must never be weakened.
 */

const lab = (datasetId = 'shop'): SqlLab => {
  const made = new SqlLab()
  const loaded = made.load('t', datasetId)
  assert.ok(!('error' in loaded), 'error' in loaded ? loaded.says : '')
  return made
}

describe('the guard', () => {
  it('refuses ATTACH, with the reason', () => {
    const made = checkSql("ATTACH DATABASE 'C:/secrets.db' AS other")
    assert.ok(made !== null)
    assert.match(made.says, /another database file/)
    assert.ok(made.fix.length > 20)
  })

  it('refuses it however it is spelt or spaced', () => {
    for (const sql of [
      'attach database "x" as y',
      'ATTACH   DATABASE  \n  "x" AS y',
      "SELECT 1; ATTACH DATABASE 'x' AS y",
      'AtTaCh dAtAbAsE "x" AS y'
    ]) {
      assert.ok(checkSql(sql) !== null, `let through: ${sql}`)
    }
  })

  it('refuses the other ways out of memory', () => {
    for (const sql of [
      "SELECT load_extension('evil.dll')",
      "VACUUM INTO 'C:/out.db'",
      'PRAGMA journal_mode = WAL',
      "SELECT writefile('C:/x', 'y')",
      'DETACH DATABASE other'
    ]) {
      assert.ok(checkSql(sql) !== null, `let through: ${sql}`)
    }
  })

  it('does not refuse ordinary SQL that merely contains a forbidden word', () => {
    // A column called `attachment` must not trip the guard, or half of SQL becomes unteachable.
    for (const sql of [
      'SELECT attachment FROM messages',
      "SELECT * FROM notes WHERE body LIKE '%attach database%'",
      '-- ATTACH DATABASE is not allowed\nSELECT 1',
      'PRAGMA table_info(customers)',
      'SELECT * FROM customers'
    ]) {
      assert.equal(checkSql(sql), null, `wrongly refused: ${sql}`)
    }
  })

  it('a forbidden statement hidden after a comment is still refused', () => {
    // The comment is stripped and the statement behind it is still seen.
    assert.ok(checkSql("SELECT 1 /* harmless */ ; ATTACH DATABASE 'x' AS y") !== null)
  })

  it('refuses nothing at all, and something absurdly long', () => {
    assert.ok(checkSql('   ') !== null)
    assert.ok(checkSql(`SELECT ${'1,'.repeat(12_000)}1`) !== null)
  })
})

describe('splitting statements', () => {
  it('splits on semicolons', () => {
    assert.deepEqual(splitStatements('SELECT 1; SELECT 2'), ['SELECT 1', 'SELECT 2'])
  })

  it('does not split on a semicolon inside a string', () => {
    assert.deepEqual(splitStatements("SELECT 'a;b'"), ["SELECT 'a;b'"])
  })

  it('does not split on a semicolon inside a comment', () => {
    assert.equal(splitStatements('SELECT 1 -- ; not a split\n').length, 1)
  })

  it('ignores a trailing semicolon', () => {
    assert.deepEqual(splitStatements('SELECT 1;'), ['SELECT 1'])
  })
})

describe('the practice databases', () => {
  it('every dataset loads, and says it is made up', () => {
    for (const dataset of DATASETS) {
      const made = new SqlLab()
      const schema = made.load('x', dataset.id)
      assert.ok(!('error' in schema), `${dataset.id}: ${'error' in schema ? schema.says : ''}`)
      assert.ok(dataset.teaches.length > 0, dataset.id)
      if (dataset.id !== 'empty') {
        // Orbis never presents invented numbers as real, so a practice dataset must say what it is.
        assert.match(dataset.about, /made-up|not real|do not exist/i, `${dataset.id} does not say it is practice data`)
      }
      made.closeAll()
    }
  })

  it('an unknown dataset is refused with the list of real ones', () => {
    const made = new SqlLab()
    const result = made.load('x', 'nonsense')
    assert.ok('error' in result)
    assert.match(result.fix, /small shop/i)
  })

  it('the schema reports the tables, their columns and their indexes', () => {
    const made = lab()
    const schema = made.schemaOf('t')
    assert.ok(!('error' in schema))
    assert.deepEqual(
      schema.tables.map((one) => one.name),
      ['customers', 'order_lines', 'orders', 'products']
    )
    const customers = schema.tables.find((one) => one.name === 'customers')
    assert.ok(customers)
    assert.equal(customers.rows, 8)
    assert.ok(customers.columns.find((one) => one.name === 'id')?.primaryKey)
    assert.ok(customers.columns.find((one) => one.name === 'name')?.notNull)
    const orders = schema.tables.find((one) => one.name === 'orders')
    assert.ok(orders?.indexes.some((one) => one.name === 'orders_by_customer'))
    made.closeAll()
  })

  it('two laboratories cannot see each other', () => {
    const made = new SqlLab()
    made.load('a', 'shop')
    made.load('b', 'library')
    assert.match(made.run('a', 'SELECT COUNT(*) AS n FROM customers').problem === null ? 'ok' : 'no', /ok/)
    // The library laboratory has no customers table, and must say so rather than reading the other one's.
    const across = made.run('b', 'SELECT * FROM customers')
    assert.ok(across.problem !== null)
    assert.match(across.problem.says, /no such table/i)
    made.closeAll()
  })
})

describe('running queries', () => {
  it('a simple select comes back with columns and rows', () => {
    const made = lab()
    const result = made.run('t', 'SELECT name, city FROM customers ORDER BY name LIMIT 3')
    assert.equal(result.problem, null)
    assert.ok(result.table)
    assert.deepEqual(
      result.table.columns.map((one) => one.name),
      ['name', 'city']
    )
    assert.equal(result.table.rows.length, 3)
    assert.equal(result.table.rows[0][0], 'Ada Nkemelu')
    made.closeAll()
  })

  it('a join gives the answer that can be checked by hand', () => {
    const made = lab()
    // Chen Wei is customer 3 and has orders 4, 5 and 6 in the dataset above.
    const result = made.run(
      't',
      `SELECT COUNT(*) AS n FROM orders JOIN customers ON customers.id = orders.customer_id WHERE customers.name = 'Chen Wei'`
    )
    assert.equal(result.problem, null)
    assert.equal(result.table?.rows[0][0], 3)
    made.closeAll()
  })

  it('a group-by with a sum is arithmetic, not a guess', () => {
    const made = lab()
    // Order 1 is 4 notebooks at 3.50 and 2 mugs at 8.00, so 14.00 + 16.00 = 30.00.
    const result = made.run(
      't',
      `SELECT ROUND(SUM(products.price * order_lines.quantity), 2) AS total
       FROM order_lines JOIN products ON products.id = order_lines.product_id
       WHERE order_lines.order_id = 1`
    )
    assert.equal(result.problem, null)
    assert.equal(result.table?.rows[0][0], 30)
    made.closeAll()
  })

  it('a left join finds the customers with no orders', () => {
    const made = lab()
    // Customers 4 and 6 appear in no order in the dataset.
    const result = made.run(
      't',
      `SELECT customers.name FROM customers LEFT JOIN orders ON orders.customer_id = customers.id
       WHERE orders.id IS NULL ORDER BY customers.name`
    )
    assert.equal(result.problem, null)
    assert.deepEqual(result.table?.rows.map((row) => row[0]), ['Dara Okafor', 'Fen Adeyemi'])
    made.closeAll()
  })

  it('an insert reports how many rows changed rather than returning a table', () => {
    const made = lab()
    const result = made.run('t', `INSERT INTO customers (id, name, city, joined) VALUES (99, 'New Person', 'Leeds', '2024-01-01')`)
    assert.equal(result.problem, null)
    assert.equal(result.changed, 1)
    assert.equal(result.table, null)
    assert.equal(made.run('t', 'SELECT COUNT(*) AS n FROM customers').table?.rows[0][0], 9)
    made.closeAll()
  })

  it('several statements run, and it says how many', () => {
    const made = lab('empty')
    const result = made.run(
      't',
      `CREATE TABLE things (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
       INSERT INTO things (id, label) VALUES (1, 'one'), (2, 'two');
       SELECT COUNT(*) AS n FROM things;`
    )
    assert.equal(result.problem, null)
    assert.equal(result.statements, 3)
    assert.equal(result.table?.rows[0][0], 2)
    made.closeAll()
  })

  it('a constraint refuses bad data, and the advice says what to do', () => {
    const made = lab()
    const result = made.run('t', `INSERT INTO customers (id, name, city, joined) VALUES (1, 'Clash', 'Leeds', '2024-01-01')`)
    assert.ok(result.problem !== null)
    assert.match(result.problem.says, /UNIQUE constraint/i)
    assert.match(result.problem.fix, /already used/i)
    made.closeAll()
  })

  it('a foreign key is enforced', () => {
    const made = lab()
    const result = made.run('t', `INSERT INTO orders (id, customer_id, placed) VALUES (99, 500, '2024-01-01')`)
    assert.ok(result.problem !== null)
    assert.match(result.problem.says, /FOREIGN KEY/i)
    made.closeAll()
  })

  it('a misspelt column gets SQLite’s own message and a pointer', () => {
    const made = lab()
    const result = made.run('t', 'SELECT custmer_id FROM orders')
    assert.ok(result.problem !== null)
    assert.match(result.problem.says, /no such column/i)
    assert.match(result.problem.fix, /spelling/i)
    made.closeAll()
  })

  it('an empty result still has a header rather than nothing', () => {
    const made = lab()
    const result = made.run('t', `SELECT name, city FROM customers WHERE city = 'Nowhere'`)
    assert.equal(result.problem, null)
    assert.equal(result.table?.rows.length, 0)
    assert.deepEqual(result.table?.columns.map((one) => one.name), ['name', 'city'])
    made.closeAll()
  })

  it('a query with no database open says so', () => {
    const made = new SqlLab()
    const result = made.run('never-loaded', 'SELECT 1')
    assert.ok(result.problem !== null)
    assert.match(result.problem.says, /no database/i)
  })
})

describe('the query plan', () => {
  it('reports using an index when there is one, and says what that means', () => {
    const made = lab()
    const result = made.run('t', 'SELECT * FROM orders WHERE customer_id = 3')
    assert.equal(result.problem, null)
    assert.ok(result.plan.length > 0, 'a plan should have come back')
    assert.ok(result.plan.some((one) => one.usingIndex), `plan was: ${result.plan.map((o) => o.detail).join(' | ')}`)
    assert.match(result.planSays, /index/i)
    made.closeAll()
  })

  it('reports reading a whole table when there is no index, and says why that matters', () => {
    const made = lab()
    const result = made.run('t', `SELECT * FROM customers WHERE city = 'Leeds'`)
    assert.equal(result.problem, null)
    assert.ok(result.plan.some((one) => one.scanning), `plan was: ${result.plan.map((o) => o.detail).join(' | ')}`)
    assert.match(result.planSays, /whole table/i)
    made.closeAll()
  })

  it('the same query gets a different plan once an index exists', () => {
    const made = lab()
    const before = made.run('t', `SELECT * FROM customers WHERE city = 'Leeds'`)
    made.run('t', 'CREATE INDEX customers_by_city ON customers(city)')
    const after = made.run('t', `SELECT * FROM customers WHERE city = 'Leeds'`)
    // The whole lesson of the plan panel: adding an index changes what the database decides to do.
    assert.ok(before.plan.some((one) => one.scanning))
    assert.ok(after.plan.some((one) => one.usingIndex), `after: ${after.plan.map((o) => o.detail).join(' | ')}`)
    made.closeAll()
  })
})

describe('the weather dataset', () => {
  it('has enough rows for a window function to mean anything', () => {
    const made = lab('weather')
    const count = made.run('t', 'SELECT COUNT(*) AS n FROM readings')
    assert.equal(count.table?.rows[0][0], 360)
    made.closeAll()
  })

  it('gives the same numbers every time it is loaded', () => {
    const first = lab('weather')
    const a = first.run('t', 'SELECT ROUND(AVG(temperature_c), 3) AS m FROM readings').table?.rows[0][0]
    first.closeAll()
    const second = lab('weather')
    const b = second.run('t', 'SELECT ROUND(AVG(temperature_c), 3) AS m FROM readings').table?.rows[0][0]
    second.closeAll()
    // Nothing random, so a query somebody writes today gives the same answer tomorrow.
    assert.equal(a, b)
  })

  it('a window function works', () => {
    const made = lab('weather')
    const result = made.run(
      't',
      `SELECT day, temperature_c,
              ROUND(AVG(temperature_c) OVER (PARTITION BY station_id ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) AS week
       FROM readings WHERE station_id = 'VAL' ORDER BY day LIMIT 10`
    )
    assert.equal(result.problem, null)
    assert.equal(result.table?.rows.length, 10)
    assert.equal(result.table?.columns.length, 3)
    made.closeAll()
  })
})

describe('closing', () => {
  it('closing lets a laboratory go', () => {
    const made = lab()
    assert.equal(made.openCount, 1)
    made.close('t')
    assert.equal(made.openCount, 0)
    assert.ok(made.run('t', 'SELECT 1').problem !== null)
  })

  it('closing one that was never open does nothing', () => {
    const made = new SqlLab()
    made.close('nothing')
    assert.equal(made.openCount, 0)
  })

  it('loading again replaces what was there', () => {
    const made = lab('shop')
    made.load('t', 'library')
    assert.ok(made.run('t', 'SELECT * FROM customers').problem !== null)
    assert.equal(made.run('t', 'SELECT COUNT(*) AS n FROM books').table?.rows[0][0], 7)
    assert.equal(made.openCount, 1)
    made.closeAll()
  })
})
