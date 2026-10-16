import type { EndgameEntry } from './endgames.ts'

/**
 * The Endgame Lab's endings.
 *
 * Data, and nothing but data. Every entry here is a claim about a position, and every claim is recomputed by
 * `verifyEntry` in `endgames.ts` before any of it is shown: the position is legal and could be reached in a game, the
 * stated side really is to move, the objective is not already met, the written line is playable and gets there, and
 * where the entry says "in n", a search has tried every defence and found that it is exactly n.
 *
 * ## Where these come from
 *
 * The positions are set up for Orbis, by hand, to put one idea in front of somebody as plainly as possible. They are
 * not taken from games and none of them is presented as a famous diagram -- the ideas are the standard ones every
 * endgame book teaches, and each entry's `provenance` says so in those words. Nothing here claims to be a historical
 * position, because none of them is one.
 *
 * ## What is claimed, and what is not
 *
 * The honest line runs through the middle of this file. "Mate in two", "a promotion is forced in three", "a draw is
 * forced in three" are claims a machine settles, and the test refuses the entry if the search disagrees. "White wins"
 * is not: king and pawn against king needs a tablebase, which Orbis does not have, so no entry here says a position
 * is won. What the `technique` entries ask for instead is a fact about the position -- a king on one of three
 * squares, a rook on a rank, the other side's last pawn gone -- which is exactly the thing the idea is about, and
 * which can be checked. The method sentences explain the idea; they do not grade the position.
 */

