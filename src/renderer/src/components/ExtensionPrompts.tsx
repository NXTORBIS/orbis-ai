import { useEffect, useState } from 'react'
import { Puzzle } from 'lucide-react'
import type { ExtensionInstallRequest, ExtensionPermissionRequest } from '../../../shared/types'

type Prompt = ({ type: 'install' } & ExtensionInstallRequest) | ({ type: 'permissions' } & ExtensionPermissionRequest)

/**
 * Asks before an extension is added from the Chrome Web Store (showing what its permissions let it do), and when an
 * installed extension asks for more access. Nothing is installed or granted until the user agrees.
 */
export default function ExtensionPrompts(): React.JSX.Element | null {
  const [queue, setQueue] = useState<Prompt[]>([])

  useEffect(() => {
    const stopInstall = window.api.onExtensionInstallRequest((request) => setQueue((q) => [...q, { type: 'install', ...request }]))
    const stopPermissions = window.api.onExtensionPermissionRequest((request) => setQueue((q) => [...q, { type: 'permissions', ...request }]))
    return () => {
      stopInstall()
      stopPermissions()
    }
  }, [])

  const prompt = queue[0]
  if (!prompt) return null
  const answer = (allow: boolean): void => {
    window.api.answerExtensionPrompt(prompt.requestId, allow)
    setQueue((q) => q.slice(1))
  }

  return (
    <div className="ext-prompt-backdrop">
      <div className="popover glass ext-prompt" role="alertdialog" aria-labelledby="ext-prompt-title" aria-describedby="ext-prompt-body">
        <div className="ext-prompt-head">
          {prompt.type === 'install' && prompt.icon ? <img src={prompt.icon} alt="" width={36} height={36} /> : <Puzzle size={28} aria-hidden="true" />}
          <h3 id="ext-prompt-title">{prompt.type === 'install' ? `Add “${prompt.name}”?` : `“${prompt.name}” is asking for more access`}</h3>
        </div>
        <div id="ext-prompt-body">
          {prompt.warnings.length ? (
            <>
              <p>It can:</p>
              <ul>
                {prompt.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>{prompt.type === 'install' ? 'It doesn’t ask for any special permissions.' : 'It asks for additional permissions.'}</p>
          )}
        </div>
        <div className="ext-prompt-actions">
          <button type="button" className="tab-edit-btn" onClick={() => answer(false)}>
            {prompt.type === 'install' ? 'Cancel' : 'Deny'}
          </button>
          <button type="button" className="tab-edit-btn primary" autoFocus onClick={() => answer(true)}>
            {prompt.type === 'install' ? 'Add extension' : 'Allow'}
          </button>
        </div>
      </div>
    </div>
  )
}
