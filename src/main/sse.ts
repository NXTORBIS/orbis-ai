/** Incrementally splits a text/event-stream body into event data payloads. */
export class SseParser {
  private buffer = ''
  private dataLines: string[] = []

  push(chunk: string): string[] {
    this.buffer += chunk
    const events: string[] = []
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      this.consumeLine(line, events)
    }
    return events
  }

  flush(): string[] {
    const events: string[] = []
    if (this.buffer) this.consumeLine(this.buffer.replace(/\r$/, ''), events)
    this.buffer = ''
    this.consumeLine('', events)
    return events
  }

  private consumeLine(line: string, events: string[]): void {
    if (line === '') {
      if (this.dataLines.length) events.push(this.dataLines.join('\n'))
      this.dataLines = []
    } else if (line.startsWith('data:')) {
      this.dataLines.push(line.slice(line.startsWith('data: ') ? 6 : 5))
    }
    // Comments (":") and other fields (event/id/retry) are not used by chat completions.
  }
}

export interface SplitText {
  content: string
  reasoning: string
}

const OPEN = '<think>'
const CLOSE = '</think>'

/**
 * Separates inline `<think>...</think>` reasoning from answer text for models that
 * don't use a dedicated `reasoning_content` field. Handles tags split across chunks.
 * Only a `<think>` that appears before any answer text is treated as a tag.
 */
export class ThinkTagSplitter {
  private inThink = false
  private sawContent = false
  private pending = ''

  push(text: string): SplitText {
    let rest = this.pending + text
    this.pending = ''
    const out: SplitText = { content: '', reasoning: '' }

    while (rest) {
      const tag = this.inThink ? CLOSE : this.sawContent ? null : OPEN
      if (!tag) {
        this.emit(out, rest)
        break
      }
      const at = rest.indexOf(tag)
      if (at !== -1 && !this.inThink && rest.slice(0, at).trim() !== '') {
        // Answer text precedes this <think>, so it's literal text rather than a reasoning tag.
        this.emit(out, rest)
        break
      }
      if (at !== -1) {
        this.emit(out, rest.slice(0, at))
        rest = rest.slice(at + tag.length)
        this.inThink = !this.inThink
        continue
      }
      const keep = partialTagSuffix(rest, tag)
      this.emit(out, rest.slice(0, rest.length - keep))
      this.pending = rest.slice(rest.length - keep)
      break
    }
    return out
  }

  flush(): SplitText {
    const out: SplitText = { content: '', reasoning: '' }
    this.emit(out, this.pending)
    this.pending = ''
    return out
  }

  private emit(out: SplitText, text: string): void {
    if (!text) return
    if (this.inThink) {
      out.reasoning += text
    } else {
      // Leading whitespace before a <think> tag shouldn't disable tag detection.
      if (!this.sawContent && text.trim() === '') return
      this.sawContent = true
      out.content += text
    }
  }
}

function partialTagSuffix(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(tag.slice(0, n))) return n
  }
  return 0
}
