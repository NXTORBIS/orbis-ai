import type { Concept } from '../courses/types.ts'
import {
  FORGIVING_FAILURE, newExercise,
  type Exercise, type ExerciseHint, type Provenance, type Solution
} from './exercise.ts'
import { nestLine, type AcademyLesson, type Curriculum, type LessonBlock } from './lessons.ts'

/**
 * The Academy's beginner-to-intermediate curriculum, as data (Sections 061-070).
 *
 * ## Every position here has been checked by a machine
 *
 * Not one position or line in this file was written from memory and left alone. The mate puzzles were produced by
 * `forcedMateTree` -- an exhaustive search over the real rules -- so every defence is in the tree by construction.
 * The material-winning lines were built the same way: every legal reply enumerated, and a continuation found for
 * each one that still reaches the stated gain after the recapture. The "show me the squares" answers were read
 * straight out of `destinationsFrom`. The lines were played out move by move to get the position they reach.
 *
 * Then `curriculum.test.ts` does it all again, from scratch, on every test run. If a position here is illegal, or a
 * solution is unplayable, or a mate in two is really a mate in one, or a defence is missing, the suite fails. That
 * is the only reason to trust any of it.
 *
 * Several positions in this file came out of that process differently from how they were first written -- a "mate in
 * one" that let the king escape to b7, a stalemate that was really checkmate, a material line that stopped one move
 * before the piece came back. Those are exactly the mistakes that would otherwise have shipped, each one looking
 * perfectly fine.
 *
 * ## It is deliberately small
 *
 * Seventeen lessons and the tasks that go with them. A bigger curriculum would have meant positions nobody checked,
 * and a wrong puzzle teaches a learner that they cannot do something they can. Two kinds of content were cut for
 * that reason, and the gap is stated rather than filled:
 *
 *   - **Nothing asks for the best move.** "Best" is an engine's opinion, and this layer has no engine, so such an
 *     exercise could never be called checked. They belong to the puzzle trainer with a real search behind it.
 *   - **Philidor and Lucena are taught as ideas in words**, with one bridge manoeuvre to play out whose moves are
 *     verified legal. The canonical positions are not drawn here, because a diagram claiming to be a standard
 *     position had better be one.
 *
 * ## The exercises arrive unverified
 *
 * `newExercise` always stamps "unverified", and nothing in this file overrides that. A caller gets verified content
 * by passing the curriculum through `verifyCurriculum`, which works the answer out instead of believing it.
 */

// ---------------------------------------------------------------- the small amount of machinery the data needs

const authored = (note: string): Provenance => ({ kind: 'authored', by: 'Orbis Academy', note })
const generated = (note: string): Provenance => ({ kind: 'generated', by: 'forcedMateTree', note })
const built = (note: string): Provenance => ({ kind: 'generated', by: 'winMaterialTree', note })

const hints = (...all: { text: string; shows: ExerciseHint['shows'] }[]): ExerciseHint[] =>
  all.map((one, index) => ({ level: index + 1, text: one.text, shows: one.shows }))

interface TaskBase {
  id: string
  fen: string
  prompt: string
  hints: ExerciseHint[]
  tags: string[]
  lesson: string
  source: Provenance
}

const mateTask = (o: TaskBase & { moves: number; solution: Solution }): Exercise =>
  newExercise({
    id: o.id,
    kind: 'lesson-task',
    startFen: o.fen,
    objective: 'mate-in-n',
    movesToMate: o.moves,
    prompt: o.prompt,
    solution: o.solution,
    failure: FORGIVING_FAILURE,
    hints: o.hints,
    source: o.source,
    tags: o.tags,
    lesson: o.lesson
  })

const materialTask = (o: TaskBase & { centipawns: number; solution: Solution }): Exercise =>
  newExercise({
    id: o.id,
    kind: 'lesson-task',
    startFen: o.fen,
    objective: 'win-material',
    materialAtLeast: o.centipawns,
    prompt: o.prompt,
    solution: o.solution,
    failure: FORGIVING_FAILURE,
    hints: o.hints,
    source: o.source,
    tags: o.tags,
    lesson: o.lesson
  })

const squaresTask = (o: TaskBase & { from: string; squares: string[] }): Exercise =>
  newExercise({
    id: o.id,
    kind: 'lesson-task',
    startFen: o.fen,
    objective: 'answer',
    prompt: o.prompt,
    answer: { kind: 'destinations', from: o.from, squares: o.squares },
    failure: FORGIVING_FAILURE,
    hints: o.hints,
    source: o.source,
    tags: o.tags,
    lesson: o.lesson
  })

const lineTask = (o: TaskBase & { moves: string[]; reaches: string; kind?: Exercise['kind'] }): Exercise =>
  newExercise({
    id: o.id,
    kind: o.kind ?? 'calculation',
    startFen: o.fen,
    objective: 'reconstruct',
    prompt: o.prompt,
    solution: { lines: nestLine(o.moves) },
    answer: { kind: 'fen', fen: o.reaches },
    failure: FORGIVING_FAILURE,
    hints: o.hints,
    source: o.source,
    tags: o.tags,
    lesson: o.lesson
  })

const drawTask = (o: TaskBase & { solution: Solution }): Exercise =>
  newExercise({
    id: o.id,
    kind: 'endgame',
    startFen: o.fen,
    objective: 'hold-draw',
    prompt: o.prompt,
    solution: o.solution,
    failure: FORGIVING_FAILURE,
    hints: o.hints,
    source: o.source,
    tags: o.tags,
    lesson: o.lesson
  })

// ---------------------------------------------------------------- concepts

export const CHESS_CONCEPTS: Concept[] = [
  { id: 'piece-moves', name: 'How the pieces move', blurb: 'Where each piece can go, and what gets in its way.', requires: [], weight: 1 },
  { id: 'captures', name: 'Taking pieces', blurb: 'A piece takes by moving onto the square, and what each piece is worth.', requires: ['piece-moves'], weight: 0.9 },
  { id: 'check', name: 'Check', blurb: 'The king is attacked, and something has to be done about it this move.', requires: ['piece-moves'], weight: 1 },
  { id: 'checkmate', name: 'Checkmate', blurb: 'In check with nothing to do about it. The game is over.', requires: ['check'], weight: 1 },
  { id: 'stalemate', name: 'Stalemate', blurb: 'No legal move and not in check. A draw, however far ahead you are.', requires: ['checkmate'], weight: 0.8 },
  { id: 'castling', name: 'Castling', blurb: 'The king and a rook move together, when four things are all true.', requires: ['piece-moves'], weight: 0.7 },
  { id: 'en-passant', name: 'En passant', blurb: 'Taking a pawn that has just run past yours.', requires: ['captures'], weight: 0.5 },
  { id: 'promotion', name: 'Promotion', blurb: 'A pawn that reaches the far side becomes another piece, and must.', requires: ['piece-moves'], weight: 0.8 },
  { id: 'mate-with-queen', name: 'Mating with a queen', blurb: 'Driving a lone king to the edge and finishing it.', requires: ['checkmate'], weight: 0.9 },
  { id: 'mate-with-rook', name: 'Mating with a rook', blurb: 'The same job with less material, and it needs the king.', requires: ['checkmate'], weight: 0.9 },
  { id: 'opening-principles', name: 'Opening principles', blurb: 'Develop, take the middle, look after f7 and f2.', requires: ['piece-moves', 'captures', 'checkmate'], weight: 0.8 },
  { id: 'fork', name: 'The fork', blurb: 'One piece attacking two things at once.', requires: ['captures'], weight: 0.9 },
  { id: 'pin', name: 'The pin', blurb: 'A piece that cannot move because of what is behind it.', requires: ['captures'], weight: 0.9 },
  { id: 'skewer', name: 'The skewer', blurb: 'A pin the other way round: the valuable piece is in front.', requires: ['pin'], weight: 0.7 },
  { id: 'discovered-attack', name: 'The discovered attack', blurb: 'Moving one piece out of the way to open another one’s line.', requires: ['pin'], weight: 0.7 },
  { id: 'removing-the-defender', name: 'Removing the defender', blurb: 'Take the piece that is holding everything together.', requires: ['captures'], weight: 0.7 },
  { id: 'opposition', name: 'The opposition', blurb: 'Kings facing each other with one square between: whoever has to move gives way.', requires: ['piece-moves'], weight: 0.6 },
  { id: 'square-of-the-pawn', name: 'The square of the pawn', blurb: 'Whether a king can catch a running pawn, counted rather than guessed.', requires: ['promotion'], weight: 0.6 },
  { id: 'rook-endgame-ideas', name: 'Rook endgame ideas', blurb: 'Where the rook belongs, and the bridge that stops the checks.', requires: ['promotion', 'mate-with-rook'], weight: 0.6 }
]

