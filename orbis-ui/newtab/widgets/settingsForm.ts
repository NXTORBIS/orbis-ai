import { button, h } from './dom.ts'
import { clampDraft, formFields, readNumber, roomLeft, stepNumber, type FormField, type Settings } from './studioLogic.ts'
import { type WidgetDefinition } from '../../../src/shared/widgets.ts'

/**
 * A widget's settings, as a form.
 *
 * Built entirely from what the catalogue says the widget takes, so a widget that gains a setting gains a control
 * here without a line being written for it. Nothing is invented: a choice with one option is no control, and a
 * setting edited on the widget itself -- the words of a sticky note -- is said to be there rather than offered twice.
 *
 * What is typed waits a moment before it is sent on, because a studio that sent every keystroke would ask Orbis to
 * save a city called "C", then "Ch", then "Che". What is pressed -- a switch, one of a row of choices -- is sent at
 * once, together with anything still waiting, because pressing it was the whole decision.
 */

export interface SettingsFormOptions {
  definition: WidgetDefinition
  settings: Readonly<Settings>
  /** How long typing settles for before it is sent on. 0 sends at once, which is what a preview wants. */
  waitMs?: number
  /** Everything the widget takes, with what changed in it. Sent whole: the caller works out what is different. */
  onChange(settings: Settings): void
  /** Said quietly to somebody listening rather than looking. */
  announce?: (text: string) => void
}

export interface SettingsForm {
  element: HTMLElement
  /** Whether the widget has anything at all to set. */
  empty: boolean
  /** Sends anything still waiting, now. */
  flush(): void
  /** Whether something is being typed or is still waiting to be sent. */
  busy(): boolean
  /** Shows a different set of settings, for when they were changed somewhere else. */
  set(settings: Readonly<Settings>): void
  destroy(): void
}

let forms = 0

