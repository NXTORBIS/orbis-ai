import type { FbLeague } from './types.ts'

const OL = (shortcut: string, name: string, country: string, kind: FbLeague['kind'], firstSeason: number, caveat: string | null = null): FbLeague => ({
  id: `openligadb:${shortcut}`,
  provider: 'openligadb',
  providerId: shortcut,
  name,
  country,
  kind,
  // Verified against the live API: fixtures, the table and a goal list with scorer and minute. No live flag (see types.ts).
  capabilities: { fixtures: true, table: kind === 'league', liveScore: false, goalEvents: true, seasonHistory: true },
  seasonFormat: 'year',
  firstSeason,
  caveat
})

const SD = (id: string, name: string, country: string, firstSeason: number, format: FbLeague['seasonFormat'] = 'span', kind: FbLeague['kind'] = 'league'): FbLeague => ({
  id: `thesportsdb:${id}`,
  provider: 'thesportsdb',
  providerId: id,
  name,
  country,
  kind,
  // Verified against the live API with the provider's public test key: live status and minute, fixtures, a table.
  // No goal list is returned on these endpoints.
  capabilities: { fixtures: true, table: kind === 'league', liveScore: true, goalEvents: false, seasonHistory: true },
  seasonFormat: format,
  firstSeason,
  caveat: 'Uses the provider’s public test key: the table is complete, but fixtures come back only a handful at a time (measured: 5 per request), and there is no goal list. Live scores are the strong part.'
})

/**
 * Competitions Orbis has actually requested from a provider. A competition is listed only if its provider returned
 * usable data for it; a provider *containing* a league is not the same as supporting it.
 */
export const LEAGUES: readonly FbLeague[] = [
  OL('bl1', '1. Bundesliga', 'Germany', 'league', 2007),
  OL('bl2', '2. Bundesliga', 'Germany', 'league', 2007),
  OL('bl3', '3. Liga', 'Germany', 'league', 2008),
  OL('dfb', 'DFB-Pokal', 'Germany', 'cup', 2010, 'A knockout cup: it has no league table.'),
  SD('4328', 'Premier League', 'England', 2010),
  SD('4329', 'Championship', 'England', 2010),
  SD('4335', 'La Liga', 'Spain', 2010),
  SD('4331', 'Bundesliga', 'Germany', 2010),
  SD('4332', 'Serie A', 'Italy', 2010),
  SD('4334', 'Ligue 1', 'France', 2010),
  SD('4337', 'Eredivisie', 'Netherlands', 2010),
  SD('4346', 'MLS', 'United States', 2010, 'year'),
  SD('4480', 'Champions League', 'Europe', 2010, 'span', 'cup')
]

export const leagueById = (id: string): FbLeague | null => LEAGUES.find((l) => l.id === id) ?? null

/** The season a competition is in now, in the form its provider wants. Football's year turns over in summer. */
export function currentSeason(l: FbLeague, now: Date): string {
  const y = now.getUTCFullYear()
  const start = now.getUTCMonth() >= 6 ? y : y - 1
  if (l.seasonFormat === 'year') return String(l.id === 'openligadb:dfb' || l.provider === 'openligadb' ? start : y)
  return String(start)
}

/** A season is "2025" to us; its provider may want "2025-2026". */
export function providerSeason(l: FbLeague, season: string): string {
  const y = Number(season)
  if (l.provider === 'thesportsdb' && l.seasonFormat === 'span') return `${y}-${y + 1}`
  return String(y)
}

export const seasonLabel = (l: FbLeague, season: string): string => (l.seasonFormat === 'span' || l.provider === 'openligadb' ? `${season}/${String(Number(season) + 1).slice(2)}` : season)
