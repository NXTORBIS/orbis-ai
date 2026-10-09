import { Search } from 'lucide-react'
import { useId } from 'react'
import './ui.css'

/**
 * A box you type into to narrow a list.
 *
 * There are sixteen of these in the window and they disagree about the one thing that matters: what Escape does.
 * Most ignore it, so Escape closes the screen while there is still a half-typed query in the box; Markets swallows
 * it to clear the box, so Escape there does not close the screen and nobody can tell which they will get.
 *
 * The rule here, which is the one a person can learn: **Escape clears the box when there is something in it, and
 * otherwise it belongs to the screen.** A box with text in it is a thing you are in the middle of, so Escape undoes
 * that; an empty box is not, so Escape means "out of this screen" as it does everywhere else. It is implemented by
 * calling `preventDefault` only in the first case, which is exactly the contract the shell in `App.tsx` expects.
 *
 * The field carries its own name in `aria-label` rather than leaning on the placeholder. A placeholder disappears
 * the moment somebody types, which is precisely when they might want to check what the box was for.
 */
export interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
  /** What this box searches. Becomes the accessible name, and the placeholder when none is given. */
  label: string
  placeholder?: string
  /** Narrower, for a toolbar. */
  small?: boolean
  autoFocus?: boolean
}

export function SearchBox({ value, onChange, label, placeholder, small, autoFocus }: SearchBoxProps): React.JSX.Element {
  const id = useId()
  return (
    <div className={['ui-search', small ? 'small' : ''].filter((one) => one !== '').join(' ')}>
      <Search size={14} aria-hidden="true" />
      <input
        id={id}
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder ?? label}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          // Only when there is something to clear. An empty box lets Escape through to the screen.
          if (value === '') return
          event.preventDefault()
          event.stopPropagation()
          onChange('')
        }}
      />
    </div>
  )
}
