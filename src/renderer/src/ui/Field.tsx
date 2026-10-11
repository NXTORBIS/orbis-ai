import { useId } from 'react'
import type { ReactNode } from 'react'

/**
 * A control with a name, and sometimes a sentence saying what it does.
 *
 * This is the biggest pile in the window by a long way: three hundred and thirty-nine of them, across `.field`,
 * `.setting`, `.page-field`, `.pw-field`, `.st-field` and a dozen more. They are not inconsistent about how they
 * look. They are inconsistent about one thing that decides whether the control can be used without looking at it.
 *
 * **Where the explanation goes.** Ten families put the sentence *inside* the labelling element, which makes it
 * part of the control's name — so instead of "Open on launch", a screen reader says the label and then the whole
 * explanation, every time, as if that were what the switch is called. The sentence belongs beside the field and
 * pointed at with `aria-describedby`: then it is read after the name, once, as a description. That is the one
 * decision this component makes for everybody.
 *
 * The control is a function of its wiring rather than a child element, because the id has to reach the input and
 * only the input knows what it is. Nothing is guessed and nothing is bolted on afterwards.
 *
 * No new CSS. The family's own classes are passed straight through, so a converted field is the same pixels.
 */
export interface FieldWiring {
  id: string
  'aria-describedby': string | undefined
  'aria-invalid': true | undefined
}

export interface FieldProps {
  /** What the control is called. Required: this is the whole point. */
  label: ReactNode
  /** The control itself, wired up. */
  children: (wiring: FieldWiring) => ReactNode
  /** The sentence under it. Described, never part of the name. */
  hint?: ReactNode
  /** What is wrong, when something is. Described and marked, so it is not left to the colour alone. */
  problem?: string
  /** The family's wrapper class — `setting`, `page-field`, `st-field`. */
  className?: string
  /** The family's label class — `setting-label`. */
  labelClassName?: string
  /** The family's hint class — `setting-note`, `pw-note`. */
  hintClassName?: string
  /** Something small beside the label — a count, a state. */
  badge?: ReactNode
  /**
   * `label` wraps a single control and is right nearly always. `fieldset` is for a group of radios or checkboxes,
   * where a `label` would claim to name one of them.
   */
  as?: 'label' | 'fieldset' | 'div'
}

export function Field({
  label,
  children,
  hint,
  problem,
  className,
  labelClassName,
  hintClassName,
  badge,
  as = 'label'
}: FieldProps): React.JSX.Element {
  const base = useId()
  const id = `${base}-field`
  const hintId = hint === undefined ? undefined : `${base}-hint`
  const problemId = problem === undefined ? undefined : `${base}-problem`
  const describedBy = [problemId, hintId].filter((one) => one !== undefined).join(' ') || undefined
  const wiring: FieldWiring = { id, 'aria-describedby': describedBy, 'aria-invalid': problem === undefined ? undefined : true }

  const name =
    as === 'fieldset' ? (
      <legend className={labelClassName}>
        {label}
        {badge}
      </legend>
    ) : (
      <label className={labelClassName} htmlFor={id}>
        {label}
        {badge}
      </label>
    )

  const inside = (
    <>
      {name}
      {children(wiring)}
      {/* After the control, not inside the label: part of the description, never part of the name. */}
      {problem === undefined ? null : (
        <p className={hintClassName} id={problemId} role="alert">
          {problem}
        </p>
      )}
      {hint === undefined ? null : (
        <p className={hintClassName} id={hintId}>
          {hint}
        </p>
      )}
    </>
  )

  if (as === 'fieldset') return <fieldset className={className}>{inside}</fieldset>
  return <div className={className}>{inside}</div>
}
