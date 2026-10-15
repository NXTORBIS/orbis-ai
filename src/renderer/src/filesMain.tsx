import '../../files/renderer/main'
import { activePane, currentLocation, navigate } from '../../files/renderer/state/workspace'

// The window buttons belong to the Orbis window around this frame; they must not reach it.
const style = document.createElement('style')
style.textContent = '.win-controls{display:none!important}'
document.head.appendChild(style)

/**
 * Opens a tool for the Orbis window (the Universe tab does). The Files screen restores its saved session while it
 * starts and would put its home page back, so the request is repeated until the tool is what is actually showing.
 */
async function openTool(tool: string): Promise<void> {
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1200 : 500))
    try {
      const here = currentLocation(activePane())
      if (here.kind === 'tool' && here.tool === tool) {
        if (i > 2) return
        continue
      }
      await navigate(activePane().id, { kind: 'tool', tool: tool as never })
    } catch {
      /* the screen is still starting */
    }
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  const data = event.data as { type?: string; tool?: string } | null
  if (data?.type === 'orbis-files-open' && typeof data.tool === 'string') void openTool(data.tool)
})
window.parent.postMessage({ type: 'orbis-files-ready' }, '*')
