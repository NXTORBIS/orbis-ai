import { join } from 'node:path'
import { JsonFile } from './personal/store.ts'
import { dataDirFor } from '../shared/profiles.ts'
import { hostOf, noteChallenge, noteOutcome, prune, readProfile, skillOf, summarise, SITE_PROFILE_VERSION, type SiteProfile } from '../shared/siteProfiles.ts'

/**
 * What Orbis has learned about working on particular sites, kept between runs.
 *
 * One file per Orbis profile, beside that profile's other things, written through the same debounced atomic writer
 * everything else uses. The file holds hosts, counts and dates and nothing else -- see the note at the top of
 * src/shared/siteProfiles.ts for why that boundary is the whole design.
 *
 * Recording is deliberately cheap and silent: it happens after an action has already finished, it never blocks
 * anything, and a file that will not read costs the notes and nothing else.
 */

interface Saved {
  v: number
  sites: SiteProfile[]
}

const read = (raw: unknown): Saved => {
  if (!raw || typeof raw !== 'object') return { v: SITE_PROFILE_VERSION, sites: [] }
  const sites = Array.isArray((raw as { sites?: unknown }).sites) ? ((raw as { sites: unknown[] }).sites as unknown[]) : []
  return { v: SITE_PROFILE_VERSION, sites: sites.map(readProfile).filter((one): one is SiteProfile => one !== null) }
}

export class SiteProfiles {
  private readonly files = new Map<string, JsonFile<Saved>>()
  private readonly userData: string
  private readonly profileId: () => string
  private readonly now: () => number

  constructor(o: { userData: string; profileId: () => string; now?: () => number }) {
    this.userData = o.userData
    this.profileId = o.profileId
    this.now = o.now ?? (() => Date.now())
  }

  private file(): JsonFile<Saved> {
    const id = this.profileId()
    let found = this.files.get(id)
    if (!found) {
      found = new JsonFile<Saved>(join(this.userData, dataDirFor(id), 'site-profiles.json'), () => ({ v: SITE_PROFILE_VERSION, sites: [] }), read)
      this.files.set(id, found)
    }
    return found
  }

  private async change(host: string, how: (one: SiteProfile | undefined) => SiteProfile): Promise<void> {
    const file = this.file()
    const saved = await file.read()
    const existing = saved.sites.find((one) => one.host === host)
    const updated = how(existing)
    const sites = prune([updated, ...saved.sites.filter((one) => one.host !== host)], undefined, this.now())
    await file.write({ v: SITE_PROFILE_VERSION, sites })
  }

  /** Records that an action of a given kind really worked, or really did not, on a page. */
  async record(url: string, capability: string, worked: boolean): Promise<void> {
    const host = hostOf(url)
    const skill = skillOf(capability)
    // Nothing that says nothing about a site is recorded against one.
    if (!host || !skill) return
    await this.change(host, (one) => noteOutcome(one, host, skill, worked, this.now())).catch(() => undefined)
  }

  /** Records that a site asked somebody to prove they were a person. */
  async recordChallenge(host: string): Promise<void> {
    if (!host) return
    await this.change(host, (one) => noteChallenge(one, host, this.now())).catch(() => undefined)
  }

  /**
   * What is worth telling the agent about this page's site, or null.
   *
   * Null is the usual answer. A site where things have worked produces nothing, because the agent already assumes
   * they work and a line on every page is a line it has to read on every page.
   */
  async noteFor(url: string): Promise<string | null> {
    const host = hostOf(url)
    if (!host) return null
    const saved = await this.file()
      .read()
      .catch(() => null)
    const profile = saved?.sites.find((one) => one.host === host)
    return profile ? summarise(profile, this.now()) : null
  }

  /** Writes anything pending. Called before quitting. */
  async flush(): Promise<void> {
    await Promise.all([...this.files.values()].map((file) => file.flush()))
  }
}
