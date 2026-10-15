import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'

interface Props {
  onClose(): void
}

/**
 * Orbis Chance, full screen. It runs in its own frame (chance/index.html, built separately) so its stylesheet,
 * its storage handling and its worker stay out of the chat window, and the chat window's styles stay out of it.
 */
export default function ChanceView({ onClose }: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section className="eye-full" aria-label="Chance">
      <button type="button" className="eye-back" onClick={onClose} title="Back to chat (Esc)" aria-label="Back to chat">
        <ArrowLeft size={16} />
      </button>
      <iframe className="eye-frame" title="Orbis Chance" src={new URL('./chance/index.html', window.location.href).href} />
    </section>
  )
}
