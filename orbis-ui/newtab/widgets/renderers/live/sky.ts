import type { WeatherSymbol } from '../../../../../src/shared/widgetFeed.ts'

/**
 * What each kind of weather looks like: the sky it is drawn on, the pieces the picture is built from, and what that
 * picture is called for somebody who cannot see it.
 *
 * One table rather than a decision taken twice. The stylesheet washes the card in a sky by name, the drawing puts
 * the pieces together by name, and the spoken line comes from the same row -- so a picture can never show sun while
 * the card says rain, and no symbol can arrive with nothing drawn for it.
 *
 * The forecast's own words ("Mostly sunny") are shown beside the picture and read on their own. What is here
 * describes the drawing, and only that.
 *
 * Pure.
 */

/** The washes the stylesheet knows how to build, each from the theme's own colours. */
export type SkyName = 'clear' | 'partly' | 'cloudy' | 'rain' | 'snow' | 'fog' | 'thunder' | 'night' | 'plain'

/** The pieces a picture is made of, drawn back to front in the order they are listed. */
export type WeatherPart = 'stars' | 'sun' | 'moon' | 'cloud-small' | 'cloud-big' | 'drops-few' | 'drops-many' | 'flakes' | 'mixed' | 'fog' | 'bolt' | 'blank'

/** The one small glyph that stands for an hour in the strip of coming hours. */
export type MiniMark = 'sun' | 'partly' | 'cloud' | 'drop' | 'flake' | 'bolt' | 'haze' | 'moon' | 'none'

export interface WeatherLook {
  sky: SkyName
  parts: WeatherPart[]
  mini: MiniMark
  /** The picture said aloud, as a picture: what is drawn, not what the forecast concluded. */
  said: string
}

const LOOKS: Readonly<Record<WeatherSymbol, WeatherLook>> = Object.freeze({
  clear: { sky: 'clear', parts: ['sun'], mini: 'sun', said: 'A clear sky, with the sun out' },
  partly: { sky: 'partly', parts: ['sun', 'cloud-small'], mini: 'partly', said: 'The sun behind a cloud' },
  cloudy: { sky: 'cloudy', parts: ['cloud-small', 'cloud-big'], mini: 'cloud', said: 'A sky covered in cloud' },
  rain: { sky: 'rain', parts: ['cloud-big', 'drops-many'], mini: 'drop', said: 'Rain falling from a cloud' },
  showers: { sky: 'rain', parts: ['sun', 'cloud-small', 'drops-few'], mini: 'drop', said: 'Showers, with the sun between them' },
  snow: { sky: 'snow', parts: ['cloud-big', 'flakes'], mini: 'flake', said: 'Snow falling from a cloud' },
  sleet: { sky: 'snow', parts: ['cloud-big', 'mixed'], mini: 'flake', said: 'Sleet: rain and snow falling together' },
  fog: { sky: 'fog', parts: ['cloud-small', 'fog'], mini: 'haze', said: 'Fog lying in bands' },
  thunder: { sky: 'thunder', parts: ['cloud-big', 'bolt', 'drops-few'], mini: 'bolt', said: 'A thunder cloud, with lightning under it' },
  night: { sky: 'night', parts: ['stars', 'moon'], mini: 'moon', said: 'A clear night sky, with the moon out' },
  unknown: { sky: 'plain', parts: ['blank'], mini: 'none', said: 'No picture for this weather' }
})

/**
 * How one symbol is drawn.
 *
 * A symbol Orbis does not have a picture for falls to the quiet one, which says so rather than borrowing another
 * symbol's picture: a cloud drawn for weather nobody could name is a made-up forecast.
 */
export const lookOf = (symbol: WeatherSymbol): WeatherLook => LOOKS[symbol] ?? LOOKS.unknown

/** Whether a picture holds a piece. */
export const hasPart = (look: WeatherLook, part: WeatherPart): boolean => look.parts.includes(part)
