import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { emptyFollows, sanitizeFollows, type FbFollows } from '../../shared/football/follows.ts'

/**
 * What a person follows in Football, one small file per Orbis profile. No Electron in here: the path comes in.
 * An unreadable file is moved aside (not overwritten with an empty list), so a bad write never costs the follows.
 */
export class FollowsStore {
  private readonly pathFor: () => Promise<string>
  private chain: Promise<unknown> = Promise.resolve()

  constructor(pathFor: () => Promise<string>) {
    this.pathFor = pathFor
  }

  async read(): Promise<FbFollows> {
    const path = await this.pathFor()
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyFollows()
      throw e
    }
    try {
      return sanitizeFollows(JSON.parse(text.replace(/^﻿/, '')))
    } catch {
      await fs.rename(path, `${path}.unreadable-${Date.now()}`).catch(() => undefined)
      return emptyFollows()
    }
  }

  /** Read, change, write: serialised, so two quick changes do not lose one. */
  update(fn: (f: FbFollows) => FbFollows): Promise<FbFollows> {
    const run = this.chain.then(async () => {
      const clean = sanitizeFollows(fn(await this.read()))
      const path = await this.pathFor()
      await fs.mkdir(dirname(path), { recursive: true })
      await fs.writeFile(`${path}.tmp`, JSON.stringify(clean), { encoding: 'utf8', mode: 0o600 })
      await fs.rename(`${path}.tmp`, path)
      return clean
    })
    this.chain = run.catch(() => undefined)
    return run
  }
}
