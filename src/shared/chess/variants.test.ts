import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  CASTLING_FLAGS, VARIANTS, allows, clearBoard, draftToFen, emptyDraft, identifyVariant, inspectDraft,
  inspectPosition, isStandardVariant, materialOf, mirrorDraft, movePiece, normaliseVariant, pawnCapturesAtLeast,
  placePiece, playableVariants, promotionsNeeded, readFen, refuse, refusedVariants, startDraft, summarise,
  supportFor, variantLabel, withCastling, withClocks, withEnPassant, withTurn, type VariantAction
} from './variants.ts'
import { START_FEN, checkFen } from './rules.ts'
import { readPgn } from './pgn.ts'

/**
 * Two promises are tested here, and both are about something that would otherwise fail silently.
 *
 * **A variant is never quietly read as ordinary chess.** That mistake has no symptom: the moves parse, the board
 * fills, the game is kept, and only the castling or the result is wrong. So every name in the registry and a handful
 * that are not in it are pushed through the identification and asked whether Orbis thinks they are standard chess.
 *
 * **An illegal position is never quietly corrected.** The editor's whole job is putting pieces where no move could
 * put them, so the line between "not a chess position" and "a position no game reached" is the only thing standing
 * between a composed study and a board with nine pawns on it.
 */

const ACTIONS: VariantAction[] = ['play', 'analyse', 'import', 'export']