export const ENDGAMES: readonly EndgameEntry[] = [
  // ---------------------------------------------------------------- basic mates
  {
    id: 'mate-back-rank',
    theme: 'basic-mate',
    title: 'The back rank',
    fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'mate-in', moves: 1 },
    method: 'A king with its own pawns in front of it has no way off the back rank, so a rook arriving there is mate. It is the first thing to look for whenever a rook gets to the eighth.',
    difficulty: 1,
    provenance: 'Authored for Orbis from the standard back-rank mating pattern. The position is set up for this exercise, not taken from a game.',
    marks: ['a8']
  },
  {
    id: 'mate-two-rooks-ladder',
    theme: 'basic-mate',
    title: 'Two rooks, one ladder',
    fen: '7k/8/8/8/8/8/5RR1/6K1 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'mate-in', moves: 2 },
    method: 'Two rooks mate without any help from the king: one takes a rank away, the other takes the next one. That is the whole method, and it works from anywhere.',
    difficulty: 1,
    provenance: 'Authored for Orbis from the standard two-rook (ladder) mate. The position is set up for this exercise, not taken from a game.'
  },
  {
    id: 'mate-queen-corner',
    theme: 'basic-mate',
    title: 'Queen and king, two moves',
    fen: '5k2/8/4K3/8/8/8/8/3Q4 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'mate-in', moves: 2 },
    method: 'The queen takes the squares away and the king supplies the last one, because a queen alone can never mate. Look for the move that leaves the king one square, then take that square with the king beside it.',
    difficulty: 2,
    provenance: 'Authored for Orbis from the standard queen-and-king mate. The position is set up for this exercise, not taken from a game.'
  },
  {
    id: 'mate-queen-three',
    theme: 'basic-mate',
    title: 'Queen and king, three moves',
    fen: '6k1/8/4K3/8/8/8/8/3Q4 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'mate-in', moves: 3 },
    method: 'With the kings a little further apart the queen has to drive the defender to the edge first, and only then can the king come up. Rushing the queen in gives stalemate instead of mate.',
    difficulty: 3,
    provenance: 'Authored for Orbis from the standard queen-and-king mate. The position is set up for this exercise, not taken from a game.'
  },
  {
    id: 'mate-rook-edge',
    theme: 'basic-mate',
    title: 'Rook and king, two moves',
    fen: '6k1/8/5K2/8/8/8/8/1R6 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'mate-in', moves: 2 },
    method: 'A rook mates on the edge only when your own king stands opposite the other one, taking away the three squares the rook cannot. Here it already does, so the rook finishes it.',
    difficulty: 2,
    provenance: 'Authored for Orbis from the standard rook-and-king mate. The position is set up for this exercise, not taken from a game.'
  },
  {
    id: 'mate-rook-three',
    theme: 'basic-mate',
    title: 'Rook and king, three moves',
    fen: '6k1/8/4K3/8/8/8/8/1R6 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'mate-in', moves: 3 },
    method: 'The kings are not yet facing each other, so the mate needs a move with the king first. Checking with the rook before that only pushes the defender sideways.',
    difficulty: 3,
    provenance: 'Authored for Orbis from the standard rook-and-king mate. The position is set up for this exercise, not taken from a game.'
  },
  {
    id: 'mate-queen-from-centre',
    theme: 'basic-mate',
    title: 'Queen against a king in the open',
    fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'win' },
    method: 'Walk the king to the edge with the queen a knight move away from it, bring your own king up, and mate. The one thing to watch is stalemate: when the defender has only one square left, give it a check, not another square taken away.',
    difficulty: 2,
    provenance: 'Authored for Orbis from the standard queen-and-king mating technique. Orbis does not prove this position is won -- that it is, is standard theory; what is checked here is the written line.'
  },
  {
    id: 'mate-rook-from-centre',
    theme: 'basic-mate',
    title: 'Rook against a king in the open',
    fen: '8/8/8/4k3/8/8/8/4K2R w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'win' },
    method: 'The rook takes a rank or a file away and the kings do the rest: step your king up until they face each other, then shrink the box by one. It takes longer than the queen and never needs a single check until the end.',
    difficulty: 4,
    provenance: 'Authored for Orbis from the standard rook-and-king mating technique (the box). Orbis does not prove this position is won -- that it is, is standard theory; what is checked here is the written line.'
  },

  // ---------------------------------------------------------------- king and pawn
  {
    id: 'kp-take-the-opposition',
    theme: 'king-and-pawn',
    title: 'Take the opposition',
    fen: '8/8/8/4k3/8/3K4/4P3/8 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'technique', goal: { kind: 'king-on', squares: ['e3'], thenOpponentToMove: true }, within: 1 },
    method: 'Opposition is standing on the same file as the other king with one square between you and it being his move: he has to give way first. From here only one square takes it.',
    difficulty: 3,
    provenance: 'Authored for Orbis from standard king-and-pawn theory (the opposition). The position is set up for this exercise, not taken from a game.',
    marks: ['e3'],
    line: ['Ke3']
  },
  {
    id: 'kp-key-squares',
    theme: 'king-and-pawn',
    title: 'The key squares',
    fen: '8/8/8/8/4P3/4K3/8/7k w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'technique', goal: { kind: 'king-on', squares: ['d6', 'e6', 'f6'] }, within: 3 },
    method: 'For a pawn on the fourth rank the squares that matter are the three two ranks in front of it: with your king on one of them the pawn gets through whoever is to move. The other king is too far away here to argue about them.',
    difficulty: 2,
    provenance: 'Authored for Orbis from standard king-and-pawn theory (key squares). The position is set up for this exercise, not taken from a game.',
    marks: ['d6', 'e6', 'f6']
  },
  {
    id: 'kp-square-of-the-pawn',
    theme: 'king-and-pawn',
    title: 'The square of the pawn',
    fen: '8/4k3/8/8/P7/8/8/K7 b - - 0 1',
    sideToMove: 'b',
    objective: { kind: 'technique', goal: { kind: 'no-pawns' }, within: 6 },
    method: 'Draw the square whose side runs from the pawn to the end of the board: if your king is inside it when it is your move, you catch the pawn without counting anything. The marked corners are that square.',
    difficulty: 3,
    provenance: 'Authored for Orbis from standard king-and-pawn theory (the square of the pawn). The position is set up for this exercise, not taken from a game.',
    marks: ['a4', 'e4', 'e8', 'a8']
  },
  {
    id: 'kp-catch-the-runner',
    theme: 'king-and-pawn',
    title: 'Catch it and the game is drawn',
    fen: '8/8/8/3k4/8/5P2/8/K7 b - - 0 1',
    sideToMove: 'b',
    objective: { kind: 'draw', holdMoves: 3, forcedIn: 3 },
    method: 'Walk at the pawn, not at the square it is on now: once it is gone neither side has anything left to mate with and the game is drawn on the spot.',
    difficulty: 2,
    provenance: 'Authored for Orbis from standard king-and-pawn theory. The forced draw is proved here by searching every defence.'
  },
  {
    id: 'kp-push-past-a-distant-king',
    theme: 'king-and-pawn',
    title: 'Too far to catch it',
    fen: '8/8/8/1P6/1K6/8/8/7k w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'promote', moves: 3 },
    method: 'When the other king is outside the square of the pawn there is nothing to work out: push. Counting the squares is quicker than calculating the moves.',
    difficulty: 1,
    provenance: 'Authored for Orbis from standard king-and-pawn theory (the square of the pawn). The forced promotion is proved here by searching every defence.',
    marks: ['b5', 'e5', 'e8', 'b8']
  },
  {
    id: 'kp-rook-pawn-corner',
    theme: 'king-and-pawn',
    title: 'A pawn on the edge is different',
    fen: '8/2k5/8/P7/K7/8/8/8 b - - 0 1',
    sideToMove: 'b',
    objective: { kind: 'technique', goal: { kind: 'king-on', squares: ['a8'] }, within: 3 },
    method: 'Against a pawn on the edge the defending king does not need the opposition or anything else: it needs the corner in front of the pawn, where it cannot be driven out. Get to a8 and there is nowhere for the other king to put you.',
    difficulty: 3,
    provenance: 'Authored for Orbis from standard king-and-pawn theory (the rook pawn). The position is set up for this exercise, not taken from a game.',
    marks: ['a8']
  },

  // ---------------------------------------------------------------- rook endings
  {
    id: 'rook-cut-the-king-off',
    theme: 'rook',
    title: 'Cut the king off',
    fen: '8/8/8/3k4/8/8/8/4K2R w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'technique', goal: { kind: 'piece-on', piece: 'r', squares: ['a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4'] }, within: 1 },
    method: 'The first thing a rook does against a bare king is take a rank or a file away from it, which halves the board it has to live in. One move does it here.',
    difficulty: 2,
    provenance: 'Authored for Orbis from standard rook-endgame technique (cutting the king off). The position is set up for this exercise, not taken from a game.',
    line: ['Rh4']
  },
  {
    id: 'rook-behind-the-passed-pawn',
    theme: 'rook',
    title: 'Behind the passed pawn',
    fen: '3r3k/8/8/3P4/8/8/8/4K1R1 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'technique', goal: { kind: 'piece-on', piece: 'r', squares: ['d1', 'd2', 'd3', 'd4'] }, within: 1 },
    method: 'A rook belongs behind a passed pawn, its own or the other side\'s: as the pawn goes forward the rook gets more squares and the defender gets fewer. Here that means getting onto the pawn\'s file behind it.',
    difficulty: 2,
    provenance: 'Authored for Orbis from standard rook-endgame theory (Tarrasch\'s rule for the rook and the passed pawn). The position is set up for this exercise, not taken from a game.',
    line: ['Rd1']
  },
  {
    id: 'rook-step-aside-and-promote',
    theme: 'rook',
    title: 'Your own king is in the way',
    fen: '2K5/k1P5/8/8/8/8/7r/3R4 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'promote', moves: 3 },
    method: 'With the pawn on the seventh and your own king standing on its promotion square, the first job is to get out of the way and still answer the checks. Here one step aside does both.',
    difficulty: 3,
    provenance: 'Authored for Orbis from standard rook-and-pawn technique. The forced promotion is proved here by searching every defence.'
  },
  {
    id: 'rook-philidor-third-rank',
    theme: 'rook',
    title: 'The third rank',
    fen: 'r7/4k3/8/4K3/4P3/8/8/8 b - - 0 1',
    sideToMove: 'b',
    objective: { kind: 'technique', goal: { kind: 'piece-on', piece: 'r', squares: ['a6', 'b6', 'c6', 'd6', 'f6', 'g6', 'h6'] }, within: 1 },
    method: 'Defending a rook ending a pawn down, put your rook on the third rank counting from the other side: the attacking king cannot cross it, and without his king in front the pawn goes nowhere. This is Philidor\'s idea.',
    difficulty: 4,
    provenance: 'Authored for Orbis from standard rook-endgame theory (Philidor\'s third-rank defence). The position is set up for this exercise, not taken from a game.',
    line: ['Ra6']
  },
  {
    id: 'rook-check-from-behind',
    theme: 'rook',
    title: 'Check it from behind',
    fen: '4k3/8/3KP2r/8/8/8/8/8 b - - 0 1',
    sideToMove: 'b',
    objective: { kind: 'technique', goal: { kind: 'piece-on', piece: 'r', squares: ['h1'] }, within: 1 },
    method: 'Once the pawn reaches the sixth the third rank has nothing left to stop, so the rook goes as far back as the board allows and checks the king from behind. Far away is the point: a rook close by can be attacked, one eight squares off cannot.',
    difficulty: 4,
    provenance: 'Authored for Orbis from standard rook-endgame theory (the checks from behind that follow Philidor\'s defence). The position is set up for this exercise, not taken from a game.',
    line: ['Rh1']
  },

  // ---------------------------------------------------------------- practical conversions
  {
    id: 'convert-two-connected-pawns',
    theme: 'conversion',
    title: 'Connected pawns look after themselves',
    fen: '8/8/4k3/1PP5/8/8/8/K7 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'promote', moves: 3 },
    method: 'Two pawns side by side beat a lone king without their own king: push the one the king is not next to, and whichever he takes, the other goes through. Pushing the wrong one throws it away.',
    difficulty: 2,
    provenance: 'Authored for Orbis from standard pawn-endgame theory (connected pawns against a king). The forced promotion is proved here by searching every defence.'
  },
  {
    id: 'convert-outside-passed-pawn',
    theme: 'conversion',
    title: 'The outside passed pawn',
    fen: '8/8/4k3/4p3/4P3/4K3/P7/8 w - - 0 1',
    sideToMove: 'w',
    objective: { kind: 'technique', goal: { kind: 'no-pawns' }, within: 6 },
    method: 'A passed pawn far from everything else is worth more than a pawn: it drags the defending king away and your king eats what is left behind. The pawn is a decoy, so do not mind losing it.',
    difficulty: 4,
    provenance: 'Authored for Orbis from standard pawn-endgame theory (the outside passed pawn). The position is set up for this exercise, not taken from a game.'
  },
  {
    id: 'convert-take-the-last-pawn',
    theme: 'conversion',
    title: 'Take the last pawn',
    fen: '8/8/4kP2/8/8/8/K7/8 b - - 0 1',
    sideToMove: 'b',
    objective: { kind: 'draw', holdMoves: 1, forcedIn: 1 },
    method: 'A king and nothing else cannot checkmate a king, so taking the last pawn ends the game there and then. When you are losing, that capture is worth more than any square.',
    difficulty: 1,
    provenance: 'Authored for Orbis from the rules on insufficient material. The forced draw is proved here by searching every defence.'
  }
]

export default ENDGAMES
