import { bool, bytes, decode, many, num, str, sub, Writer } from './protobuf.ts'
import type { Field } from './protobuf.ts'

/**
 * Chromium's sync protocol, as far as a server has to understand it.
 *
 * One request, one response, both protobuf, both defined in components/sync/protocol/sync.proto of the build this talks
 * to. A request is either a COMMIT (here is what changed here) or a GET_UPDATES (what changed elsewhere since this
 * token). Everything else in that file is detail the client fills in and the server may ignore.
 *
 * Field numbers are written here as constants rather than read from a schema, because they are the contract: a number
 * that changes upstream is a protocol break that no amount of generated code would paper over, and this way the break
 * is one line to find. Each is cited to the message it belongs to.
 */

// ClientToServerMessage
const REQ = { share: 1, protocolVersion: 2, contents: 3, commit: 4, getUpdates: 5, storeBirthday: 7 } as const
// ClientToServerResponse
const RES = { commit: 1, getUpdates: 2, errorCode: 4, errorMessage: 5, storeBirthday: 6 } as const
// CommitMessage / GetUpdatesMessage
const COMMIT = { entries: 1, cacheGuid: 2 } as const
const GET_UPDATES = { fromProgressMarker: 6, getUpdatesOrigin: 9 } as const
// GetUpdatesResponse
const GET_UPDATES_RES = { entries: 1, changesRemaining: 4, newProgressMarker: 5 } as const
// CommitResponse.EntryResponse (a group)
const ENTRY_RES = { group: 1, responseType: 2, idString: 3, version: 6, errorMessage: 9 } as const
// DataTypeProgressMarker
const MARKER = { dataTypeId: 1, token: 2 } as const
// SyncEntity
const ENTITY = {
  idString: 1,
  parentIdString: 2,
  version: 4,
  mtime: 5,
  ctime: 6,
  name: 7,
  nonUniqueName: 8,
  serverDefinedUniqueTag: 10,
  deleted: 18,
  originatorCacheGuid: 19,
  originatorClientItemId: 20,
  specifics: 21,
  folder: 22,
  clientTagHash: 23
} as const

/** SyncEnums.ErrorType. */
export const ERROR = { SUCCESS: 0, NOT_MY_BIRTHDAY: 2, THROTTLED: 3, TRANSIENT_ERROR: 8, MIGRATION_DONE: 9, DISABLED_BY_ADMIN: 10 } as const
/** CommitResponse.ResponseType. */
export const COMMIT_RESULT = { SUCCESS: 1, CONFLICT: 2, RETRY: 3, INVALID_MESSAGE: 4, OVER_QUOTA: 5, TRANSIENT_ERROR: 6 } as const

export const CONTENTS = { COMMIT: 1, GET_UPDATES: 2, CLEAR_SERVER_DATA: 5 } as const

/** One thing being synced, as it crosses the wire. `specifics` is the type's own payload and is never looked inside here. */
export interface Entity {
  idString: string
  parentIdString: string
  version: number
  name: string
  nonUniqueName: string
  serverDefinedUniqueTag: string
  clientTagHash: string
  originatorCacheGuid: string
  originatorClientItemId: string
  deleted: boolean
  folder: boolean
  ctime: number
  mtime: number
  /** The raw EntitySpecifics bytes. The data type inside is the client's business, not the server's. */
  specifics: Uint8Array
}

export interface ProgressMarker {
  dataTypeId: number
  /** Opaque to the client: this server puts the highest version it has handed out for that type in it. */
  token: string
}

export interface SyncRequest {
  share: string
  protocolVersion: number
  contents: number
  storeBirthday: string
  cacheGuid: string
  /** COMMIT only. */
  entries: Entity[]
  /** GET_UPDATES only. */
  markers: ProgressMarker[]
  getUpdatesOrigin: number
}

const readEntity = (f: Field[]): Entity => ({
  idString: str(f, ENTITY.idString),
  parentIdString: str(f, ENTITY.parentIdString),
  version: num(f, ENTITY.version),
  name: str(f, ENTITY.name),
  nonUniqueName: str(f, ENTITY.nonUniqueName),
  serverDefinedUniqueTag: str(f, ENTITY.serverDefinedUniqueTag),
  clientTagHash: str(f, ENTITY.clientTagHash),
  originatorCacheGuid: str(f, ENTITY.originatorCacheGuid),
  originatorClientItemId: str(f, ENTITY.originatorClientItemId),
  deleted: bool(f, ENTITY.deleted),
  folder: bool(f, ENTITY.folder),
  ctime: num(f, ENTITY.ctime),
  mtime: num(f, ENTITY.mtime),
  specifics: bytes(f, ENTITY.specifics) ?? new Uint8Array()
})

