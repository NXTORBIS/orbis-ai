import { useEffect, useState } from 'react'

const PHRASES = [
  'where should we begin?',
  'what are we working on?',
  'need help with something?',
  'what would you like to accomplish?',
  "what's on your mind?"
]

/** Typewriter greeting that cycles phrases, with a short glitch burst on each change. */
export default function Greeting({ title }: { title: string }): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const [glitching, setGlitching] = useState(false)

  useEffect(() => {
    let phrase = 0
    let length = 0
    let deleting = false
    let timer: ReturnType<typeof setTimeout>
    let glitchTimer: ReturnType<typeof setTimeout>

    const burst = (ms: number): void => {
      setGlitching(true)
      clearTimeout(glitchTimer)
      glitchTimer = setTimeout(() => setGlitching(false), ms)
    }

    const tick = (): void => {
      const target = PHRASES[phrase]
      if (!deleting) {
        length += 1
        setTyped(target.slice(0, length))
        if (length === 1) burst(420)
        if (length >= target.length) {
          deleting = true
          timer = setTimeout(tick, 2400)
          return
        }
        timer = setTimeout(tick, 40 + Math.random() * 45)
      } else {
        length -= 1
        setTyped(target.slice(0, length))
        if (length === target.length - 1) burst(300)
        if (length <= 0) {
          deleting = false
          phrase = (phrase + 1) % PHRASES.length
          timer = setTimeout(tick, 400)
          return
        }
        timer = setTimeout(tick, 20)
      }
    }

    timer = setTimeout(tick, 450)
    return () => {
      clearTimeout(timer)
      clearTimeout(glitchTimer)
    }
  }, [])

  return (
    <h1 className={`greeting${glitching ? ' glitching' : ''}`} data-text={typed} aria-label={PHRASES[0]}>
      {typed}
      <span className="greeting-caret" />
    </h1>
  )
}
