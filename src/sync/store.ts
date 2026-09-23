import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decode } from './protobuf.ts'
import type { Entity, ProgressMarker } from './protocol.ts'

/**
 * What the sync server keeps, per account.
 *
 * Sync needs surprisingly little state: every entity, and one number. The number is a version that only ever goes up,
 * and every write takes the next one. A client's progress marker is the highest version it has seen, so "what changed
 * since you last asked" is "everything above that number" — no timestamps, no per-client bookkeeping, and a client that
 * was away for a month catches up the same way as one that was away for a second.
 *
 * The birthday is the other half. It names this body of data; if the account is ever reset, the birthday changes and
 * every client is told NOT_MY_BIRTHDAY, which makes them drop local sync state rather than carry on quoting versions
 * that no longer mean anything.
 */

export interface StoredEntity extends Omit<Entity, 'specifics'> {
  /** Base64: the type's own bytes, which this server never looks inside. */
  specifics: string
  /** The field number of the one field set in EntitySpecifics, which is how Chromium names a data type. */
  dataTypeId: number
}

interface AccountData {
  birthday: string
  version: number
  entities: Record<string, StoredEntity>
}

const ACCOUNT_ID = /^[A-Za-z0-9_.@-]{1,128}$/
const blank = (): AccountData => ({ birthday: randomUUID(), version: 0, entities: {} })

/**
 * Which data type an entity belongs to: the one field set inside EntitySpecifics. Chromium names a type by that field
 * number and uses the same number in a progress marker, so reading it here needs no table of types to keep in step.
 */
export function dataTypeOf(specifics: Uint8Array): number {
  if (!specifics.length) return 0
  try {
    const fields = decode(specifics)
    return fields.length ? fields[0].no : 0
  } catch {
    return 0
  }
}

export interface CommitOutcome {
  idString: string
  version: number
  /** Set when the commit was refused, and why. */
  conflict?: string
}

export class SyncStore {
  private readonly dir: string
  private readonly cache = new Map<string, AccountData>()
  /** Writes for one account run one at a time, so two commits cannot both take the same version. */
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(dir: string) {
    this.dir = dir
  }

  private path(account: string): string {
    if (!ACCOUNT_ID.test(account)) throw new Error('That is not a usable account id.')
    return join(this.dir, `${encodeURIComponent(account)}.json`)
  }

  private async load(account: string): Promise<AccountData> {
    const held = this.cache.get(account)
    if (held) return held
    let data: AccountData
    try {
      const raw = JSON.parse(await readFile(this.path(account), 'utf8')) as Partial<AccountData>
      data = {
        birthday: typeof raw.birthday === 'string' && raw.birthday ? raw.birthday : randomUUID(),
        version: typeof raw.version === 'number' && raw.version >= 0 ? raw.version : 0,
        entities: raw.entities && typeof raw.entities === 'object' ? raw.entities : {}
      }
    } catch {
      data = blank()
    }
    this.cache.set(account, data)
    return data
  }

