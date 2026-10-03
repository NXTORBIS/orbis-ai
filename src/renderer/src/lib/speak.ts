import { shouldStopSpeaking, speakable, type SpeechStop } from '../../../shared/voiceReply'

/**
 * The one thing in Orbis that talks.
 *
 * There is one microphone for the whole application; there was no equivalent for the other direction. Reading aloud
 * lived inside a menu on one kind of message, so nothing else could speak, two messages could be read at once, and
 * speaking carried straight on while somebody held the microphone button down and talked over it.
 *
 * Everything that reads something out goes through here. That buys the three things one place always buys: exactly
 * one thing is ever being said, anything can ask what is being said, and stopping is one call from anywhere --
 * including from the microphone, which stops it without having to know what was speaking or why.
 */

export interface SpeakingStatus {
  speaking: boolean
  /** What is being read, by id, so a button can show itself as the one that is on. */
  id: string | null
}

type Listener = (status: SpeakingStatus) => void

class SpeechService {
  private listeners = new Set<Listener>()
  private current: string | null = null
  private utterance: SpeechSynthesisUtterance | null = null

  /** Whether this machine can speak at all. False is an honest answer, not an error. */
  get available(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  get status(): SpeakingStatus {
    return { speaking: this.current !== null, id: this.current }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  private announce(): void {
    const status = this.status
    for (const listener of this.listeners) listener(status)
  }

  /**
   * Reads something out, stopping whatever was being read first.
   *
   * Asking for the thing already being read stops it instead, which is what a single button that says "Read aloud"
   * and then "Stop reading" has to do. Returns whether it is now speaking.
   */
  speak(id: string, markdown: string, onStop?: (stop: SpeechStop) => void): boolean {
    if (!this.available) return false
    if (this.current === id) {
      this.stop('asked')
      return false
    }
    this.stop('asked')

    const { text } = speakable(markdown)
    if (!text) return false

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onend = () => {
      if (this.current !== id) return
      this.current = null
      this.utterance = null
      this.announce()
      onStop?.('finished')
    }
    utterance.onerror = () => {
      if (this.current !== id) return
      this.current = null
      this.utterance = null
      this.announce()
      onStop?.('failed')
    }
    this.current = id
    this.utterance = utterance
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    this.announce()
    return true
  }

  /** Stops, now. Not at the end of the sentence: somebody who interrupts has decided they have heard enough. */
  stop(why: SpeechStop = 'asked'): void {
    if (!this.available || this.current === null) return
    const utterance = this.utterance
    // Cleared before cancelling, so the handlers above see this is no longer the thing being read and stay quiet.
    this.current = null
    this.utterance = null
    if (utterance) {
      utterance.onend = null
      utterance.onerror = null
    }
    window.speechSynthesis.cancel()
    this.announce()
    void why
  }

  /**
   * The microphone opened.
   *
   * Speaking stops. This is the rule the whole file exists for, and it is why the microphone does not have to know
   * what was being read or which part of Orbis started it.
   */
  microphoneOpened(): void {
    const stop = shouldStopSpeaking({ microphoneOpen: true })
    if (stop) this.stop(stop)
  }
}

export const speech = new SpeechService()
