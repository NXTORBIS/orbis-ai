import { famousTitle, type FamousGame } from './famous.ts'

/**
 * The order the famous games are listed in, and the marks beside their moves.
 *
 * ## Why the order is worked out here rather than on the screen
 *
 * The three order buttons on the Famous games screen were reported as doing nothing. The sorting function they
 * called is fine and has always been fine, so what was wrong was never the comparison: the screen offered
 * "Oldest first", "Shortest first" and "By name" and gave no way to ask for the other direction, so pressing a
 * button you were already on looked like a button that did nothing, and nothing on screen said which way round
 * the list was. Six orders with the direction written into the name, and a line of words saying what the list is
 * ordered by, is the fix -- and both of those are decisions about data, so they live here where a test can hold
 * them.
 *
 * A game whose year is not recorded sorts last whichever direction is asked for. "Unknown" is not early and it is
 * not late, and putting it at the front of "Oldest first" would be Orbis claiming a date it does not have.
 */

export type FamousOrderId = 'oldest' | 'newest' | 'shortest' | 'longest' | 'name' | 'name-back'

export interface FamousOrder {
  id: FamousOrderId
  /** What the button says. The direction is part of the name, so no button is ambiguous. */
  label: string
  /** What the list is ordered by, said in full for the line under the buttons. */
  says: string
}

export const FAMOUS_ORDERS: readonly FamousOrder[] = Object.freeze([
  { id: 'oldest', label: 'Oldest first', says: 'Oldest game first. Games with no year recorded are last.' },
  { id: 'newest', label: 'Newest first', says: 'Newest game first. Games with no year recorded are last.' },
  { id: 'shortest', label: 'Shortest first', says: 'Fewest moves first.' },
  { id: 'longest', label: 'Longest first', says: 'Most moves first.' },
  { id: 'name', label: 'A to Z', says: 'By the players’ names, A to Z.' },
  { id: 'name-back', label: 'Z to A', says: 'By the players’ names, Z to A.' }
] as const)

/** Whether a stored or spoken name is really one of the orders. Anything else is not trusted. */
export function isFamousOrder(value: unknown): value is FamousOrderId {
  return typeof value === 'string' && FAMOUS_ORDERS.some((one) => one.id === value)
}

/** What the list is ordered by, in words, for the line under the buttons. */
export function orderWords(id: FamousOrderId): string {
  return FAMOUS_ORDERS.find((one) => one.id === id)?.says ?? ''
}

/**
 * The collection in the order asked for.
 *
 * A fresh array: the collection itself is frozen data and sorting it in place would be sorting the program's own
 * copy of it. Ties keep the order they came in, which is what makes stepping between two orders and back give the
 * list you started with.
 */
export function orderFamous(games: readonly FamousGame[], id: FamousOrderId): FamousGame[] {
  const out = [...games]
  out.sort((a, b) => {
    if (id === 'name') return famousTitle(a).localeCompare(famousTitle(b))
    if (id === 'name-back') return famousTitle(b).localeCompare(famousTitle(a))
    if (id === 'shortest') return a.san.length - b.san.length
    if (id === 'longest') return b.san.length - a.san.length
    // A year nobody recorded is last in both directions, so it is handled before the two years are compared.
    if (a.year === undefined && b.year === undefined) return 0
    if (a.year === undefined) return 1
    if (b.year === undefined) return -1
    return id === 'newest' ? b.year - a.year : a.year - b.year
  })
  return out
}

/** A mark beside one move in the move list, in the shape the shared move list takes. */
export interface FamousMoveNote {
  symbol: string
  title: string
  kind: string
}

/**
 * Which moves of a game carry commentary, as marks for the move list.
 *
 * Nothing is judged here and nothing is measured: the only moves marked are the ones the collection really has
 * words about, which is `game.guided`. A mark saying "brilliant" or "a mistake" would be a judgement nobody made,
 * and this collection exists not to make those -- so the mark says what it is, that there is something written
 * about this move, and the words themselves are shown beside the board when you get to it.
 */
export function famousMoveNotes(game: FamousGame): Record<number, FamousMoveNote> {
  const out: Record<number, FamousMoveNote> = {}
  for (const point of game.guided) {
    if (!Number.isInteger(point.ply) || point.ply < 1 || point.ply > game.san.length) continue
    out[point.ply] = {
      symbol: '✎',
      title: 'There is something written about this move. Step to it to read it.',
      kind: 'commentary'
    }
  }
  return out
}