  private async save(account: string, data: AccountData): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const path = this.path(account)
    // Written beside and moved into place, so a crash mid-write cannot leave half an account behind.
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(data), 'utf8')
    await rename(temp, path)
  }

  /** Runs one write at a time for an account, in the order they arrived. */
  private enqueue<T>(account: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(account) ?? Promise.resolve()).then(work, work)
    this.queues.set(
      account,
      next.catch(() => undefined)
    )
    return next
  }

  async birthday(account: string): Promise<string> {
    return (await this.load(account)).birthday
  }

  /**
   * Takes a batch of changes. Each one gets the next version, so the order they are written in is the order every other
   * client will see them in. An entity the client has seen before keeps its id; a new one is given a server id, which is
   * the client's tag hash when it has one so that the same thing committed twice is the same entity and not two.
   */
  async commit(account: string, entries: Entity[]): Promise<CommitOutcome[]> {
    return this.enqueue(account, async () => {
      const data = await this.load(account)
      const out: CommitOutcome[] = []
      for (const entry of entries) {
        const id = entry.idString || (entry.clientTagHash ? `tag:${entry.clientTagHash}` : `srv:${randomUUID()}`)
        const existing = data.entities[id]
        // The client says which version it is changing. If the server has moved on since, the client is out of date and
        // must take the newer one first: overwriting here is how one device silently loses what another just wrote.
        if (existing && entry.version && entry.version < existing.version) {
          out.push({ idString: id, version: existing.version, conflict: 'The server has a newer version of this.' })
          continue
        }
        const version = ++data.version
        const now = Date.now()
        data.entities[id] = {
          idString: id,
          parentIdString: entry.parentIdString,
          version,
          name: entry.name,
          nonUniqueName: entry.nonUniqueName,
          serverDefinedUniqueTag: entry.serverDefinedUniqueTag,
          clientTagHash: entry.clientTagHash,
          originatorCacheGuid: entry.originatorCacheGuid,
          originatorClientItemId: entry.originatorClientItemId,
          deleted: entry.deleted,
          folder: entry.folder,
          ctime: existing?.ctime || entry.ctime || now,
          mtime: now,
          // A deletion keeps its place in the list, with no payload, so other clients learn it went.
          specifics: entry.deleted ? '' : Buffer.from(entry.specifics).toString('base64'),
          dataTypeId: entry.deleted ? (existing?.dataTypeId ?? dataTypeOf(entry.specifics)) : dataTypeOf(entry.specifics)
        }
        out.push({ idString: id, version })
      }
      await this.save(account, data)
      return out
    })
  }

  /**
   * Everything of the asked-for types that has changed since the client's markers, oldest first so a client applying
   * them in order ends up where the server is. `limit` caps one response; what is left is reported so the client comes
   * back for it rather than being handed an unbounded batch.
   */
  async updatesSince(
    account: string,
    markers: ProgressMarker[],
    limit = 500
  ): Promise<{ entries: Entity[]; markers: ProgressMarker[]; remaining: number }> {
    const data = await this.load(account)
    const since = new Map(markers.map((m) => [m.dataTypeId, Number(m.token) || 0]))
    const wanted = [...since.keys()]
    const changed = Object.values(data.entities)
      .filter((e) => since.has(e.dataTypeId) && e.version > (since.get(e.dataTypeId) ?? 0))
      .sort((a, b) => a.version - b.version)

    const page = changed.slice(0, limit)
    const remaining = changed.length - page.length
    // A marker only moves as far as what was actually sent, or a client would skip what did not fit in this batch.
    const highest = new Map<number, number>()
    for (const type of wanted) highest.set(type, since.get(type) ?? 0)
    for (const e of page) highest.set(e.dataTypeId, Math.max(highest.get(e.dataTypeId) ?? 0, e.version))

    return {
      entries: page.map((e) => ({
        idString: e.idString,
        parentIdString: e.parentIdString,
        version: e.version,
        name: e.name,
        nonUniqueName: e.nonUniqueName,
        serverDefinedUniqueTag: e.serverDefinedUniqueTag,
        clientTagHash: e.clientTagHash,
        originatorCacheGuid: e.originatorCacheGuid,
        originatorClientItemId: e.originatorClientItemId,
        deleted: e.deleted,
        folder: e.folder,
        ctime: e.ctime,
        mtime: e.mtime,
        specifics: e.specifics ? new Uint8Array(Buffer.from(e.specifics, 'base64')) : new Uint8Array()
      })),
      markers: wanted.map((dataTypeId) => ({ dataTypeId, token: String(highest.get(dataTypeId) ?? 0) })),
      remaining
    }
  }

  /** Throws the account's data away and gives it a new birthday, which is how every client is told to start again. */
  async clear(account: string): Promise<string> {
    return this.enqueue(account, async () => {
      const fresh = blank()
      this.cache.set(account, fresh)
      await this.save(account, fresh)
      return fresh.birthday
    })
  }
}
