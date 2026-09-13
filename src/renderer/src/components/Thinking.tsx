import { useEffect, useState } from 'react'
import { OrbisMark } from './Brand'

/** The Orbis ring turning inside a glowing halo while a reply is pending. */
export function ThinkingOrb(): React.JSX.Element {
  return (
    <div className="orb" aria-hidden="true">
      <OrbisMark size={30} className="orb-mark" />
    </div>
  )
}

const WORDS = ['Understanding', 'Analyzing', 'Reasoning', 'Composing']

/** Types out cycling status words with a block cursor. */
export function ThinkingText(): React.JSX.Element {
  const [index, setIndex] = useState(0)
  const [chars, setChars] = useState(0)
  const word = `${WORDS[index]}...`

  useEffect(() => {
    if (chars < word.length) {
      const timer = setTimeout(() => setChars((c) => c + 1), 55)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % WORDS.length)
      setChars(0)
    }, 1400)
    return () => clearTimeout(timer)
  }, [chars, word.length])

  return (
    <span className="thinking-text">
      {word.slice(0, chars)}
      <span className="block-caret" />
    </span>
  )
}