// ---------------------------------------------------------------- module 1: the rules

const howThePiecesMove: AcademyLesson = {
  id: 'pieces-move',
  title: 'How the pieces move',
  intro: 'Six pieces, six ways of moving. The board will only let you play legal moves, so the quickest way to learn this is to look at where a piece can actually go.',
  objectives: [
    'Say where a knight, bishop, rook and queen can go from any square',
    'Explain why a piece in the corner has fewer squares than one in the middle',
    'Spot when a piece of your own is in the way'
  ],
  requires: [],
  concepts: ['piece-moves'],
  minutes: 12,
  difficulty: 'beginner',
  blocks: [
    { kind: 'text', text: 'A rook goes along ranks and files. A bishop goes along diagonals and never changes the colour of square it stands on. A queen does both. A knight jumps two squares one way and one the other, and is the only piece that is not stopped by anything in between. A king goes one square in any direction. A pawn goes one square forward, two from its starting square, and takes diagonally.' },
    { kind: 'callout', tone: 'tip', text: 'Pieces in the middle are worth more than the same pieces on the edge, and this is why: a knight in the middle has eight squares, and a knight in the corner has two.' },
    { kind: 'board', fen: '4k3/7p/8/3N4/8/8/8/4K3 w - - 0 1', caption: 'Eight squares from the middle.', highlight: ['b4', 'b6', 'c3', 'c7', 'e3', 'e7', 'f4', 'f6'] },
    { kind: 'task', taskId: 'pieces-knight-corner' },
    { kind: 'task', taskId: 'pieces-knight-middle' },
    { kind: 'text', text: 'Your own pieces block you; the other side’s pieces can be taken, which also stops you going any further. A rook with its own pawn in front of it has lost a whole direction.' },
    { kind: 'task', taskId: 'pieces-rook-blocked' },
    { kind: 'task', taskId: 'pieces-bishop' },
    { kind: 'task', taskId: 'pieces-queen' }
  ],
  tasks: [
    squaresTask({
      id: 'pieces-knight-corner',
      fen: '4k3/7p/8/8/8/8/8/N3K3 w - - 0 1',
      from: 'a1',
      squares: ['b3', 'c2'],
      prompt: 'Show every square the knight on a1 can go to.',
      hints: hints(
        { text: 'A knight moves two squares one way and one the other. From the corner, most of those land off the board.', shows: 'theme' },
        { text: 'There are two of them, and both are on the b and c files.', shows: 'target' },
        { text: 'b3 and c2.', shows: 'move' }
      ),
      tags: ['piece-moves', 'knight'],
      lesson: 'A knight in the corner reaches two squares. The same knight in the middle reaches eight.',
      source: authored('Answer read from destinationsFrom.')
    }),
    squaresTask({
      id: 'pieces-knight-middle',
      fen: '4k3/7p/8/3N4/8/8/8/4K3 w - - 0 1',
      from: 'd5',
      squares: ['b4', 'b6', 'c3', 'c7', 'e3', 'e7', 'f4', 'f6'],
      prompt: 'Show every square the knight on d5 can go to.',
      hints: hints(
        { text: 'Count them in pairs: two up, one across -- then one up, two across. Go round the clock.', shows: 'theme' },
        { text: 'There are eight.', shows: 'target' }
      ),
      tags: ['piece-moves', 'knight'],
      lesson: 'Eight squares. A knight is worth about three pawns in the middle and a good deal less at the edge.',
      source: authored('Answer read from destinationsFrom.')
    }),
    squaresTask({
      id: 'pieces-rook-blocked',
      fen: '4k3/8/8/8/8/3P4/8/3RK3 w - - 0 1',
      from: 'd1',
      squares: ['a1', 'b1', 'c1', 'd2'],
      prompt: 'Show every square the rook on d1 can go to.',
      hints: hints(
        { text: 'Look up the d-file first, and look at what is standing on d3.', shows: 'theme' },
        { text: 'Your own pawn blocks the file after d2, and your own king blocks the rank to the right.', shows: 'target' },
        { text: 'a1, b1, c1 and d2.', shows: 'move' }
      ),
      tags: ['piece-moves', 'rook'],
      lesson: 'Four squares, from a piece that would usually have fourteen. Your own pieces cost you more squares than the other side’s do.',
      source: authored('Answer read from destinationsFrom.')
    }),
    squaresTask({
      id: 'pieces-bishop',
      fen: '4k3/7p/8/8/8/8/8/2B1K3 w - - 0 1',
      from: 'c1',
      squares: ['a3', 'b2', 'd2', 'e3', 'f4', 'g5', 'h6'],
      prompt: 'Show every square the bishop on c1 can go to.',
      hints: hints(
        { text: 'Two diagonals, and the bishop stays on dark squares the whole game.', shows: 'theme' },
        { text: 'One diagonal is short and the other runs all the way to h6.', shows: 'target' }
      ),
      tags: ['piece-moves', 'bishop'],
      lesson: 'A bishop never changes the colour of square it is on. That is why a pair of bishops covers things a single bishop never can.',
      source: authored('Answer read from destinationsFrom.')
    }),
    squaresTask({
      id: 'pieces-queen',
      fen: '4k3/8/8/8/8/8/8/3QK3 w - - 0 1',
      from: 'd1',
      squares: ['a1', 'a4', 'b1', 'b3', 'c1', 'c2', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'e2', 'f3', 'g4', 'h5'],
      prompt: 'Show every square the queen on d1 can go to.',
      hints: hints(
        { text: 'A rook and a bishop at the same time: the file, the rank, and both diagonals.', shows: 'theme' },
        { text: 'The king on e1 blocks the rank going right. Seventeen squares are left.', shows: 'target' }
      ),
      tags: ['piece-moves', 'queen'],
      lesson: 'Seventeen squares from the corner of the board, and the king next door is the only thing in the way.',
      source: authored('Answer read from destinationsFrom.')
    })
  ],
  assessment: { id: 'pieces-move-check', title: 'The pieces', taskIds: [], needs: 4, countHinted: false }
}

