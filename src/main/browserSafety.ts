/** What Orbis reads about the element an action targets. */
export interface ElementInfo {
  tag: string
  type?: string
  role?: string
  /** Visible text or accessible name. */
  label: string
  name?: string
  autocomplete?: string
  href?: string
  inForm: boolean
  /** The element's form is a search form. */
  searchForm: boolean
  /** A button or input that submits its form. */
  submits: boolean
  /** A field that takes typed text. */
  editable: boolean
}

export type BrowserAction =
  | { kind: 'click'; element: ElementInfo; flagged: boolean }
  | { kind: 'type'; element: ElementInfo; text: string; submit: boolean; flagged: boolean }
  | { kind: 'key'; key: string; element: ElementInfo | null; flagged: boolean }
  | { kind: 'select'; element: ElementInfo; option: string; flagged: boolean }

export type SafetyVerdict = { decision: 'run' } | { decision: 'confirm'; reason: string } | { decision: 'block'; reason: string }

/** Words on buttons whose effect usually reaches beyond the browser. */
const BUTTON_ACTIONS =
  /\b(buy|purchase|order|check ?out|pay|payment|send|submit|post|publish|tweet|reply|comment|delete|remove|erase|book|reserve|confirm|subscribe|unsubscribe|sign ?in|log ?in|log ?out|sign ?out|sign ?up|register|create (?:an )?account|join|transfer|donate|apply|upload|share|follow|unfollow|accept|agree|bid|save changes|update)\b/i
/** Links normally just navigate; links with these words usually do something. */
const LINK_ACTIONS = /\b(buy now|check ?out|pay(?: now)?|delete|remove|unsubscribe|log ?out|sign ?out|confirm|place (?:your )?order|donate|transfer)\b/i
/** Fields Orbis never fills in. */
const SENSITIVE =
  /\b(pass(?:word|code)?|pwd|pin|otp|one[- ]?time|verification code|security code|cvv|cvc|csc|card ?number|credit card|debit card|expiry|iban|account number|routing number|ssn|social security)\b|cc-|current-password|new-password|one-time-code/i

const run: SafetyVerdict = { decision: 'run' }
const confirm = (reason: string): SafetyVerdict => ({ decision: 'confirm', reason })
const block = (reason: string): SafetyVerdict => ({ decision: 'block', reason })

function isSensitive(el: ElementInfo): boolean {
  return el.type === 'password' || SENSITIVE.test(`${el.autocomplete ?? ''} ${el.name ?? ''} ${el.label}`)
}

function isSearchField(el: ElementInfo): boolean {
  return (
    el.type === 'search' ||
    el.role === 'searchbox' ||
    el.searchForm ||
    /^(q|query|search|search_query|keywords?|s|k|p)$/i.test(el.name ?? '') ||
    /\bsearch\b/i.test(el.label)
  )
}

function clickVerdict(el: ElementInfo): SafetyVerdict {
  if (el.submits && el.inForm && !el.searchForm) return confirm('This submits a form, which may send information to the website.')
  const words = el.tag === 'a' && el.href ? LINK_ACTIONS : BUTTON_ACTIONS
  if (words.test(el.label)) {
    return confirm(`“${el.label.slice(0, 60)}” may make a change outside the browser, such as an order, a message or an account change.`)
  }
  return run
}

/**
 * Orbis's browsing policy. Reversible browsing (opening pages, reading, links, scrolling, searching, filling
 * ordinary fields) runs; anything that submits, buys, sends, posts, books, deletes or logs in needs the user's
 * approval, as does anything the model itself is unsure about; passwords, codes and payment details are never typed.
 */
export function assessAction(action: BrowserAction): SafetyVerdict {
  let verdict = run
  switch (action.kind) {
    case 'type':
      if (isSensitive(action.element)) return block("Orbis doesn't type passwords, codes or payment details.")
      if (action.submit && !isSearchField(action.element)) verdict = confirm('Pressing Enter after typing may submit or send it.')
      break
    case 'key':
      if (action.key === 'Enter' && action.element) {
        if (!action.element.editable) verdict = clickVerdict(action.element)
        else if (!isSearchField(action.element)) verdict = confirm('Pressing Enter here may submit or send what was entered.')
      }
      break
    case 'click':
      verdict = clickVerdict(action.element)
      break
    case 'select':
      break
  }
  // When the impact is unclear to the model, it asks too.
  if (verdict.decision === 'run' && action.flagged) return confirm('Orbis thinks this action could have an effect outside the browser.')
  return verdict
}
