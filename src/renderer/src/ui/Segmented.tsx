import type { ReactNode } from 'react'

/**
 * Pick one of a few.
 *
 * There are fifty of these in the window — `mk-seg`, `mk-tabs`, `mk-modes`, `p2-tabs`, `st-tabs`, `cz-tabs` and
 * the rest — and they disagree about the two things that matter.
 *
 * **Which one is chosen.** Twelve strips say it properly, with `aria-selected`. The rest say it with a class and
 * nothing else, so anything not looking at the screen is told there are four buttons and nothing about which one
 * you are on. Worse, `native/LabShell.tsx` never adds the lit class at all, so in **twenty laboratories** the
 * chosen tab has looked exactly like the others. That is not a style disagreement; it is a strip that does not
 * work, repeated twenty times, and it is the reason this component exists rather than a convention.
 *
 * **What it is for.** `label` is required, because a bare row of three words — "Day", "Week", "Month" — means
 * nothing on its own. It is the question the buttons are answering.
 *
 * No new CSS. The strip keeps whatever class it already had; this only fixes what it says about itself.
 */
export interface SegmentedOption<T> {
  value: T
  /** What the button shows. */
  label: ReactNode
  /** What it is called, when the label is a symbol or an abbreviation. */
  name?: string
  disabled?: boolean
  /** Why it cannot be picked, shown on hover. */
  why?: string
}

export interface SegmentedProps<T extends string> {
  /** Which one is on. */
  value: T | null
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  /** The question these are answering. Required: three bare words are not a question. */
  label: string
  /** The strip's own class — `mk-seg`, `p2-tabs`, `st-tabs`. */
  className?: string
  /** Each button's class, when the strip styles its buttons by class rather than by element. */
  optionClass?: string
  /** What the chosen one wears. Nearly always `on`. */
  litClass?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  optionClass,
  litClass = 'on'
}: SegmentedProps<T>): React.JSX.Element | null {
  // One choice is not a choice. `LabShell` already guarded this and every other strip forgot to.
  if (options.length < 2) return null
  return (
    <div className={className} role="tablist" aria-label={label}>
      {options.map((one) => {
        const chosen = one.value === value
        return (
          <button
            key={String(one.value)}
            type="button"
            role="tab"
            aria-selected={chosen}
            // A tab nobody can reach with the keyboard is a tab for mouse users only: the chosen one holds the
            // tab stop and the arrow keys move between them, which is how a strip of tabs is meant to behave.
            tabIndex={chosen ? 0 : -1}
            disabled={one.disabled}
            title={one.why}
            className={[optionClass ?? '', chosen ? litClass : ''].filter((bit) => bit !== '').join(' ')}
            onClick={() => onChange(one.value)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              if (step === 0) return
              event.preventDefault()
              const usable = options.filter((other) => !other.disabled)
              const at = usable.findIndex((other) => other.value === value)
              const next = usable[(at + step + usable.length) % usable.length]
              if (next) onChange(next.value)
            }}
            aria-label={one.name}
          >
            {one.label}
          </button>
        )
      })}
    </div>
  )
}
