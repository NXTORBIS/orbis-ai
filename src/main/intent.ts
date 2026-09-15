import { requestJson } from './suggest.ts'
import type { Research } from '../shared/types'

export type AdBlockAction = 'report' | 'allow_site' | 'block_site' | 'allow_resource' | 'strict' | 'standard' | 'enable' | 'disable' | 'update'
const ADBLOCK_ACTIONS: readonly AdBlockAction[] = ['report', 'allow_site', 'block_site', 'allow_resource', 'strict', 'standard', 'enable', 'disable', 'update']

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type BrowseMode = 'once' | 'loop' | 'game'

/** A request that needs more than a text reply. */
export type ChatIntent =
  | {
      kind: 'image'
      /** Self-contained prompt for the image generator. */
      prompt: string
      /** The previous image's seed, so an edit keeps its composition. */
      seed?: number
    }
  | {
      kind: 'browse'
      /** Self-contained instruction for Orbis to carry out in the browser. */
      task: string
      mode: BrowseMode
      /** Continue the conversation's paused or stopped automation instead of starting over. */
      resume: boolean
      count?: number
      minutes?: number
      stopWhen?: string
      unit?: string
    }
  | {
      /** A question or command about ad blocking, answered from the real blocking engine. */
      kind: 'adblock'
      action: AdBlockAction
      /** A site or resource the user named, if any. */
      target: string | null
    }
  | {
      /** A text reply that needs web research first, or is about the page open in the browser. */
      kind: 'answer'
      research: { queries: string[]; recency: Research['recency'] } | null
      usePage: boolean
    }

/** The conversation's latest automation, so "keep going" and "continue" can refer to it. */
export interface AutomationContext {
  objective: string
  status: string
  progress: string
}

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+(?:\s+"seed:(\d+)")?\)/g

