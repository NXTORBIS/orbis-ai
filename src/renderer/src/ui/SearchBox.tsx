import { Search, X } from 'lucide-react'
import { useId, type Ref } from 'react'
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
  /**
   * The screen's own rule for *where this box sits* — how much room it takes in the row it is in.
   *
   * Nothing else. The border, the corner, the colours, the font, the focus ring, the placeholder and the clear
   * button all come from `.ui-search`, which is the whole point; six screens had written all of that out again
   * and disagreed about every line of it. What a screen genuinely owns is its own layout, so that stays with the
   * screen — written against the row it is in, never as a class of its own, so no two screens can collide.
   */
  className?: string
  /**
   * A clear button beside the field, for the screens that already had one.
   *
   * Escape clears the box whether this is set or not. This is the *visible* way to do it, which several screens
   * had and which would be a control taken away if it went.
   */
  clearable?: boolean
  /** A handle on the field, for a screen that focuses it from a keyboard shortcut of its own. */
  inputRef?: Ref<HTMLInputElement>
  /** A tooltip on the field — worth it only when the screen has keys of its own worth saying out loud. */
  title?: string
  /**
   * A cap on how much can be typed.
   *
   * Several of the boxes this replaced had one, and it is not decoration: the query goes to a provider, and a box
   * with no limit lets somebody paste a novel into a web request.
   */
  maxLength?: number
  /**
   * The id of the list this box is driving, when there is one on screen under it.
   *
   * It becomes `aria-controls`, which is what tells somebody using a screen reader that typing here changes that
   * list rather than something they cannot see.
   */
  controls?: string
}

export function SearchBox({ value, onChange, label, placeholder, small, autoFocus, className, clearable, inputRef, title, maxLength, controls }: SearchBoxProps): React.JSX.Element {
  const id = useId()
  return (
    <div className={['ui-search', small ? 'small' : '', className ?? ''].filter((one) => one !== '').join(' ')}>
      <Search size={14} aria-hidden="true" />
      <input
        id={id}
        ref={inputRef}
        type="search"
        aria-label={label}
        title={title}
        maxLength={maxLength}
        aria-controls={controls}
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
      {clearable && value !== '' && (
        <button type="button" aria-label="Clear the search" onClick={() => onChange('')}>
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