describe('which game', () => {
  test('no Variant tag at all is ordinary chess, because PGN says so', () => {
    for (const tag of [undefined, null, '', '   ']) {
      const identity = identifyVariant(tag)
      assert.equal(identity.kind, 'standard', String(tag))
      assert.equal(identity.record.id, 'standard')
    }
    assert.ok(isStandardVariant(undefined))
    for (const action of ACTIONS) {
      assert.equal(refuse(undefined, action), null)
      assert.ok(allows(undefined, action))
    }
  })

  test('the spellings of ordinary chess all reach it, including a game set up from a position', () => {
    for (const tag of ['standard', 'Standard', 'CHESS', 'Normal', 'classical', 'From Position', 'from position', 'Standard Chess']) {
      assert.ok(isStandardVariant(tag), tag)
      assert.ok(allows(tag, 'play'), tag)
    }
  })

  test('standard chess is the only thing Orbis can play, analyse, read or write', () => {
    assert.deepEqual(playableVariants().map((one) => one.id), ['standard'])
    const full = VARIANTS.filter((one) => ACTIONS.every((action) => one.support[action]))
    assert.deepEqual(full.map((one) => one.id), ['standard'], 'something other than ordinary chess claims full support')
    for (const record of refusedVariants()) {
      for (const action of ACTIONS) {
        assert.equal(record.support[action], false, `${record.id} claims it can ${action}`)
      }
    }
  })

  test('every variant Orbis knows and refuses is refused, and never passed off as standard chess', () => {
    const refused = refusedVariants()
    assert.ok(refused.length >= 20, 'the registry should name the variants that turn up in real files')
    for (const record of refused) {
      for (const name of [record.id, ...record.aliases]) {
        for (const spelling of [name, name.toUpperCase(), ` ${name} `, name.replace(/[ -]/g, '')]) {
          assert.equal(isStandardVariant(spelling), false, `${spelling} was treated as ordinary chess`)
          const identity = identifyVariant(spelling)
          assert.equal(identity.kind, 'variant', spelling)
          assert.equal(identity.record.id, record.id, spelling)
          for (const action of ACTIONS) {
            assert.equal(allows(spelling, action), false, `${spelling} / ${action}`)
            const why = refuse(spelling, action)
            assert.ok(typeof why === 'string' && why.length > 0, `${spelling} / ${action} gave no reason`)
            assert.match(why, /ordinary chess/, `${spelling} / ${action} does not say it was not read as ordinary chess`)
            assert.ok(why.includes(record.name), `${spelling} / ${action} does not name the game`)
          }
        }
      }
    }
  })

  test('a name Orbis has never heard of is refused, not assumed to be ordinary chess', () => {
    const strangers = [
      'wizard chess', 'chess 1010', 'standard960', 'chess960x', 'crazyhouse960', 'hexagonal', 'glinski',
      'my own rules', 'standardish', '??', 'chessx'
    ]
    for (const tag of strangers) {
      const identity = identifyVariant(tag)
      assert.equal(identity.kind, 'unknown', tag)
      assert.equal(isStandardVariant(tag), false, tag)
      for (const action of ACTIONS) {
        assert.equal(allows(tag, action), false, `${tag} / ${action}`)
        const why = refuse(tag, action)
        assert.ok(why && why.includes(tag), `${tag} / ${action} does not quote the tag`)
        assert.match(why, /not been read as ordinary chess/)
      }
      assert.match(variantLabel(tag), /not recognised/)
    }
  })

  test('a near miss of a standard spelling is not standard chess', () => {
    // The whole risk is a loose match: 'chess' is ordinary chess and 'chess960' is not, and they share six letters.
    assert.ok(isStandardVariant('chess'))
    assert.equal(isStandardVariant('chess960'), false)
    assert.equal(isStandardVariant('chess 960'), false)
    assert.equal(isStandardVariant('960'), false)
    assert.equal(identifyVariant('chess960').kind, 'variant')
  })

  test('spelling a name differently reaches the same variant', () => {
    const ids = ['Three-check', 'three check', 'THREECHECK', '3check', '3 check'].map((one) => {
      const identity = identifyVariant(one)
      return identity.kind === 'variant' ? identity.record.id : identity.kind
    })
    assert.deepEqual(ids, ['three-check', 'three-check', 'three-check', 'three-check', 'three-check'])
    assert.equal(normaliseVariant('King of the Hill'), 'kingofthehill')
    assert.equal(normaliseVariant("Loser's chess"), 'loserschess')
  })

  test('no two variants claim the same name', () => {
    const owner = new Map<string, string>()
    const clashes: string[] = []
    for (const record of VARIANTS) {
      for (const name of [record.id, ...record.aliases]) {
        const key = normaliseVariant(name)
        const already = owner.get(key)
        if (already !== undefined && already !== record.id) clashes.push(`${name}: ${already} and ${record.id}`)
        owner.set(key, record.id)
      }
    }
    assert.deepEqual(clashes, [], 'one spelling cannot mean two different games')
  })

  test('every refused variant says what makes it a different game', () => {
    for (const record of refusedVariants()) {
      assert.ok(record.differs.length > 20, `${record.id} does not say what is different about it`)
      assert.ok(record.name.length > 0)
    }
  })

  test('an unrecognised tag can be done nothing with, which is also what supportFor says', () => {
    const support = supportFor('wizard chess')
    assert.deepEqual(support, { play: false, analyse: false, import: false, export: false })
  })

  /**
   * The importer is the place this policy really bites, so it is checked against the importer rather than only
   * against itself: a real PGN naming Chess960 must come out refused, and its recorded variant must still be
   * refused when the registry is asked about it afterwards.
   */
  test('a real Chess960 file is refused by the importer and still refused by the registry', () => {
    const file = [
      '[Event "Test"]',
      '[Variant "Chess960"]',
      '[SetUp "1"]',
      '[FEN "bqnbrkrn/pppppppp/8/8/8/8/PPPPPPPP/BQNBRKRN w KQkq - 0 1"]',
      '',
      '1. e4 e5 *',
      ''
    ].join('\n')
    const read = readPgn(file)
    assert.equal(read.games.length, 1)
    const game = read.games[0]
    assert.equal(game.ok, false, 'the importer read a Chess960 game as if it were chess')
    assert.equal(game.problem, 'unsupported-variant')
    assert.equal(game.moves.length, 0, 'not one move of a variant game may be built')
    assert.equal(isStandardVariant(game.variant), false)
    assert.ok(refuse(game.variant, 'import'))
    assert.ok(refuse(game.variant, 'play'))
  })

  test('a game written as “From Position” is ordinary chess and is read', () => {
    const file = [
      '[Event "Test"]',
      '[Variant "From Position"]',
      '[SetUp "1"]',
      '[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]',
      '',
      '1. e4 Kd7 *',
      ''
    ].join('\n')
    const read = readPgn(file)
    assert.equal(read.games.length, 1)
    assert.equal(read.games[0].ok, true, read.games[0].reason)
    assert.equal(read.games[0].variant, 'standard')
    assert.ok(isStandardVariant(read.games[0].variant))
    assert.ok(allows(read.games[0].variant, 'import'))
  })

  test('every spelling the importer treats as ordinary chess is ordinary chess here too', () => {
    // These are the names `pgn.ts` lets through as standard. If this registry disagreed, a file would be refused in
    // one place and accepted in the other.
    for (const tag of ['standard', 'chess', 'normal', 'classical', 'from position']) {
      assert.ok(isStandardVariant(tag), tag)
    }
  })
})