const takingPieces: AcademyLesson = {
  id: 'captures',
  title: 'Taking pieces, and what they are worth',
  intro: 'A piece takes by moving onto the square the other piece is standing on. Which capture to make is usually decided by what the pieces are worth.',
  objectives: [
    'Take a piece with the right piece',
    'Say what a pawn, knight, bishop, rook and queen are worth against each other',
    'Choose between two captures'
  ],
  requires: ['piece-moves'],
  concepts: ['captures'],
  minutes: 10,
  difficulty: 'beginner',
  blocks: [
    { kind: 'text', text: 'Captures are not compulsory, and a capture is still just a move: the piece goes to the square, and what was there comes off the board. A pawn is the exception to the shape of its own move -- it goes straight forward and takes diagonally.' },
    {
      kind: 'table',
      headers: ['Piece', 'Roughly worth'],
      rows: [['Pawn', '1'], ['Knight', '3'], ['Bishop', '3'], ['Rook', '5'], ['Queen', '9'], ['King', 'the game']]
    },
    { kind: 'callout', tone: 'note', text: 'These numbers are a rule of thumb for deciding a trade, not a score. Nobody wins a game by having the higher total.' },
    { kind: 'task', taskId: 'captures-take-queen' },
    { kind: 'task', taskId: 'captures-choose' }
  ],
  tasks: [
    materialTask({
      id: 'captures-take-queen',
      fen: '4k3/8/8/8/3q4/5N2/8/4K3 w - - 0 1',
      centipawns: 900,
      solution: { lines: [{ move: 'f3d4', why: 'The knight reaches d4, and nothing can take it back.' }] },
      prompt: 'White to play. Win the queen.',
      hints: hints(
        { text: 'The knight is the only piece that can reach her.', shows: 'theme' },
        { text: 'Count the knight’s squares from f3 and find the one with the queen on it.', shows: 'piece' },
        { text: 'Nxd4.', shows: 'move' }
      ),
      tags: ['captures'],
      lesson: 'The queen was not defended, and nothing could take the knight back. That is what "winning a piece" means.',
      source: authored('Gain and recapture checked by validateExercise.')
    }),
    materialTask({
      id: 'captures-choose',
      fen: '4k3/8/8/6p1/3q4/5N2/8/4K3 w - - 0 1',
      centipawns: 900,
      solution: { lines: [{ move: 'f3d4', why: 'Nine points rather than one.' }] },
      prompt: 'White to play. The knight can take two different things. Take the right one.',
      hints: hints(
        { text: 'Both captures are legal. One of them is worth nine times the other.', shows: 'theme' },
        { text: 'Leave the pawn alone.', shows: 'target' }
      ),
      tags: ['captures'],
      lesson: 'Taking the pawn is a legal move and a bad one. A free pawn is not worth as much as a free queen.',
      source: authored('Gain and recapture checked by validateExercise.')
    })
  ],
  assessment: { id: 'captures-check', title: 'Taking pieces', taskIds: [], needs: 2, countHinted: false }
}

const checkAndCheckmate: AcademyLesson = {
  id: 'check-and-mate',
  title: 'Check, and checkmate',
  intro: 'Check means the king is attacked. Checkmate means the king is attacked and there is nothing to be done about it -- and that is the whole object of the game.',
  objectives: [
    'Find the three answers to a check: move, block, take',
    'Deliver checkmate in one move',
    'Tell a check that ends the game from one that does not'
  ],
  requires: ['piece-moves'],
  concepts: ['check', 'checkmate'],
  minutes: 15,
  difficulty: 'beginner',
  blocks: [
    { kind: 'text', text: 'When your king is attacked you must deal with it this move. There are only three ways: move the king somewhere safe, put something in the way, or take the attacker. If none of the three is available, that is checkmate and the game is over.' },
    { kind: 'task', taskId: 'check-escape' },
    { kind: 'text', text: 'To mate with a queen or a rook you need the king shut in. Look at what is holding the king in place as much as at what is giving the check -- very often it is the king’s own pawns.' },
    { kind: 'task', taskId: 'mate-back-rank' },
    { kind: 'task', taskId: 'mate-queen-one' }
  ],
  tasks: [
    squaresTask({
      id: 'check-escape',
      fen: '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1',
      from: 'e1',
      squares: ['d1', 'e2', 'f1'],
      prompt: 'White is in check from the rook. Show every square the king can go to.',
      hints: hints(
        { text: 'The rook covers the whole e-file and the whole second rank. Where does that leave the king?', shows: 'theme' },
        { text: 'One of the three answers is to take the rook -- nothing is defending it.', shows: 'target' }
      ),
      tags: ['check'],
      lesson: 'Three squares, and one of them is the rook itself. Taking the attacker is an answer to a check as good as running away.',
      source: authored('Answer read from destinationsFrom.')
    }),
    mateTask({
      id: 'mate-back-rank',
      fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1',
      moves: 1,
      solution: { lines: [{ move: 'a1a8', why: 'The pawns the king hid behind are now the walls of its cell.' }] },
      prompt: 'White to play. Mate in one.',
      hints: hints(
        { text: 'The black king has three pawns in front of it and no way out along the back row.', shows: 'theme' },
        { text: 'The rook wants the eighth rank.', shows: 'piece' },
        { text: 'Ra8 is mate.', shows: 'move' }
      ),
      tags: ['checkmate', 'back-rank'],
      lesson: 'The back-rank mate. The king is not short of defenders -- it is short of air.',
      source: generated('Tree from an exhaustive mate search.')
    }),
    mateTask({
      id: 'mate-queen-one',
      fen: '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',
      moves: 1,
      solution: { lines: [{ move: 'f1f8', why: 'Check along the eighth rank, with the white king covering g7 and h7.' }] },
      prompt: 'White to play. Mate in one.',
      hints: hints(
        { text: 'The white king is already doing half the work. Which squares does it cover?', shows: 'theme' },
        { text: 'The queen needs to give check on a line the king cannot step off.', shows: 'piece' },
        { text: 'Qf8 is mate.', shows: 'move' }
      ),
      tags: ['checkmate'],
      lesson: 'With the kings facing each other like this, the queen only has to give check on the back row. The two pieces mate together; neither could do it alone.',
      source: generated('Tree from an exhaustive mate search.')
    })
  ],
  assessment: { id: 'check-and-mate-check', title: 'Check and mate', taskIds: ['mate-back-rank', 'mate-queen-one'], needs: 2, countHinted: false }
}

const stalemate: AcademyLesson = {
  id: 'stalemate',
  title: 'Stalemate: the draw that feels wrong',
  intro: 'If it is your move, you are not in check, and you have no legal move at all, the game is a draw. It does not matter that the other side has a queen and you have nothing.',
  objectives: [
    'Recognise a position with no legal move and no check',
    'Avoid a stalemate when you are winning'
  ],
  requires: ['checkmate'],
  concepts: ['stalemate'],
  minutes: 10,
  difficulty: 'beginner',
  blocks: [
    { kind: 'text', text: 'Checkmate and stalemate look alike on the board and could not be further apart in the score. Both are positions with no legal move; in one the king is attacked and in the other it is not.' },
    { kind: 'board', fen: '7k/8/5KQ1/8/8/8/8/8 b - - 0 1', caption: 'Black to move, not in check, and no legal move anywhere. A draw.', highlight: ['h8'] },
    { kind: 'task', taskId: 'stalemate-see' },
    { kind: 'callout', tone: 'warning', text: 'The commonest way to throw away a won game: take every square away from the king without giving check. Always leave it somewhere to go, right up to the move that mates it.' },
    { kind: 'task', taskId: 'stalemate-avoid' }
  ],
  tasks: [
    squaresTask({
      id: 'stalemate-see',
      fen: '7k/8/5KQ1/8/8/8/8/8 b - - 0 1',
      from: 'h8',
      squares: [],
      prompt: 'It is Black to move. Show every square the king can go to.',
      hints: hints(
        { text: 'Check each of the three squares next to the king in turn: g7, g8, h7.', shows: 'theme' },
        { text: 'The queen covers two of them and the white king covers the third.', shows: 'target' }
      ),
      tags: ['stalemate'],
      lesson: 'No squares, and no check either. That is stalemate: a draw, with a queen against nothing.',
      source: authored('Answer read from destinationsFrom; the position is confirmed stalemate by outcome().')
    }),
    mateTask({
      id: 'stalemate-avoid',
      fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1',
      moves: 1,
      solution: { lines: [{ move: 'g1g7', why: 'Check, with the king behind the queen holding g7.' }] },
      prompt: 'White to play. One move mates. Another one draws on the spot. Find the mate.',
      hints: hints(
        { text: 'Qg6 would leave the black king with nothing to play and no check: a draw. So the move must give check.', shows: 'theme' },
        { text: 'The queen can go next to the king, as long as the white king defends her.', shows: 'piece' },
        { text: 'Qg7 is mate.', shows: 'move' }
      ),
      tags: ['stalemate', 'checkmate'],
      lesson: 'Qg7 mates because the king on f6 defends the queen. Qg6 is stalemate. One square apart, and the difference between winning and drawing.',
      source: generated('Tree from an exhaustive mate search; the stalemate alternative is a legal move the judge will call "not the idea".')
    })
  ],
  assessment: { id: 'stalemate-check', title: 'Stalemate', taskIds: [], needs: 2, countHinted: false }
}