export function createSettingsForm(options: SettingsFormOptions): SettingsForm {
  const { definition } = options
  const wait = options.waitMs ?? 0
  const mine = `wgset${forms++}`
  let draft: Settings = clampDraft(definition, options.settings)
  let timer: ReturnType<typeof setTimeout> | null = null
  const controls = new Map<string, (value: Settings[string]) => void>()

  const send = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    options.onChange(clampDraft(definition, draft))
  }
  const later = (): void => {
    if (timer !== null) clearTimeout(timer)
    if (wait <= 0) return send()
    timer = setTimeout(() => {
      timer = null
      options.onChange(clampDraft(definition, draft))
    }, wait)
  }
  const say = (text: string): void => options.announce?.(text)

  const element = h('div', { class: 'wg-form' })
  const fields = formFields(definition, draft)
  for (const field of fields) element.append(drawField(field))

  // A setting the widget keeps on its own face is said to be there, so nobody hunts for it in the settings.
  for (const spec of definition.settings) {
    if (spec.onCard) element.append(h('p', { class: 'wg-note', text: `${spec.label} is typed on the widget itself.` }))
  }
  if (fields.length === 0) element.append(h('p', { class: 'wg-form-none', text: `${definition.name} has nothing to set.` }))

  return {
    element,
    empty: fields.length === 0,
    flush: () => {
      if (timer !== null) send()
    },
    busy: () => timer !== null || (document.activeElement instanceof HTMLElement && element.contains(document.activeElement) && isTyped(document.activeElement)),
    set(settings) {
      draft = clampDraft(definition, settings)
      for (const [name, show] of controls) show(draft[name])
    },
    destroy: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
  }

  // ---------------------------------------------------------------- one control each

  function drawField(field: FormField): HTMLElement {
    const id = `${mine}-${field.name}`
    const hintId = `${id}-hint`
    const errorId = `${id}-error`
    const hint = h('p', { class: 'wg-form-hint', id: hintId })
    const error = h('p', { class: 'wg-form-error', id: errorId, role: 'alert' })
    const described = (): string => [hint.textContent ? hintId : '', error.textContent ? errorId : ''].filter(Boolean).join(' ')

    if (field.kind === 'switch') {
      const input = h('input', { class: 'wg-form-switch', type: 'checkbox', id, role: 'switch', checked: field.value })
      input.addEventListener('change', () => {
        draft[field.name] = input.checked
        send()
        say(`${field.label} is ${input.checked ? 'on' : 'off'}.`)
      })
      controls.set(field.name, (value) => {
        input.checked = value === true
      })
      return h('div', { class: 'wg-form-row wg-form-row-switch' }, input, h('label', { class: 'wg-form-label', for: id, text: field.label }))
    }

    if (field.kind === 'number') {
      const spec = definition.settings.find((one) => one.name === field.name)!
      const input = h('input', { class: 'wg-form-input wg-form-number', type: 'number', id, value: String(field.value), inputmode: 'numeric', ...(field.min === null ? {} : { min: field.min }), ...(field.max === null ? {} : { max: field.max }) })
      hint.textContent = field.range
      input.setAttribute('aria-describedby', described())
      const read = (): void => {
        const reading = readNumber(spec, input.value)
        if (!reading.ok) {
          error.textContent = reading.error
          input.setAttribute('aria-invalid', 'true')
          input.setAttribute('aria-describedby', described())
          return
        }
        error.textContent = ''
        input.removeAttribute('aria-invalid')
        hint.textContent = reading.note === '' ? field.range : `${field.range} ${reading.note}`.trim()
        input.setAttribute('aria-describedby', described())
        draft[field.name] = reading.value
        later()
      }
      input.addEventListener('input', read)
      // Leaving the box is when a number past either end is put back where it belongs, in front of the person.
      input.addEventListener('blur', () => {
        const reading = readNumber(spec, input.value)
        if (reading.ok && String(reading.value) !== input.value.trim()) input.value = String(reading.value)
        if (timer !== null) send()
      })
      const step = (by: 1 | -1): void => {
        const next = stepNumber(spec, Number(input.value), by)
        input.value = String(next)
        read()
        say(`${field.label} is ${next}.`)
      }
      controls.set(field.name, (value) => {
        input.value = String(value)
        error.textContent = ''
        input.removeAttribute('aria-invalid')
      })
      return h('div', { class: 'wg-form-row' },
        h('label', { class: 'wg-form-label', for: id, text: field.label }),
        h('div', { class: 'wg-form-stepper' },
          button(`Fewer ${field.label.toLowerCase()}`, () => step(-1), 'âˆ’', 'wg-icon-btn wg-form-step'),
          input,
          button(`More ${field.label.toLowerCase()}`, () => step(1), '+', 'wg-icon-btn wg-form-step')
        ),
        hint,
        error
      )
    }

    if (field.kind === 'text') {
      const input = h('input', { class: 'wg-form-input', type: 'text', id, value: field.value, maxlength: field.maxLength, ...(field.placeholder ? { placeholder: field.placeholder } : {}) })
      hint.textContent = roomLeft(field.value.length, field.maxLength)
      input.setAttribute('aria-describedby', described())
      input.addEventListener('input', () => {
        draft[field.name] = input.value
        hint.textContent = roomLeft(input.value.length, field.maxLength)
        input.setAttribute('aria-describedby', described())
        later()
      })
      input.addEventListener('blur', () => {
        if (timer !== null) send()
      })
      controls.set(field.name, (value) => {
        input.value = String(value)
        hint.textContent = roomLeft(input.value.length, field.maxLength)
      })
      return h('div', { class: 'wg-form-row' }, h('label', { class: 'wg-form-label', for: id, text: field.label }), input, hint, error)
    }

    if (field.kind === 'select') {
      const picker = h('select', { class: 'wg-form-select', id })
      for (const choice of field.choices) picker.append(h('option', { value: choice.value, text: choice.label }))
      // Set after the choices are in: a select with nothing in it has nothing to be set to.
      picker.value = field.value
      picker.addEventListener('change', () => {
        draft[field.name] = picker.value
        send()
        say(`${field.label} is ${picker.options[picker.selectedIndex]?.text.toLowerCase() ?? picker.value}.`)
      })
      controls.set(field.name, (value) => {
        picker.value = String(value)
      })
      return h('div', { class: 'wg-form-row' }, h('label', { class: 'wg-form-label', for: id, text: field.label }), picker)
    }

    {
      const name = `${id}-pick`
      const row = h('div', { class: 'wg-form-seg', role: 'radiogroup', 'aria-label': field.label })
      const inputs = new Map<string, HTMLInputElement>()
      for (const choice of field.choices) {
        const oneId = `${name}-${choice.value}`
        const input = h('input', { class: 'wg-form-seg-input', type: 'radio', name, id: oneId, value: choice.value, checked: choice.value === field.value })
        input.addEventListener('change', () => {
          if (!input.checked) return
          draft[field.name] = choice.value
          send()
          say(`${field.label} is ${choice.label.toLowerCase()}.`)
        })
        inputs.set(choice.value, input)
        row.append(input, h('label', { class: 'wg-form-seg-one', for: oneId, text: choice.label }))
      }
      controls.set(field.name, (value) => {
        const input = inputs.get(String(value))
        if (input) input.checked = true
      })
      return h('div', { class: 'wg-form-row' }, h('span', { class: 'wg-form-label', id: `${id}-name`, text: field.label }), row)
    }
  }
}

/** Whether what has the keyboard is a box somebody is typing in, rather than a switch or a row of choices. */
const isTyped = (node: HTMLElement): boolean => node instanceof HTMLInputElement && (node.type === 'text' || node.type === 'number')
