// The lock surface.
//
// Two conversations and nothing else. The browser is asked what this surface is covering -- a label and a tab id, never
// an address -- and Orbis is asked whether a password is right, because Orbis is what holds it.
//
// This page cannot unlock anything by itself. It has no credential, no verifier and no way to hide itself: when a password
// is accepted, Orbis marks the tab unlocked and the browser takes this surface away. That is why there is no "success"
// branch here that reveals a page -- there is nothing here that could.

import { askBrowser, call, HelperDown } from './helper.js'

const $ = (id) => document.getElementById(id)

const surface = document.querySelector('.lock')
const heading = $('lock-heading')
const form = $('unlock')
const password = $('password')
const reveal = $('reveal')
const submit = $('submit')
const problem = $('problem')
const forgot = $('forgot')
const recover = $('recover')
const account = $('account')
const fresh = $('fresh')
const again = $('again')
const recoverProblem = $('recover-problem')
const reset = $('reset')
const cancel = $('cancel')

/** The tab this surface is over, as Orbis knows it. Zero until the browser has answered. */
let tabId = 0

/** One short shake, then the message. Removed on the next keystroke so it does not sit there while somebody retypes. */
const complain = (where, said) => {
  where.textContent = said
  surface.classList.add('is-wrong')
  setTimeout(() => surface.classList.remove('is-wrong'), 260)
}

const clear = () => {
  problem.textContent = ''
  recoverProblem.textContent = ''
}

/** Whatever came back, as a sentence. A refusal carries a code; anything else is not worth repeating. */
const sentence = (err) => {
  if (err instanceof HelperDown) return 'Orbis is not running.'
  const code = err?.code
  if (code === 'wrong-password') return 'That is not the password for this tab.'
  if (code === 'cooling-down') return 'Too many attempts. Wait a moment and try again.'
  if (code === 'weak-password') return 'Choose a longer password.'
  if (code === 'no-recovery') return 'Your account password cannot reset this one.'
  if (code === 'account-locked') return 'Open Orbis and sign in to your account first.'
  if (code === 'no-group') return 'This tab is no longer locked.'
  return err?.message || 'That did not work.'
}

// ---------------------------------------------------------------- what this is covering

async function describe() {
  try {
    const said = await askBrowser('orbis.lockSurface.state')
    if (said?.label) {
      heading.textContent = said.label
      // The accessible name says what it is, not what it hides. "Unlock protected tab", never "Unlock Gmail".
      password.setAttribute('aria-label', 'Password for this protected tab')
    }
    tabId = Number(said?.tabId) || 0
  } catch {
    // The browser is the only thing that knows, so if it cannot say, the default label in the markup stands. It reveals
    // nothing either way, which is why there is nothing to recover from here.
  }

  // Whether to offer recovery at all. Asked of Orbis, because whether the account password can reset this credential
  // depends on whether the account was open when it was made -- and offering a way out that will be refused is worse
  // than not offering one.
  if (tabId === 0) return
  try {
    const state = await call('tabLock:surface', [tabId])
    forgot.hidden = !state?.recoverable
  } catch {
    forgot.hidden = true
  }
}

// ---------------------------------------------------------------- the password

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  clear()
  if (!password.value) {
    complain(problem, 'Enter the password for this tab.')
    password.focus()
    return
  }
  if (tabId === 0) {
    complain(problem, 'Orbis cannot tell which tab this is. Try again in a moment.')
    return
  }
  submit.disabled = true
  submit.textContent = 'Checking…'
  try {
    await call('tabLock:unlock', [tabId, password.value])
    // Nothing to do on success. Orbis marks the tab unlocked and the browser takes this surface away; a page that could
    // reveal the tab itself would be a page worth attacking.
    password.value = ''
  } catch (err) {
    complain(problem, sentence(err))
    password.select()
  } finally {
    submit.disabled = false
    submit.textContent = 'Unlock'
  }
})

password.addEventListener('input', () => {
  problem.textContent = ''
})

reveal.setAttribute('aria-pressed', 'false')
reveal.addEventListener('click', () => {
  const showing = password.type === 'text'
  password.type = showing ? 'password' : 'text'
  reveal.setAttribute('aria-pressed', String(!showing))
  reveal.setAttribute('aria-label', showing ? 'Show password' : 'Hide password')
  password.focus()
})

// ---------------------------------------------------------------- forgotten

forgot.hidden = true
forgot.addEventListener('click', () => {
  clear()
  form.hidden = true
  forgot.hidden = true
  recover.hidden = false
  account.focus()
})

cancel.addEventListener('click', () => {
  clear()
  account.value = ''
  fresh.value = ''
  again.value = ''
  recover.hidden = true
  form.hidden = false
  forgot.hidden = false
  password.focus()
})

recover.addEventListener('submit', async (event) => {
  event.preventDefault()
  clear()
  if (!account.value) {
    complain(recoverProblem, 'Enter your Orbis account password.')
    return
  }
  if (fresh.value !== again.value) {
    complain(recoverProblem, 'The two new passwords do not match.')
    again.focus()
    return
  }
  if (!fresh.value) {
    complain(recoverProblem, 'Choose a new password for this tab.')
    return
  }
  reset.disabled = true
  reset.textContent = 'Checking…'
  try {
    await call('tabLock:recover', [tabId, account.value, fresh.value])
    // Same as above: the surface goes away because Orbis unlocked the tab, not because this page decided to.
    account.value = ''
    fresh.value = ''
    again.value = ''
  } catch (err) {
    complain(recoverProblem, sentence(err))
  } finally {
    reset.disabled = false
    reset.textContent = 'Set new password'
  }
})

// Escape steps back from recovery to the password, and does nothing at all on the password itself -- there is no way out
// of a locked tab from inside it, and a key that appeared to offer one would be a lie.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !recover.hidden) {
    event.preventDefault()
    cancel.click()
  }
})

void describe()