const castling: AcademyLesson = {
  id: 'castling',
  title: 'Castling',
  intro: 'One move that moves two pieces: the king goes two squares towards a rook and the rook hops over to the other side of it. It is how the king gets somewhere safe.',
  objectives: [
    'Castle on either side',
    'List the four things that stop you castling'
  ],
  requires: ['piece-moves'],
  concepts: ['castling'],
  minutes: 10,
  difficulty: 'beginner',
  blocks: [
    { kind: 'text', text: 'Castling is legal when all of these are true: the king has not moved, that rook has not moved, the squares between them are empty, and the king is not in check and does not pass through or land on an attacked square.' },
    { kind: 'callout', tone: 'note', text: 'Note what is not on the list: the rook may be attacked, and the rook may pass through an attacked square. It is only the king’s journey that matters.' },
    { kind: 'task', taskId: 'castling-which' },
    { kind: 'task', taskId: 'castling-play' }
  ],
  tasks: [
    squaresTask({
      id: 'castling-which',
      fen: 'r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1',
      from: 'e1',
      squares: ['c1', 'd1', 'd2', 'e2'],
      prompt: 'White may castle on either side -- in principle. Show every square the king can actually go to.',
      hints: hints(
        { text: 'The black rook on f8 owns the whole f-file. Which squares does that take away?', shows: 'theme' },
        { text: 'Castling short would take the king across f1, and f1 is attacked.', shows: 'target' },
        { text: 'c1 (castling long), d1, d2 and e2.', shows: 'move' }
      ),
      tags: ['castling'],
      lesson: 'Short castling is out because the king would cross f1, which the rook on f8 covers. Long castling is fine. The rook on a1 crossing b1 and c1 does not matter.',
      source: authored('Answer read from destinationsFrom.')
    }),
    lineTask({
      id: 'castling-play',
      fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
      moves: ['O-O', 'O-O'],
      reaches: 'r4rk1/pppppppp/8/8/8/8/PPPPPPPP/R4RK1 w - - 2 2',
      prompt: 'Castle short for White, then for Black. Where do the four pieces end up?',
      hints: hints(
        { text: 'The king goes two squares towards the rook; the rook goes to the square the king crossed.', shows: 'theme' },
        { text: 'The kings land on g1 and g8.', shows: 'target' }
      ),
      tags: ['castling'],
      lesson: 'Kings on g1 and g8, rooks on f1 and f8. Both sides have lost their castling rights, which is why the position can only be reached this way once.',
      source: authored('Final position computed by playing the line.'),
      kind: 'lesson-task'
    })
  ],
  assessment: { id: 'castling-check', title: 'Castling', taskIds: [], needs: 2, countHinted: false }
}

const enPassant: AcademyLesson = {
  id: 'en-passant',
  title: 'En passant',
  intro: 'A pawn that tries to run past yours by going two squares can be taken as though it had only gone one. It is the only capture where the piece you take is not on the square you land on.',
  objectives: [
    'Take a pawn en passant',
    'Say when the chance disappears'
  ],
  requires: ['captures'],
  concepts: ['en-passant'],
  minutes: 8,
  difficulty: 'beginner',
  blocks: [
    { kind: 'text', text: 'The conditions are narrow. Your pawn must be on its fifth rank, an enemy pawn on an next-door file must have just moved two squares past it, and you must take immediately -- the chance is gone after any other move.' },
    { kind: 'task', taskId: 'ep-squares' },
    { kind: 'task', taskId: 'ep-capture' }
  ],
  tasks: [
    squaresTask({
      id: 'ep-squares',
      fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
      from: 'e5',
      squares: ['d6', 'e6'],
      prompt: 'Black has just played d7-d5. Show every square the pawn on e5 can go to.',
      hints: hints(
        { text: 'A pawn usually has one square. This one has two, and the second is a capture.', shows: 'theme' },
        { text: 'The pawn can land on d6 even though nothing is standing there.', shows: 'target' }
      ),
      tags: ['en-passant'],
      lesson: 'e6 and d6. The capture on d6 takes the pawn that is sitting on d5, which is the only time a capture works like that.',
      source: authored('Answer read from destinationsFrom.')
    }),
    materialTask({
      id: 'ep-capture',
      fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
      centipawns: 100,
      solution: { lines: [{ move: 'e5d6', why: 'The pawn on d5 comes off, even though the capturing pawn lands on d6.' }] },
      prompt: 'White to play. Win the pawn.',
      hints: hints(
        { text: 'Pushing to e6 lets the pawn go past. There is another move.', shows: 'theme' },
        { text: 'Take it in passing.', shows: 'target' },
        { text: 'exd6.', shows: 'move' }
      ),
      tags: ['en-passant', 'captures'],
      lesson: 'Take it now or not at all. Next move the pawn on d5 is safe for good.',
      source: authored('Gain and recapture checked by validateExercise.')
    })
  ],
  assessment: { id: 'en-passant-check', title: 'En passant', taskIds: [], needs: 2, countHinted: false }
}

const promotion: AcademyLesson = {
  id: 'promotion',
  title: 'Promotion',
  intro: 'A pawn that reaches the far side of the board turns into a queen, rook, bishop or knight. It is not optional -- it cannot stay a pawn.',
  objectives: [
    'Promote a pawn and choose the piece',
    'Notice when a queen is not the best choice'
  ],
  requires: ['piece-moves'],
  concepts: ['promotion'],
  minutes: 10,
  difficulty: 'beginner',
  blocks: [
    { kind: 'text', text: 'You may have nine queens if you can get them. The new piece appears on the square the pawn landed on and goes to work immediately, which is why a pawn on the seventh rank is worth watching.' },
    { kind: 'task', taskId: 'promote-square' },
    { kind: 'text', text: 'A queen is right almost every time. Almost: promoting to a rook sometimes avoids a stalemate, and a knight sometimes gives a check nothing else gives.' },
    { kind: 'task', taskId: 'promote-mate' }
  ],
  tasks: [
    squaresTask({
      id: 'promote-square',
      fen: '8/P7/8/8/8/8/8/K6k w - - 0 1',
      from: 'a7',
      squares: ['a8'],
      prompt: 'Show every square the pawn on a7 can go to.',
      hints: hints(
        { text: 'One square forward, as always. What happens when it gets there is the interesting part.', shows: 'theme' }
      ),
      tags: ['promotion'],
      lesson: 'One square -- but four moves, because the pawn must become a queen, rook, bishop or knight when it arrives.',
      source: authored('Answer read from destinationsFrom; the four promotion moves all land on a8.')
    }),
    mateTask({
      id: 'promote-mate',
      fen: 'k7/1R5P/2K5/8/8/8/8/8 w - - 0 1',
      moves: 1,
      solution: {
        lines: [
          { move: 'h7h8q', why: 'Check along the eighth rank. The rook holds a7 and b8, and the king defends the rook.' },
          { move: 'h7h8r', why: 'The rook does exactly the same job. Both are mate.' }
        ]
      },
      prompt: 'White to play. Mate in one.',
      hints: hints(
        { text: 'The pawn has one move. The question is what it should become.', shows: 'theme' },
        { text: 'Two of the four choices mate. A bishop and a knight on h8 do nothing at all.', shows: 'target' }
      ),
      tags: ['promotion', 'checkmate'],
      lesson: 'h8=Q and h8=R both mate: the eighth rank is what matters, and a bishop or knight there gives no check. Two right answers, and the trainer accepts either.',
      source: generated('Tree from an exhaustive mate search; it found both mating promotions.')
    })
  ],
  assessment: { id: 'promotion-check', title: 'Promotion', taskIds: [], needs: 2, countHinted: false }
}

