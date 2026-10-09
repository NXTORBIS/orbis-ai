import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * One laboratory, kept inside its own card when it goes wrong.
 *
 * ## Why this exists
 *
 * The Control Laboratory read a field off a value that was undefined. React has no middle setting for that: a throw
 * during a render unmounts the whole tree, so one wrong line in one laboratory left an entirely blank window -- no
 * chat, no sidebar, no way back -- and nothing on screen to say what had happened or that anything could be done
 * about it. The conversation was still there on disk the whole time.
 *
 * A laboratory is the most likely thing in Orbis to throw: there are fifty-odd of them, each reading a shape some
 * engine returned, and any one of those shapes can be missing a field on some input nobody tried. So each one renders
 * inside this, and a fault is a card that says so beside a chat that still works.
 *
 * ## What it does not do
 *
 * It does not retry, and it does not pretend. The card says which laboratory failed and what the fault was, and the
 * rest of Orbis carries on. Swallowing the message and showing a blank panel would be the same bug with better
 * manners.
 */

interface Props {
  /** Named in the message, so a card that failed says which one it was. */
  name: string
  children: ReactNode
}

interface State {
  fault: string | null
}

export class LabBoundary extends Component<Props, State> {
  state: State = { fault: null }

  static getDerivedStateFromError(error: unknown): State {
    return { fault: error instanceof Error ? error.message : 'Something in it went wrong.' }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is where this belongs: it is a programming fault, and the stack is what a person fixing it needs.
    console.error(`[${this.props.name}] stopped:`, error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.fault === null) return this.props.children
    return (
      <div className="na-fault" role="status">
        <AlertTriangle size={16} aria-hidden />
        <div>
          <strong>{this.props.name} stopped.</strong>
          <p>{this.state.fault}</p>
          <p className="na-fault-note">
            Nothing else in Orbis was affected, and nothing you had was lost. Close this card and open it again, or
            change a setting and it will try afresh.
          </p>
        </div>
      </div>
    )
  }
}

export default LabBoundary