const INSTRUCTIONS = [
  'You route messages in Orbis, an AI assistant that can also generate images and operate an in-app web browser.',
  'Decide whether the latest user message asks Orbis to produce a picture, to do something in the web browser, or just for a text reply. Judge the intent, not the wording.',
  'Picture requests include drawing, painting, rendering, photos, portraits, designing a logo, icon, poster or wallpaper, visualizing something,',
  '"show me" or "I want to see" something visual, turning an idea into a visual, and restyling or changing a picture.',
  'Designing a logo, icon, poster or wallpaper is a picture request even when it is for Orbis itself or another brand.',
  'Browser requests ask Orbis to act on a website: open or go to a site, search on a specific site, click, scroll, fill in, sign up, add to a cart, buy, book or post something,',
  'continue working in the page that is open (for example "click the first result", "scroll down"), repeat work across many items or pages, or play a web game.',
  'Text requests include questions, explanations, advice, code, writing, plans, lists, data tables, questions about images or art, and questions that only need information,',
  'even current information, or questions about how to use a website (for example "how do I draw a dragon?", "what makes a good logo?", "explain black holes", "what is the weather in Tokyo?").',
  'A short follow-up such as "make it darker", "add rain", "change the background", "make it realistic" or "turn it into a poster" edits the most recent generated image',
  'when the conversation has one and the follow-up fits it; when the recent conversation is about something else (such as a website, code, or the open browser page), follow that context instead.',
  'Browser requests have a mode. "once": a single task. "loop": the user wants work repeated or continued across many items, results, pages, posts, videos, emails or listings, or over a period of time,',
  'until a count, a condition, the end of the content, or until they say stop (for example "keep scrolling Shorts until I say stop", "check every result", "go through them all", "open each product and record the price",',
  '"keep clicking next until there are no more pages", "monitor this page for 5 minutes", "keep going until you find five"). "game": the user wants Orbis to play, beat, finish or progress in a web game.',
  'When the open page is a game, or the message talks about a game, levels, stages, missions, puzzles or winning, requests such as "beat this", "finish this", "can you play this for me",',
  '"complete all the levels", "get to level 20", "unlock everything" or "get 100%" are mode "game", not "loop" or "once".',
  '"resume" is true when the user wants the active browser automation to continue ("continue", "resume", "keep going", "carry on") instead of starting something new;',
  'a request that extends the active automation ("keep going until the end", "do that until I say stop") also continues it.',
  'Questions about what the open page says (summarize it, what does this article say, what numbers are mentioned, does this source support your answer, explain this) and comparing it with sources from the chat are text replies, not browser tasks,',
  'unless the user asks Orbis to click, scroll, type, navigate, or open pages. Asking to open sources in the browser ("open every source", "open the two most important sources", "check the next source") is a browser task.',
  'For a text reply, also decide whether it needs web research. "research" is true when an accurate answer depends on current or recent facts: news, the latest or newest releases, versions, models or products,',
  'prices, rankings, scores, schedules, who leads or holds a role now, what a company, person or project is doing now, what changed recently, anything tied to today, this week, this month or this year,',
  'or anything likely to have changed since your training, even when the message never says "latest" (for example "what is happening with NVIDIA?", "which version should I use?", "who is leading the market?").',
  'It is also true when the user asks to verify or fact-check something, check whether it is still true, find another, newer, original or official source, find conflicting reports, or research a topic further.',
  'It is false for timeless knowledge and stable concepts, writing, code, math, opinions, and questions the open page or the conversation already answers.',
  '"queries": up to 3 short, specific web search queries that would find authoritative, current sources, resolving words such as "this", "it" or "that source" from the open page, the research in this chat and the conversation',
  '(add the current year when freshness matters); null when research is false. "recency": how fresh sources must be: "day" (today, breaking), "week", "month", "year" or "any".',
  '"use_page": true when the message is about the page open in the browser or part of it, false otherwise.',
  'Orbis blocks ads, trackers, popups and ad redirects in its browser. "adblock" is set when the message is about that: which or how many ads or trackers were blocked, why something was blocked,',
  'why a page looks broken, whether a page is loading ads ("report"); allowing a website or turning ad blocking off for a site ("allow_site"); blocking on a site again ("block_site");',
  'allowing one blocked resource ("allow_resource"); strict or standard blocking ("strict", "standard"); turning ad blocking on or off everywhere ("enable", "disable"); updating the filter lists ("update").',
  'Its "target" is a site or resource the user named, or null for the open page. When "adblock" is set, the intent is "text". Otherwise "adblock" is null.',
  'Reply with JSON only: {"intent": "new_image" | "edit_image" | "browse" | "text", "prompt": string | null, "task": string | null, "mode": "once" | "loop" | "game" | null,',
  '"resume": boolean, "count": number | null, "minutes": number | null, "stop_when": string | null, "unit": string | null,',
  '"research": boolean, "queries": string[] | null, "recency": "day" | "week" | "month" | "year" | "any" | null, "use_page": boolean,',
  '"adblock": {"action": "report" | "allow_site" | "block_site" | "allow_resource" | "strict" | "standard" | "enable" | "disable" | "update", "target": string | null} | null}.',
  'For new_image, "prompt" is a vivid, self-contained English description for an image generator (subject, setting, style, lighting, composition), under 70 words,',
  'keeping every detail the user gave, such as "4K wallpaper", "cinematic" or "anime style", and filling in what an earlier message described when the user refers to it.',
  'For edit_image, "prompt" is the complete description of the changed picture: keep every detail of the most recent image prompt that the request does not change, and apply the change.',
  'When the change is open-ended (such as "change the background" or "try a different style"), pick one specific, fitting new choice and write it into the prompt, so the picture really changes.',
  'For browse, "task" is a clear, self-contained instruction for the browser in the user\'s words, including the website, every detail they gave, and what to do on each item;',
  'when continuing the active automation, "task" is its objective updated with anything the user changed.',
  '"count" is how many items, levels or iterations the user asked for in total (when continuing, null unless the user gives a new total; never the number remaining); "minutes" is a time limit in minutes; "stop_when" says briefly when to stop, starting with "when", "after", "at" or "once"',
  '(for example "when you say stop", "after 10 results", "when five matching jobs are found", "at the end of the page"); "unit" names what is counted (results, Shorts, pages, products, articles, levels).',
  'Use null for anything not given. For text, image intents, "task", "mode" and the browse fields are null.'
].join(' ')

const CONTROL_INSTRUCTIONS = [
  'Orbis is running a browser automation for the user, and the user just sent a message. Decide what it means for the automation.',
  'Reply with JSON only: {"action": "stop" | "pause" | "resume" | "steer" | "other"}.',
  'stop: end it (for example "stop", "cancel", "that\'s enough", "end this", "don\'t continue", "stop playing"). pause: hold it to continue later ("pause", "hold on", "pause here", "wait a sec").',
  'resume: continue or keep going. steer: an instruction that changes or adds to how the automation works ("skip videos longer than a minute", "also note the rating", "only look at laptops under $800").',
  'other: an unrelated question or message.'
].join(' ')

/** The newest image Orbis generated in the recent conversation, if any. */
export function latestGeneratedImage(messages: { role: string; content: string }[]): { prompt: string; seed?: number } | null {
  for (const m of messages.slice(-6).reverse()) {
    if (m.role !== 'assistant') continue
    const found = [...m.content.matchAll(IMAGE_MARKDOWN)].at(-1)
    if (found) return { prompt: found[1], seed: found[2] ? Number(found[2]) : undefined }
  }
  return null
}

const clean = (value: unknown, max = 1000): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/**
 * Works out from meaning and recent context whether the latest message asks for a picture or a browser task.
 * Resolves to the intent, null for a text reply, or undefined when Groq couldn't be asked.
 */