// ---------------------------------------------------------------- module 2: the basic mates

const mateWithTheQueen: AcademyLesson = {
  id: 'mate-with-queen',
  title: 'Mate with a king and queen',
  intro: 'A queen cannot mate a lone king on her own. The job is to walk the king to the edge with the queen and then bring your own king up to finish it.',
  objectives: [
    'Mate with king and queen against a lone king',
    'Explain why the king has to join in'
  ],
  requires: ['checkmate'],
  concepts: ['mate-with-queen'],
  minutes: 15,
  difficulty: 'beginner',
  blocks: [
    { kind: 'text', text: 'Every mate with a queen looks the same at the end: the enemy king on the edge, your queen giving check along that edge, and your own king close enough to cover the squares in front of it. Getting there is two jobs -- push the king to the edge, then walk your own king over.' },
    { kind: 'board', fen: '6k1/8/6K1/8/8/8/8/Q7 w - - 0 1', caption: 'Kings facing each other with one square between: the queen mates anywhere on the eighth rank.' },
    { kind: 'task', taskId: 'queen-mate-finish' },
    { kind: 'callout', tone: 'tip', text: 'If the mate is not there yet, the move is almost always a king move. A queen giving check for the sake of it just lets the king out.' },
    { kind: 'task', taskId: 'queen-mate-two' }
  ],
  tasks: [
    mateTask({
      id: 'queen-mate-finish',
      fen: '6k1/8/6K1/8/8/8/8/Q7 w - - 0 1',
      moves: 1,
      solution: {
        lines: [
          { move: 'a1a8', why: 'Check along the eighth rank; the king on g6 holds f7, g7 and h7.' },
          { move: 'a1g7', why: 'Next to the king and defended by the king. Also mate.' }
        ]
      },
      prompt: 'White to play. Mate in one.',
      hints: hints(
        { text: 'Your king covers f7, g7 and h7 already. The black king needs to be cut off from f8 and h8 as well.', shows: 'theme' },
        { text: 'Either the eighth rank or the square right next to the king.', shows: 'target' }
      ),
      tags: ['mate-with-queen', 'checkmate'],
      lesson: 'Qa8 and Qg7 both mate. This is the shape to aim for every time: kings facing, queen on the edge.',
      source: generated('Tree from an exhaustive mate search; it found both mates.')
    }),
    mateTask({
      id: 'queen-mate-two',
      fen: '7k/8/5K2/8/8/8/8/1Q6 w - - 0 1',
      moves: 2,
      solution: {
        lines: [
          {
            move: 'f6g6',
            why: 'The king steps up. Black has one move, and then the eighth rank mates.',
            children: [{ move: 'h8g8', children: [{ move: 'b1b8', why: 'Mate: the king covers f7, g7 and h7, the queen covers the eighth rank.' }] }]
          },
          {
            move: 'b1b7',
            why: 'Taking g7 and h7 with the queen instead. Also mate in two.',
            children: [{ move: 'h8g8', children: [{ move: 'b7g7' }] }]
          },
          {
            move: 'b1g1',
            why: 'Cutting the king off down the g-file first.',
            children: [{ move: 'h8h7', children: [{ move: 'g1g7' }] }]
          }
        ]
      },
      prompt: 'White to play. Mate in two.',
      hints: hints(
        { text: 'There is no mate this move. Something has to take squares away from the black king first.', shows: 'theme' },
        { text: 'The black king has exactly one square. Take the others and let it walk there.', shows: 'target' },
        { text: 'Kg6, and after Kg8, Qb8 is mate.', shows: 'move' }
      ),
      tags: ['mate-with-queen', 'checkmate'],
      lesson: 'Three different moves mate in two, and the trainer accepts any of them. The king step is the one worth learning, because it is the move that works with a rook as well.',
      source: generated('Tree from an exhaustive mate search: every first move that forces mate in two, with every defence answered.')
    })
  ],
  assessment: { id: 'mate-with-queen-check', title: 'King and queen', taskIds: [], needs: 2, countHinted: false }
}

const mateWithTheRook: AcademyLesson = {
  id: 'mate-with-rook',
  title: 'Mate with a king and rook',
  intro: 'The same job with less material. A rook covers a rank or a file and nothing else, so your king has to do more of the work -- and the mate only exists with the kings facing each other.',
  objectives: [
    'Mate with king and rook against a lone king',
    'Use a king move to force the enemy king where you want it'
  ],
  requires: ['checkmate'],
  concepts: ['mate-with-rook'],
  minutes: 15,
  difficulty: 'beginner',
  blocks: [
    { kind: 'text', text: 'The finished position: the kings facing each other with one square between them, and the rook giving check along the edge. Nothing else mates with a rook, so every move you make is about reaching that picture.' },
    { kind: 'task', taskId: 'rook-mate-finish' },
    { kind: 'text', text: 'When the picture is not there yet, step your king towards the enemy king. If it has only one square left, it has to take it, and then the rook mates.' },
    { kind: 'task', taskId: 'rook-mate-two' }
  ],
  tasks: [
    mateTask({
      id: 'rook-mate-finish',
      fen: '6k1/8/6K1/8/8/8/8/R7 w - - 0 1',
      moves: 1,
      solution: { lines: [{ move: 'a1a8', why: 'The rook takes the eighth rank; the king takes the three squares in front of it.' }] },
      prompt: 'White to play. Mate in one.',
      hints: hints(
        { text: 'Your king already covers f7, g7 and h7.', shows: 'theme' },
        { text: 'The rook needs the eighth rank.', shows: 'piece' },
        { text: 'Ra8 is mate.', shows: 'move' }
      ),
      tags: ['mate-with-rook', 'checkmate'],
      lesson: 'This is the only mating picture with a rook. Learn it as a picture and the rest of the technique is about reaching it.',
      source: generated('Tree from an exhaustive mate search.')
    }),
    mateTask({
      id: 'rook-mate-two',
      fen: '7k/8/5K2/8/8/8/8/R7 w - - 0 1',
      moves: 2,
      solution: {
        lines: [
          {
            move: 'f6g6',
            why: 'Now the black king has only g8, and after it goes there the rook mates on the eighth rank.',
            children: [{ move: 'h8g8', children: [{ move: 'a1a8', why: 'Mate.' }] }]
          },
          {
            move: 'f6f7',
            why: 'The same idea the other way: the king is forced to h7 and the rook mates on the h-file.',
            children: [{ move: 'h8h7', children: [{ move: 'a1h1' }] }]
          }
        ]
      },
      prompt: 'White to play. Mate in two.',
      hints: hints(
        { text: 'A rook check now only chases the king somewhere useless. Move the other piece.', shows: 'theme' },
        { text: 'Walk your king up so the black king has one square, and let it walk there.', shows: 'piece' },
        { text: 'Kg6, and after Kg8, Ra8 is mate.', shows: 'move' }
      ),
      tags: ['mate-with-rook', 'checkmate'],
      lesson: 'Two ways, both the same idea: the king takes the squares away and the rook delivers. A rook mate is always two pieces working together.',
      source: generated('Tree from an exhaustive mate search: both first moves, with every defence answered.')
    })
  ],
  assessment: { id: 'mate-with-rook-check', title: 'King and rook', taskIds: [], needs: 2, countHinted: false }
}

// ---------------------------------------------------------------- module 3: the opening

