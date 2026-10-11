/**
 * Whether a message is somebody trying to decide something.
 *
 * ## Why this is not a keyword list
 *
 * "Which is better, a linked list or an array?" is a question about data structures. "Which should I use, a linked
 * list or an array?" is a decision. Both contain "which", "better" or "or"; only one of them wants options weighed.
 * So what is looked for here is **structure**, not vocabulary:
 *
 *   - somebody asking on their own behalf -- "should I", "help me", "what should I do"
 *   - two or more named things set against each other, in a sentence that is about choosing between them
 *   - the arithmetic of having to prioritise: an amount of time and a number of things to do in it
 *   - a message that changes a decision already on the table
 *
 * And what is looked for *against* it matters as much. "Explain how a weighted score works" is teaching.
 * "What is the probability of rolling a six" is arithmetic. "How do people make good decisions" is a question
 * about deciding, which is not the same as a decision. Each of those has to stay on the ordinary chat path, and
 * each of them would trip a keyword list.
 *
 * ## Four answers, not two
 *
 * `clear` goes ahead. `probable` goes ahead too, but Orion is told it may hand the message back if it turns out not
 * to be a decision after all -- so this file can be generous without hijacking the chat. `unsure` asks one short
 * question. Nothing at all stays on the ordinary path and this file never ran, as far as anybody can tell.
 *
 * That split is the whole safety story. A gate strict enough never to be wrong would miss "I have four hours and
 * eight assignments"; a gate loose enough to catch it would turn every comparison into a decision workspace. Being
 * generous here and letting the model decline is what gets both.
 */
import type { DecisionSort } from './types.ts'

export type Sureness = 'clear' | 'probable'

/** What somebody wants to see more of. */
export type Detail =
  /** The whole working: every option, every criterion, every figure. */
  | 'everything'
  /** Why a particular option was not chosen. */
  | 'why-not'
  /** What the method did, and why that method. */
  | 'how-it-worked'
  /** What would have to be different for the answer to change. */
  | 'what-would-change-it'

export type Reading =
  /** Not a decision. Nothing here happened. */
  | { want: 'nothing'; because?: string }
  /** It might be. One short question is better than guessing. */
  | { want: 'unsure'; ask: string }
  /** A decision to work out from scratch. */
  | { want: 'new'; sure: Sureness; sort: DecisionSort; named: readonly string[]; saw: readonly string[] }
  /** A change to the decision already open: an option added, an importance moved, a constraint corrected. */
  | { want: 'change'; saw: readonly string[] }
  /** A what-if, which must not overwrite what was actually said. */
  | { want: 'what-if'; saw: readonly string[] }
  /** More of the working. */
  | { want: 'detail'; of: Detail }
  /** Keep this one. */
  | { want: 'save' }
  /** Stop asking and answer with whatever is known. */
  | { want: 'just-decide' }

export interface Context {
  /** True when this conversation already has a decision open. */
  hasOpen: boolean
}

// ---------------------------------------------------------------- what stays on the ordinary path

/** Asking what a thing is, or how it works. Teaching, not deciding. */
const TEACHING =
  /\b(?:explain|describe|define|what\s+(?:is|are|does|do)\b|how\s+(?:do(?:es)?|is|are)\b|tell\s+me\s+about|teach\s+me|give\s+me\s+an\s+example\s+of|meaning\s+of|difference\s+between)\b/i

/** A question about deciding, rather than a decision. "How do I make good decisions?" */
const ABOUT_DECIDING =
  /\b(?:weighted\s+(?:score|sum|average)|multi[\s-]?criteria|decision\s+(?:tree|theory|analysis|matrix|making)|pareto\s+(?:front|principle)|utility\s+function|analytic\s+hierarchy)\b/i

/** Arithmetic and probability questions, which contain "chance" and "better" and are not decisions. */
const SUMS = /\b(?:probability|odds|expected\s+value)\s+of\b|\bhow\s+many\s+ways\b|\bcalculate\b/i

/** Asking Orbis to make something, which the Creation Engine and the labs already answer. */
const MAKE_ME = /\b(?:write|draw|generate|render|code|implement|refactor|debug|fix)\s+(?:me\s+)?(?:a|an|the|this|some)\b/i

