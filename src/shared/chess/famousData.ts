import type { FamousGame } from './famous.ts'

/**
 * The Famous Games collection: fifteen games that were really played.
 *
 * ## What is in here and what is not
 *
 * Moves, and Orbis's own words. Nothing else. Every move below was typed in as data and every move is replayed
 * through `rules.ts` by `famous.test.ts`, which will not pass if a single one of them is illegal, written wrongly,
 * or inconsistent with how the game is said to have ended.
 *
 * No annotation has been copied from anywhere. Everything in a `note`, an `ask` or an `afterward` was written for
 * Orbis, which is why none of it reads like a chess book: it describes what happens on the board and says when it
 * is only an opinion. If somebody later wants to add a game, the rule is the same -- the moves are a fact and may be
 * typed in; the prose has to be written, not pasted.
 *
 * ## Why the collection is small
 *
 * Because a large one could not be honest. A thousand-game collection comes from somewhere, and "somewhere" is
 * normally a database that somebody compiled and may have rights in. Fifteen games whose moves are published in a
 * hundred places, typed in by hand and machine-checked, is a thing Orbis can stand behind.
 *
 * ## `unstated` is the important field
 *
 * It is where Orbis says what it does **not** know: a round it is not sure of, an occasion that is disputed, a first
 * name that is not recorded here. Everything in it is a blank that somebody could easily have filled in with a
 * plausible guess, and did not.
 */