export function readRequest(body: Uint8Array): SyncRequest {
  const f = decode(body)
  const commit = sub(f, REQ.commit)
  const getUpdates = sub(f, REQ.getUpdates)
  return {
    share: str(f, REQ.share),
    protocolVersion: num(f, REQ.protocolVersion, 99),
    contents: num(f, REQ.contents),
    storeBirthday: str(f, REQ.storeBirthday),
    cacheGuid: commit ? str(commit, COMMIT.cacheGuid) : '',
    entries: commit ? many(commit, COMMIT.entries).map((e) => readEntity(decode(e.value as Uint8Array))) : [],
    markers: getUpdates
      ? many(getUpdates, GET_UPDATES.fromProgressMarker).map((m) => {
          const marker = decode(m.value as Uint8Array)
          return { dataTypeId: num(marker, MARKER.dataTypeId), token: str(marker, MARKER.token) }
        })
      : [],
    getUpdatesOrigin: getUpdates ? num(getUpdates, GET_UPDATES.getUpdatesOrigin) : 0
  }
}

const writeEntity = (w: Writer, e: Entity): void => {
  w.string(ENTITY.idString, e.idString)
  if (e.parentIdString) w.string(ENTITY.parentIdString, e.parentIdString)
  w.varint(ENTITY.version, e.version)
  w.varint(ENTITY.mtime, e.mtime)
  w.varint(ENTITY.ctime, e.ctime)
  if (e.name) w.string(ENTITY.name, e.name)
  if (e.nonUniqueName) w.string(ENTITY.nonUniqueName, e.nonUniqueName)
  if (e.serverDefinedUniqueTag) w.string(ENTITY.serverDefinedUniqueTag, e.serverDefinedUniqueTag)
  if (e.clientTagHash) w.string(ENTITY.clientTagHash, e.clientTagHash)
  if (e.originatorCacheGuid) w.string(ENTITY.originatorCacheGuid, e.originatorCacheGuid)
  if (e.originatorClientItemId) w.string(ENTITY.originatorClientItemId, e.originatorClientItemId)
  if (e.deleted) w.boolean(ENTITY.deleted, true)
  if (e.folder) w.boolean(ENTITY.folder, true)
  // A deletion carries no payload: the type's own bytes are gone with it.
  if (!e.deleted && e.specifics.length) w.bytes(ENTITY.specifics, e.specifics)
}

export interface CommitResult {
  idString: string
  version: number
  responseType: number
  errorMessage?: string
}

export function writeCommitResponse(storeBirthday: string, results: CommitResult[]): Uint8Array {
  const w = new Writer()
  w.message(RES.commit, (commit) => {
    for (const r of results) {
      // CommitResponse carries its entries as a group, not an embedded message.
      commit.group(ENTRY_RES.group, (g) => {
        g.varint(ENTRY_RES.responseType, r.responseType)
        g.string(ENTRY_RES.idString, r.idString)
        g.varint(ENTRY_RES.version, r.version)
        if (r.errorMessage) g.string(ENTRY_RES.errorMessage, r.errorMessage)
      })
    }
  })
  w.varint(RES.errorCode, ERROR.SUCCESS)
  w.string(RES.storeBirthday, storeBirthday)
  return w.finish()
}

export function writeGetUpdatesResponse(
  storeBirthday: string,
  entries: Entity[],
  markers: ProgressMarker[],
  changesRemaining: number
): Uint8Array {
  const w = new Writer()
  w.message(RES.getUpdates, (gu) => {
    for (const e of entries) gu.message(GET_UPDATES_RES.entries, (entity) => writeEntity(entity, e))
    gu.varint(GET_UPDATES_RES.changesRemaining, changesRemaining)
    for (const m of markers) {
      gu.message(GET_UPDATES_RES.newProgressMarker, (marker) => {
        marker.varint(MARKER.dataTypeId, m.dataTypeId)
        marker.string(MARKER.token, m.token)
      })
    }
  })
  w.varint(RES.errorCode, ERROR.SUCCESS)
  w.string(RES.storeBirthday, storeBirthday)
  return w.finish()
}

/**
 * An error the client is meant to act on. NOT_MY_BIRTHDAY is the important one: it tells a client that the server's data
 * was reset under it, and that it must throw away its local sync state and start again rather than carry on against
 * versions that no longer mean anything.
 */
export function writeError(code: number, message: string, storeBirthday = ''): Uint8Array {
  const w = new Writer()
  w.varint(RES.errorCode, code)
  if (message) w.string(RES.errorMessage, message)
  if (storeBirthday) w.string(RES.storeBirthday, storeBirthday)
  return w.finish()
}
