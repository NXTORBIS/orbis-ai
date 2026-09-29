import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CATEGORIES, EXCLUDED } from '../../shared/portable/registry.ts'
import {
  builtInProviders,
  fileProvider,
  isProviderError,
  mergeableJsonProvider,
  packagePathFor,
  PortableProviderRegistry,
  REDACTED_SETTINGS_FIELDS,
  redactingJsonProvider,
  sourcesFor,
  type ProviderError,
  type Restored
} from './providers.ts'

const ok = <T>(value: T): Exclude<T, ProviderError> => {
  assert.ok(!isProviderError(value), isProviderError(value) ? value.message : '')
  return value as Exclude<T, ProviderError>
}

const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8')
const read = (one: Restored): unknown => JSON.parse((one.bytes as Buffer).toString('utf8'))
const category = (id: string) => {
  const found = CATEGORIES.find((one) => one.id === id)
  assert.ok(found !== undefined, `no category ${id}`)
  return found
}

describe('the built-in registry', () => {
  const providers = builtInProviders()
  const excluded = new Set(EXCLUDED.map((one) => one.id))

  it('has a provider for every category that can travel', () => {
    const missing = CATEGORIES.filter((one) => !excluded.has(one.id)).filter((one) => !providers.has(one.id))
    assert.deepEqual(
      missing.map((one) => one.id),
      [],
      'a category with no provider would be quietly left out of every transfer'
    )
  })

  it('has no provider for a category that cannot travel', () => {
    for (const one of EXCLUDED) {
      assert.equal(providers.has(one.id), false, `${one.id} is excluded and should have no provider`)
    }
  })

  it('matches each provider schema version to the registry', () => {
    for (const provider of providers.all()) {
      const one = CATEGORIES.find((entry) => entry.id === provider.categoryId)
      assert.ok(one !== undefined, provider.categoryId)
      assert.equal(provider.schemaVersion, one.schemaVersion, provider.categoryId)
    }
  })

  it('names the category rather than skipping it when one has no provider', () => {
    const empty = new PortableProviderRegistry()
    const result = empty.for('notes')
    assert.ok(isProviderError(result))
    assert.match(result.message, /quietly left out of every transfer/)
  })

  it('gives settings the provider that removes the device-bound key', () => {
    const settings = ok(providers.for('orion.settings'))
    const packed = ok(settings.toPackage('settings.json', bytes({ theme: 'dark', apiKey: 'sk-secret-value' })))
    assert.ok(packed !== null)
    const text = (packed as Buffer).toString('utf8')
    assert.ok(!text.includes('sk-secret-value'), 'the sealed key must not reach the package')
    assert.ok(text.includes('dark'))
  })
})

describe('canonical paths', () => {
  it('derives the package path from the storage path, not the category', () => {
    assert.equal(packagePathFor('profile', 'knowledge/knowledge.db'), 'data/profile/knowledge/knowledge.db')
    assert.equal(packagePathFor('app', 'settings.json'), 'data/app/settings.json')
  })

  it('normalises a Windows separator, so the same file is one path', () => {
    assert.equal(packagePathFor('profile', 'personal\\notes.json'), 'data/profile/personal/notes.json')
  })

  it('carries a file shared by three categories exactly once', () => {
    const sources = sourcesFor(['orion.memory', 'galaxy.graph', 'search.sessions'])
    const database = sources.filter((one) => one.storage === 'knowledge/knowledge.db')
    assert.equal(database.length, 1, 'three categories, one file, one copy')
    assert.deepEqual([...(database[0]?.wantedBy ?? [])].sort(), ['galaxy.graph', 'orion.memory', 'search.sessions'])
  })

  it('records every storage path of a category with more than one', () => {
    const sources = sourcesFor(['tasks'])
    assert.equal(sources.length, 2)
    assert.deepEqual(sources.map((one) => one.storage).sort(), ['personal/task-lists.json', 'personal/tasks.json'])
  })

  it('ignores a category that is not in the registry', () => {
    assert.deepEqual(sourcesFor(['nothing-like-this']), [])
  })
})

describe('fileProvider', () => {
  const provider = fileProvider(category('markets'))

  it('carries the bytes unchanged', () => {
    const payload = Buffer.from([1, 2, 3, 255])
    assert.deepEqual([...(ok(provider.toPackage('markets.json', payload)) as Buffer)], [...payload])
  })

  it('writes the package copy when replacing', () => {
    const result = ok(provider.fromPackage('markets.json', bytes({ a: 1 }), 'replace', bytes({ b: 2 })))
    assert.deepEqual(read(result), { a: 1 })
  })

  it('writes the package copy when there is nothing there', () => {
    const result = ok(provider.fromPackage('markets.json', bytes({ a: 1 }), 'merge', null))
    assert.deepEqual(read(result), { a: 1 })
  })

  it('leaves an existing file alone on a merge, and says why', () => {
    const result = ok(provider.fromPackage('markets.json', bytes({ a: 1 }), 'merge', bytes({ b: 2 })))
    assert.equal(result.bytes, null)
    assert.equal(result.kept, 1)
    assert.match(result.notes[0] ?? '', /carried as a whole file/)
  })
})