describe('reading a position', () => {
  test('the starting position goes round without changing a character', () => {
    const reading = readFen(START_FEN)
    assert.ok(reading.ok)
    assert.deepEqual(reading.notes, [])
    assert.equal(draftToFen(reading.draft), START_FEN)
    assert.equal(reading.draft.pieces.length, 32)
    assert.equal(reading.draft.castling, 'KQkq')
    assert.equal(reading.draft.enPassant, '-')
  })

  test('a board that cannot be read is refused rather than half read', () => {
    for (const bad of ['', '   ', 'nonsense', '8/8/8/8/8/8/8 w - - 0 1', 'rnbqkbnr/ppp9ppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1']) {
      const reading = readFen(bad)
      assert.equal(reading.ok, false, bad)
      assert.ok(reading.reason && reading.reason.length > 0, bad)
      assert.equal(reading.draft.pieces.length, 0, bad)
    }
    assert.match(readFen('8/8/8/8/8/8/8 w - - 0 1').reason ?? '', /eight rows/)
    assert.match(readFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1').reason ?? '', /not a chess piece/)
  })

  test('anything reading had to fill in or drop is said out loud', () => {
    const boardOnly = readFen('4k3/8/8/8/8/8/8/4K3')
    assert.ok(boardOnly.ok)
    assert.equal(boardOnly.notes.length, 1)
    assert.match(boardOnly.notes[0], /only the board/)
    assert.equal(boardOnly.draft.turn, 'w')

    const badEp = readFen('4k3/8/8/8/8/8/8/4K3 w - e4 0 1')
    assert.ok(badEp.ok)
    assert.equal(badEp.draft.enPassant, '-')
    assert.equal(badEp.notes.length, 1)
    assert.match(badEp.notes[0], /e4/)

    const badCastling = readFen('4k3/8/8/8/8/8/8/4K3 w KQxq - 0 1')
    assert.equal(badCastling.draft.castling, 'KQq')
    assert.match(badCastling.notes[0] ?? '', /castling part/)

    const badTurn = readFen('4k3/8/8/8/8/8/8/4K3 x - - 0 1')
    assert.equal(badTurn.draft.turn, 'w')
    assert.match(badTurn.notes[0] ?? '', /neither w nor b/)
  })
})

describe('editing a position', () => {
  test('a piece can be put down, picked up, and moved where no move could take it', () => {
    let draft = emptyDraft()
    draft = placePiece(draft, 'e1', { type: 'k', color: 'w' })
    draft = placePiece(draft, 'e8', { type: 'k', color: 'b' })
    assert.equal(draft.pieces.length, 2)
    // One square, one piece: putting something on an occupied square replaces it.
    draft = placePiece(draft, 'e8', { type: 'q', color: 'b' })
    assert.equal(draft.pieces.length, 2)
    assert.equal(draft.pieces.find((one) => one.square === 'e8')?.type, 'q')
    draft = placePiece(draft, 'e8', null)
    assert.equal(draft.pieces.length, 1)
    // A king moved straight across the board. An editor is not a game.
    draft = movePiece(draft, 'e1', 'a8')
    assert.equal(draft.pieces[0].square, 'a8')
    assert.equal(movePiece(draft, 'h4', 'h5').pieces[0].square, 'a8', 'moving from an empty square changes nothing')
    assert.equal(placePiece(draft, 'z9', { type: 'q', color: 'w' }).pieces.length, 1, 'a square that is not on the board is ignored')
  })

  test('castling rights are written in one order however they are switched on', () => {
    let draft = emptyDraft()
    assert.equal(draft.castling, '-')
    draft = withCastling(draft, 'q', true)
    draft = withCastling(draft, 'K', true)
    assert.equal(draft.castling, 'Kq')
    draft = withCastling(draft, 'Q', true)
    draft = withCastling(draft, 'k', true)
    assert.equal(draft.castling, 'KQkq')
    draft = withCastling(draft, 'Q', false)
    assert.equal(draft.castling, 'Kkq')
    draft = withCastling(draft, 'K', false)
    draft = withCastling(draft, 'k', false)
    draft = withCastling(draft, 'q', false)
    assert.equal(draft.castling, '-')
    assert.deepEqual([...CASTLING_FLAGS], ['K', 'Q', 'k', 'q'])
  })

  test('the en passant square is only ever a square a pawn can be taken on', () => {
    const start = emptyDraft()
    assert.equal(withEnPassant(start, 'e3').enPassant, 'e3')
    assert.equal(withEnPassant(start, 'e6').enPassant, 'e6')
    assert.equal(withEnPassant(start, '-').enPassant, '-')
    assert.equal(withEnPassant(start, '').enPassant, '-')
    // Not a square a pawn can ever be captured on: the draft is left exactly as it was rather than given a square
    // nobody asked for.
    for (const bad of ['e4', 'e1', 'z3', 'ee3', '3e']) {
      assert.equal(withEnPassant(withEnPassant(start, 'a3'), bad).enPassant, 'a3', bad)
    }
  })

  test('clearing the board takes the rights with it', () => {
    const draft = clearBoard({ ...startDraft(), enPassant: '-' })
    assert.equal(draft.pieces.length, 0)
    assert.equal(draft.castling, '-')
    assert.equal(draft.enPassant, '-')
  })

  test('the clocks cannot be set to something that is not a clock', () => {
    const draft = withClocks(emptyDraft(), -4, 0)
    assert.equal(draft.halfmove, 0)
    assert.equal(draft.fullmove, 1)
    assert.equal(withClocks(draft, 3.6, 12).halfmove, 4)
    assert.equal(withClocks(draft, Number.NaN, Number.NaN).halfmove, 0)
  })

  test('swapping the colours gives the mirror image, and doing it twice gives the position back', () => {
    const start = startDraft()
    const mirrored = mirrorDraft(start)
    assert.equal(mirrored.turn, 'b')
    // The opening position is symmetrical, so its mirror is itself with the other side to move.
    assert.equal(draftToFen(mirrored), START_FEN.replace(' w ', ' b '))
    assert.equal(draftToFen(mirrorDraft(mirrored)), START_FEN)

    let draft = emptyDraft()
    draft = placePiece(draft, 'e1', { type: 'k', color: 'w' })
    draft = placePiece(draft, 'h1', { type: 'r', color: 'w' })
    draft = placePiece(draft, 'e8', { type: 'k', color: 'b' })
    draft = withCastling(draft, 'K', true)
    draft = withTurn(draft, 'w')
    const other = mirrorDraft(draft)
    assert.equal(other.castling, 'k')
    assert.equal(other.turn, 'b')
    assert.deepEqual(
      other.pieces.map((one) => `${one.color}${one.type}${one.square}`).sort(),
      ['bke8', 'brh8', 'wke1'].sort()
    )
    const ep = mirrorDraft({ ...emptyDraft(), enPassant: 'c3' })
    assert.equal(ep.enPassant, 'c6')
  })
})

describe('counting men', () => {
  test('the starting armies are counted as they stand', () => {
    const material = materialOf(startDraft().pieces)
    assert.equal(material.w.men, 16)
    assert.equal(material.b.p, 8)
    assert.equal(material.w.q, 1)
    assert.equal(material.w.lightBishops, 1)
    assert.equal(material.w.darkBishops, 1)
    assert.equal(promotionsNeeded(material.w), 0)
    assert.equal(promotionsNeeded(material.b), 0)
  })

  test('an extra queen or two bishops of one colour is a promoted pawn', () => {
    const two = materialOf([
      { square: 'd1', type: 'q', color: 'w' },
      { square: 'd8', type: 'q', color: 'w' }
    ])
    assert.equal(promotionsNeeded(two.w), 1)
    // c1 and f1 are both dark... c1 is dark and f1 is light, so these two are the pair a side starts with.
    const pair = materialOf([
      { square: 'c1', type: 'b', color: 'w' },
      { square: 'f1', type: 'b', color: 'w' }
    ])
    assert.equal(promotionsNeeded(pair.w), 0)
    const sameColour = materialOf([
      { square: 'c1', type: 'b', color: 'w' },
      { square: 'a3', type: 'b', color: 'w' }
    ])
    assert.equal(promotionsNeeded(sameColour.w), 1, 'two bishops on dark squares need a promotion')
  })

  test('pawns stacked on a file must have captured their way there', () => {
    const pieces = [
      { square: 'a2', type: 'p' as const, color: 'w' as const },
      { square: 'a3', type: 'p' as const, color: 'w' as const },
      { square: 'a4', type: 'p' as const, color: 'w' as const },
      { square: 'b2', type: 'p' as const, color: 'w' as const }
    ]
    assert.equal(pawnCapturesAtLeast(pieces, 'w'), 2)
    assert.equal(pawnCapturesAtLeast(pieces, 'b'), 0)
    assert.equal(pawnCapturesAtLeast(startDraft().pieces, 'w'), 0)
  })
})

describe('judging a position', () => {
  const fault = (fen: string, kind: string): boolean => inspectPosition(fen).faults.some((one) => one.kind === kind)

  test('the starting position is a legal position that a game could have reached', () => {
    const look = inspectPosition(START_FEN)
    assert.deepEqual(look.faults, [])
    assert.deepEqual(look.unreachable, [])
    assert.equal(look.legal, true)
    assert.equal(look.reachable, true)
    assert.equal(look.turn, 'w')
    assert.equal(look.check, false)
    assert.equal(look.moves, 20)
    assert.match(summarise(look), /White to move/)
  })

  test('an empty board is not a position, and says which king is missing', () => {
    const look = inspectDraft(emptyDraft())
    assert.equal(look.legal, false)
    const kings = look.faults.filter((one) => one.kind === 'kings')
    assert.equal(kings.length, 2)
    assert.match(kings[0].message, /White has no king/)
    assert.match(kings[1].message, /Black has no king/)
    assert.match(summarise(look), /^Not a chess position/)
  })

  test('nine pawns is refused here, which is the whole reason this check exists', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/P7/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    // chess.js is happy with it. If this module trusted the FEN check alone, nine pawns would go straight through.
    assert.equal(checkFen(fen).ok, true)
    const look = inspectPosition(fen)
    assert.equal(look.legal, false)
    const pawns = look.faults.find((one) => one.kind === 'pawn-count')
    assert.ok(pawns)
    assert.match(pawns.message, /White has 9 pawns/)
    assert.equal(pawns.squares.length, 9)
  })

  test('a side cannot have more than sixteen men', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/QQ6/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    assert.equal(checkFen(fen).ok, true)
    assert.ok(fault(fen, 'men-count'))
  })

  test('a pawn cannot stand on the first or last row', () => {
    // chess.js catches this one as well; the point is that the reason names the squares.
    const look = inspectPosition('P6k/8/8/8/8/8/8/K7 w - - 0 1')
    assert.equal(look.legal, false)
    const found = look.faults.find((one) => one.kind === 'pawn-rank')
    assert.ok(found)
    assert.deepEqual(found.squares, ['a8'])
  })

  test('two kings, or none, is refused', () => {
    assert.ok(fault('4k3/8/8/8/8/8/8/4K1K1 w - - 0 1', 'kings'))
    assert.ok(fault('8/8/8/8/8/8/8/4K3 w - - 0 1', 'kings'))
  })

  test('the side not to move cannot be left standing in check', () => {
    const fen = '4k3/8/8/8/8/8/8/4K2r b - - 0 1'
    assert.equal(checkFen(fen).ok, true, 'chess.js allows it, so this module has to catch it')
    const look = inspectPosition(fen)
    assert.equal(look.legal, false)
    const found = look.faults.find((one) => one.kind === 'opponent-in-check')
    assert.ok(found)
    assert.match(found.message, /White is in check but it is Black to move/)
    assert.deepEqual(found.squares, ['e1'])
    // The same board with the other side to move is a perfectly ordinary position: White is in check on his own turn.
    const fine = inspectPosition('4k3/8/8/8/8/8/8/4K2r w - - 0 1')
    assert.equal(fine.legal, true)
    assert.equal(fine.check, true)
  })

  test('the kings cannot touch', () => {
    const fen = '8/8/8/3kK3/8/8/8/8 w - - 0 1'
    assert.equal(checkFen(fen).ok, true)
    const look = inspectPosition(fen)
    const found = look.faults.find((one) => one.kind === 'kings-adjacent')
    assert.ok(found)
    assert.deepEqual(found.squares.sort(), ['d5', 'e5'])
    assert.equal(look.legal, false)
  })

  test('castling rights that no piece could honour are refused, and Chess960 is named', () => {
    const noRook = '4k3/8/8/8/8/8/8/4K3 w KQ - 0 1'
    assert.equal(checkFen(noRook).ok, true)
    const look = inspectPosition(noRook)
    assert.equal(look.legal, false)
    const rooks = look.faults.filter((one) => one.kind === 'castling-rook')
    assert.equal(rooks.length, 2)
    assert.deepEqual(rooks.map((one) => one.squares[0]).sort(), ['a1', 'h1'])

    const kingElsewhere = '4k3/8/8/8/8/8/8/3K3R w K - 0 1'
    const second = inspectPosition(kingElsewhere)
    const king = second.faults.find((one) => one.kind === 'castling-king')
    assert.ok(king)
    assert.match(king.message, /no white king on e1/)
    assert.match(king.message, /Chess960/, 'the refusal should say why the other arrangement is not allowed here')
    assert.equal(second.faults.filter((one) => one.kind === 'castling-rook').length, 0, 'one complaint per colour, not two')

    const black = inspectPosition('4k3/8/8/8/8/8/8/4K3 w kq - 0 1')
    assert.equal(black.faults.filter((one) => one.kind === 'castling-rook').length, 2)
    const fine = inspectPosition('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
    assert.deepEqual(fine.faults, [])
  })

  test('an en passant square has to agree with the side to move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e3 0 1'
    const look = inspectPosition(fen)
    const found = look.faults.find((one) => one.kind === 'en-passant-side')
    assert.ok(found, 'a white double push means it is Black to move')
    assert.match(found.message, /Black to move, not White/)
    assert.equal(look.legal, false)
    // The same thing with Black to move is the position after 1. e4.
    const after = inspectPosition('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')
    assert.deepEqual(after.faults, [])
    assert.equal(after.legal, true)
  })

  test('an en passant square has to have the pawn that pushed, and a clear path', () => {
    const noPawn = '4k3/8/8/8/8/8/8/4K3 b - e3 0 1'
    assert.equal(checkFen(noPawn).ok, true, 'chess.js allows it, so this module has to catch it')
    const look = inspectPosition(noPawn)
    const pawn = look.faults.find((one) => one.kind === 'en-passant-pawn')
    assert.ok(pawn)
    assert.match(pawn.message, /standing on e4/)
    assert.equal(look.legal, false)

    // The pawn is there, but something is sitting on the square it would have crossed.
    const blocked = inspectPosition('4k3/8/8/8/4P3/4N3/8/4K3 b - e3 0 1')
    assert.ok(blocked.faults.some((one) => one.kind === 'en-passant-path'))
    const home = inspectPosition('4k3/8/8/8/4P3/8/4N3/4K3 b - e3 0 1')
    assert.ok(home.faults.some((one) => one.kind === 'en-passant-path'))
    const clear = inspectPosition('4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1')
    assert.deepEqual(clear.faults, [])
  })

  test('a composed position that no game could reach is legal, and said to be unreachable', () => {
    // Eight pawns still on the board and two queens: one of the queens is a promoted pawn, and there is no pawn left
    // for it to have been. This is exactly the kind of position somebody sets up on purpose.
    const fen = '4k3/8/8/8/8/8/PPPPPPPP/Q3K2Q w - - 0 1'
    const look = inspectPosition(fen)
    assert.deepEqual(look.faults, [], 'a composed position must not be refused')
    assert.equal(look.legal, true)
    assert.equal(look.reachable, false)
    const note = look.unreachable.find((one) => one.kind === 'promotions')
    assert.ok(note)
    assert.match(note.message, /more than the eight pawns/)
    assert.match(summarise(look), /no game could have reached/)
  })

  test('nine queens with no pawns left is reachable, because eight pawns can promote', () => {
    const fen = '4k3/8/8/8/8/QQQ5/QQQ5/QQQ1K3 w - - 0 1'
    const look = inspectPosition(fen)
    assert.equal(look.legal, true, summarise(look))
    assert.equal(look.material.w.q, 9)
    assert.deepEqual(look.unreachable, [], 'eight promotions and the queen she started with is nine queens')
  })

  test('pawns that must have captured more men than are missing is unreachable', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/P7/P7/P7/4K3 w kq - 0 1'
    const look = inspectPosition(fen)
    assert.deepEqual(look.faults, [])
    assert.equal(look.legal, true)
    const note = look.unreachable.find((one) => one.kind === 'captures')
    assert.ok(note)
    assert.match(note.message, /at least 2 times/)
    assert.match(note.message, /only 0 black men are missing/)
  })

  test('clocks that contradict the move number are unreachable, not refused', () => {
    const look = inspectPosition('4k3/8/8/8/8/8/8/4K3 w - - 40 3')
    assert.equal(look.legal, true)
    const note = look.unreachable.find((one) => one.kind === 'clock')
    assert.ok(note)
    assert.match(note.message, /only 4 have been played/)
  })

  test('an en passant square with a count that is not zero is unreachable', () => {
    const look = inspectPosition('4k3/8/8/4p3/8/8/8/4K3 w - e6 5 3')
    assert.deepEqual(look.faults, [])
    assert.equal(look.legal, true)
    const note = look.unreachable.find((one) => one.kind === 'en-passant-clock')
    assert.ok(note)
    assert.match(note.message, /resets that count to zero/)
  })

  test('checkmate and stalemate on the board are reported, not treated as faults', () => {
    const mate = inspectPosition('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1')
    assert.equal(mate.legal, true, summarise(mate))
    assert.equal(mate.state?.over, true)
    assert.equal(mate.moves, 0)
    assert.equal(mate.check, true)
    assert.match(summarise(mate), /checkmate, 1-0/)
    // The same idea one file across is stalemate: Black is not in check and has nothing to play.
    const stalemate = inspectPosition('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')
    assert.equal(stalemate.legal, true, summarise(stalemate))
    assert.equal(stalemate.state?.over, true)
    assert.equal(stalemate.check, false)
    assert.match(summarise(stalemate), /drawn already, stalemate/)
  })

  test('a position that will not load is refused with the rules module’s own reason', () => {
    // Four fields is a shorthand the editor can read, and not a FEN the rules will load.
    const look = inspectPosition('4k3/8/8/8/8/8/8/4K3 w - -')
    assert.equal(look.legal, false)
    assert.ok(look.faults.some((one) => one.kind === 'fen'))
    assert.match(summarise(look), /^Not a chess position/)
  })

  test('nothing is corrected on the way through: the FEN that comes out is the position that went in', () => {
    let draft = startDraft()
    draft = placePiece(draft, 'a3', { type: 'p', color: 'w' })
    const fen = draftToFen(draft)
    assert.match(fen, /\/P7\/PPPPPPPP\//, 'the ninth pawn is still there')
    const look = inspectDraft(draft)
    assert.equal(look.legal, false)
    assert.equal(look.fen, fen)
    assert.ok(look.faults.some((one) => one.kind === 'pawn-count'))
  })
})
