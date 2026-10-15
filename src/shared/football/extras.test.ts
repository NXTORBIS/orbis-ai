import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeEventStats, normalizeLineup, normalizeSquad, normalizeTeam, normalizeTimeline, statShare } from './extras.ts'

test('lineup: sides, positions and substitutes; a row with no name is dropped', () => {
  const l = normalizeLineup({
    lineup: [
      { strPlayer: 'Matt Grimes', strHome: 'Yes', strPosition: 'Central Midfield', strSubstitute: 'No', intSquadNumber: '6', strTeam: 'Coventry City' },
      { strPlayer: 'Jacob Murphy', strHome: 'No', strPosition: 'Right Winger', strSubstitute: 'Yes', intSquadNumber: '23', strTeam: 'Newcastle United' },
      { strHome: 'Yes' }
    ]
  })
  assert.equal(l.length, 2)
  assert.equal(l[0].side, 'home')
  assert.equal(l[1].substitute, true)
  assert.equal(l[1].number, 23)
})

test('timeline: kinds, minutes in order, the substitution carries who went off, NULL comments are nothing', () => {
  const t = normalizeTimeline({
    timeline: [
      { idTimeline: '3', strTimeline: 'subst', strTimelineDetail: 'Substitution 1', strHome: 'No', strPlayer: 'Lewis Miley', strAssist: 'Amar Dedić', intTime: '59' },
      { idTimeline: '1', strTimeline: 'Goal', strTimelineDetail: 'Penalty', strHome: 'Yes', strPlayer: 'Jack Rudoni', intTime: '6' },
      { idTimeline: '2', strTimeline: 'Yellow Card', strTimelineDetail: 'NULL', strHome: 'No', strPlayer: 'X', intTime: 'soon' }
    ]
  })
  assert.deepEqual(t.map((x) => x.kind), ['goal', 'substitution', 'card'])
  assert.equal(t[0].minute, 6)
  assert.equal(t[1].other, 'Amar Dedić')
  assert.equal(t[2].minute, null)
  assert.equal(t[2].detail, 'Yellow Card')
})

test('statistics: numbers parse, and a bar needs both numbers and a non-zero total', () => {
  const s = normalizeEventStats({ eventstats: [{ strStat: 'Passes accurate', intHome: '185', intAway: '472' }, { strStat: 'Offsides', intHome: '0', intAway: '0' }, { strStat: 'Corners', intHome: '4', intAway: null }] })
  assert.equal(s.length, 3)
  const a = statShare(s[0])
  assert.ok(a && Math.abs(a.home + a.away - 1) < 1e-9)
  assert.equal(statShare(s[1]), null)
  assert.equal(statShare(s[2]), null)
})

test('team and squad: a missing name or id is refused, the website gets a scheme, and a squad row needs a name', () => {
  const t = normalizeTeam({ teams: [{ idTeam: '133604', strTeam: 'Arsenal', strWebsite: 'www.arsenal.com', intFormedYear: '1892', strStadium: 'Emirates Stadium' }] })
  assert.equal(t?.id, 'thesportsdb:133604')
  assert.equal(t?.website, 'https://www.arsenal.com')
  assert.equal(t?.formed, 1892)
  assert.equal(normalizeTeam({ teams: [{ strTeam: 'No id' }] }), null)
  const sq = normalizeSquad({ player: [{ strPlayer: 'Bukayo Saka', strPosition: 'Right Winger', strNumber: '7' }, { strPosition: 'x' }] })
  assert.equal(sq.length, 1)
  assert.equal(sq[0].number, 7)
})