// ---------------------------------------------------------------- asking on one's own behalf

/** "should I", "help me choose", "what should I do" -- somebody asking for themselves. */
const ASKING =
  /\b(?:should\s+(?:i|we)\b|shall\s+(?:i|we)\b|do\s+(?:i|we)\s+(?:go|pick|choose)\b|help\s+(?:me|us)\s+(?:to\s+)?(?:choose|decide|pick|work\s+out|prioriti[sz]e|compare|rank|figure)\b|which\s+(?:one\s+)?(?:should|do|would)\s+(?:i|we)\b|what\s+should\s+(?:i|we)\b|i\s+(?:can(?:no|')t|cannot)\s+decide\b|i\s+(?:am|'m)\s+(?:torn|undecided)\b|i\s+need\s+to\s+(?:choose|decide|pick)\b|which\s+(?:is|would\s+be)\s+(?:the\s+)?(?:best|better|most\s+suitable|right)\s+(?:for|option|choice|one)\b)/i

/** "between A and B", "A or B", "these two", "my options" -- things set against each other. */
const SET_AGAINST =
  /\bbetween\s+[^.?!]{2,80}?\s+(?:and|or)\s+[^.?!]{2,80}|\b(?:either|whether)\s+[^.?!]{2,60}?\s+or\s+[^.?!]{2,60}|\b(?:these|those|my|the)\s+(?:two|three|four|five|\d+)?\s*(?:options?|choices?|alternatives?|candidates?|ideas?|approaches?|solutions?)\b|\bmy\s+options\b/i

/** Prioritising: a plain word for it. */
const ORDERING =
  /\b(?:prioriti[sz]e|prioriti[sz]ation|rank(?:ing)?\b|in\s+what\s+order|which\s+(?:comes\s+)?first|what\s+(?:comes\s+|to\s+do\s+)?next|most\s+important\s+thing\s+to\s+do|shortlist)\b/i

/** Weighing things up against each other. */
const WEIGHING =
  /\b(?:trade[\s-]?offs?|best\s+balance|balance\s+of\b|worth\s+(?:it|the)\b|pros\s+and\s+cons|compare\s+(?:the|these|those|two|my)\b|most\s+suitable|better\s+value|cost[\s-]benefit)\b/i

/** An amount of time, which turns a list of things to do into a prioritisation problem. */
const HOW_LONG = /\b(\d{1,3}|a|one|two|three|four|five|six|seven|eight|nine|ten)\s+(minutes?|hours?|days?|weeks?|months?|sprints?)\b/i

/** A count of things. "eight assignments", "three projects", "twelve tickets". */
const HOW_MANY_THINGS =
  /\b(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+([a-z]{3,20}(?:s|ies)|people|children)\b/i

/** Having less time than there is work. */
const UNDER_PRESSURE = /\b(?:only|just)\s+(?:\d+|a|one|two|three|four|five)\s+(?:minutes?|hours?|days?|weeks?)\b|\bdeadline\b|\b(?:\d+|two|three|four|five)\s+(?:days?|weeks?)\s+left\b|\brunning\s+out\s+of\s+time\b/i

// ---------------------------------------------------------------- changes to one already open

const ADD_OPTION = /\b(?:add|include|also\s+consider|what\s+about|throw\s+in)\b[^.?!]{0,60}?\b(?:option|alternative|choice|candidate|one\s+more|another)\b|\badd\s+(?:a\s+)?(?:third|fourth|fifth)\b/i
const DROP_SOMETHING = /\b(?:remove|drop|ignore|forget|leave\s+out|take\s+out|never\s+mind|don'?t\s+(?:count|include|worry\s+about))\b/i
const MOVES_IMPORTANCE =
  /\b(?:matters?|counts?|weighs?)\s+(?:a\s+lot\s+)?(?:more|less|most|least)\b|\b(?:more|less|most|least)\s+important\b|\btwice\s+as\s+important\b|\bmake\s+[a-z\s]{2,30}\s+(?:the\s+)?(?:most|more|less|least)\s+important\b|\bi\s+care\s+(?:more|less)\s+about\b|\bprioriti[sz]e\s+[a-z\s]{2,30}\s+over\b/i
const CORRECTS = /\b(?:actually|no,|not\s+\d|i\s+meant|correction|instead\s+of|rather\s+than\s+\d|sorry,)\b|\bi\s+have\s+[^.?!]{1,30}\bnot\b/i
const ADDS_FACT = /\b(?:i\s+(?:already|just)\s+(?:finished|did|built|bought|started)|turns?\s+out|i\s+found\s+out|the\s+price\s+is|it\s+costs?)\b/i

const WHAT_IF =
  /\bwhat\s+if\b|\bsuppose\b|\bassume\s+(?:that\s+)?(?:the|my|i|it)\b|\bif\s+(?:i|we|the|my)\s+[^.?!]{2,60}?\s+(?:instead|would|will)\b|\bhow\s+much\s+would\b|\bwould\s+it\s+change\b|\bwhat\s+would\s+(?:make|change)\b|\bworst[\s-]case\b|\bbest[\s-]case\b/i

const GO_BACK = /\b(?:go\s+back|back\s+to|the\s+original|as\s+it\s+was|undo|previous\s+(?:assumptions?|version|comparison|answer)|show\s+the\s+(?:first|original))\b/i

const WANTS_DETAIL =
  /\b(?:in\s+(?:full|detail)|show\s+(?:me\s+)?(?:the\s+)?(?:working|workings|details?|breakdown|numbers?|scores?|calculations?|reasoning)|detailed|full\s+(?:breakdown|reasoning|analysis)|how\s+did\s+you\s+(?:work|get|decide)|explain\s+(?:your|the)\s+(?:reasoning|working|method|scores?))\b/i
const WHY_NOT = /\bwhy\s+(?:not|didn'?t|isn'?t|wasn'?t)\b|\bwhat'?s\s+wrong\s+with\b|\bwhy\s+did\s+you\s+(?:rule\s+out|reject|drop)\b/i
const HOW_METHOD = /\b(?:what\s+method|which\s+method|how\s+(?:does|did)\s+(?:the|this)\s+(?:scoring|score|ranking|maths?|arithmetic)|how\s+(?:are|were)\s+(?:the\s+)?scores?)\b/i
const WHAT_CHANGES_IT =
  /\bwhat\s+would\s+change\s+(?:your|the)\s+(?:recommendation|answer|mind)\b|\bwhich\s+assumption\s+matters\b|\bhow\s+(?:robust|solid|safe)\b|\bam\s+i\s+(?:using|making|working|basing)\b[^.?!]{0,46}?\bwrong\s+assumptions?\b|\bwhat\s+am\s+i\s+getting\s+wrong\b/i

const SAVE = /\b(?:save|keep)\s+(?:this|that|the|it)\b|\bi\s+want\s+to\s+(?:revisit|come\s+back\s+to)\s+(?:this|it)\b|\bremember\s+this\s+(?:decision|comparison)\b/i
const JUST_DECIDE =
  /\bjust\s+(?:decide|pick|choose|tell\s+me)\b|\b(?:make|give)\s+(?:your|me\s+your)\s+best\s+(?:recommendation|guess|call)\b|\bstop\s+asking\b|\byour\s+call\b|\bno\s+more\s+questions\b|\bi\s+don'?t\s+(?:know|mind)[,.]?\s*(?:you|just)\b/i

// ---------------------------------------------------------------- what kind of decision

/** Checked first, and on its own: these change what may be said, not just how it is scored. */
const HIGH_STAKES =
  /\b(?:medical|medicine|diagnos\w+|treatment|surgery|chemo\w*|symptom|prescription|doctor|hospital|therapy|legal|lawyer|solicitor|sue|lawsuit|court|contract\s+terms|visa|immigration|custody|mortgage|loan|invest(?:ing|ment)?|pension|retirement|stocks?|shares?|crypto|tax(?:es)?|resign|quit\s+my\s+job|job\s+offer|redundancy|divorce|will\s+and\s+testament|insurance\s+claim|safety|structural|electrical\s+wiring|gas\s+(?:leak|fitting)|dosage)\b/i

const BUYING =
  /\b(?:buy|buying|purchase|order|price|cost|cheaper|afford|budget|₹|\$|£|€|laptop|phone|monitor|keyboard|camera|car|headphones?|subscription|plan|tariff|warranty|brand|model)\b/i
const BUILDING =
  /\b(?:build|ship|launch|implement|feature|project|module|release|mvp|backlog|roadmap|sprint|refactor|rewrite|version)\b/i
const LEARNING =
  /\b(?:learn|learning|study|studying|course|tutorial|revise|revision|exam|syllabus|degree|python|javascript|typescript|rust|java\b|c\+\+|language\s+to\s+learn)\b/i
const TIME = /\b(?:hours?|days?|weeks?|deadline|schedule|timetable|assignments?|tasks?|chores?|homework|errands?|to[\s-]?do)\b/i
const TECHNICAL =
  /\b(?:architecture|database|framework|library|api|stack|schema|protocol|algorithm|infrastructure|deployment|hosting|server|cache|queue|microservices?|monolith|sql|nosql|rest\b|graphql|approach|solution|design\s+pattern)\b/i

function sortOf(text: string): DecisionSort {
  if (HIGH_STAKES.test(text)) return 'high-stakes'
  const scores: readonly [DecisionSort, number][] = [
    ['buying', count(text, BUYING)],
    ['what-to-build-first', count(text, BUILDING)],
    ['learning', count(text, LEARNING)],
    ['time', count(text, TIME)],
    ['technical', count(text, TECHNICAL)]
  ]
  const best = scores.reduce((top, one) => (one[1] > top[1] ? one : top), ['other', 0] as [DecisionSort, number])
  return best[1] > 0 ? best[0] : 'other'
}

/** How many times a pattern matches, which is a rough measure of how much a message is about something. */
function count(text: string, pattern: RegExp): number {
  const all = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
  return (text.match(all) ?? []).length
}

// ---------------------------------------------------------------- the things named

/**
 * The things the message sets against each other, as the person wrote them.
 *
 * Only ever substrings of what they typed. Orion does the real extraction later with the whole message in front of
 * it; these are a hint to it and a sanity check on what it comes back with, so an option that was never mentioned
 * can be spotted.
 */
export function namedIn(message: string): string[] {
  const text = String(message ?? '')
  const found: string[] = []

  const between = /\bbetween\s+([^.?!;]{2,90}?)\s+(?:and|or)\s+([^.?!;]{2,90}?)(?=[.?!;,]|$|\s+(?:first|for|because|but|so)\b)/i.exec(text)
  if (between) found.push(between[1], between[2])

  if (found.length === 0) {
    const either = /\b(?:either|whether)\s+([^.?!;]{2,70}?)\s+or\s+([^.?!;]{2,70}?)(?=[.?!;,]|$)/i.exec(text)
    if (either) found.push(either[1], either[2])
  }

  if (found.length === 0) {
    // "Should I build Orbis Music or Orbis Files first?" -- the or-list after a deciding verb.
    const orList = /\b(?:should\s+i|shall\s+i|do\s+i)\s+(?:\w+\s+){0,3}?([A-Za-z][^.?!;]{1,60}?)\s+or\s+([^.?!;]{1,60}?)(?=[.?!;,]|$|\s+(?:first|next|instead)\b)/i.exec(text)
    if (orList) found.push(orList[1], orList[2])
  }

  return found
    .map((one) =>
      one
        .replace(/^\s*(?:the|a|an|my|building|learning|buying|using|doing|going\s+with)\s+/i, '')
        .replace(/\s+(?:first|next|instead|now)\s*$/i, '')
        .trim()
    )
    .filter((one) => one.length >= 2 && one.length <= 70)
    .slice(0, 6)
}

// ---------------------------------------------------------------- the reading

/**
 * What to do with one message.
 *
 * Order matters and is deliberate. A change to an open decision is checked before a new one, because "add another
 * option" read as a brand-new decision throws away everything already established. Teaching and arithmetic are
 * checked before both, except when somebody is plainly asking on their own behalf as well -- "what is a GPU, and
 * should I get the 8GB or the 16GB" is both, and the decision is the part that needs work done on it.
 */
export function readMessage(message: string, context: Context = { hasOpen: false }): Reading {
  /*
   * Curly quotes become straight ones first.
   *
   * Every pattern below is written with an ASCII apostrophe, and Windows, iOS and most editors produce the typographic
   * one. "Why didn't you choose C" read as not a question about the decision -- and nothing about the message looked
   * wrong -- because of one character.
   */
  const text = String(message ?? '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .trim()
  if (text === '' || text.length > 8000) return { want: 'nothing' }

  const asking = ASKING.test(text)

  // ---- a decision already on the table
  if (context.hasOpen) {
    if (SAVE.test(text)) return { want: 'save' }
    if (WHAT_CHANGES_IT.test(text)) return { want: 'detail', of: 'what-would-change-it' }
    if (HOW_METHOD.test(text)) return { want: 'detail', of: 'how-it-worked' }
    if (WHY_NOT.test(text)) return { want: 'detail', of: 'why-not' }
    if (WANTS_DETAIL.test(text)) return { want: 'detail', of: 'everything' }
    if (JUST_DECIDE.test(text)) return { want: 'just-decide' }
    if (GO_BACK.test(text)) return { want: 'change', saw: ['back to how it was'] }
    if (WHAT_IF.test(text)) return { want: 'what-if', saw: ['a what-if'] }

    const changes: string[] = []
    if (ADD_OPTION.test(text)) changes.push('another option')
    if (DROP_SOMETHING.test(text)) changes.push('something taken out')
    if (MOVES_IMPORTANCE.test(text)) changes.push('what matters has moved')
    if (CORRECTS.test(text)) changes.push('a correction')
    if (ADDS_FACT.test(text)) changes.push('something new that is known')
    if (changes.length > 0) return { want: 'change', saw: changes }
  }

  // ---- things that are not decisions
  const teaching = TEACHING.test(text) || ABOUT_DECIDING.test(text)
  if (SUMS.test(text) && !asking) return { want: 'nothing', because: 'it is an arithmetic question' }
  if (ABOUT_DECIDING.test(text) && !asking) return { want: 'nothing', because: 'it is a question about how deciding works' }
  if (MAKE_ME.test(text) && !asking) return { want: 'nothing', because: 'it is asking for something to be made' }

  // ---- a new decision
  const saw: string[] = []
  if (asking) saw.push('asking on your own behalf')
  const against = SET_AGAINST.test(text)
  if (against) saw.push('options set against each other')
  const ordering = ORDERING.test(text)
  if (ordering) saw.push('putting things in order')
  const weighing = WEIGHING.test(text)
  if (weighing) saw.push('weighing things up')
  /*
   * "I have four hours and eight assignments" never says the word choose. It is a decision because of its shape: an
   * amount of a resource beside a number of things that need it. Missing this is the single most likely way a real
   * decision gets answered as small talk.
   */
  const squeezed = (HOW_LONG.test(text) || UNDER_PRESSURE.test(text)) && HOW_MANY_THINGS.test(text)
  if (squeezed) saw.push('less time than there is to do')

  const named = namedIn(text)
  if (named.length >= 2) saw.push(`${named.length} things named`)

  const strong = (asking && (against || named.length >= 2 || ordering || weighing || squeezed)) || (squeezed && ordering)
  const some = asking || against || ordering || squeezed || (weighing && /\bi\b|\bmy\b|\bwe\b/i.test(text))

  if (strong) {
    if (teaching) saw.push('there is a question in it as well')
    return { want: 'new', sure: 'clear', sort: sortOf(text), named, saw }
  }

  if (some && !teaching) {
    return { want: 'new', sure: 'probable', sort: sortOf(text), named, saw }
  }

  if (some && teaching) {
    /*
     * Both at once, and neither clearly. One short question, because guessing either way is worse: a decision
     * workspace over "what is the difference between Rust and Go" is an interruption, and a paragraph about Rust
     * when somebody is choosing between them is no help.
     */
    return {
      want: 'unsure',
      ask: 'Do you want me to explain the difference, or help you pick between them?'
    }
  }

  // Comparisons alone are not decisions. "Python is better than Perl for this" is a statement.
  if (against || weighing) return { want: 'nothing', because: 'it mentions a comparison but is not asking to choose' }
  return { want: 'nothing' }
}
