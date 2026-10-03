import type { RendererTable } from '../api.ts'
import { weather } from './live/weather.ts'
import { news } from './live/news.ts'
import { markets } from './live/markets.ts'
import { orion } from './live/orion.ts'

/**
 * The widgets that show something happening outside Orbis: the sky, the headlines, a price, and Orion.
 *
 * What they have in common is that none of them knows anything. Each asks a source through the card it is drawn in
 * and shows what comes back, so the same four files draw the person's own weather on the start page and the sample
 * in the gallery without being told which is which. Where a source has nothing to give, the card says so in its own
 * words -- nothing in here invents a headline, a temperature or a price to fill a gap.
 */
export const LIVE_RENDERERS: RendererTable = Object.freeze({ weather, news, markets, orion })
