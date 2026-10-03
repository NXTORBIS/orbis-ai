import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WEATHER_SYMBOLS } from '../../../../../src/shared/widgetFeed.ts'
import { hasPart, lookOf, type SkyName, type WeatherPart } from './sky.ts'

const SKIES: SkyName[] = ['clear', 'partly', 'cloudy', 'rain', 'snow', 'fog', 'thunder', 'night', 'plain']
const PARTS: WeatherPart[] = ['stars', 'sun', 'moon', 'cloud-small', 'cloud-big', 'drops-few', 'drops-many', 'flakes', 'mixed', 'fog', 'bolt', 'blank']

test('every kind of weather the feed can send has a picture and a sky', () => {
  for (const symbol of WEATHER_SYMBOLS) {
    const look = lookOf(symbol)
    assert.ok(SKIES.includes(look.sky), `${symbol} is washed in a sky the stylesheet knows: ${look.sky}`)
    assert.ok(look.parts.length > 0, `${symbol} has something drawn for it`)
    for (const part of look.parts) assert.ok(PARTS.includes(part), `${symbol} is built from pieces the drawing has: ${part}`)
    assert.ok(look.said.length > 3, `${symbol} can be read aloud`)
  }
})

test('weather nobody could name says so rather than borrowing another picture', () => {
  const look = lookOf('unknown')
  assert.deepEqual(look.parts, ['blank'])
  assert.equal(look.said, 'No picture for this weather')
  // Something that is not one of the symbols at all lands in the same place.
  assert.deepEqual(lookOf('nonsense' as never), look)
})

test('the picture matches what the weather is called', () => {
  assert.ok(hasPart(lookOf('clear'), 'sun'))
  assert.ok(!hasPart(lookOf('clear'), 'cloud-big'))
  assert.ok(hasPart(lookOf('night'), 'moon'))
  assert.ok(!hasPart(lookOf('night'), 'sun'), 'the sun is never drawn at night')
  assert.ok(hasPart(lookOf('rain'), 'drops-many'))
  assert.ok(hasPart(lookOf('snow'), 'flakes'))
  assert.ok(hasPart(lookOf('thunder'), 'bolt'))
})

test('rain and showers share a sky, and sleet is drawn on the snow one', () => {
  assert.equal(lookOf('showers').sky, lookOf('rain').sky)
  assert.equal(lookOf('sleet').sky, lookOf('snow').sky)
  // They are still different pictures: showers keep their sun.
  assert.ok(hasPart(lookOf('showers'), 'sun'))
  assert.ok(!hasPart(lookOf('rain'), 'sun'))
})