const openingPrinciples: AcademyLesson = {
  id: 'opening-principles',
  title: 'The opening: four things worth doing',
  intro: 'There is nothing to memorise here. Get pieces out, take some of the middle, get the king safe, and do not move the same piece five times.',
  objectives: [
    'Name the squares a knight can reach on the first move',
    'Play a short, sound opening line',
    'Watch the f7 and f2 squares'
  ],
  requires: ['piece-moves', 'captures', 'checkmate'],
  concepts: ['opening-principles'],
  minutes: 15,
  difficulty: 'beginner',
  blocks: [
    {
      kind: 'list',
      ordered: true,
      items: [
        'Put a pawn in the middle, so your pieces have somewhere to go.',
        'Bring out the knights and bishops before the queen and rooks.',
        'Castle, usually in the first ten moves.',
        'Do not move the same piece again and again, and do not go hunting pawns with the queen.'
      ]
    },
    { kind: 'task', taskId: 'opening-knight' },
    { kind: 'task', taskId: 'opening-line' },
    { kind: 'callout', tone: 'warning', text: 'The weakest square in the opening position is f7 for Black and f2 for White: the only square next to the king that the king itself defends. Two pieces aiming at it can be mate.' },
    { kind: 'task', taskId: 'opening-f7' }
  ],
  tasks: [
    squaresTask({
      id: 'opening-knight',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      from: 'g1',
      squares: ['f3', 'h3'],
      prompt: 'Nothing has been played. Show every square the knight on g1 can go to.',
      hints: hints(
        { text: 'The knight is the only piece that can move before any pawn, and your own pawns take some of its squares.', shows: 'theme' },
        { text: 'Two squares, and only one of them does anything useful.', shows: 'target' }
      ),
      tags: ['opening-principles'],
      lesson: 'f3 and h3. f3 looks at the middle; h3 looks at nothing. A knight on the edge is a knight with half its squares.',
      source: authored('Answer read from destinationsFrom.')
    }),
    lineTask({
      id: 'opening-line',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
      reaches: 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
      prompt: 'Play 1.e4 e5 2.Nf3 Nc6 3.Bb5 and see where it leaves White.',
      hints: hints(
        { text: 'Each move does one of the four jobs: a pawn in the middle, a knight out, a bishop out.', shows: 'theme' },
        { text: 'After three moves White can castle next move.', shows: 'target' }
      ),
      tags: ['opening-principles'],
      lesson: 'Three moves, two pieces developed, a pawn in the middle, and castling available. This has a name -- the Spanish -- and you did not have to know it.',
      source: authored('Final position computed by playing the line.'),
      kind: 'lesson-task'
    }),
    mateTask({
      id: 'opening-f7',
      fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
      moves: 1,
      solution: { lines: [{ move: 'h5f7', why: 'The queen takes on f7 defended by the bishop on c4, and the king has nowhere to go.' }] },
      prompt: 'Black has just developed a knight. White to play: mate in one.',
      hints: hints(
        { text: 'Two white pieces are aiming at the same square next to the black king.', shows: 'theme' },
        { text: 'f7. Who is defending it, and who is attacking it?', shows: 'square' },
        { text: 'Qxf7 is mate.', shows: 'move' }
      ),
      tags: ['opening-principles', 'checkmate'],
      lesson: 'This is the scholar’s mate, and the defence is simple: cover f7 with a knight on h6 or a pawn on g6, and develop so there is something to put in the way.',
      source: generated('Tree from an exhaustive mate search on a real opening position.')
    })
  ],
  assessment: { id: 'opening-check', title: 'Opening ideas', taskIds: ['opening-knight', 'opening-f7'], needs: 2, countHinted: false }
}

// ---------------------------------------------------------------- module 4: tactics

const theFork: AcademyLesson = {
  id: 'fork',
  title: 'The fork',
  intro: 'One piece attacking two things at once. The other side can only save one of them, and a knight does it better than anything else because nothing it attacks can attack it back.',
  objectives: [
    'Find a knight fork that wins material',
    'Look for forks where a check comes with the fork'
  ],
  requires: ['captures'],
  concepts: ['fork'],
  minutes: 12,
  difficulty: 'intermediate',
  blocks: [
    { kind: 'text', text: 'The forks that win are the ones that come with a check, because then the other side has no choice about which piece to save. Look for squares a knight can reach that touch both the king and something valuable.' },
    { kind: 'task', taskId: 'fork-knight' }
  ],
  tasks: [
    materialTask({
      id: 'fork-knight',
      fen: '3q3k/6p1/3N4/8/8/8/8/6K1 w - - 0 1',
      centipawns: 900,
      solution: {
        lines: [
          {
            move: 'd6f7',
            why: 'Check, and the queen on d8 is attacked by the same knight.',
            children: [
              { move: 'h8g8', children: [{ move: 'f7d8', why: 'The queen comes off and nothing can take the knight.' }] },
              { move: 'h8h7', children: [{ move: 'f7d8' }] }
            ]
          }
        ]
      },
      prompt: 'White to play. Win the queen.',
      hints: hints(
        { text: 'Find a square where the knight touches the king and the queen at the same time.', shows: 'theme' },
        { text: 'The knight on d6 can reach it in one move, and the move is a check.', shows: 'piece' },
        { text: 'Nf7+, and then Nxd8.', shows: 'move' }
      ),
      tags: ['fork', 'knight'],
      lesson: 'Nf7+ hits the king and the queen. The king has to move, and the queen is lost. A fork with a check is not a choice -- it is a collection.',
      source: built('Every legal defence enumerated, each answered by a capture that keeps the material after the recapture check.')
    })
  ],
  assessment: { id: 'fork-check', title: 'Forks', taskIds: [], needs: 1, countHinted: false }
}

const thePin: AcademyLesson = {
  id: 'pin',
  title: 'The pin',
  intro: 'A piece in front of something more valuable on the same line cannot move. If the king is behind it, it cannot move at all -- not as a choice, but as a rule.',
  objectives: [
    'See that a pinned piece has no legal moves',
    'Win a pinned piece by attacking it again'
  ],
  requires: ['captures'],
  concepts: ['pin'],
  minutes: 14,
  difficulty: 'intermediate',
  blocks: [
    { kind: 'text', text: 'A pin against the king is absolute: moving the pinned piece would leave your own king in check, so the board will not let you. A pin against anything else is a choice, and usually a bad one.' },
    { kind: 'task', taskId: 'pin-cannot-move' },
    { kind: 'callout', tone: 'tip', text: 'A pinned piece cannot run away, so the way to win it is simply to attack it again -- with a pawn if possible, because a pawn is the cheapest attacker there is.' },
    { kind: 'task', taskId: 'pin-attack-again' }
  ],
  tasks: [
    squaresTask({
      id: 'pin-cannot-move',
      fen: '4k3/8/8/4n3/8/8/8/4RK2 b - - 0 1',
      from: 'e5',
      squares: [],
      prompt: 'Black to move. Show every square the knight on e5 can go to.',
      hints: hints(
        { text: 'Look down the e-file: the rook, the knight, and the king, all in a line.', shows: 'theme' },
        { text: 'Any knight move would leave the black king in check, which is not allowed.', shows: 'target' }
      ),
      tags: ['pin'],
      lesson: 'No squares at all. The knight is pinned against its own king, and a pinned piece is not a defender -- it only looks like one.',
      source: authored('Answer read from destinationsFrom, which only ever returns legal moves.')
    }),
    materialTask({
      id: 'pin-attack-again',
      fen: '4k3/8/8/4n3/8/5P2/8/4RK2 w - - 0 1',
      centipawns: 300,
      solution: {
        lines: [
          {
            move: 'f3f4',
            why: 'The pawn attacks the knight, and the knight cannot move because it is pinned.',
            children: [
              { move: 'e8f8', children: [{ move: 'f4e5', why: 'A whole knight for a pawn move.' }] },
              { move: 'e8f7', children: [{ move: 'f4e5' }] },
              { move: 'e8e7', children: [{ move: 'f4e5' }] },
              { move: 'e8d7', children: [{ move: 'f4e5' }] },
              { move: 'e8d8', children: [{ move: 'f4e5' }] }
            ]
          }
        ]
      },
      prompt: 'White to play. Win the knight.',
      hints: hints(
        { text: 'Rxe5 wins a knight for a rook, which is not winning anything. The knight is pinned -- it is not going anywhere.', shows: 'theme' },
        { text: 'Attack it with the cheapest piece you have.', shows: 'piece' },
        { text: 'f4, and the knight falls next move whatever Black does.', shows: 'move' }
      ),
      tags: ['pin'],
      lesson: 'f4 wins the knight because the pin means it cannot run. Taking it with the rook first would have been a trade, not a win.',
      source: built('All five legal defences enumerated, each answered by fxe5.')
    })
  ],
  assessment: { id: 'pin-check', title: 'Pins', taskIds: [], needs: 2, countHinted: false }
}

