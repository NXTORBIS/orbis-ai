import test from 'node:test'
import assert from 'node:assert/strict'
import { isWeatherQuery, placeFromQuery } from './searchWeather.ts'

test('a weather query is recognised however it is phrased', () => {
  for (const query of ['weather in chennai', 'chennai weather', 'forecast for Tokyo', 'is it raining in London', 'temperature in Paris']) {
    assert.equal(isWeatherQuery(query), true, query)
  }
})

test('a query that is not about weather is not treated as one', () => {
  for (const query of ['chennai population', 'python tutorial', 'Albert Einstein']) {
    assert.equal(isWeatherQuery(query), false, query)
    assert.equal(placeFromQuery(query), null)
  }
})

test('the place is found wherever it sits in the sentence', () => {
  assert.equal(placeFromQuery('weather in chennai'), 'chennai')
  assert.equal(placeFromQuery('chennai weather'), 'chennai')
  assert.equal(placeFromQuery('forecast for Tokyo'), 'Tokyo')
  assert.equal(placeFromQuery('what is the weather in New York today'), 'New York')
})

test('a weather query naming nowhere asks rather than guessing', () => {
  assert.equal(placeFromQuery('weather'), null)
  assert.equal(placeFromQuery('what is the weather today'), null)
  assert.equal(placeFromQuery('forecast'), null)
})

test('the words of the asking do not survive into the place', () => {
  const place = placeFromQuery('what is the weather like in San Francisco tomorrow')
  assert.equal(place, 'San Francisco')
})
