import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { ControlConfirmRequest } from '../../../shared/browserControl'

const WHO: Record<ControlConfirmRequest['source'], string> = { orion: 'Orion', automation: 'An automation', user: 'Orbis' }

/**
 * Approvals for consequential actions Orion or an automation wants to take through the Browser Control Layer (removing
 * an extension, clearing history, submitting a form, answering a site's permission request…). Nothing happens until the
 * user approves; closing or cancelling declines.
 */
export default function ControlPrompts(): React.JSX.Element | null {
  const [queue, setQueue] = useState<ControlConfirmRequest[]>([])

  useEffect(() => window.api.onControlConfirm((request) => setQueue((q) => [...q, request])), [])

  const prompt = queue[0]
  if (!prompt) return null
  const answer = (approved: boolean): void => {
    window.api.answerControlConfirm(prompt.id, approved)
    setQueue((q) => q.slice(1))
  }

  return (
    <div className="ext-prompt-backdrop control-prompt-backdrop">
      <div
        className="popover glass ext-prompt control-prompt"
        role="alertdialog"
        aria-labelledby="control-prompt-title"
        aria-describedby="control-prompt-body"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            answer(false)
          }
        }}
      >
        <div className="ext-prompt-head">
          <ShieldAlert size={26} aria-hidden="true" />
          <h3 id="control-prompt-title">{WHO[prompt.source]} wants to:</h3>
        </div>
        <div id="control-prompt-body">
          <p className="control-prompt-action">{prompt.action}</p>
          <p>{prompt.reason} Nothing happens until you approve.</p>
          {queue.length > 1 && <p className="control-prompt-more">{queue.length - 1} more waiting.</p>}
        </div>
        <div className="ext-prompt-actions">
          <button type="button" className="tab-edit-btn" onClick={() => answer(false)}>
            Cancel
          </button>
          <button type="button" className="tab-edit-btn primary" autoFocus onClick={() => answer(true)}>
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
