import { useEffect, useRef, useState } from 'react'

interface Props {
  /** A Files tool to open once the frame is ready, e.g. 'universeExplorer'. */
  tool?: string
}

/**
 * The Files screen runs in its own frame (files.html). Its stylesheet restyles the whole document, so sharing a
 * page with the rest of Orbis made the Orbis window collapse; a frame keeps both exactly as they were.
 */
export default function FilesHost({ tool }: Props): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow) return
      if ((event.data as { type?: string } | null)?.type === 'orbis-files-ready') setReady(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (ready && tool) frame.current?.contentWindow?.postMessage({ type: 'orbis-files-open', tool }, '*')
  }, [ready, tool])

  return <iframe ref={frame} className="files-frame" title="Orbis Files" src={new URL('./files.html', window.location.href).href} />
}
