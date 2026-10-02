import type { BrowserControl, ControlContext } from './registry.ts'
import { fail } from './registry.ts'
import type { PageHandle } from '../pageHandle'
import * as page from './page.ts'

/**
 * Moving to the next thing in a feed.
 *
 * Found by running the Shorts scenario. The plan was right -- wait until this one has finished, then go to the next,
 * three times -- and it failed on the second step, waiting fifteen seconds for a "next" button. There is no next
 * button on YouTube Shorts. You advance by scrolling one screen or pressing a key, and the same is true of Reels, of
 * TikTok, and of every vertical feed built since.
 *
 * So the gap was not the planner being foolish. It was asked to do something real that Orbis had no capability for,
 * and the only things on offer were a click and a wait. Given a button to look for, a model looks for a button.
 *
 * Two things make this a capability rather than a trick:
 *
 *   1. **It does not know about YouTube.** It tries what advances a feed in general -- the keyboard first, because a
 *      feed that responds to a key is telling you that is how it is meant to be driven, then a screen's worth of
 *      scrolling. Nothing here matches a site.
 *   2. **It checks what actually changed.** A feed has moved on when the thing in front of you is a different thing:
 *      a video of a different length, a different media source, or different text at the top. Not when a key was
 *      pressed, which always "works".
 */

/** What the page is showing now, reduced to the few things that differ between one item and the next. */
const WHAT_IS_SHOWING = `(() => {
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height };
  const players = [...document.querySelectorAll('video, audio')].filter((el) => area(el) > 2500 || el.tagName === 'AUDIO');
  const main = players.sort((a, b) => area(b) - area(a))[0] || null;
  /*
   * The source and duration of whatever is playing, and the text near the top.
   *
   * A source is the strongest signal and is often a blob url that changes per item. A duration is almost as good: one
   * video cannot change its own length. The text is the fallback for a feed with no media in it at all.
   */
  const body = document.body ? document.body.innerText || '' : '';
  return {
    source: main ? String(main.currentSrc || main.src || '') : '',
    duration: main && isFinite(main.duration) ? Math.round(main.duration * 100) / 100 : 0,
    text: body.replace(/\\s+/g, ' ').trim().slice(0, 300),
    scroll: Math.round((document.scrollingElement || document.documentElement).scrollTop)
  }
})()`

interface Showing {
  source: string
  duration: number
  text: string
  scroll: number
}

/** Whether the page is showing something different from before. The question "did the feed move on" and nothing else. */
export function movedOn(before: Showing, after: Showing): { moved: boolean; how: string } {
  if (before.source && after.source && before.source !== after.source) return { moved: true, how: 'a different video is playing' }
  if (before.duration > 0 && after.duration > 0 && Math.abs(before.duration - after.duration) > 0.05) {
    return { moved: true, how: `a video of a different length (${before.duration}s to ${after.duration}s)` }
  }
  // Only when there is no media to judge by: a feed of text moves on by its text changing.
  if (!before.source && !after.source && before.text && after.text && before.text !== after.text) {
    return { moved: true, how: 'the page is showing different text' }
  }
  if (before.scroll !== after.scroll && !before.source) return { moved: true, how: `the page moved down (${before.scroll} to ${after.scroll})` }
  return { moved: false, how: 'the same thing is still in front' }
}

export interface FeedDeps {
  tab(ctx: ControlContext): PageHandle
}

export function registerFeedCapabilities(control: BrowserControl, d: FeedDeps): void {
  const read = (handle: PageHandle): Promise<Showing> => page.exec<Showing>(handle, WHAT_IS_SHOWING, 6000)

  control.register({
    id: 'feed.next',
    domain: 'page',
    name: 'Go to the next item in a feed',
    description:
      'Moves to the next item in a feed of items shown one at a time -- short videos, reels, stories, a one-at-a-time gallery. Use this instead of looking for a "next" button: most feeds have none, and are advanced by a key or by scrolling one screen. Checked by whether what is in front has actually changed, not by whether the key was pressed.',
    keywords: ['next short', 'next reel', 'next video', 'swipe', 'scroll to the next', 'skip to the next', 'advance', 'move on'],
    params: {
      /*
       * Backwards is the same act, and leaving it out would mean "go back one" had to be a different capability with
       * the same body. A feed that goes forwards with a key goes backwards with the opposite one.
       */
      direction: { type: 'string', description: 'next (default) or previous.', enum: ['next', 'previous'] }
    },
    mutates: true,
    confirmation: 'none',
    observe: (_p, ctx) => read(d.tab(ctx)),
    run: async (p, ctx) => {
      const handle = d.tab(ctx)
      const back = p.direction === 'previous'
      const before = await read(handle)

      /*
       * The keyboard first, then scrolling.
       *
       * A feed that answers an arrow key is telling you that is how it expects to be driven, and a key moves exactly
       * one item where a scroll might land between two. Scrolling a whole screen is the fallback, because a feed shows
       * one item per screen -- which is what makes it a feed.
       */
      const attempts: { how: string; act: () => Promise<unknown> }[] = [
        {
          how: back ? 'the up arrow' : 'the down arrow',
          act: () => page.pressNamedKey(handle, back ? 'ArrowUp' : 'ArrowDown', 0, [])
        },
        {
          how: back ? 'page up' : 'page down',
          act: () => page.pressNamedKey(handle, back ? 'PageUp' : 'PageDown', 0, [])
        },
        {
          how: 'scrolling one screen',
          act: () => page.exec(handle, `window.scrollBy({ top: ${back ? '-' : ''}window.innerHeight, behavior: 'instant' })`, 4000)
        }
      ]

      const tried: string[] = []
      for (const attempt of attempts) {
        tried.push(attempt.how)
        await attempt.act().catch(() => undefined)
        // Each way is given a moment to take effect before the next is tried, since a feed loads the next item.
        const end = Date.now() + 2500
        while (Date.now() < end) {
          await page.sleep(250)
          const now = await read(handle).catch(() => before)
          const verdict = movedOn(before, now)
          if (verdict.moved) return { moved: true, how: verdict.how, by: attempt.how, direction: back ? 'previous' : 'next' }
        }
      }

      /*
       * Nothing worked, and that is reported rather than retried.
       *
       * Said with what was tried, because the next decision is a person's or a planner's: a page where neither the
       * keyboard nor a screen of scrolling changes anything is probably not a feed, and trying a fourth way would be
       * guessing rather than recovering.
       */
      return fail('failed', `This does not look like a feed: ${tried.join(', then ')} changed nothing on the page.`, true)
    },
    /**
     * Verified from the reading taken before the act, against the page now.
     *
     * `run` already waited for the change, so this is the second look that catches a feed which moved and bounced
     * back -- and it is the reading the control layer records, so a step is only `done` on evidence from after.
     */
    verify: async (_data, _p, ctx, before) => {
      const now = await read(d.tab(ctx)).catch(() => null)
      if (!now) return { verified: false, detail: 'The page could not be read afterwards.' }
      const verdict = movedOn(before as Showing, now)
      return { verified: verdict.moved, detail: verdict.moved ? `The feed moved on: ${verdict.how}.` : 'The feed did not move on.' }
    }
  })
}
