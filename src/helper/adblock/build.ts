import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FiltersEngine } from '@ghostery/adblocker'
import { ENGINE_CONFIG, extractPopupHosts, type EngineCategory } from '../../main/adblock/blocker.ts'
import { countRules, type Catalog, type LoadedFilters } from '../../main/adblock/store.ts'
import { convertList, withIds, type DnrRule } from './dnr.ts'

/**
 * Turns the filter lists Orbis already manages (FilterStore: download, validation, rollback, corruption recovery) into
 * what the Chromium extension enforces:
 *
 *  - `rules/<ruleset>.json`   Chromium declarativeNetRequest rulesets — Chromium's network layer blocks with these.
 *  - `engines/<category>.bin` the same compiled Ghostery engines Electron Orbis used, for element hiding and scriptlets
 *                             inside pages (which network rules cannot do).
 *  - `popup-hosts.json`       hosts the lists block as popups.
 *  - `index.json`             what was built, from which lists, and what could not be converted (and why).
 *
 * The output is written to a staging folder and swapped in whole, so a failed build never leaves half a set behind.
 */

export const RULESETS = ['ads', 'ads-strict', 'trackers', 'trackers-strict', 'annoyances', 'annoyances-strict'] as const
export type RulesetId = (typeof RULESETS)[number]

export interface BuildIndex {
  builtAt: number
  version: string
  rulesets: Record<string, { rules: number; category: EngineCategory }>
  lists: { id: string; category: string; networkRules: number; skipped: Record<string, number>; total: number }[]
  popupHosts: number
  engines: Record<string, number>
}

const categoryOf = (list: { category: string }): EngineCategory => (list.category === 'orbis' ? 'ads' : (list.category as EngineCategory))

export async function buildAdblockAssets(catalog: Catalog, loaded: LoadedFilters, outDir: string): Promise<BuildIndex> {
  const staging = `${outDir}.staging`
  await rm(staging, { recursive: true, force: true })
  await mkdir(join(staging, 'rules'), { recursive: true })
  await mkdir(join(staging, 'engines'), { recursive: true })

  const index: BuildIndex = { builtAt: Date.now(), version: loaded.manifest.version, rulesets: {}, lists: [], popupHosts: 0, engines: {} }
  const byRuleset: Record<RulesetId, Omit<DnrRule, 'id'>[]> = { ads: [], 'ads-strict': [], trackers: [], 'trackers-strict': [], annoyances: [], 'annoyances-strict': [] }

  for (const list of catalog.lists) {
    const text = loaded.texts.get(list.id)
    if (text === undefined) continue
    const category = categoryOf(list)
    const converted = convertList(text)
    byRuleset[category].push(...converted.standard)
    byRuleset[`${category}-strict` as RulesetId].push(...converted.strictExtra)
    index.lists.push({ id: list.id, category: list.category, networkRules: converted.standard.length + converted.strictExtra.length, skipped: converted.skipped, total: countRules(text) })
  }
  for (const id of RULESETS) {
    // The same rule in two lists is one rule. (Order within a ruleset does not matter to DNR; priority does.)
    const seen = new Set<string>()
    const unique = byRuleset[id].filter((r) => {
      const key = JSON.stringify(r)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    await writeFile(join(staging, 'rules', `${id}.json`), JSON.stringify(withIds(unique, 1)))
    index.rulesets[id] = { rules: unique.length, category: id.replace('-strict', '') as EngineCategory }
  }

  // The same engines Electron Orbis compiles (blocker.ts's ENGINE_CONFIG), for cosmetic filters and scriptlets.
  const resources = loaded.texts.get(catalog.resources.id) ?? ''
  const checksum = loaded.manifest.lists[catalog.resources.id]?.checksum ?? ''
  const listsFor = (category: EngineCategory): string[] => catalog.lists.filter((l) => categoryOf(l) === category && loaded.texts.has(l.id)).map((l) => l.id)
  for (const category of ['ads', 'trackers', 'annoyances'] as const) {
    const text = listsFor(category).map((id) => loaded.texts.get(id)).join('\n')
    const engine = FiltersEngine.parse(text, category === 'trackers' ? { ...ENGINE_CONFIG, loadCosmeticFilters: false } : ENGINE_CONFIG)
    if (resources && category !== 'trackers') engine.updateResources(resources, checksum)
    const bytes = engine.serialize()
    await writeFile(join(staging, 'engines', `${category}.bin`), bytes)
    index.engines[category] = bytes.byteLength
  }
  const popupHosts = [...new Set([...listsFor('ads'), ...listsFor('annoyances')].flatMap((id) => extractPopupHosts(loaded.texts.get(id) ?? '')))]
  index.popupHosts = popupHosts.length
  await writeFile(join(staging, 'popup-hosts.json'), JSON.stringify(popupHosts))
  await writeFile(join(staging, 'index.json'), JSON.stringify(index, null, 2))

  // Swap in whole: the finished set replaces the old one only once everything is written.
  const previous = `${outDir}.previous`
  await rm(previous, { recursive: true, force: true })
  await rename(outDir, previous).catch(() => undefined)
  await rename(staging, outDir)
  await readdir(previous).then(() => rm(previous, { recursive: true, force: true })).catch(() => undefined)
  return index
}
