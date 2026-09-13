/** ORION process lifecycle management. */

import type { ChildProcess } from 'node:child_process'
import type { OrionClient } from './client'
import type { OrionState, OrionStatus, ProcessInfo } from './types'

export interface OrionManagerOptions {
  /** Path to ORION executable or Python module. */
  orionPath?: string
  /** Working directory for ORION process. */
  workDir?: string
  /** Maximum attempts to restart before giving up. */
  maxRestarts?: number
  /** Backoff multiplier for restart delays (ms). */
  restartBackoff?: number
  /** Timeout for ORION to become ready (ms). */
  readinessTimeout?: number
}

export class OrionManager {
  private state: OrionState = 'stopped'
  private process: ChildProcess | null = null
  private stateChangeCallbacks: ((state: OrionState) => void)[] = []
  private logs: string[] = []
  private maxLogs = 1000

  constructor(_client: OrionClient, _options: OrionManagerOptions = {}) {
    // ORION auto-start disabled - user must start manually
  }

  private addLog(message: string): void {
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] ${message}`
    this.logs.push(logLine)
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }
  }

  private setState(state: OrionState): void {
    if (this.state === state) return
    this.state = state
    this.addLog(`State changed to: ${state}`)
    this.stateChangeCallbacks.forEach((cb) => cb(state))
  }

  /** Start ORION process. */
  async start(): Promise<void> {
    if (this.state !== 'stopped' && this.state !== 'failed' && this.state !== 'crashed') {
      throw new Error(`Cannot start: current state is ${this.state}`)
    }

    this.setState('starting')
    // ORION auto-spawn disabled - user must start manually
    this.setState('failed')
    this.addLog('ORION auto-start disabled. Start ORION manually in terminal.')
  }

  /** Stop ORION process gracefully. */
  async stop(): Promise<void> {
    if (this.state === 'stopped') return

    this.setState('stopping')

    if (this.process) {
      try {
        this.process.kill('SIGTERM')
        // Wait up to 5s for graceful shutdown
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            if (this.process) {
              this.process.kill('SIGKILL')
            }
            resolve(undefined)
          }, 5000)

          this.process!.on('exit', () => {
            clearTimeout(timer)
            resolve(undefined)
          })
        })
      } catch (err) {
        this.addLog(`Error during stop: ${err instanceof Error ? err.message : String(err)}`)
      }

      this.process = null
    }

    this.setState('stopped')
    this.addLog('ORION stopped')
  }

  /** Restart ORION. */
  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  /** Get current state. */
  getState(): OrionState {
    return this.state
  }

  /** Get full status. */
  getStatus(): OrionStatus {
    return {
      state: this.state,
      uptime: 0,
      pid: this.process?.pid,
      error: this.state === 'failed' || this.state === 'error' ? 'ORION not ready' : undefined,
    }
  }

  /** Check if ORION is ready. */
  async isReady(): Promise<boolean> {
    return this.state === 'ready'
  }

  /** Register callback for state changes. */
  onStateChange(callback: (state: OrionState) => void): () => void {
    this.stateChangeCallbacks.push(callback)
    return () => {
      this.stateChangeCallbacks = this.stateChangeCallbacks.filter((cb) => cb !== callback)
    }
  }

  /** Get process info. */
  getProcessInfo(): ProcessInfo | null {
    if (!this.process) return null
    return {
      pid: this.process.pid || 0,
      uptime: 0,
      memory: 0,
      rss: 0,
    }
  }

  /** Get recent logs. */
  getLogs(limit: number = 100): string[] {
    return this.logs.slice(-limit)
  }

  /** Clear logs. */
  clearLogs(): void {
    this.logs = []
  }

}
