import { join } from 'node:path'
import type { Board, BoardElement } from '../../shared/whiteboard'
import { boardToSvg, MAX_ELEMENTS, newBoard, normalizeBoard, normalizeElement, topZ } from '../../shared/whiteboard'
import { Collection } from './store'

/** Whiteboards as they are kept and changed: one file of boards, each with everything drawn on it. */
export class WhiteboardStore {
  private readonly boards: Collection<Board>

  constructor(userData: string) {
    this.boards = new Collection<Board>(join(userData, 'personal', 'whiteboards.json'), normalizeBoard, 500)
  }

  onChange(listener: () => void): () => void {
    return this.boards.onChange(listener)
  }

  /** Every board, newest change first, without what is drawn on them (that comes with get). */
  async list(): Promise<(Omit<Board, 'elements'> & { count: number })[]> {
    return (await this.boards.all())
      .map(({ elements, ...rest }) => ({ ...rest, count: elements.length }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Promise<Board | null> {
    return this.boards.get(id)
  }

  create(patch: Partial<Board> = {}): Promise<Board> {
    return this.boards.put(newBoard(patch))
  }

  save(board: Board): Promise<Board> {
    return this.boards.put({ ...board, updatedAt: Date.now() })
  }

  remove(id: string): Promise<boolean> {
    return this.boards.remove(id)
  }

  async rename(id: string, name: string): Promise<Board> {
    const board = await this.get(id)
    if (!board) throw new Error('That board no longer exists.')
    return this.save({ ...board, name })
  }

  /** Adds things to a board (a note, a picture from a page, a line) without sending the whole board back and forth. */
  async add(id: string, elements: unknown[]): Promise<Board> {
    const board = await this.get(id)
    if (!board) throw new Error('That board no longer exists.')
    let z = topZ(board.elements)
    const added = elements
      .map((raw) => normalizeElement({ id: crypto.randomUUID(), createdAt: Date.now(), z: z++, ...(raw as object) }))
      .filter((el): el is BoardElement => el !== null)
    if (!added.length) throw new Error('Nothing could be added to the board.')
    if (board.elements.length + added.length > MAX_ELEMENTS) throw new Error('This board is full.')
    return this.save({ ...board, elements: [...board.elements, ...added] })
  }

  /** The board written out as SVG. */
  async exportSvg(id: string): Promise<{ name: string; svg: string }> {
    const board = await this.get(id)
    if (!board) throw new Error('That board no longer exists.')
    return { name: board.name, svg: boardToSvg(board) }
  }

  flush(): Promise<void> {
    return this.boards.flush()
  }
}
