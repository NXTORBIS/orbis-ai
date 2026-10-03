import type { RendererTable } from '../api.ts'
import { TIME_RENDERERS } from './time.ts'
import { PERSONAL_RENDERERS } from './personal.ts'
import { LIVE_RENDERERS } from './live.ts'

/**
 * Every widget that can be drawn, by its id in the catalogue (src/shared/widgets.ts).
 *
 * A widget in the catalogue with nothing here is never offered: the gallery only lists what it can show.
 */
export const RENDERERS: RendererTable = Object.freeze({ ...TIME_RENDERERS, ...PERSONAL_RENDERERS, ...LIVE_RENDERERS })