describe('redactingJsonProvider', () => {
  const provider = redactingJsonProvider(category('orion.settings'), REDACTED_SETTINGS_FIELDS)

  it('removes the named fields and keeps the rest', () => {
    const packed = ok(provider.toPackage('settings.json', bytes({ theme: 'dark', userName: 'N', apiKey: 'sk-live' })))
    assert.deepEqual(JSON.parse((packed as Buffer).toString('utf8')), { theme: 'dark', userName: 'N' })
  })

  it('refuses a file that is not a JSON object rather than carrying it whole', () => {
    const result = provider.toPackage('settings.json', bytes([1, 2, 3]))
    assert.ok(isProviderError(result))
    assert.match(result.message, /Nothing is carried rather than carrying it whole/)
  })

  it('refuses invalid JSON', () => {
    assert.ok(isProviderError(provider.toPackage('settings.json', Buffer.from('{oops', 'utf8'))))
  })

  it('keeps the key this machine already has rather than clearing it', () => {
    // The field was removed on the way out, so its absence from the package must not delete the local one.
    const result = ok(provider.fromPackage('settings.json', bytes({ theme: 'light' }), 'replace', bytes({ theme: 'dark', apiKey: 'sk-local' })))
    const written = read(result) as Record<string, unknown>
    assert.equal(written.theme, 'light', 'the package wins for a field it carries')
    assert.equal(written.apiKey, 'sk-local', 'and the one it does not carry is left alone')
    assert.match(result.notes[0] ?? '', /left alone/)
  })

  it('says the key will have to be entered when neither side has one', () => {
    const result = ok(provider.fromPackage('settings.json', bytes({ theme: 'light' }), 'replace', null))
    assert.match(result.notes[0] ?? '', /You will be asked for/)
  })

  it('lets what is here win on a merge', () => {
    const result = ok(provider.fromPackage('settings.json', bytes({ theme: 'light', extra: 1 }), 'merge', bytes({ theme: 'dark' })))
    const written = read(result) as Record<string, unknown>
    assert.equal(written.theme, 'dark')
    assert.equal(written.extra, 1)
  })
})

describe('mergeableJsonProvider', () => {
  const provider = mergeableJsonProvider(category('notes'))

  it('replaces outright when asked to replace', () => {
    const result = ok(provider.fromPackage('notes.json', bytes([{ id: 'a' }]), 'replace', bytes([{ id: 'b' }])))
    assert.deepEqual(read(result), [{ id: 'a' }])
  })

  it('joins two lists by id, keeping what is already here', () => {
    const here = bytes([{ id: 'a', text: 'mine' }, { id: 'b', text: 'also mine' }])
    const coming = bytes([{ id: 'b', text: 'theirs' }, { id: 'c', text: 'new' }])
    const result = ok(provider.fromPackage('notes.json', coming, 'merge', here))
    const written = read(result) as { id: string; text: string }[]
    assert.equal(written.length, 3)
    assert.equal(written.find((one) => one.id === 'b')?.text, 'also mine', 'a collision keeps what is here')
    assert.equal(written.find((one) => one.id === 'c')?.text, 'new')
    assert.equal(result.added, 1)
    assert.equal(result.kept, 1)
  })

  it('joins two maps by key, keeping what is already here', () => {
    const here = bytes({ a: 1, b: 2 })
    const coming = bytes({ b: 99, c: 3 })
    const result = ok(provider.fromPackage('notes.json', coming, 'merge', here))
    assert.deepEqual(read(result), { a: 1, b: 2, c: 3 })
    assert.equal(result.added, 1)
    assert.equal(result.kept, 1)
  })

  it('recognises other identifying fields', () => {
    const here = bytes([{ slug: 'one' }])
    const coming = bytes([{ slug: 'one' }, { slug: 'two' }])
    const result = ok(provider.fromPackage('notes.json', coming, 'merge', here))
    assert.equal((read(result) as unknown[]).length, 2)
  })

  it('replaces rather than guessing when the entries have no id', () => {
    const here = bytes([{ text: 'one' }, { text: 'two' }])
    const coming = bytes([{ text: 'three' }])
    const result = ok(provider.fromPackage('notes.json', coming, 'merge', here))
    assert.deepEqual(read(result), [{ text: 'three' }])
    assert.match(result.notes[0] ?? '', /no id on them/)
    assert.match(result.notes[0] ?? '', /replaced rather than merged/)
  })

  it('replaces when the two stores are different shapes', () => {
    const result = ok(provider.fromPackage('notes.json', bytes([{ id: 'a' }]), 'merge', bytes({ a: 1 })))
    assert.deepEqual(read(result), [{ id: 'a' }])
    assert.match(result.notes[0] ?? '', /not two versions of the same store/)
  })

  it('uses the package copy when what is here cannot be read', () => {
    const result = ok(provider.fromPackage('notes.json', bytes([{ id: 'a' }]), 'merge', Buffer.from('{broken', 'utf8')))
    assert.deepEqual(read(result), [{ id: 'a' }])
    assert.match(result.notes[0] ?? '', /could not be read as JSON/)
  })

  it('refuses a package file that is not JSON', () => {
    const result = provider.fromPackage('notes.json', Buffer.from('{broken', 'utf8'), 'merge', bytes([]))
    assert.ok(isProviderError(result))
    assert.equal(result.error, 'unreadable')
  })

  it('keeps an entry with no id out rather than duplicating it', () => {
    const here = bytes([{ id: 'a' }])
    const coming = bytes([{ id: 'b' }, { text: 'anonymous' }])
    const result = ok(provider.fromPackage('notes.json', coming, 'merge', here))
    const written = read(result) as unknown[]
    assert.equal(written.length, 2, 'a and b, not the unidentified one')
    assert.equal(result.kept, 1)
  })

  it('does not let a key called __proto__ reach a prototype', () => {
    const here = bytes({ a: 1 })
    const coming = Buffer.from('{"__proto__": {"polluted": true}, "b": 2}', 'utf8')
    const result = ok(provider.fromPackage('notes.json', coming, 'merge', here))
    const written = read(result) as Record<string, unknown>
    assert.equal(written.b, 2)
    assert.equal(({} as Record<string, unknown>).polluted, undefined, 'nothing reached Object.prototype')
  })
})
