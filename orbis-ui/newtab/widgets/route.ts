import type { GalleryRoute } from './api.ts'

/**
 * Where the gallery is, written in the page's address.
 *
 *   chrome://orbis-newtab/                         the start page
 *   chrome://orbis-newtab/#widgets                 the gallery
 *   chrome://orbis-newtab/#widgets?q=clock&in=time&show=installed
 *   chrome://orbis-newtab/#widgets/weather         one widget from the catalogue
 *   chrome://orbis-newtab/#widgets/on/<id>         one widget that is on the start page
 *
 * In the address so that Back closes what was opened, a reload stays where it was, and Orion can open the gallery by
 * opening an address like any other page. Anything that is not one of these is the start page.
 *
 * Pure.
 */

const WORD = /^[a-z0-9-]{1,40}$/i
const ID = /^[A-Za-z0-9_-]{1,80}$/

export function readRoute(hash: string): GalleryRoute {
  const text = hash.replace(/^#/, '')
  if (text !== 'widgets' && !text.startsWith('widgets/') && !text.startsWith('widgets?')) return { view: 'closed' }
  const [path, search = ''] = text.split('?', 2)
  const parts = path.split('/').slice(1)
  if (parts[0] === 'on' && parts[1] && ID.test(parts[1])) return { view: 'instance', id: parts[1] }
  if (parts[0] && parts[0] !== 'on' && WORD.test(parts[0])) return { view: 'widget', widget: parts[0].toLowerCase() }
  const params = new URLSearchParams(search)
  const query = (params.get('q') ?? '').slice(0, 80)
  const category = params.get('in') ?? ''
  const filter = params.get('show') ?? ''
  return {
    view: 'home',
    ...(query ? { query } : {}),
    ...(WORD.test(category) ? { category } : {}),
    ...(WORD.test(filter) ? { filter } : {})
  }
}

export function writeRoute(route: GalleryRoute): string {
  if (route.view === 'closed') return ''
  if (route.view === 'widget') return `#widgets/${route.widget}`
  if (route.view === 'instance') return `#widgets/on/${route.id}`
  const params = new URLSearchParams()
  if (route.query) params.set('q', route.query)
  if (route.category) params.set('in', route.category)
  if (route.filter) params.set('show', route.filter)
  const search = params.toString()
  return search ? `#widgets?${search}` : '#widgets'
}
