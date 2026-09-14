// Sending the first message remounts the composer docked at the bottom, so its starting position is kept here.
let start: { rect: DOMRect; at: number } | null = null

export function rememberComposerStart(rect: DOMRect): void {
  start = { rect, at: performance.now() }
}

/** The centred composer's position, if a first message was sent within the last moment. */
export function peekComposerStart(): DOMRect | null {
  if (!start || performance.now() - start.at > 1500) return null
  return start.rect
}

export function clearComposerStart(): void {
  start = null
}