export async function classifyIntent(
  messages: { role: string; content: string }[],
  browser: { url: string; title: string } | undefined,
  automation: AutomationContext | undefined,
  apiKeys: string[],
  fetchFn: FetchFn,
  /** The chat's latest web research and whether the open page is one of its sources, in a line. */
  research?: string
): Promise<ChatIntent | null | undefined> {
  const latest = messages.at(-1)
  if (latest?.role !== 'user') return null
  const text = latest.content.trim()
  // Long pastes, code and commands are never picture or browser requests, so they skip the round trip.
  if (!text || text.length > 1200 || text.startsWith('/') || text.includes('```')) return null

  const previous = latestGeneratedImage(messages.slice(0, -1))
  const transcript = messages
    .slice(-5, -1)
    .map((m) => `${m.role === 'user' ? 'User' : 'Orbis'}: ${m.content.replace(IMAGE_MARKDOWN, '[generated image: $1]').replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n')
  const parsed = await requestJson(
    INSTRUCTIONS,
    [
      `Most recent generated image: ${previous ? JSON.stringify(previous.prompt) : '(none)'}`,
      `Browser: ${browser ? `open at ${browser.url} (${JSON.stringify(browser.title)})` : 'closed'}`,
      `Active browser automation: ${automation ? `${JSON.stringify(automation.objective)} (${automation.status}; ${automation.progress})` : '(none)'}`,
      `Web research in this chat: ${research ?? '(none)'}`,
      `Today: ${new Date().toDateString()}`,
      `Recent conversation:\n${transcript || '(none)'}`,
      `Latest user message: ${JSON.stringify(text)}`
    ].join('\n\n'),
    apiKeys,
    fetchFn,
    10_000
  )
  if (!parsed) return undefined

  const adblock = parsed.adblock as { action?: unknown; target?: unknown } | null | undefined
  const action = adblock && typeof adblock === 'object' ? ADBLOCK_ACTIONS.find((a) => a === adblock.action) : undefined
  if (action) return { kind: 'adblock', action, target: clean(adblock!.target, 300) || null }

  const prompt = clean(parsed.prompt)
  if (parsed.intent === 'new_image' && prompt) return { kind: 'image', prompt }
  if (parsed.intent === 'edit_image' && prompt) return { kind: 'image', prompt, seed: previous?.seed }
  if (parsed.intent === 'browse') {
    const count = typeof parsed.count === 'number' && parsed.count >= 1 ? Math.min(Math.round(parsed.count), 1000) : undefined
    const minutes = typeof parsed.minutes === 'number' && parsed.minutes > 0 ? Math.min(parsed.minutes, 240) : undefined
    const resume = parsed.resume === true && Boolean(automation)
    // A count, a time limit or continuing an automation always means repeated work, whatever mode was picked.
    const mode: BrowseMode = parsed.mode === 'game' ? 'game' : parsed.mode === 'loop' || count !== undefined || minutes !== undefined || resume ? 'loop' : 'once'
    return {
      kind: 'browse',
      task: clean(parsed.task) || text,
      mode,
      resume,
      count,
      minutes,
      // Shown to the user as Orbis's words: "until I say stop" becomes "when you say stop".
      stopWhen:
        clean(parsed.stop_when, 120)
          .replace(/\bI\b/g, 'you')
          .replace(/\bme\b/gi, 'you')
          .replace(/\bmy\b/gi, 'your')
          // A bare "once" or "when" says nothing about when to stop.
          .replace(/^(once|when|after|at|until)$/i, '') || undefined,
      unit: clean(parsed.unit, 30) || undefined
    }
  }
  const usePage = parsed.use_page === true && Boolean(browser)
  if (parsed.research === true || usePage) {
    const queries = Array.isArray(parsed.queries) ? parsed.queries.map((q) => clean(q, 160)).filter(Boolean).slice(0, 3) : []
    const recency = (['day', 'week', 'month', 'year', 'any'] as const).find((r) => r === parsed.recency) ?? 'any'
    return { kind: 'answer', research: parsed.research === true ? { queries: queries.length ? queries : [text], recency } : null, usePage }
  }
  return null
}

/** What a message sent while an automation runs means for it. Plain one-word commands act without waiting for Groq. */
export async function classifyAutomationMessage(
  text: string,
  objective: string,
  apiKeys: string[],
  fetchFn: FetchFn
): Promise<'stop' | 'pause' | 'resume' | 'steer' | 'other'> {
  const trimmed = text.trim()
  if (/^(stop|stop it|stop this|stop now|cancel|halt|end it|enough|that'?s enough)[.!]*$/i.test(trimmed)) return 'stop'
  if (/^(pause|pause it|pause here|hold on)[.!]*$/i.test(trimmed)) return 'pause'
  const parsed = await requestJson(CONTROL_INSTRUCTIONS, `Automation: ${JSON.stringify(objective)}\nUser message: ${JSON.stringify(trimmed)}`, apiKeys, fetchFn, 6000)
  const action = parsed?.action
  if (action === 'stop' || action === 'pause' || action === 'resume' || action === 'steer' || action === 'other') return action
  // Groq couldn't be asked: still honour an obvious stop or pause.
  if (/\b(stop|cancel|enough|end)\b/i.test(trimmed)) return 'stop'
  if (/\bpause\b/i.test(trimmed)) return 'pause'
  return 'other'
}