export const FAMOUS_GAMES: readonly FamousGame[] = Object.freeze([
  {
    id: 'immortal-1851',
    nickname: 'The Immortal Game',
    white: { name: 'Adolf Anderssen' },
    black: { name: 'Lionel Kieseritzky' },
    result: '1-0',
    site: 'London',
    year: 1851,
    ending: 'checkmate',
    themes: ['piece-sacrifice', 'queen-sacrifice', 'mating-attack'],
    note:
      'White gives away a bishop, both rooks and finally the queen, and mates with two knights and a bishop. ' +
      'Black’s rooks never move from their starting squares, and the black queen ends the game on a1, where she ' +
      'had gone to collect a pawn and a rook. Orbis’s reason for keeping it first: every one of those offers has a concrete ' +
      'follow-up, and the game is a better lesson stepped through slowly than admired quickly.',
    unstated: [
      'No event or round is recorded here. The game is widely described as a casual game rather than part of a tournament, and Orbis does not state more than that.',
      'The date within 1851.'
    ],
    san: [
      'e4', 'e5', 'f4', 'exf4', 'Bc4', 'Qh4+', 'Kf1', 'b5', 'Bxb5', 'Nf6',
      'Nf3', 'Qh6', 'd3', 'Nh5', 'Nh4', 'Qg5', 'Nf5', 'c6', 'g4', 'Nf6',
      'Rg1', 'cxb5', 'h4', 'Qg6', 'h5', 'Qg5', 'Qf3', 'Ng8', 'Bxf4', 'Qf6',
      'Nc3', 'Bc5', 'Nd5', 'Qxb2', 'Bd6', 'Bxg1', 'e5', 'Qxa1+', 'Ke2', 'Na6',
      'Nxg7+', 'Kd8', 'Qf6+', 'Nxf6', 'Be7#'
    ],
    guided: [
      {
        ply: 21,
        ask: 'White’s bishop is attacked and cannot easily be saved. White played a move that does not save it, and prepares something on the other wing. Which piece moved?',
        afterward: 'The rook steps up beside the king instead of rescuing the bishop. Black takes the bishop next move, and White never gets it back — the point is the open file the rook now sits on.'
      },
      {
        ply: 35,
        ask: 'White has just lost a pawn on b2 and the rook in the corner is hanging. The move played ignores both. Which piece moved, and to where?',
        afterward: 'The bishop steps into the middle of Black’s position and guards nothing of White’s. Black takes one rook on the next move and the other two moves later; White never defends either of them.'
      },
      {
        ply: 43,
        ask: 'White gives check with a piece that can be taken. Which piece, and where does it go?',
        afterward: 'The queen is offered where the knight must take her. Once the knight is pulled off its square, the bishop mate is unstoppable.'
      },
      {
        ply: 45,
        ask: 'One move finishes it. Find the mate.',
        afterward: 'A bishop, with Black a queen and two rooks to the good. Orbis’s view: this is the picture people remember, and it only means anything once you have checked that nothing can take the bishop.'
      }
    ]
  },
  {
    id: 'evergreen-1852',
    nickname: 'The Evergreen Game',
    white: { name: 'Adolf Anderssen' },
    black: { name: 'Jean Dufresne' },
    result: '1-0',
    site: 'Berlin',
    year: 1852,
    ending: 'checkmate',
    themes: ['queen-sacrifice', 'quiet-move', 'mating-attack'],
    note:
      'White brings a rook into the centre on move 19 and leaves a knight to be taken; Black takes it. After that the finish is ' +
      'forced — a rook check, the queen handed over with check, and two bishops walking the black king into mate while ' +
      'the black queen sits on f3 with nothing to do. The rook move is the move worth stopping at: it attacks nothing.',
    unstated: [
      'No event or round is recorded here. The game is widely described as a casual game played in Berlin.',
      'The date within 1852.'
    ],
    san: [
      'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5',
      'd4', 'exd4', 'O-O', 'd3', 'Qb3', 'Qf6', 'e5', 'Qg6', 'Re1', 'Nge7',
      'Ba3', 'b5', 'Qxb5', 'Rb8', 'Qa4', 'Bb6', 'Nbd2', 'Bb7', 'Ne4', 'Qf5',
      'Bxd3', 'Qh5', 'Nf6+', 'gxf6', 'exf6', 'Rg8', 'Rad1', 'Qxf3', 'Rxe7+', 'Nxe7',
      'Qxd7+', 'Kxd7', 'Bf5+', 'Ke8', 'Bd7+', 'Kf8', 'Bxe7#'
    ],
    guided: [
      {
        ply: 37,
        ask: 'White has a knight on f3 that Black is threatening to take, and a pawn on f6 cutting the black king off. The move played does not defend the knight. Which rook moved, and where?',
        afterward: 'The rook comes to the centre file and attacks nothing at all. Black takes the knight; everything after that is check, check, check.'
      },
      {
        ply: 41,
        ask: 'White is about to hand over the biggest piece on the board. What is the move?',
        afterward: 'The queen goes where the king has to take her. The black king is then pulled onto a square where two bishops can reach it, which is the whole idea.'
      },
      {
        ply: 47,
        ask: 'One move finishes it. Find the mate.',
        afterward: 'A bishop takes the knight and mates. Orbis’s view: the striking thing is not the queen offer but how little material White needs at the end — two bishops and a pawn.'
      }
    ]
  },
  {
    id: 'paulsen-morphy-1857',
    white: { name: 'Louis Paulsen' },
    black: { name: 'Paul Morphy' },
    result: '0-1',
    event: 'First American Chess Congress',
    site: 'New York',
    year: 1857,
    ending: 'checkmate',
    themes: ['queen-sacrifice', 'counter-attack', 'mating-attack'],
    note:
      'Black gives up the queen for a bishop on move 17, and from then on a rook, a bishop and the second rook do all ' +
      'the work: the white queen is away on the far side of the board collecting a pawn and comes back too late to ' +
      'help. The mate is in the corner, with Black a bishop and two rooks against a queen the whole way.',
    unstated: [
      'Which game of the congress this was, and the round.',
      'The date within 1857.'
    ],
    san: [
      'e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6', 'Bb5', 'Bc5', 'O-O', 'O-O',
      'Nxe5', 'Re8', 'Nxc6', 'dxc6', 'Bc4', 'b5', 'Be2', 'Nxe4', 'Nxe4', 'Rxe4',
      'Bf3', 'Re6', 'c3', 'Qd3', 'b4', 'Bb6', 'a4', 'bxa4', 'Qxa4', 'Bd7',
      'Ra2', 'Rae8', 'Qa6', 'Qxf3', 'gxf3', 'Rg6+', 'Kh1', 'Bh3', 'Rd1', 'Bg2+',
      'Kg1', 'Bxf3+', 'Kf1', 'Rg2', 'Qd3', 'Rxf2+', 'Kg1', 'Rg2+', 'Kh1', 'Rg1#'
    ],
    guided: [
      {
        ply: 34,
        ask: 'Black is about to give up the queen for a bishop. Which bishop, and on which square?',
        afterward: 'The queen takes the bishop on the third rank and White has to recapture with a pawn, which opens the file in front of his own king. That file is how Black gets in.'
      },
      {
        ply: 40,
        ask: 'Black has a bishop on h3 and a rook on g6, and the white king is in the corner. The move played puts a piece where it can be taken. Which piece, and where?',
        afterward: 'The bishop steps right next to the king, where the king must take it or move. Either way Black keeps checking.'
      },
      {
        ply: 50,
        ask: 'One move finishes it. Find the mate.',
        afterward: 'A rook drops into the corner. Orbis’s view: nothing in the last fifteen moves needed calculating deeply — what needed calculating was the queen offer, sixteen moves earlier.'
      }
    ]
  },
  {
    id: 'opera-1858',
    nickname: 'The Opera Game',
    white: { name: 'Paul Morphy' },
    black: { name: 'Duke of Brunswick and Count Isouard' },
    result: '1-0',
    site: 'Paris',
    year: 1858,
    ending: 'checkmate',
    themes: ['piece-sacrifice', 'queen-sacrifice', 'mating-attack'],
    note:
      'Seventeen moves. White gives up a knight on move 10 so that a bishop can come in with check and the black ' +
      'knight that lands on d7 ends up pinned; he castles on the queen’s side and then feeds a rook and the queen ' +
      'into the position one after the other, so that the last rook mates on the back rank. Black’s bishop on f8 and rook on h8 never move at all. Orbis keeps this one for people who are new to ' +
      'the game: it is the shortest thing in the collection and the easiest to follow end to end.',
    unstated: [
      'No event or round is recorded here. The game is widely described as a casual game played in Paris while an opera was on.',
      'Which of the two opponents chose which move.',
      'The date within 1858.'
    ],
    san: [
      'e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5',
      'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5', 'cxb5',
      'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7',
      'Qb8+', 'Nxb8', 'Rd8#'
    ],
    guided: [
      {
        ply: 19,
        ask: 'Black has just pushed a pawn two squares to attack the bishop on c4. White did not move the bishop. What did he play?',
        afterward: 'The knight takes the pawn. Black wins it back at once, and for the knight White gets two pawns, a check, and the file his rooks use for the rest of the game.'
      },
      {
        ply: 31,
        ask: 'White has a rook on d1 and Black has a knight on d7 that holds everything together. White played a check that gives up the queen. What is it?',
        afterward: 'The queen is offered where the knight in the corner has to take her, which pulls that knight away from d7. One rook move then mates.'
      },
      {
        ply: 33,
        ask: 'One move finishes it. Find the mate.',
        afterward: 'The rook drops onto d8. Orbis’s view: the reason this game is taught so often is that every move White makes after castling is the only move that keeps the attack going.'
      }
    ]
  },
  {
    id: 'zukertort-blackburne-1883',
    white: { name: 'Johannes Zukertort' },
    black: { name: 'Joseph Henry Blackburne' },
    result: '1-0',
    event: 'London 1883',
    site: 'London',
    year: 1883,
    ending: 'resignation',
    themes: ['piece-sacrifice', 'positional-squeeze', 'mating-attack'],
    note:
      'Twenty quiet moves and then everything at once. A pawn takes en passant on move 22, which is the only en ' +
      'passant capture in this collection, the centre opens, and on move 28 the white queen goes all the way across ' +
      'to the far wing — a move that attacks nothing on the square it lands on. Black resigned five moves later, ' +
      'having just lost the queen, with a bishop sitting next to his king.',
    unstated: [
      'The round, and the date within 1883.'
    ],
    san: [
      'c4', 'e6', 'e3', 'Nf6', 'Nf3', 'b6', 'Be2', 'Bb7', 'O-O', 'd5',
      'd4', 'Bd6', 'Nc3', 'O-O', 'b3', 'Nbd7', 'Bb2', 'Qe7', 'Nb5', 'Ne4',
      'Nxd6', 'cxd6', 'Nd2', 'Ndf6', 'f3', 'Nxd2', 'Qxd2', 'dxc4', 'Bxc4', 'd5',
      'Bd3', 'Rfc8', 'Rae1', 'Rc7', 'e4', 'Rac8', 'e5', 'Ne8', 'f4', 'g6',
      'Re3', 'f5', 'exf6', 'Nxf6', 'f5', 'Ne4', 'Bxe4', 'dxe4', 'fxg6', 'Rc2',
      'gxh7+', 'Kh8', 'd5+', 'e5', 'Qb4', 'R8c5', 'Rf8+', 'Kxh7', 'Qxe4+', 'Kg7',
      'Bxe5+', 'Kxf8', 'Bg7+', 'Kg8', 'Qxe7'
    ],
    guided: [
      {
        ply: 43,
        ask: 'Black has just pushed a pawn two squares past White’s pawn on e5. White has a capture available for one move only. What is it?',
        afterward: 'En passant: the pawn takes as though the black pawn had only moved one square. It is the single en passant capture in this collection, and it is easy to miss when stepping through the game.'
      },
      {
        ply: 55,
        ask: 'White has a pawn on h7, a rook on f1 and a bishop on b2, and it is time for the queen to join in. Where did she go?',
        afterward: 'Right across to the far side, where she attacks nothing directly. She is now on the same long diagonal line of attack as the bishop, and Black cannot deal with both.'
      },
      {
        ply: 57,
        ask: 'White gives check with a rook on a square where the king can take it. Which square?',
        afterward: 'The rook goes to the eighth rank beside the king. Black took it — and that is the move that lets the queen in with check, after which the two bishops finish the job.'
      }
    ]
  },
  {
    id: 'lasker-bauer-1889',
    white: { name: 'Emanuel Lasker' },
    black: { name: 'Johann Hermann Bauer' },
    result: '1-0',
    site: 'Amsterdam',
    year: 1889,
    ending: 'resignation',
    themes: ['piece-sacrifice', 'king-hunt'],
    note:
      'The game people mean by "the two bishops". White gives up a bishop on h7 and, two moves later, the other one ' +
      'on g7, which takes every pawn away from in front of the black king. The queen and a rook then come down the ' +
      'open file, and on move 22 the queen steps quietly back down the board, which wins the bishop on b7 the move after. ' +
      'White has the piece back and a better position; the last fifteen moves are White turning that into a win.',
    unstated: [
      'No event or round is recorded here.',
      'The date within 1889.'
    ],
    san: [
      'f4', 'd5', 'e3', 'Nf6', 'b3', 'e6', 'Bb2', 'Be7', 'Bd3', 'b6',
      'Nf3', 'Bb7', 'Nc3', 'Nbd7', 'O-O', 'O-O', 'Ne2', 'c5', 'Ng3', 'Qc7',
      'Ne5', 'Nxe5', 'Bxe5', 'Qc6', 'Qe2', 'a6', 'Nh5', 'Nxh5', 'Bxh7+', 'Kxh7',
      'Qxh5+', 'Kg8', 'Bxg7', 'Kxg7', 'Qg4+', 'Kh7', 'Rf3', 'e5', 'Rh3+', 'Qh6',
      'Rxh6+', 'Kxh6', 'Qd7', 'Bf6', 'Qxb7', 'Kg7', 'Rf1', 'Rab8', 'Qd7', 'Rfd8',
      'Qg4+', 'Kf8', 'fxe5', 'Bg7', 'e6', 'Rb7', 'Qg6', 'f6', 'Rxf6+', 'Bxf6',
      'Qxf6+', 'Ke8', 'Qh8+', 'Ke7', 'Qg7+', 'Kxe6', 'Qxb7', 'Rd6', 'Qxa6', 'd4',
      'exd4', 'cxd4', 'h4', 'd3', 'Qxd3'
    ],
    guided: [
      {
        ply: 29,
        ask: 'White has a queen on e2, a bishop on d3 and a bishop on e5, and Black has just taken a knight. White started a combination with a capture that gives up a bishop. Which square?',
        afterward: 'The bishop takes the pawn beside the black king, and the king has to take it. One pawn gone from the king’s cover, one bishop given up.'
      },
      {
        ply: 33,
        ask: 'The black king is back on g8, and White has a queen on h5 and a bishop still on e5. White gave up the second bishop. Which capture?',
        afterward: 'The other bishop takes the other pawn. The king has to take again, and now there are no pawns at all in front of him — which is what the queen and rook needed.'
      },
      {
        ply: 43,
        ask: 'White has just given a rook for the queen on h6, and the black king is in the open on h6. White’s next move does not give check. Where did the queen go?',
        afterward: 'The queen steps back and attacks the bishop on b7 along the rank. It is the move the whole combination was for: White ends up a piece ahead, not just with a bare king to shout at.'
      }
    ]
  },
  {
    id: 'steinitz-bardeleben-1895',
    white: { name: 'Wilhelm Steinitz' },
    black: { name: 'Curt von Bardeleben' },
    result: '1-0',
    event: 'Hastings 1895',
    site: 'Hastings',
    year: 1895,
    ending: 'score-ends-here',
    themes: ['piece-sacrifice', 'mating-attack'],
    note:
      'White puts a rook on the seventh rank on move 22 and then simply walks it along the rank ' +
      'giving check, and it can never be taken. Orbis’s suggestion: do not take anybody’s word for that — ' +
      'at each check, try the captures on the board and see what happens to Black. That is the whole game.',
    unstated: [
      'How the game was concluded. The score ends after White’s 25th move and the result is recorded as a win for White; Orbis does not state more than that.',
      'The round, and the date within 1895.'
    ],
    san: [
      'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4',
      'cxd4', 'Bb4+', 'Nc3', 'd5', 'exd5', 'Nxd5', 'O-O', 'Be6', 'Bg5', 'Be7',
      'Bxd5', 'Bxd5', 'Nxd5', 'Qxd5', 'Bxe7', 'Nxe7', 'Re1', 'f6', 'Qe2', 'Qd7',
      'Rac1', 'c6', 'd5', 'cxd5', 'Nd4', 'Kf7', 'Ne6', 'Rhc8', 'Qg4', 'g6',
      'Ng5+', 'Ke8', 'Rxe7+', 'Kf8', 'Rf7+', 'Kg8', 'Rg7+', 'Kh8', 'Rxh7+'
    ],
    guided: [
      {
        ply: 37,
        ask: 'White has a knight on d4 and the black king has just stepped to f7. White put the knight on a square where two things can take it. Which square?',
        afterward: 'The knight goes into the middle of Black’s position where a pawn and the queen both attack it. Neither can take it without something worse happening, which is the first link in the whole chain.'
      },
      {
        ply: 43,
        ask: 'White gives check with a rook, taking a knight. Which rook capture?',
        afterward: 'The rook takes on the seventh rank and sits beside the black king. Nothing Black has can take it: the king is pinned to the rank, the queen and the rook each have a reason not to.'
      },
      {
        ply: 49,
        ask: 'The rook has checked from f7, g7 and now has one more capture with check on the seventh rank. What is it?',
        afterward: 'The rook takes the last pawn, still with check, still untouchable. The score ends here with the result recorded as a win for White; Orbis does not say how the game was concluded.'
      }
    ]
  },
  {
    id: 'rubinstein-immortal-1907',
    nickname: 'Rubinstein’s Immortal',
    white: { name: 'Georg Rotlewi' },
    black: { name: 'Akiba Rubinstein' },
    result: '0-1',
    site: 'Lodz',
    year: 1907,
    ending: 'resignation',
    themes: ['queen-sacrifice', 'counter-attack', 'mating-attack'],
    note:
      'Both sides attack, and Black is a move faster. On move 22 Black takes a knight with a rook and leaves the ' +
      'queen to be captured; on move 23 he puts a rook on the second rank where the queen can take it as well. ' +
      'White resigned with Black a queen down and two bishops, a rook and a knight all pointing at his king.',
    unstated: [
      'The event and round. Orbis records the town and the year only.',
      'The date within 1907.'
    ],
    san: [
      'd4', 'd5', 'Nf3', 'e6', 'e3', 'c5', 'c4', 'Nc6', 'Nc3', 'Nf6',
      'dxc5', 'Bxc5', 'a3', 'a6', 'b4', 'Bd6', 'Bb2', 'O-O', 'Qd2', 'Qe7',
      'Bd3', 'dxc4', 'Bxc4', 'b5', 'Bd3', 'Rd8', 'Qe2', 'Bb7', 'O-O', 'Ne5',
      'Nxe5', 'Bxe5', 'f4', 'Bc7', 'e4', 'Rac8', 'e5', 'Bb6+', 'Kh1', 'Ng4',
      'Be4', 'Qh4', 'g3', 'Rxc3', 'gxh4', 'Rd2', 'Qxd2', 'Bxe4+', 'Qg2', 'Rh3'
    ],
    guided: [
      {
        ply: 44,
        ask: 'White has just played g3, attacking the black queen on h4. Black has a rook on c8 and a knight on g4. Black did not move the queen. What did he play?',
        afterward: 'The rook takes the knight on the third rank and leaves the queen there to be taken. White took her — and the next move is the one that makes it work.'
      },
      {
        ply: 46,
        ask: 'Black is a queen down. He has rooks on c3 and d8, a bishop on b6 and a bishop on b7, and a knight on g4. The move he played also loses a piece. Which rook moved, and where?',
        afterward: 'The second rook comes to the second rank, where the queen can take it. If she does, the bishop on b7 comes in along the long diagonal with check, which is where the game ended.'
      },
      {
        ply: 50,
        ask: 'Black has a bishop on e4 giving check, White’s queen has just blocked on g2, and Black has a rook left. Where does it go?',
        afterward: 'The rook comes to the third rank. White resigned here. Orbis’s view: the three moves from 22 onwards are worth replaying several times — each one gives something away, and each one is the only move that works.'
      }
    ]
  },
  {
    id: 'lasker-thomas-1912',
    white: { name: 'Edward Lasker' },
    black: { name: 'George Alan Thomas' },
    result: '1-0',
    site: 'London',
    year: 1912,
    ending: 'checkmate',
    themes: ['queen-sacrifice', 'king-hunt', 'mating-attack'],
    note:
      'White gives up the queen beside the black king and then drives that king down the whole board with checks, ' +
      'from h7 to g1, where it is mated by a move of White’s own king. That last move is not itself a check: moving the ' +
      'king uncovers the rook in the corner along the first rank, and a knight on g4 and the rook on h2 cover the ' +
      'squares the king might run to. This is Edward Lasker, who is not Emanuel Lasker — both are in this ' +
      'collection and they are different people.',
    unstated: [
      'No event or round is recorded here. The game is usually given as London 1912 without more.',
      'The date within 1912.'
    ],
    san: [
      'd4', 'e6', 'Nf3', 'f5', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'Bxf6', 'Bxf6',
      'e4', 'fxe4', 'Nxe4', 'b6', 'Ne5', 'O-O', 'Bd3', 'Bb7', 'Qh5', 'Qe7',
      'Qxh7+', 'Kxh7', 'Nxf6+', 'Kh6', 'Neg4+', 'Kg5', 'h4+', 'Kf4', 'g3+', 'Kf3',
      'Be2+', 'Kg2', 'Rh2+', 'Kg1', 'Kd2#'
    ],
    guided: [
      {
        ply: 21,
        ask: 'White has a queen on h5, a knight on e4 and a knight on e5, and the black king has castled. White started with a capture that gives up the queen. Which square?',
        afterward: 'The queen takes the pawn beside the king and the king has to take her. From here every white move is a check, and the king has nowhere to go but forward.'
      },
      {
        ply: 27,
        ask: 'The black king is on g5 with knights on f6 and g4 checking around him. White gave check with a pawn. Which pawn, and how far?',
        afterward: 'A pawn steps up two squares to give check, and the king is pushed further out. Count how many moves the king has left: never more than one.'
      },
      {
        ply: 35,
        ask: 'The black king is on g1, deep in White’s half. One move mates, and it is not a check from any of the pieces attacking him now. What is it?',
        afterward: 'The white king steps across, which uncovers the rook in the corner along the first rank. Castling on the queen’s side would also have mated — Orbis checks that against the rules, rather than taking it on trust.'
      }
    ]
  },
  {
    id: 'adams-torre-1920',
    white: { name: 'Adams' },
    black: { name: 'Carlos Torre' },
    result: '1-0',
    site: 'New Orleans',
    year: 1920,
    ending: 'resignation',
    themes: ['queen-sacrifice', 'quiet-move'],
    note:
      'White offers the queen again and again on squares where Black cannot take her, because the back rank would ' +
      'fall. Nothing is actually given up: it is one idea repeated until Black runs out of ways to guard both the ' +
      'queen and the rook on e8, and then White takes a pawn on the seventh rank and Black resigned.',
    unstated: [
      'White’s first name. Orbis records the surname only.',
      'The occasion. This game is usually given as New Orleans 1920, is often described as a casual or exhibition game rather than a tournament one, and its authenticity as a game actually played has been questioned. Orbis keeps the moves and does not vouch for the occasion.'
    ],
    san: [
      'e4', 'e5', 'Nf3', 'd6', 'd4', 'exd4', 'Qxd4', 'Nc6', 'Bb5', 'Bd7',
      'Bxc6', 'Bxc6', 'Nc3', 'Nf6', 'O-O', 'Be7', 'Nd5', 'Bxd5', 'exd5', 'O-O',
      'Bg5', 'c6', 'c4', 'cxd5', 'cxd5', 'Re8', 'Rfe1', 'a5', 'Re2', 'Rc8',
      'Rae1', 'Qd7', 'Bxf6', 'Bxf6', 'Qg4', 'Qb5', 'Qc4', 'Qd7', 'Qc7', 'Qb5',
      'a4', 'Qxa4', 'Re4', 'Qb5', 'Qxb7'
    ],
    guided: [
      {
        ply: 35,
        ask: 'White has rooks on e1 and e2 and has just taken a knight on f6. The black queen is on d7. White’s move puts the queen where the black queen can take her. Where?',
        afterward: 'The queen steps out beside the king where Black could take her — except that the rook on e8 would then be undefended and White mates on the back rank. The same trick is coming four more times.'
      },
      {
        ply: 39,
        ask: 'The black queen has just gone back to b5 and White has a queen on c4. White offered her again, further up the same file. Where?',
        afterward: 'The queen goes forward onto the seventh rank. She still cannot be taken, for the same reason, and Black is running out of squares that guard the rook.'
      },
      {
        ply: 45,
        ask: 'Black has a queen on b5, White a queen on c7 and a rook on e4. White took a pawn. Which capture?',
        afterward: 'The queen takes on b7 — and still cannot be taken. Black resigned. Orbis’s view: this is the clearest demonstration of a back-rank weakness anywhere in the collection, which is why it is in it despite the doubts about where it was played.'
      }
    ]
  },
  {
    id: 'reti-alekhine-1925',
    white: { name: 'Richard Réti' },
    black: { name: 'Alexander Alekhine' },
    result: '0-1',
    event: 'Baden-Baden 1925',
    site: 'Baden-Baden',
    year: 1925,
    ending: 'resignation',
    themes: ['counter-attack', 'piece-sacrifice', 'quiet-move'],
    note:
      'A long, slow game that turns in about eight moves in the middle. Black puts a rook on the third rank where it ' +
      'looks lost, then a knight the same way; the queens come off; and from move 30 a knight and a bishop take ' +
      'material on both sides of the board, one check at a time. The last move attacks the bishop on f3 and the rook ' +
      'on e2 at once, and White resigned.',
    unstated: [
      'The round, and the date within 1925.'
    ],
    san: [
      'g3', 'e5', 'Nf3', 'e4', 'Nd4', 'd5', 'd3', 'exd3', 'Qxd3', 'Nf6',
      'Bg2', 'Bb4+', 'Bd2', 'Bxd2+', 'Nxd2', 'O-O', 'c4', 'Na6', 'cxd5', 'Nb4',
      'Qc4', 'Nbxd5', 'N2b3', 'c6', 'O-O', 'Re8', 'Rfd1', 'Bg4', 'Rd2', 'Qc8',
      'Nc5', 'Bh3', 'Bf3', 'Bg4', 'Bg2', 'Bh3', 'Bf3', 'Bg4', 'Bh1', 'h5',
      'b4', 'a6', 'Rc1', 'h4', 'a4', 'hxg3', 'hxg3', 'Qc7', 'b5', 'axb5',
      'axb5', 'Re3', 'Nf3', 'cxb5', 'Qxb5', 'Nc3', 'Qxb7', 'Qxb7', 'Nxb7', 'Nxe2+',
      'Kh2', 'Ne4', 'Rc4', 'Nxf2', 'Bg2', 'Be6', 'Rcc2', 'Ng4+', 'Kh3', 'Ne5+',
      'Kh2', 'Rxf3', 'Rxe2', 'Ng4+', 'Kh3', 'Ne3+', 'Kh2', 'Nxc2', 'Bxf3', 'Nd4'
    ],
    guided: [
      {
        ply: 52,
        ask: 'Black has a rook on e8, a knight on d5 and a queen on c7, and White has just taken on b5. Black moved the rook forward to a square where a pawn can take it. Which square?',
        afterward: 'The rook steps to the third rank in front of White’s pawns, where the pawn on f2 can take it. Taking it does not work, because the knight is coming next.'
      },
      {
        ply: 56,
        ask: 'White has just taken on b5 with the queen. Black has a rook on e3 and a knight on d5. Black moved the knight to a square where a rook can take it. Where?',
        afterward: 'The knight goes to the third rank, offering itself to the rook on the c-file. Everything after this is forced for a dozen moves, which is why this is the move the game is remembered for.'
      },
      {
        ply: 80,
        ask: 'Black has a knight on c2, a rook that has just been taken on f3, and a bishop on e6 — and White has a bishop on f3 and a rook on e2. One knight move attacks both. Where?',
        afterward: 'The knight lands in the middle and forks the bishop and the rook. White resigned. Orbis’s view: the game is worth having for the quiet part before move 50 as much as for the fireworks after it.'
      }
    ]
  },
  {
    id: 'byrne-fischer-1956',
    nickname: 'The Game of the Century',
    white: { name: 'Donald Byrne' },
    black: { name: 'Robert Fischer' },
    result: '0-1',
    event: 'Rosenwald Trophy tournament',
    site: 'New York',
    year: 1956,
    ending: 'checkmate',
    themes: ['queen-sacrifice', 'quiet-move', 'counter-attack'],
    note:
      'Black was thirteen years old. On move 11 he puts a knight on the edge of the board; on move 17, with his queen ' +
      'attacked and only a pawn guarding her, he moves a bishop out instead of saving her. White takes the queen, ' +
      'Black takes a bishop with check, and over the next twenty moves the two bishops, a knight and a rook take more ' +
      'material than the queen was worth. The game ends in mate on move 41, with White’s king driven to c1.',
    unstated: [
      'The round, and the date within 1956.'
    ],
    san: [
      'Nf3', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'd4', 'O-O', 'Bf4', 'd5',
      'Qb3', 'dxc4', 'Qxc4', 'c6', 'e4', 'Nbd7', 'Rd1', 'Nb6', 'Qc5', 'Bg4',
      'Bg5', 'Na4', 'Qa3', 'Nxc3', 'bxc3', 'Nxe4', 'Bxe7', 'Qb6', 'Bc4', 'Nxc3',
      'Bc5', 'Rfe8+', 'Kf1', 'Be6', 'Bxb6', 'Bxc4+', 'Kg1', 'Ne2+', 'Kf1', 'Nxd4+',
      'Kg1', 'Ne2+', 'Kf1', 'Nc3+', 'Kg1', 'axb6', 'Qb4', 'Ra4', 'Qxb6', 'Nxd1',
      'h3', 'Rxa2', 'Kh2', 'Nxf2', 'Re1', 'Rxe1', 'Qd8+', 'Bf8', 'Nxe1', 'Bd5',
      'Nf3', 'Ne4', 'Qb8', 'b5', 'h4', 'h5', 'Ne5', 'Kg7', 'Kg1', 'Bc5+',
      'Kf1', 'Ng3+', 'Ke1', 'Bb4+', 'Kd1', 'Bb3+', 'Kc1', 'Ne2+', 'Kb1', 'Nc3+',
      'Kc1', 'Rc2#'
    ],
    guided: [
      {
        ply: 22,
        ask: 'White has a queen on c5 and bishops on g5 and f1, and Black has knights on b6 and f6. Black put a knight on the edge of the board. Which square?',
        afterward: 'The knight goes to the rim, which every beginner is told not to do. It attacks the queen and a knight at the same time, and it is the move that starts everything.'
      },
      {
        ply: 34,
        ask: 'Black’s queen on b6 is attacked by the bishop on c5, and the only thing guarding her is a pawn. Black did not move her. What did he play instead?',
        afterward: 'A bishop steps out to e6, leaving the queen. White took her; Black then took a bishop with check and kept taking. Orbis’s view: the point is not that the queen was offered, it is that Black had counted every check to the end.'
      },
      {
        ply: 82,
        ask: 'White’s king is on c1 and Black has a rook on a2, a knight on c3 and bishops on b3 and b4. One move mates. What is it?',
        afterward: 'The rook comes to the second rank beside the king. Black has been a queen down on paper for twenty moves and ends up mating.'
      }
    ]
  },
  {
    id: 'fischer-spassky-1972-g6',
    white: { name: 'Robert Fischer' },
    black: { name: 'Boris Spassky' },
    result: '1-0',
    event: 'World Championship match',
    site: 'Reykjavik',
    year: 1972,
    round: '6',
    ending: 'resignation',
    themes: ['positional-squeeze'],
    note:
      'No sacrifices and no mate. White opens with the c-pawn, exchanges down to a position where Black is left with ' +
      'a pawn on e6 he has to keep defending, breaks on the f-file on move 26, and then adds pressure until Black has no move that ' +
      'holds everything. Orbis keeps it as the counterweight to the rest of the collection: most famous games are ' +
      'fireworks, and this one is famous for not being.',
    unstated: [
      'The date within 1972.'
    ],
    san: [
      'c4', 'e6', 'Nf3', 'd5', 'd4', 'Nf6', 'Nc3', 'Be7', 'Bg5', 'O-O',
      'e3', 'h6', 'Bh4', 'b6', 'cxd5', 'Nxd5', 'Bxe7', 'Qxe7', 'Nxd5', 'exd5',
      'Rc1', 'Be6', 'Qa4', 'c5', 'Qa3', 'Rc8', 'Bb5', 'a6', 'dxc5', 'bxc5',
      'O-O', 'Ra7', 'Be2', 'Nd7', 'Nd4', 'Qf8', 'Nxe6', 'fxe6', 'e4', 'd4',
      'f4', 'Qe7', 'e5', 'Rb8', 'Bc4', 'Kh8', 'Qh3', 'Nf8', 'b3', 'a5',
      'f5', 'exf5', 'Rxf5', 'Nh7', 'Rcf1', 'Qd8', 'Qg3', 'Re7', 'h4', 'Rbb7',
      'e6', 'Rbc7', 'Qe5', 'Qe8', 'a4', 'Qd8', 'R1f2', 'Qe8', 'R2f3', 'Qd8',
      'Bd3', 'Qe8', 'Qe4', 'Nf6', 'Rxf6', 'gxf6', 'Rxf6', 'Kg7', 'Bc4', 'Kh8',
      'Qf4'
    ],
    guided: [
      {
        ply: 51,
        ask: 'White has rooks on c1 and f1, a bishop on c4 and a queen on h3, and Black is tied to the pawn on e6. White pushed a pawn. Which one, and how far?',
        afterward: 'The pawn steps up one square, offering itself. Black has to take, and that gives White the open file his rooks have been waiting for.'
      },
      {
        ply: 75,
        ask: 'Black has just blocked with a knight in front of his own pawns. White has two rooks stacked on one file and a queen on e4, and he took the knight. With which piece?',
        afterward: 'A rook takes it, and Black must take back with a pawn, opening the king. The second rook comes to the same square next move.'
      },
      {
        ply: 81,
        ask: 'White has a rook on f6 and a bishop on c4; the black king is on h8 and nothing is holding together. White played a quiet queen move and Black resigned. Where did the queen go?',
        afterward: 'The queen steps to the f-file behind the rook. Black resigned here. Orbis’s view: this game teaches more about chess than any of the sacrifices in the collection, and takes much longer to enjoy.'
      }
    ]
  },
  {
    id: 'deepblue-kasparov-1997-g6',
    white: { name: 'Deep Blue' },
    black: { name: 'Garry Kasparov' },
    result: '1-0',
    event: 'Rematch',
    site: 'New York',
    year: 1997,
    round: '6',
    ending: 'resignation',
    themes: ['machine', 'piece-sacrifice'],
    note:
      'Nineteen moves. White, a machine, gives up a knight for a pawn on move 8 so that the black king can never ' +
      'castle; the king spends the rest of the game on c8 and d8 while the white pieces come at him. Black resigned ' +
      'on move 19. It is in the collection because of what it was — the last game of the match a computer won ' +
      'against the world champion — rather than because the moves are beautiful.',
    unstated: [
      'Anything about how the machine chose its moves.',
      'The date within 1997.'
    ],
    san: [
      'e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Ng5', 'Ngf6',
      'Bd3', 'e6', 'N1f3', 'h6', 'Nxe6', 'Qe7', 'O-O', 'fxe6', 'Bg6+', 'Kd8',
      'Bf4', 'b5', 'a4', 'Bb7', 'Re1', 'Nd5', 'Bg3', 'Kc8', 'axb5', 'cxb5',
      'Qd3', 'Bc6', 'Bf5', 'exf5', 'Rxe7', 'Bxe7', 'c4'
    ],
    guided: [
      {
        ply: 15,
        ask: 'White has knights on g5 and f3 and a bishop on d3; Black has just played h6, attacking a knight. White did not retreat it — he played it forward and gave it up. Which square?',
        afterward: 'The knight takes a pawn and is lost for it. What White gets is a black king that can never castle, which turns out to be worth more than a knight here.'
      },
      {
        ply: 19,
        ask: 'Black has just taken on e6 with a pawn, so the black king on e8 has no cover. White gave check with a bishop. Where?',
        afterward: 'The bishop steps right up the board to give check, and the king has to go to d8. From here Black never gets his pieces out.'
      },
      {
        ply: 35,
        ask: 'Black has just taken a bishop on f5 with a pawn. White has a rook on e1 and the black queen is still on the file in front of it. What did White play?',
        afterward: 'The rook takes the queen. Black resigned four plies later. Orbis’s view: whatever anybody thinks about that match, the knight offer on move 8 is a good example of a piece given up for something that is not a mating attack.'
      }
    ]
  },
  {
    id: 'kasparov-topalov-1999',
    white: { name: 'Garry Kasparov' },
    black: { name: 'Veselin Topalov' },
    result: '1-0',
    site: 'Wijk aan Zee',
    year: 1999,
    ending: 'resignation',
    themes: ['piece-sacrifice', 'king-hunt'],
    note:
      'White gives up a rook in the centre on move 24 and then drives the black king from b8 all the way to the first ' +
      'rank with checks, taking pawns and a knight on the way, while Black’s queen and rooks are still on the board. ' +
      'The king survives the hunt; the material does not. Black resigned on move 44, a rook against a queen.',
    unstated: [
      'The event and round. Orbis records the town and the year only.',
      'The date within 1999.'
    ],
    san: [
      'e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'Qd2', 'c6',
      'f3', 'b5', 'Nge2', 'Nbd7', 'Bh6', 'Bxh6', 'Qxh6', 'Bb7', 'a3', 'e5',
      'O-O-O', 'Qe7', 'Kb1', 'a6', 'Nc1', 'O-O-O', 'Nb3', 'exd4', 'Rxd4', 'c5',
      'Rd1', 'Nb6', 'g3', 'Kb8', 'Na5', 'Ba8', 'Bh3', 'd5', 'Qf4+', 'Ka7',
      'Rhe1', 'd4', 'Nd5', 'Nbxd5', 'exd5', 'Qd6', 'Rxd4', 'cxd4', 'Re7+', 'Kb6',
      'Qxd4+', 'Kxa5', 'b4+', 'Ka4', 'Qc3', 'Qxd5', 'Ra7', 'Bb7', 'Rxb7', 'Qc4',
      'Qxf6', 'Kxa3', 'Qxa6+', 'Kxb4', 'c3+', 'Kxc3', 'Qa1+', 'Kd2', 'Qb2+', 'Kd1',
      'Bf1', 'Rd2', 'Rd7', 'Rxd7', 'Bxc4', 'bxc4', 'Qxh8', 'Rd3', 'Qa8', 'c3',
      'Qa4+', 'Ke1', 'f4', 'f5', 'Kc1', 'Rd2', 'Qa7'
    ],
    guided: [
      {
        ply: 47,
        ask: 'Black has just played Qd6. White has a rook in the centre that a pawn is attacking, another rook on e1 and a bishop on h3, and he started with a capture that gives the rook up. What is it?',
        afterward: 'The rook takes the pawn in the centre and Black takes it back. That opens the file the other rook needs, and from here White gives check on every move for twenty plies.'
      },
      {
        ply: 51,
        ask: 'The black king has been forced to b6 and White has a rook on e7 giving check. White’s next move takes a pawn with check. With which piece, and where?',
        afterward: 'The queen takes in the centre with check, and the king has to take the knight on a5. He is now in the open with eight white moves of checks ahead of him.'
      },
      {
        ply: 67,
        ask: 'The black king has walked to c3 and White has a queen on a6. One check brings the queen behind him. Where does she go?',
        afterward: 'The queen drops into the corner and checks along the first rank. The king goes to d2 and the hunt carries on for another eight moves before the material tells.'
      }
    ]
  }
])

/** The one-line description of the whole collection, for a screen that has to say what this is. */
export const FAMOUS_COLLECTION_SAYS =
  'Fifteen games that were really played, typed in as data and checked move by move against the rules. Everything written about them was written for Orbis.'
