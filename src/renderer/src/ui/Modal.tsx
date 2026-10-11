import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from './IconButton'
import { useFocusTrap } from '../lib/useFocusTrap'

/**
 * A panel over the window that has to be dealt with before anything else.
 *
 * Thirty-three hand-written ones, and two of them have **no keyboard way out at all**. The shell's Escape handler
 * steps aside the moment it sees a dialog on screen — rightly, or one key would close two things — but Shortcuts
 * and the Workspaces confirmation never pick the key up on the other side. In both, Escape does nothing and the
 * mouse is the only way out. That is what this fixes first: Escape belongs to the dialog, and every dialog built
 * from this has it.
 *
 * **The name is required**, and that is deliberate beyond politeness. The guard that has been keeping dialogs
 * honest, `accessibleUi.test.ts`, works by searching the screen files for the words `role="dialog"`. The moment
 * those words live once, here, that search covers nothing. A required `label` is what keeps the promise after the
 * guard stops being able to: there is no way to render a dialog with no name. Same move `IconButton` made.
 *
 * **Focus is held inside** with `useFocusTrap`, which only Settings had. Not `useDismiss` — that one is built for
 * menus, and a menu's habits are wrong for a dialog.
 *
 * **A click on the backdrop closes it, but only a click that began there.** A drag that started inside the panel
 * and ended outside is not somebody dismissing it; it is somebody selecting text. Pass `keepsTyping` for a dialog
 * holding words somebody has written, where a stray click should never throw them away.
 *
 * No new CSS: `.modal-backdrop`, `.modal`, `.glass`, `.modal-header` and `.modal-body` already exist. Note that
 * `.modal` carries no background of its own — that comes from `glass` — and `.modal` is the only thing the
 * Corners setting hooks onto, so a panel that drops it quietly stops answering that setting.
 */
export interface ModalProps {
  /** What this dialog is called. Required — see above. */
  label: string
  /** Closing it. Required: a dialog with no way out is the fault this exists to stop. */
  onClose: () => void
  /** Drawn as a heading with the close button beside it. Left out for a dialog that titles itself in its body. */
  title?: ReactNode
  /** What the close button says. "Back", when it returns somewhere rather than closing. */
  closeLabel?: string
  /** False while something must finish first — a download, a save. Closes off Escape, the backdrop and the button together. */
  canClose?: boolean
  /** False for a dialog holding typed words, where a stray click outside must not throw them away. */
  keepsTyping?: boolean
  /** For a dialog that is only a question. Says `alertdialog`, which asks to be read out at once. */
  asking?: boolean
  /** The id of the block that says what is at stake, so a question is read out with its stakes. */
  describedBy?: string
  /** Narrower, 420px rather than 660. */
  small?: boolean
  /** The panel's own class — `set-modal`, `notices-modal`. */
  className?: string
  /** Replaces `modal glass` entirely, for a family that brings its own panel — the Student sheets. */
  panel?: string
  /** Replaces `modal-backdrop`, for a cover that belongs to a screen rather than to the window. */
  cover?: string
  children: ReactNode
}

export function Modal({
  label,
  onClose,
  title,
  closeLabel = 'Close',
  canClose = true,
  keepsTyping = false,
  asking = false,
  describedBy,
  small,
  className,
  panel,
  cover,
  children
}: ModalProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusTrap(panelRef, true)

  useEffect(() => {
    if (!canClose) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Taken here rather than let through: the shell's handler would otherwise close the screen behind this one.
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    // Capturing, so this is the first to see the key rather than the last.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [canClose, onClose])

  const panelClass = [panel ?? 'modal glass', small === true && panel === undefined ? 'small' : '', className ?? '']
    .filter((one) => one !== '')
    .join(' ')

  return (
    <div
      className={cover ?? 'modal-backdrop'}
      role="presentation"
      onMouseDown={(event) => {
        if (!canClose || keepsTyping) return
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={panelClass}
        role={asking ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        {...(title === undefined ? { 'aria-label': label } : { 'aria-labelledby': titleId })}
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
      >
        {title === undefined ? null : (
          <header className="modal-header">
            <h2 id={titleId}>{title}</h2>
            <IconButton label={closeLabel} onClick={onClose} disabled={!canClose}>
              <X size={16} />
            </IconButton>
          </header>
        )}
        {children}
      </div>
    </div>
  )
}