const theSkewer: AcademyLesson = {
  id: 'skewer',
  title: 'The skewer',
  intro: 'A pin with the pieces the other way round: the valuable piece is in front and has to move, and what was hiding behind it is taken.',
  objectives: [
    'Win a queen with a skewer',
    'Tell a skewer from a pin'
  ],
  requires: ['pin'],
  concepts: ['skewer'],
  minutes: 12,
  difficulty: 'intermediate',
  blocks: [
    { kind: 'text', text: 'Give check on a line that has something valuable further along it. The king must get out of the way, and then you take what was behind it. A pin holds a piece still; a skewer makes it move.' },
    { kind: 'task', taskId: 'skewer-queen' }
  ],
  tasks: [
    materialTask({
      id: 'skewer-queen',
      fen: '7q/8/8/8/1B1k4/8/1P6/K7 w - - 0 1',
      centipawns: 900,
      solution: {
        lines: [
          {
            move: 'b4c3',
            why: 'Check on the long diagonal, with the queen on h8 sitting at the far end of it. The pawn on b2 defends the bishop.',
            children: [
              { move: 'd4c4', children: [{ move: 'c3h8', why: 'The queen comes off.' }] },
              { move: 'd4c5', children: [{ move: 'c3h8' }] },
              { move: 'd4d5', children: [{ move: 'c3h8' }] },
              { move: 'd4d3', children: [{ move: 'c3h8' }] },
              { move: 'd4e3', children: [{ move: 'c3h8' }] },
              { move: 'd4e4', children: [{ move: 'c3h8' }] }
            ]
          }
        ]
      },
      prompt: 'White to play. Win the queen.',
      hints: hints(
        { text: 'The king on d4 and the queen on h8 are on the same diagonal.', shows: 'theme' },
        { text: 'The bishop can step onto that diagonal with check, and the pawn on b2 means the king cannot take it.', shows: 'piece' },
        { text: 'Bc3+, and after the king moves, Bxh8.', shows: 'move' }
      ),
      tags: ['skewer', 'bishop'],
      lesson: 'Bc3+ is a check the king cannot answer by taking, because the pawn on b2 defends the bishop. Wherever the king goes, the diagonal to h8 is open.',
      source: built('All six legal king moves enumerated, each answered by Bxh8.')
    })
  ],
  assessment: { id: 'skewer-check', title: 'Skewers', taskIds: [], needs: 1, countHinted: false }
}

const discoveredAttack: AcademyLesson = {
  id: 'discovered-attack',
  title: 'The discovered attack',
  intro: 'Two of your pieces on one line, one in front of the other. Move the front one and the back one is suddenly attacking something.',
  objectives: [
    'Open a line by moving the piece in front of it',
    'Make the discovering move a check so the other side has no time'
  ],
  requires: ['pin'],
  concepts: ['discovered-attack'],
  minutes: 12,
  difficulty: 'intermediate',
  blocks: [
    { kind: 'text', text: 'The piece that moves can go anywhere; what matters is what it uncovers. If it leaves with a check, or takes something on the way, the other side does not get a move to deal with the thing behind it.' },
    { kind: 'task', taskId: 'discovered-queen' }
  ],
  tasks: [
    materialTask({
      id: 'discovered-queen',
      fen: '3q3k/6p1/8/8/3B4/8/8/3R2K1 w - - 0 1',
      centipawns: 700,
      solution: {
        lines: [
          {
            move: 'd4g7',
            why: 'The bishop leaves the d-file with check, and the rook on d1 is now looking straight at the queen.',
            children: [
              { move: 'h8g7', children: [{ move: 'd1d8', why: 'A queen for a bishop.' }] },
              { move: 'h8h7', children: [{ move: 'd1d8' }] },
              { move: 'h8g8', children: [{ move: 'd1d8' }] }
            ]
          }
        ]
      },
      prompt: 'White to play. Win the queen.',
      hints: hints(
        { text: 'The rook on d1, the bishop on d4 and the black queen on d8 are all on the same file.', shows: 'theme' },
        { text: 'The bishop needs to leave with check, and there is a pawn on g7 to take on the way.', shows: 'piece' },
        { text: 'Bxg7+, and then Rxd8.', shows: 'move' }
      ),
      tags: ['discovered-attack'],
      lesson: 'Bxg7+ takes a pawn, gives check, and opens the d-file. Black has to answer the check, and then the queen goes. The check is what makes it work.',
      source: built('All three legal defences enumerated, each answered by Rxd8.')
    })
  ],
  assessment: { id: 'discovered-check', title: 'Discovered attacks', taskIds: [], needs: 1, countHinted: false }
}

const removingTheDefender: AcademyLesson = {
  id: 'removing-the-defender',
  title: 'Removing the defender',
  intro: 'Something is held up by one piece. Take that piece, and everything it was holding is loose.',
  objectives: [
    'Spot the one piece that is defending everything',
    'Take it, and count what happens next'
  ],
  requires: ['captures'],
  concepts: ['removing-the-defender'],
  minutes: 12,
  difficulty: 'intermediate',
  blocks: [
    { kind: 'text', text: 'Before you take something that is defended, ask what is defending it -- and whether that piece can be taken first. Half of all tactics are this: one defender doing two jobs.' },
    { kind: 'task', taskId: 'remove-defender' },
    { kind: 'moves', fen: '6k1/8/5n2/3r2B1/8/8/8/3RK3 w - - 0 1', moves: ['Bxf6', 'Rd8', 'Rxd8+', 'Kf7'], caption: 'If the rook stays anywhere on the d-file, it goes too.' }
  ],
  tasks: [
    materialTask({
      id: 'remove-defender',
      fen: '6k1/8/5n2/3r2B1/8/8/8/3RK3 w - - 0 1',
      centipawns: 300,
      solution: { lines: [{ move: 'g5f6', why: 'The knight was the only thing defending the rook on d5, and nothing defends the knight.' }] },
      prompt: 'White to play. Win a piece.',
      hints: hints(
        { text: 'Rxd5 would be a trade. Why is the rook on d5 safe at the moment?', shows: 'theme' },
        { text: 'The knight on f6 defends d5, and nothing defends the knight.', shows: 'piece' },
        { text: 'Bxf6.', shows: 'move' }
      ),
      tags: ['removing-the-defender'],
      lesson: 'Bxf6 wins a knight outright, and if the rook stays on the d-file it is lost as well. Rxd1 in reply does not help Black: the king on e1 takes back.',
      source: built('Terminal gain and the two-ply recapture both checked by validateExercise.')
    })
  ],
  assessment: { id: 'remove-defender-check', title: 'Removing defenders', taskIds: [], needs: 1, countHinted: false }
}

// ---------------------------------------------------------------- module 5: endgames

