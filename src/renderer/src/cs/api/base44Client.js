/**
 * The backend the ported simulations expect, answered by Orbis instead.
 *
 * The original talks to Base44 for two things, and both are kept working rather than stubbed out:
 *
 *   - `integrations.Core.InvokeLLM` asks a model a question. That goes to Orion, through the same bridge the
 *     chat uses, so the research panels really do get an answer rather than a placeholder.
 *   - `entities.ExperimentRecord` saves and lists experiment records. Those are kept in this browser's own
 *     storage, so the notebook keeps its records across sessions without a server to keep them on.
 *
 * Every method keeps the original's shape and name, so none of the 230 simulations needs editing.
 */

const RECORDS = 'orbis:physics:experiment-records'

const read = () => {
  try {
    const held = localStorage.getItem(RECORDS)
    return held ? JSON.parse(held) : []
  } catch {
    // Storage can be denied outright. An empty notebook is a working notebook; a thrown error is not.
    return []
  }
}

const write = (rows) => {
  try {
    localStorage.setItem(RECORDS, JSON.stringify(rows))
  } catch {
    // Nothing to do about it here, and losing a save is better than losing the screen.
  }
}

const id = () => `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/**
 * Ask Orion. Returns the text, or throws — the callers already handle a failure, and an invented answer would be
 * far worse than a visible one.
 */
async function invokeLLM({ prompt, response_json_schema: schema } = {}) {
  const api = typeof window !== 'undefined' ? window.api : null
  if (!api || typeof api.physicsAsk !== 'function') {
    throw new Error('Orion is not available here.')
  }
  const text = await api.physicsAsk(String(prompt ?? ''), schema ? JSON.stringify(schema) : null)
  if (text === null || text === undefined || String(text).trim() === '') {
    throw new Error('Orion did not answer.')
  }
  if (!schema) return text
  // The original asks for JSON when it passes a schema, so parse it the same way and let a bad reply throw.
  const cleaned = String(text).trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(cleaned)
}

const ExperimentRecord = {
  async list(order = '-created_date', limit = 50) {
    const rows = read()
    const descending = String(order).startsWith('-')
    const key = String(order).replace(/^-/, '') || 'created_date'
    const sorted = [...rows].sort((a, b) => {
      const left = a?.[key] ?? ''
      const right = b?.[key] ?? ''
      return descending ? String(right).localeCompare(String(left)) : String(left).localeCompare(String(right))
    })
    return sorted.slice(0, Math.max(0, limit))
  },
  async create(record) {
    const now = new Date().toISOString()
    const made = { ...record, id: record?.id ?? id(), created_date: record?.created_date ?? now, updated_date: now }
    write([made, ...read()])
    return made
  },
  async update(recordId, changes) {
    const rows = read()
    const at = rows.findIndex((one) => one.id === recordId)
    if (at < 0) throw new Error('No such record.')
    rows[at] = { ...rows[at], ...changes, updated_date: new Date().toISOString() }
    write(rows)
    return rows[at]
  },
  async delete(recordId) {
    write(read().filter((one) => one.id !== recordId))
    return { ok: true }
  }
}

/*
 * The person, and their preferences.
 *
 * The original had accounts: `auth.me()` returned a signed-in user whose record carried a settings object, and
 * their `useSettings` hook reads it. Orbis has no accounts here and nothing to sign in to, so this answers from
 * this browser's own storage instead -- which keeps their hook working unedited, and keeps the preferences
 * across sessions without a server to keep them on.
 *
 * `me()` resolving to null was not an option: their hook called `.then` on it and the whole studio stopped on
 * "Cannot read properties of undefined", which is a card that will not open rather than a setting that is at its
 * default.
 */
const PREFS = 'orbis:chemistry:settings'

const auth = {
  async me() {
    try {
      const held = localStorage.getItem(PREFS)
      return { id: 'this-computer', settings: held ? JSON.parse(held) : {} }
    } catch {
      // Storage can be denied outright. Defaults are a working studio; a thrown error is not.
      return { id: 'this-computer', settings: {} }
    }
  },
  async updateMe(changes) {
    try {
      localStorage.setItem(PREFS, JSON.stringify(changes?.settings ?? {}))
    } catch {
      // Losing a preference is better than losing the screen.
    }
    return { ok: true }
  }
}

export const base44 = {
  auth,
  integrations: { Core: { InvokeLLM: invokeLLM } },
  entities: { ExperimentRecord }
}

export default base44