const kingAndPawn: AcademyLesson = {
  id: 'king-and-pawn',
  title: 'King and pawn: the square, and the opposition',
  intro: 'Two things worth being able to work out rather than guess: whether a king can catch a running pawn, and what happens when two kings face each other.',
  objectives: [
    'Count the square of the pawn instead of guessing',
    'Take the last pawn and claim the draw',
    'Say what the opposition is'
  ],
  requires: ['promotion'],
  concepts: ['square-of-the-pawn', 'opposition'],
  minutes: 15,
  difficulty: 'intermediate',
  blocks: [
    { kind: 'heading', text: 'The square of the pawn' },
    { kind: 'text', text: 'Draw a square with the pawn in one corner, as wide as the pawn is from promoting. If the defending king is inside that square -- or can step into it when it is their move -- the pawn is caught. If not, it promotes. It is counting, not judgement.' },
    { kind: 'task', taskId: 'square-catch' },
    { kind: 'moves', fen: '8/8/5k2/8/7P/8/8/K7 b - - 0 1', moves: ['Kg7', 'h5', 'Kh6', 'Kb1', 'Kxh5'], caption: 'The king is inside the square, so it walks the pawn down and takes it.' },
    { kind: 'heading', text: 'Bare kings' },
    { kind: 'text', text: 'King against king is a draw by the rules themselves, not by agreement: neither side has anything to mate with. Taking the last pawn when you are losing is a result.' },
    { kind: 'task', taskId: 'last-pawn' },
    { kind: 'heading', text: 'The opposition' },
    { kind: 'text', text: 'Two kings facing each other with one square between them. Whoever has to move has to give way, and in king-and-pawn endings that decides the game. It is the reason a waiting move is sometimes the strongest move on the board.' },
    { kind: 'board', fen: '8/8/4k3/8/4K3/8/8/8 w - - 0 1', caption: 'White to move has to step aside; Black to move would have to. The opposition is worth a tempo, and a tempo is worth the game.' }
  ],
  tasks: [
    drawTask({
      id: 'square-catch',
      fen: '8/8/8/8/6kP/8/8/K7 b - - 0 1',
      solution: { lines: [{ move: 'g4h4', why: 'The pawn comes off and two bare kings cannot mate each other.' }] },
      prompt: 'Black to play, a pawn down. Hold the draw.',
      hints: hints(
        { text: 'The pawn is the only thing on the board that can win this game.', shows: 'theme' },
        { text: 'Your king is standing next to it.', shows: 'target' },
        { text: 'Kxh4, and the game is a draw there and then.', shows: 'move' }
      ),
      tags: ['square-of-the-pawn', 'draw'],
      lesson: 'Kxh4 leaves king against king, which the rules call a draw immediately -- nothing left to mate with.',
      source: authored('Outcome after the move confirmed as a draw by insufficient material.')
    }),
    drawTask({
      id: 'last-pawn',
      fen: '8/8/8/4k3/8/4p3/4K3/8 w - - 0 1',
      solution: { lines: [{ move: 'e2e3', why: 'The last pawn comes off and the game is drawn on the spot.' }] },
      prompt: 'White to play, a pawn down. Hold the draw.',
      hints: hints(
        { text: 'There is one thing on the board that could still beat you.', shows: 'theme' },
        { text: 'Take it.', shows: 'target' }
      ),
      tags: ['draw'],
      lesson: 'Kxe3 and it is king against king. Being a pawn down in this position does not matter once the pawn is gone.',
      source: authored('Outcome after the move confirmed as a draw by insufficient material.')
    })
  ],
  assessment: { id: 'king-and-pawn-check', title: 'King and pawn', taskIds: [], needs: 2, countHinted: false }
}

const rookEndings: AcademyLesson = {
  id: 'rook-endings',
  title: 'Rook endings: two ideas with names',
  intro: 'Rook endings are the ones you will get most often. Two ideas carry most of the load, and both have names worth knowing: the Philidor defence and the Lucena bridge.',
  objectives: [
    'Say where a rook belongs against a passed pawn',
    'Play the bridge manoeuvre that stops a stream of checks',
    'Describe Philidor’s third-rank defence'
  ],
  requires: ['promotion', 'mate-with-rook'],
  concepts: ['rook-endgame-ideas'],
  minutes: 18,
  difficulty: 'intermediate',
  blocks: [
    { kind: 'heading', text: 'The rook belongs behind the pawn' },
    { kind: 'text', text: 'Behind a passed pawn, a rook gets more squares as the pawn advances; in front of it, fewer. That is true whether the pawn is yours or theirs, which is why both sides want the same square.' },
    { kind: 'heading', text: 'Philidor: the third rank' },
    { kind: 'text', text: 'Defending a rook ending a pawn down, put your rook on your own third rank. The attacking king cannot cross it. When the pawn advances to the sixth to drive your rook away, the rook goes back to its own first rank and checks from behind for ever, because the king has nowhere to hide from the checks. That is the idea; the position itself is not drawn here, because a diagram claiming to be the Philidor position had better be exactly that.' },
    { kind: 'heading', text: 'Lucena: building a bridge' },
    { kind: 'text', text: 'With a pawn on the seventh and your king in front of it, the problem is that the enemy rook checks your king every time it steps out. The answer is to put your own rook on the fourth rank, walk the king into the checks, and then interpose the rook -- a bridge. Play the manoeuvre through and watch the checks stop.' },
    { kind: 'task', taskId: 'bridge' }
  ],
  tasks: [
    lineTask({
      id: 'bridge',
      fen: '3K4/3P3k/8/8/6R1/8/8/r7 w - - 0 1',
      moves: ['Kc7', 'Rc1+', 'Kb6', 'Rb1+', 'Kc6', 'Rc1+', 'Kb5', 'Rb1+', 'Rb4'],
      reaches: '8/3P3k/8/1K6/1R6/8/8/1r6 b - - 9 5',
      prompt: 'Play the bridge: walk the king out of the way of the pawn, let Black check, and then put the rook in the way.',
      hints: hints(
        { text: 'Start by stepping the king off the promotion square so the pawn can go. Black will check.', shows: 'theme' },
        { text: 'Keep walking towards the checks. The rook on the fourth rank is the whole point.', shows: 'target' },
        { text: 'Kc7 Rc1+ Kb6 Rb1+ Kc6 Rc1+ Kb5 Rb1+ and now Rb4 blocks.', shows: 'move' }
      ),
      tags: ['rook-endgame-ideas'],
      lesson: 'The rook on the fourth rank steps in front of the checks, the king shelters behind it, and the pawn promotes next move. That interposition is the bridge.',
      source: authored('Every move checked legal and the final position computed by playing the line. It is the manoeuvre, not a claim about the best defence.')
    })
  ],
  assessment: { id: 'rook-endings-check', title: 'Rook endings', taskIds: [], needs: 1, countHinted: false }
}

// ---------------------------------------------------------------- the curriculum

export const CHESS_CURRICULUM: Curriculum = {
  id: 'chess-academy-foundation',
  title: 'The Academy: from the rules to the first tactics',
  blurb: 'Seventeen lessons, every position checked by a machine before it was allowed in.',
  version: 1,
  concepts: CHESS_CONCEPTS,
  modules: [
    {
      id: 'the-rules',
      title: 'The rules of the game',
      summary: 'How the pieces move, how they take, and the three rules that catch everybody out.',
      lessons: [howThePiecesMove, takingPieces, checkAndCheckmate, stalemate, castling, enPassant, promotion]
    },
    {
      id: 'basic-mates',
      title: 'Mating with a king and one piece',
      summary: 'The two endings you have to be able to win, and the picture they both end in.',
      lessons: [mateWithTheQueen, mateWithTheRook]
    },
    {
      id: 'the-opening',
      title: 'The opening',
      summary: 'Four things worth doing, and the square that costs beginners the most games.',
      lessons: [openingPrinciples]
    },
    {
      id: 'tactics',
      title: 'Tactics',
      summary: 'The five patterns that win most material: fork, pin, skewer, discovered attack, and taking the defender.',
      lessons: [theFork, thePin, theSkewer, discoveredAttack, removingTheDefender]
    },
    {
      id: 'endgames',
      title: 'Endgames',
      summary: 'Counting instead of guessing, and two rook-ending ideas with names.',
      lessons: [kingAndPawn, rookEndings]
    }
  ]
}

/** Every lesson's block list, for anything that needs to walk the content without the lesson shape. */
export const CURRICULUM_BLOCKS: readonly LessonBlock[] = CHESS_CURRICULUM.modules
  .flatMap((module) => module.lessons)
  .flatMap((lesson) => lesson.blocks)
